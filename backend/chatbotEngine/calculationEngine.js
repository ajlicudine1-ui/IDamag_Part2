const {
  parseNumber,
  formatNumber,
  getColumns,
  normalizeText,
} = require("./utils");
const {
  findDatasetName,
  findColumn,
  findDatasetsContainingColumn,
  findSharedColumns,
} = require("./columnMatcher");
const {
  resolveFilters,
  inferValueFilters,
  inferDatasetValueFilters,
  mergeFilters,
  applyFilters,
} = require("./filterEngine");
const {
  formatLookupAnswer,
  formatAggregateAnswer,
  formatCountAnswer,
} = require("./responseFormatter");
const {
  findBestRelationship,
} = require("./relationshipEngine");
const {
  applySemanticContractScope,
  evaluateSemanticContractAggregation,
} = require("./semanticContractEngine");
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function getLimit(plan) {
  const value = Number(plan?.limit);

  if (!Number.isInteger(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(
    Math.max(value, 1),
    MAX_LIMIT
  );
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function requireColumn(rows, requested, label) {
  const column = findColumn(rows, requested);

  if (!column) {
    throw new Error(
      `${label} "${requested || ""}" was not found. ` +
      `Available columns: ${getColumns(rows).join(", ")}`
    );
  }

  return column;
}

function describeFilters(filters) {
  if (!filters.length) return "";

  return (
    " where " +
    filters
      .map(
        (filter) =>
          `${filter.column} ${filter.operator} "${filter.value}"`
      )
      .join(" and ")
  );
}


/**
 * Mixed-grain datasets can contain the same measure at several aggregation
 * levels (for example Province, Municipality, and Barangay). Summing all rows
 * in that situation double- or triple-counts the same underlying population.
 *
 * This layer is deliberately schema/data-driven. It does NOT know about any
 * particular dashboard, province, metric, or geography. A column is treated as
 * a grain marker only when:
 *   1) its name explicitly describes a level/grain/granularity; and
 *   2) at least two of its values map back to real columns in the same rows.
 *
 * Example of a detected hierarchy:
 *   geography_level = [Province, Municipality, Barangay]
 *   columns          = [province, municipality, barangay, ...]
 *
 * If the plan asks for a Province-scoped aggregate, Province rows are used. If
 * those rows cannot satisfy a requested grouping field, the engine falls back
 * to the nearest finer compatible level rather than mixing grains.
 */
function normalizeGrainKey(value, { descriptor = false } = {}) {
  let text = normalizeText(value)
    .replace(/[_.\\/()+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (descriptor) {
    text = text
      .replace(
        /\b(?:summary|summaries|total|totals|level|grain|granularity|aggregate|aggregation|detail|details|record|records|row|rows)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length > 4 && word.endsWith("ies")) {
        return `${word.slice(0, -3)}y`;
      }
      if (
        word.length > 3 &&
        word.endsWith("s") &&
        !word.endsWith("ss")
      ) {
        return word.slice(0, -1);
      }
      return word;
    });

  return words.join(" ");
}

function isPotentialGrainColumn(column) {
  const normalized = normalizeText(column)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    normalized === "level" ||
    normalized === "grain" ||
    normalized === "granularity" ||
    /(?:^| )(?:level|grain|granularity)$/.test(normalized)
  );
}

function findDimensionForGrainValue(columns, grainColumn, value) {
  const target = normalizeGrainKey(value, { descriptor: true });
  if (!target) return null;

  const candidates = columns
    .filter((column) => column !== grainColumn)
    .map((column) => ({
      column,
      key: normalizeGrainKey(column),
    }))
    .filter((item) => item.key);

  const exact = candidates.find((item) => item.key === target);
  if (exact) return exact.column;

  // Controlled containment supports values such as "Province Summary" after
  // descriptor cleanup while avoiding very short accidental matches.
  if (target.length >= 5) {
    const contained = candidates
      .filter(
        (item) =>
          item.key.length >= 5 &&
          (item.key.includes(target) || target.includes(item.key))
      )
      .sort((a, b) => Math.abs(a.key.length - target.length) - Math.abs(b.key.length - target.length))[0];

    if (contained) return contained.column;
  }

  return null;
}

function detectGrainHierarchies(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const columns = getColumns(rows);
  const hierarchies = [];

  for (const grainColumn of columns.filter(isPotentialGrainColumn)) {
    const valueMap = new Map();

    for (const row of rows) {
      const raw = String(row?.[grainColumn] ?? "").trim();
      if (!raw) continue;
      const key = normalizeText(raw);
      if (!valueMap.has(key)) {
        valueMap.set(key, {
          value: raw,
          count: 0,
        });
      }
      valueMap.get(key).count += 1;
    }

    const distinctValues = [...valueMap.values()];
    if (distinctValues.length < 2 || distinctValues.length > 50) {
      continue;
    }

    const levels = distinctValues.map((entry) => ({
      ...entry,
      dimensionColumn: findDimensionForGrainValue(
        columns,
        grainColumn,
        entry.value
      ),
    }));

    const mapped = levels.filter((level) => level.dimensionColumn);
    const coverage = mapped.length / distinctValues.length;

    // Requiring two mapped levels prevents ordinary categorical fields from
    // being mistaken for hierarchy/grain controls.
    if (mapped.length < 2 || coverage < 0.5) {
      continue;
    }

    hierarchies.push({
      grainColumn,
      levels,
      mappedLevels: mapped,
      coverage,
    });
  }

  return hierarchies.sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    return b.mappedLevels.length - a.mappedLevels.length;
  });
}

function rowsAtGrain(rows, grainColumn, grainValue) {
  const wanted = normalizeText(grainValue);
  return (rows || []).filter(
    (row) => normalizeText(row?.[grainColumn]) === wanted
  );
}

function nonEmptyRatio(rows, column) {
  if (!column || !Array.isArray(rows) || !rows.length) return 0;
  let populated = 0;

  for (const row of rows) {
    const value = row?.[column];
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ""
    ) {
      populated += 1;
    }
  }

  return populated / rows.length;
}

function resolveGrainSelection({
  hierarchy,
  allRows,
  scopedRows,
  plan,
  filters,
  operation,
}) {
  const mappedLevels = hierarchy.mappedLevels
    .map((level) => ({
      ...level,
      globalCount: rowsAtGrain(
        allRows,
        hierarchy.grainColumn,
        level.value
      ).length,
      scopedRows: rowsAtGrain(
        scopedRows,
        hierarchy.grainColumn,
        level.value
      ),
    }))
    .filter((level) => level.globalCount > 0);

  if (mappedLevels.length < 2) return null;

  // Coarser levels normally contain fewer rows. This data-derived ordering is
  // intentionally independent of words such as Province/Month/Year.
  const ordered = [...mappedLevels].sort(
    (a, b) => a.globalCount - b.globalCount
  );

  const resolvedGroupColumn =
    plan.groupBy && findColumn(allRows, plan.groupBy);
  const resolvedLabelColumn =
    plan.labelColumn && findColumn(allRows, plan.labelColumn);

  const requiredColumns = [];
  if (
    [
      "group_sum",
      "group_average",
      "group_minimum",
      "group_maximum",
      "rank_groups",
    ].includes(operation)
  ) {
    if (resolvedGroupColumn) requiredColumns.push(resolvedGroupColumn);
    if (
      resolvedLabelColumn &&
      resolvedLabelColumn !== resolvedGroupColumn
    ) {
      requiredColumns.push(resolvedLabelColumn);
    }
  }

  const isCompatible = (level) => {
    if (!level.scopedRows.length) return false;
    return requiredColumns.every(
      (column) => nonEmptyRatio(level.scopedRows, column) >= 0.5
    );
  };

  const targetColumns = [];
  if (resolvedGroupColumn) targetColumns.push(resolvedGroupColumn);
  if (
    resolvedLabelColumn &&
    !targetColumns.includes(resolvedLabelColumn)
  ) {
    targetColumns.push(resolvedLabelColumn);
  }

  for (const filter of filters || []) {
    const resolved = findColumn(allRows, filter?.column);
    if (resolved && !targetColumns.includes(resolved)) {
      targetColumns.push(resolved);
    }
  }

  let requestedLevel = null;
  let requestedDimension = null;

  for (const targetColumn of targetColumns) {
    const targetKey = normalizeGrainKey(targetColumn);
    const match = ordered.find(
      (level) =>
        normalizeGrainKey(level.dimensionColumn) === targetKey
    );

    if (match) {
      requestedLevel = match;
      requestedDimension = targetColumn;
      break;
    }
  }

  if (requestedLevel) {
    if (isCompatible(requestedLevel)) {
      return {
        level: requestedLevel,
        strategy: "requested_level",
        requestedDimension,
      };
    }

    // If the exact requested summary level cannot carry another requested
    // dimension (for example grouping by Commodity), move only toward finer
    // levels until one can answer the question. This avoids mixing levels and
    // avoids discarding necessary detail columns.
    const requestedIndex = ordered.indexOf(requestedLevel);
    for (let index = requestedIndex + 1; index < ordered.length; index += 1) {
      if (isCompatible(ordered[index])) {
        return {
          level: ordered[index],
          strategy: "nearest_finer_compatible_level",
          requestedDimension,
        };
      }
    }

    return null;
  }

  // With no explicit hierarchy level in the plan, use the coarsest compatible
  // level. Summing one complete level is safe; summing all levels is not.
  const coarsestCompatible = ordered.find(isCompatible);
  if (!coarsestCompatible) return null;

  return {
    level: coarsestCompatible,
    strategy: "coarsest_compatible_level",
    requestedDimension: null,
  };
}

function applyGrainAwareAggregation({
  rows,
  filteredRows,
  plan,
  filters,
  operation,
}) {
  const supportedOperations = new Set([
    "sum",
    "average",
    "median",
    "minimum",
    "maximum",
    "group_sum",
    "group_average",
    "group_minimum",
    "group_maximum",
    "rank_groups",
  ]);

  if (!supportedOperations.has(operation)) {
    return {
      rows: filteredRows,
      metadata: null,
    };
  }

  const hierarchies = detectGrainHierarchies(rows);
  if (!hierarchies.length) {
    return {
      rows: filteredRows,
      metadata: null,
    };
  }

  let scopedRows = filteredRows;
  const selections = [];

  for (const hierarchy of hierarchies) {
    const selection = resolveGrainSelection({
      hierarchy,
      allRows: rows,
      scopedRows,
      plan,
      filters,
      operation,
    });

    if (!selection?.level) continue;

    const before = scopedRows.length;
    const nextRows = selection.level.scopedRows;

    if (!nextRows.length) continue;

    scopedRows = nextRows;
    selections.push({
      column: hierarchy.grainColumn,
      value: selection.level.value,
      dimensionColumn: selection.level.dimensionColumn,
      strategy: selection.strategy,
      requestedDimension: selection.requestedDimension,
      rowsBefore: before,
      rowsAfter: scopedRows.length,
    });
  }

  const applied =
    selections.length > 0 &&
    scopedRows.length < filteredRows.length;

  if (!applied) {
    return {
      rows: filteredRows,
      metadata: null,
    };
  }

  return {
    rows: scopedRows,
    metadata: {
      grainAwareAggregation: true,
      grainColumn: selections[0].column,
      grainValue: selections[0].value,
      grainStrategy: selections[0].strategy,
      grainSelections: selections,
      rowsBeforeGrainSelection: filteredRows.length,
      rowsAfterGrainSelection: scopedRows.length,
    },
  };
}


function transformLookupValue(value, transform) {
  const text = String(value ?? "").trim();

  if (!transform || !text) {
    return text;
  }

  const parts = text
    .split(/\s+/)
    .filter(Boolean);

  if (transform === "first_word") {
    return parts[0] || "";
  }

  if (transform === "last_word") {
    return parts[parts.length - 1] || "";
  }

  return text;
}


function nonEmptyValues(rows, column) {
  const values = new Set();

  for (const row of rows || []) {
    const value = String(row?.[column] ?? "").trim();
    if (value) values.add(value.toLowerCase());
  }

  return values;
}

function scoreJoinColumn(sourceRows, targetRows, shared) {
  const sourceValues = nonEmptyValues(sourceRows, shared.leftColumn);
  const targetValues = nonEmptyValues(targetRows, shared.rightColumn);

  if (!sourceValues.size || !targetValues.size) return 0;

  let overlap = 0;
  for (const value of sourceValues) {
    if (targetValues.has(value)) overlap += 1;
  }

  const overlapRatio =
    overlap / Math.max(1, Math.min(sourceValues.size, targetValues.size));

  const sourceUniqueRatio =
    sourceValues.size / Math.max(1, sourceRows.length);

  const targetUniqueRatio =
    targetValues.size / Math.max(1, targetRows.length);

  return overlapRatio * 4 + sourceUniqueRatio + targetUniqueRatio;
}

function chooseJoin(
  sourceRows,
  targetRows
) {
  return (
    findBestRelationship(
      sourceRows,
      targetRows
    ) || null
  );
}

function getRequestedOutputColumns(datasets, plan) {
  const requested = [];

  if (Array.isArray(plan.selectColumns)) {
    requested.push(...plan.selectColumns);
  }

  if (plan.column) requested.push(plan.column);

  const results = [];
  const seen = new Set();

  for (const item of requested.filter(Boolean)) {
    for (const match of findDatasetsContainingColumn(datasets, item)) {
      const key = `${match.dataset}|${match.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(match);
      }
    }
  }

  return results;
}

function getRequestedColumnNames(plan) {
  const requested = [];

  if (Array.isArray(plan.selectColumns)) {
    requested.push(...plan.selectColumns);
  }

  if (plan.column) requested.push(plan.column);

  const seen = new Set();
  return requested
    .map((item) => String(item || "").trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildJoinIndex(rows, column) {
  const index = new Map();

  for (const row of rows || []) {
    const key = normalizeJoinValue(row?.[column]);
    if (!key) continue;

    if (!index.has(key)) {
      index.set(key, []);
    }

    index.get(key).push(row);
  }

  return index;
}

function findBestTargetForColumn({
  datasets,
  sourceDataset,
  requestedColumn,
}) {
  const sourceRows = datasets[sourceDataset];

  if (!Array.isArray(sourceRows) || !sourceRows.length) {
    return null;
  }

  return findDatasetsContainingColumn(datasets, requestedColumn)
    .filter((match) => match.dataset !== sourceDataset)
    .map((match) => {
      const targetRows = datasets[match.dataset];

      if (!Array.isArray(targetRows) || !targetRows.length) {
        return null;
      }

      const join = chooseJoin(sourceRows, targetRows);
      if (!join) return null;

      return {
        ...match,
        join,
        targetRows,
        score: join.score || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0] || null;
}

/**
 * Generic cross-worksheet lookup that MERGES requested fields
 * from multiple worksheets into one result object.
 */
function dedupeProjectedLookupResults(results, selectedColumns = []) {
  const seen = new Set();
  const unique = [];

  for (const item of Array.isArray(results) ? results : []) {
    const columns = selectedColumns.length
      ? selectedColumns
      : Object.keys(item || {});

    const key = columns
      .map((column) => normalizeText(item?.[column]))
      .join("\u001f");

    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function tryCrossDatasetLookup({
  datasets,
  plan,
  question,
  preferredDataset = null,
  preferredRows = null,
  preferredFilters = [],
}) {
  const requestedColumns = getRequestedColumnNames(plan);

  if (!requestedColumns.length) return null;

  const sourceCandidates = [];

  if (
    preferredDataset &&
    Array.isArray(datasets[preferredDataset]) &&
    datasets[preferredDataset].length
  ) {
    const matches = Array.isArray(preferredRows)
      ? preferredRows
      : datasets[preferredDataset];

    if (matches.length) {
      sourceCandidates.push({
        dataset: preferredDataset,
        rows: datasets[preferredDataset],
        matches,
        filters: preferredFilters,
      });
    }
  }

  const valueMatches = inferDatasetValueFilters(datasets, question);

  for (const valueMatch of valueMatches) {
    const sourceRows = datasets[valueMatch.dataset];
    if (!Array.isArray(sourceRows) || !sourceRows.length) continue;

    const sourceFilter = {
      column: valueMatch.column,
      operator: valueMatch.operator || "equals",
      value: valueMatch.value,
    };

    const sourceMatches = applyFilters(sourceRows, [sourceFilter]);
    if (!sourceMatches.length) continue;

    if (!sourceCandidates.some((item) => item.dataset === valueMatch.dataset)) {
      sourceCandidates.push({
        dataset: valueMatch.dataset,
        rows: sourceRows,
        matches: sourceMatches,
        filters: [sourceFilter],
      });
    }
  }

  for (const source of sourceCandidates) {
    const resolvers = [];
    let hasCrossDatasetColumn = false;
    let failed = false;

    for (const requested of requestedColumns) {
      const localColumn = findColumn(source.rows, requested);

      if (localColumn) {
        resolvers.push({
          dataset: source.dataset,
          column: localColumn,
          local: true,
        });
        continue;
      }

      const target = findBestTargetForColumn({
        datasets,
        sourceDataset: source.dataset,
        requestedColumn: requested,
      });

      if (!target) {
        failed = true;
        break;
      }

      hasCrossDatasetColumn = true;

      resolvers.push({
        dataset: target.dataset,
        column: target.column,
        local: false,
        join: target.join,
        index: buildJoinIndex(
          target.targetRows,
          target.join.rightColumn
        ),
      });
    }

    if (failed || !hasCrossDatasetColumn) continue;

    const limit = getLimit(plan);
    const sourceRowsToShow = plan.showAll
      ? source.matches
      : source.matches.slice(0, limit);

    const results = [];

    for (const sourceRow of sourceRowsToShow) {
      const projected = {};
      let complete = true;

      for (const resolver of resolvers) {
        if (resolver.local) {
          projected[resolver.column] = transformLookupValue(
            sourceRow?.[resolver.column],
            plan.transform
          );
          continue;
        }

        const joinKey = normalizeJoinValue(
          sourceRow?.[resolver.join.leftColumn]
        );

        const relatedRows = joinKey
          ? resolver.index.get(joinKey) || []
          : [];

        if (!relatedRows.length) {
          complete = false;
          break;
        }

        // Collect ALL unique matching values from the related worksheet.
        // Example:
        // CN201708932 -> Rice, Corn, Vegetables, Legumes, Cattle
        const relatedValues = [];
        const seenRelatedValues = new Set();

        for (const relatedRow of relatedRows) {
          const transformedValue = transformLookupValue(
            relatedRow?.[resolver.column],
            plan.transform
          );

          const displayValue = String(
            transformedValue ?? ""
          ).trim();

          if (!displayValue) continue;

          const normalizedValue = displayValue.toLowerCase();

          if (!seenRelatedValues.has(normalizedValue)) {
            seenRelatedValues.add(normalizedValue);
            relatedValues.push(displayValue);
          }
        }

        if (!relatedValues.length) {
          complete = false;
          break;
        }

        projected[resolver.column] = relatedValues.join(", ");
      }

      if (complete) {
        results.push(projected);
      }
    }

    if (!results.length) continue;

    const selectedColumns = resolvers.map((item) => item.column);
    const distinctResults = dedupeProjectedLookupResults(results, selectedColumns);

    return {
      success: true,
      source: "dataset",
      dataset: source.dataset,
      operation: "lookup",
      crossDataset: true,
      joins: resolvers
        .filter((item) => !item.local)
        .map((item) => ({
          sourceDataset: source.dataset,
          targetDataset: item.dataset,
          sourceColumn: item.join.leftColumn,
          targetColumn: item.join.rightColumn,
          outputColumn: item.column,
        })),
      filters: source.filters,
      matchedRowCount: results.length,
      count: distinctResults.length,
      results: distinctResults,
      duplicateLookupRowsRemoved: distinctResults.length !== results.length,
      answer: formatLookupAnswer({
        results: distinctResults,
        selectedColumns,
        count: distinctResults.length,
      }),
    };
  }

  return null;
}

function normalizeJoinValue(value) {
  return String(value ?? "").trim().toLowerCase();
}


function executePlannedCrossDatasetCount({
  datasets,
  plan,
}) {
  const cross =
    plan?.crossDatasetFilter;

  const operation = String(
    plan?.operation || ""
  )
    .trim()
    .toLowerCase();

  if (
    !cross ||
    ![
      "non_empty_count",
      "distinct_count",
    ].includes(operation)
  ) {
    return null;
  }

  const sourceRows =
    datasets?.[
      cross.sourceDataset
    ];

  const targetRows =
    datasets?.[
      plan.dataset
    ];

  if (
    !Array.isArray(sourceRows) ||
    !sourceRows.length
  ) {
    throw new Error(
      `Source worksheet "${cross.sourceDataset}" has no usable rows.`
    );
  }

  if (
    !Array.isArray(targetRows) ||
    !targetRows.length
  ) {
    throw new Error(
      `Target worksheet "${plan.dataset}" has no usable rows.`
    );
  }

  const sourceMatches =
    applyFilters(
      sourceRows,
      [
        {
          column:
            cross.sourceColumn,
          operator:
            cross.operator ||
            "equals",
          value:
            cross.value,
        },
      ]
    );

  if (!sourceMatches.length) {
    return {
      success: true,
      source: "dataset",
      dataset: plan.dataset,
      operation,
      column: plan.column,
      value: 0,
      recordsUsed: 0,
      answer:
        `There are 0 ${plan.column} record(s) connected to "${cross.value}".`,
    };
  }

  const bestRelationship =
  findBestRelationship(
    sourceRows,
    targetRows
  );

  const joinCandidates =
    bestRelationship
      ? [bestRelationship]
      : [];

  let selectedJoin = null;
  let targetIndex = null;

  for (
    const candidate of
    joinCandidates
  ) {
    const index =
      buildJoinIndex(
        targetRows,
        candidate.rightColumn
      );

    const connects =
      sourceMatches.some(
        (row) => {
          const key =
            normalizeJoinValue(
              row?.[
                candidate.leftColumn
              ]
            );

          return (
            key &&
            (index.get(key) || [])
              .length > 0
          );
        }
      );

    if (connects) {
      selectedJoin =
        candidate;
      targetIndex =
        index;
      break;
    }
  }

  if (
    !selectedJoin ||
    !targetIndex
  ) {
    return {
      success: false,
      source: "dataset",
      dataset: plan.dataset,
      operation,
      column: plan.column,
      value: 0,
      answer:
        `I found "${cross.value}" in ${cross.sourceDataset}, but I could not connect it to ${plan.dataset}.`,
    };
  }

  const requestedColumn =
    requireColumn(
      targetRows,
      plan.column,
      "Column"
    );

  const relatedRows = [];
  const seenRowKeys =
    new Set();

  for (
    const sourceRow of
    sourceMatches
  ) {
    const key =
      normalizeJoinValue(
        sourceRow?.[
          selectedJoin.leftColumn
        ]
      );

    if (!key) {
      continue;
    }

    for (
      const targetRow of
      targetIndex.get(key) || []
    ) {
      const rowKey =
        JSON.stringify(
          targetRow
        );

      if (
        !seenRowKeys.has(
          rowKey
        )
      ) {
        seenRowKeys.add(
          rowKey
        );
        relatedRows.push(
          targetRow
        );
      }
    }
  }

  const values =
    relatedRows
      .map(
        (row) =>
          row?.[
            requestedColumn
          ]
      )
      .filter(
        (value) =>
          value !== null &&
          value !== undefined &&
          String(value).trim() !== ""
      );

  if (
    operation ===
    "distinct_count"
  ) {
    const unique =
      new Set(
        values.map(
          (value) =>
            String(value)
              .trim()
              .toLowerCase()
        )
      );

    return {
      success: true,
      source: "dataset",
      dataset: plan.dataset,
      operation,
      column:
        requestedColumn,
      value:
        unique.size,
      recordsUsed:
        values.length,
      crossDataset: true,
      answer:
        `There are ${formatNumber(unique.size)} unique ${requestedColumn} value(s) connected to ${cross.value}.`,
    };
  }

  return {
    success: true,
    source: "dataset",
    dataset: plan.dataset,
    operation,
    column:
      requestedColumn,
    value:
      values.length,
    recordsUsed:
      relatedRows.length,
    crossDataset: true,
    answer:
      `There are ${formatNumber(values.length)} ${requestedColumn} record(s) connected to ${cross.value}.`,
  };
}


function executePlannedCrossDatasetLookup({
  datasets,
  plan,
}) {
  const cross = plan?.crossDatasetFilter;

  if (!cross) {
    return null;
  }

  const sourceRows = datasets?.[cross.sourceDataset];
  const targetRows = datasets?.[plan.dataset];

  if (!Array.isArray(sourceRows) || !sourceRows.length) {
    throw new Error(
      `Source worksheet "${cross.sourceDataset}" has no usable rows.`
    );
  }

  if (!Array.isArray(targetRows) || !targetRows.length) {
    throw new Error(
      `Target worksheet "${plan.dataset}" has no usable rows.`
    );
  }

  const sourceFilter = {
    column: cross.sourceColumn,
    operator: cross.operator || "equals",
    value: cross.value,
  };

  const matchedSourceRows = applyFilters(
    sourceRows,
    [sourceFilter]
  );

  if (!matchedSourceRows.length) {
    return {
      success: true,
      source: "dataset",
      dataset: plan.dataset,
      operation: "lookup",
      crossDataset: true,
      filters: [sourceFilter],
      count: 0,
      results: [],
      answer:
        `No matching record was found for "${cross.value}".`,
    };
  }

  const joinCandidates = findSharedColumns(
    sourceRows,
    targetRows
  )
    .map((shared) => ({
      ...shared,
      score: scoreJoinColumn(
        sourceRows,
        targetRows,
        shared
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  let selectedJoin = null;

  for (const candidate of joinCandidates) {
    const targetIndex = buildJoinIndex(
      targetRows,
      candidate.rightColumn
    );

    const hasMatchedBridge = matchedSourceRows.some(
      (row) => {
        const key = normalizeJoinValue(
          row?.[candidate.leftColumn]
        );

        return (
          key &&
          Array.isArray(
            targetIndex.get(key)
          ) &&
          targetIndex.get(key).length > 0
        );
      }
    );

    if (hasMatchedBridge) {
      selectedJoin = {
        ...candidate,
        targetIndex,
      };
      break;
    }
  }

  if (!selectedJoin) {
    return {
      success: false,
      source: "dataset",
      dataset: plan.dataset,
      operation: "lookup",
      crossDataset: true,
      filters: [sourceFilter],
      count: 0,
      results: [],
      answer:
        `I found "${cross.value}" in ${cross.sourceDataset}, ` +
        `but I could not find a shared column that connects it to ${plan.dataset}.`,
    };
  }

  const requestedColumns =
    getRequestedColumnNames(plan);

  if (!requestedColumns.length) {
    throw new Error(
      "No output column was requested for the cross-worksheet lookup."
    );
  }

  const selectedColumns = [];

  for (const requested of requestedColumns) {
    const exactTargetColumn =
      findColumn(
        targetRows,
        requested
      );

    if (exactTargetColumn) {
      selectedColumns.push(
        exactTargetColumn
      );
    }
  }

  if (!selectedColumns.length) {
    throw new Error(
      `The requested output field was not found in ${plan.dataset}.`
    );
  }

  const limit = getLimit(plan);

  const results = [];
  const seenRows = new Set();

  for (const sourceRow of matchedSourceRows) {
    const joinKey = normalizeJoinValue(
      sourceRow?.[
        selectedJoin.leftColumn
      ]
    );

    if (!joinKey) {
      continue;
    }

    const relatedRows =
      selectedJoin.targetIndex.get(
        joinKey
      ) || [];

    for (const relatedRow of relatedRows) {
      const projected = {};

      for (const selectedColumn of selectedColumns) {
        projected[selectedColumn] =
          transformLookupValue(
            relatedRow?.[
              selectedColumn
            ],
            plan.transform
          );
      }

      const rowKey =
        JSON.stringify(projected);

      if (!seenRows.has(rowKey)) {
        seenRows.add(rowKey);
        results.push(projected);
      }
    }
  }

  const displayedResults =
    plan.showAll
      ? results
      : results.slice(0, limit);

  if (!displayedResults.length) {
    return {
      success: true,
      source: "dataset",
      dataset: plan.dataset,
      operation: "lookup",
      crossDataset: true,
      filters: [sourceFilter],
      count: 0,
      results: [],
      joins: [
        {
          sourceDataset:
            cross.sourceDataset,
          targetDataset:
            plan.dataset,
          sourceColumn:
            selectedJoin.leftColumn,
          targetColumn:
            selectedJoin.rightColumn,
        },
      ],
      answer:
        `No ${selectedColumns.join(
          ", "
        )} value was found for "${cross.value}".`,
    };
  }

  return {
    success: true,
    source: "dataset",
    dataset: plan.dataset,
    operation: "lookup",
    crossDataset: true,
    filters: [sourceFilter],
    count: displayedResults.length,
    results: displayedResults,
    joins: [
      {
        sourceDataset:
          cross.sourceDataset,
        targetDataset:
          plan.dataset,
        sourceColumn:
          selectedJoin.leftColumn,
        targetColumn:
          selectedJoin.rightColumn,
      },
    ],
    answer: formatLookupAnswer({
      results: displayedResults,
      selectedColumns,
      count: displayedResults.length,
    }),
  };
}



function executeCrossDatasetGroupedAggregation({
  datasets,
  plan,
  question,
}) {
  const operation = String(
    plan?.operation || ""
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  const supportedOperations = new Set([
    "group_count",
    "group_sum",
    "group_average",
    "group_minimum",
    "group_maximum",
    "rank_groups",
  ]);

  if (!supportedOperations.has(operation)) {
    return null;
  }

  const groupRequest =
    plan.labelColumn ||
    plan.groupBy;

  const metricRequest =
    plan.column;

  if (!groupRequest || !metricRequest) {
    return null;
  }

  const groupMatches =
    findDatasetsContainingColumn(
      datasets,
      groupRequest
    );

  const metricMatches =
    findDatasetsContainingColumn(
      datasets,
      metricRequest
    );

  if (
    !groupMatches.length ||
    !metricMatches.length
  ) {
    return null;
  }

  /*
   * Existing same-worksheet grouped logic should continue handling
   * plans where both columns are already in one worksheet.
   */
  const sameDatasetMatch =
    groupMatches.find((group) =>
      metricMatches.some(
        (metric) =>
          metric.dataset ===
          group.dataset
      )
    );

  if (sameDatasetMatch) {
    return null;
  }

  let selected = null;

  for (const groupMatch of groupMatches) {
    const groupRows =
      datasets[groupMatch.dataset];

    if (
      !Array.isArray(groupRows) ||
      !groupRows.length
    ) {
      continue;
    }

    for (const metricMatch of metricMatches) {
      if (
        metricMatch.dataset ===
        groupMatch.dataset
      ) {
        continue;
      }

      const metricRows =
        datasets[metricMatch.dataset];

      if (
        !Array.isArray(metricRows) ||
        !metricRows.length
      ) {
        continue;
      }

      const join =
        chooseJoin(
          groupRows,
          metricRows
        );

      if (!join) {
        continue;
      }

      const score =
        Number(join.score || 0);

      if (
        !selected ||
        score > selected.score
      ) {
        selected = {
          groupDataset:
            groupMatch.dataset,
          metricDataset:
            metricMatch.dataset,
          groupColumn:
            groupMatch.column,
          metricColumn:
            metricMatch.column,
          groupRows,
          metricRows,
          join,
          score,
        };
      }
    }
  }

  if (!selected) {
    return null;
  }

  /*
   * Resolve filters separately in both worksheets.
   * A filter is applied only where its column exists.
   */
  const groupFilters =
    resolveFilters(
      selected.groupRows,
      plan.filters
    );

  const metricFilters =
    resolveFilters(
      selected.metricRows,
      plan.filters
    );

  const implicitGroupFilters =
    inferValueFilters(
      selected.groupRows,
      question,
      [
        selected.groupColumn,
        selected.join.leftColumn,
      ]
    );

  const implicitMetricFilters =
    inferValueFilters(
      selected.metricRows,
      question,
      [
        selected.metricColumn,
        selected.join.rightColumn,
      ]
    );

  const filteredGroupRows =
    applyFilters(
      selected.groupRows,
      mergeFilters(
        groupFilters,
        implicitGroupFilters
      )
    );

  const filteredMetricRows =
    applyFilters(
      selected.metricRows,
      mergeFilters(
        metricFilters,
        implicitMetricFilters
      )
    );

  const metricIndex =
    buildJoinIndex(
      filteredMetricRows,
      selected.join.rightColumn
    );

  const aggregation =
    operation === "group_count"
      ? "count"
      : operation === "group_sum"
        ? "sum"
        : operation === "group_average"
          ? "average"
          : operation === "group_minimum"
            ? "minimum"
            : operation === "group_maximum"
              ? "maximum"
              : ["sum", "average", "count"].includes(
                    String(
                      plan.aggregation || ""
                    ).toLowerCase()
                  )
                ? String(
                    plan.aggregation
                  ).toLowerCase()
                : "sum";

  const groups = new Map();

  for (const groupRow of filteredGroupRows) {
    const label = String(
      groupRow?.[
        selected.groupColumn
      ] ?? ""
    ).trim();

    if (!label) {
      continue;
    }

    const joinKey =
      normalizeJoinValue(
        groupRow?.[
          selected.join.leftColumn
        ]
      );

    if (!joinKey) {
      continue;
    }

    const relatedRows =
      metricIndex.get(joinKey) ||
      [];

    if (!relatedRows.length) {
      continue;
    }

    if (!groups.has(label)) {
      groups.set(label, {
        sum: 0,
        count: 0,
        minimum: null,
        maximum: null,
      });
    }

    const group =
      groups.get(label);

    for (const metricRow of relatedRows) {
      if (aggregation === "count") {
        const rawValue =
          metricRow?.[
            selected.metricColumn
          ];

        if (
          rawValue === null ||
          rawValue === undefined ||
          String(rawValue).trim() === ""
        ) {
          continue;
        }

        group.sum += 1;
        group.count += 1;
        continue;
      }

      const numericValue =
        parseNumber(
          metricRow?.[
            selected.metricColumn
          ]
        );

      if (numericValue === null) {
        continue;
      }

      group.sum += numericValue;
      group.count += 1;

      group.minimum =
        group.minimum === null
          ? numericValue
          : Math.min(
              group.minimum,
              numericValue
            );

      group.maximum =
        group.maximum === null
          ? numericValue
          : Math.max(
              group.maximum,
              numericValue
            );
    }
  }

  const direction =
    plan.direction === "asc"
      ? "asc"
      : "desc";

  const limit =
    getLimit(plan);

  let results =
    [...groups.entries()]
      .map(([label, group]) => {
        let value = null;

        if (aggregation === "count") {
          value = group.count;
        } else if (aggregation === "average") {
          value =
            group.count > 0
              ? group.sum /
                group.count
              : null;
        } else if (aggregation === "minimum") {
          value = group.minimum;
        } else if (aggregation === "maximum") {
          value = group.maximum;
        } else {
          value = group.sum;
        }

        return {
          label,
          value,
          recordsUsed:
            group.count,
        };
      })
      .filter(
        (item) =>
          item.value !== null
      )
      .sort((a, b) =>
        direction === "asc"
          ? a.value - b.value
          : b.value - a.value
      );

  if (
    operation === "rank_groups" ||
    plan.showAll !== true
  ) {
    results =
      results.slice(0, limit);
  }

  if (!results.length) {
    throw new Error(
      `No cross-worksheet grouped values were found for "${selected.groupColumn}" by "${selected.metricColumn}".`
    );
  }

  const heading =
    operation === "rank_groups"
      ? `${
          direction === "desc"
            ? "Top"
            : "Bottom"
        } ${results.length} ${selected.groupColumn} by ${aggregation} ${selected.metricColumn}`
      : `${aggregation} ${selected.metricColumn} by ${selected.groupColumn}`;

  return {
    success: true,
    source: "dataset",
    operation,
    crossDataset: true,
    dataset:
      selected.groupDataset,
    metricDataset:
      selected.metricDataset,
    groupBy:
      selected.groupColumn,
    labelColumn:
      selected.groupColumn,
    column:
      selected.metricColumn,
    aggregation,
    direction,
    results,
    joins: [
      {
        sourceDataset:
          selected.groupDataset,
        targetDataset:
          selected.metricDataset,
        sourceColumn:
          selected.join.leftColumn,
        targetColumn:
          selected.join.rightColumn,
      },
    ],
    answer:
      `${heading}:\n` +
      results
        .map(
          (item, index) =>
            `${index + 1}. ${item.label}: ${formatNumber(item.value)}`
        )
        .join("\n"),
  };
}




/**
 * Infer a compact categorical context column for list results when the same
 * displayed value can refer to more than one entity in the current scope.
 *
 * This is intentionally data-driven. No geography, office, project, or other
 * dashboard-specific field names are hardcoded. A useful context column is:
 *   - mostly populated,
 *   - non-numeric / non-date-like,
 *   - lower-cardinality than the requested list field, and
 *   - nearly functionally dependent on the requested field.
 *
 * Example shape (field names are arbitrary):
 *   Parent=A, Child=Shared
 *   Parent=B, Child=Shared
 *
 * Listing Child alone would collapse two real entities into one label. The
 * inferred Parent column lets the renderer preserve both as
 * "Shared — A" and "Shared — B".
 */
function inferListDisambiguationContext({ rows, selectedColumn }) {
  const scopedRows = (rows || []).filter((row) => {
    const value = row?.[selectedColumn];
    return value !== null && value !== undefined && String(value).trim() !== "";
  });

  if (scopedRows.length < 2) return null;

  const selectedDisplays = new Map();
  for (const row of scopedRows) {
    const display = String(row?.[selectedColumn] ?? "").trim();
    const key = normalizeText(display);
    if (key && !selectedDisplays.has(key)) selectedDisplays.set(key, display);
  }

  const selectedUniqueCount = selectedDisplays.size;
  if (selectedUniqueCount < 2) return null;

  const candidates = [];

  for (const candidateColumn of getColumns(scopedRows)) {
    if (normalizeText(candidateColumn) === normalizeText(selectedColumn)) continue;

    const nonEmpty = [];
    let numericCount = 0;
    let dateLikeCount = 0;
    const candidateValues = new Set();
    const contextsBySelected = new Map();

    for (const row of scopedRows) {
      const rawSelected = row?.[selectedColumn];
      const rawCandidate = row?.[candidateColumn];
      const selectedDisplay = String(rawSelected ?? "").trim();
      const candidateDisplay = String(rawCandidate ?? "").trim();
      if (!selectedDisplay || !candidateDisplay) continue;

      nonEmpty.push(candidateDisplay);
      if (parseNumber(rawCandidate) !== null) numericCount += 1;
      if (/[/-]/.test(candidateDisplay) && !Number.isNaN(Date.parse(candidateDisplay))) {
        dateLikeCount += 1;
      }

      const selectedKey = normalizeText(selectedDisplay);
      const candidateKey = normalizeText(candidateDisplay);
      if (!selectedKey || !candidateKey) continue;

      candidateValues.add(candidateKey);
      if (!contextsBySelected.has(selectedKey)) contextsBySelected.set(selectedKey, new Map());
      const valueMap = contextsBySelected.get(selectedKey);
      if (!valueMap.has(candidateKey)) valueMap.set(candidateKey, candidateDisplay);
    }

    if (!nonEmpty.length) continue;

    const populationRate = nonEmpty.length / scopedRows.length;
    if (populationRate < 0.85) continue;

    const numericRatio = numericCount / nonEmpty.length;
    const dateRatio = dateLikeCount / nonEmpty.length;
    if (numericRatio >= 0.7 || dateRatio >= 0.7) continue;

    const distinctCandidateCount = candidateValues.size;
    if (distinctCandidateCount < 2 || distinctCandidateCount >= selectedUniqueCount) continue;

    // Require the context to exist for every distinct displayed child value.
    // This prevents sparse descriptive fields from becoming accidental labels.
    if (contextsBySelected.size !== selectedUniqueCount) continue;

    let pairCount = 0;
    let expandedSelectedCount = 0;
    let maxContextsForOneSelected = 0;

    for (const valueMap of contextsBySelected.values()) {
      const size = valueMap.size;
      pairCount += size;
      if (size > 1) expandedSelectedCount += 1;
      maxContextsForOneSelected = Math.max(maxContextsForOneSelected, size);
    }

    if (expandedSelectedCount === 0) continue;

    const averageContextsPerSelected = pairCount / selectedUniqueCount;
    const averageSelectedPerContext = pairCount / distinctCandidateCount;

    // A parent/context field should be close to a function of the listed
    // value. Wide many-to-many fields (category, commodity, status history,
    // etc.) are attributes, not safe identity context.
    if (averageContextsPerSelected > 1.6 || maxContextsForOneSelected > 4) continue;

    // A useful parent/context is normally shared by multiple child labels.
    // Near one-to-one descriptive attributes should not become identity
    // context just because one repeated label happens to have different text.
    // This relies on relationship shape rather than any specific column name.
    if (averageSelectedPerContext < 1.5) continue;

    // Prefer the most specific stable context. Higher cardinality usually
    // means "closer parent" (e.g. municipality over province for barangays),
    // while the stability penalty rejects fields that fan out too much.
    const specificity = Math.log1p(distinctCandidateCount);
    const stabilityPenalty = (averageContextsPerSelected - 1) * 4;
    const expansionRate = expandedSelectedCount / selectedUniqueCount;
    const score = specificity - stabilityPenalty + populationRate + expansionRate * 0.25;

    candidates.push({
      column: candidateColumn,
      score,
      pairCount,
      distinctCandidateCount,
      averageContextsPerSelected,
      averageSelectedPerContext,
      expandedSelectedCount,
      contextsBySelected,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.distinctCandidateCount !== left.distinctCandidateCount) {
      return right.distinctCandidateCount - left.distinctCandidateCount;
    }
    return left.averageContextsPerSelected - right.averageContextsPerSelected;
  });

  const best = candidates[0];
  const values = [];
  const seenPairs = new Set();

  for (const row of scopedRows) {
    const selectedDisplay = String(row?.[selectedColumn] ?? "").trim();
    const contextDisplay = String(row?.[best.column] ?? "").trim();
    if (!selectedDisplay) continue;

    const selectedKey = normalizeText(selectedDisplay);
    const contextKey = normalizeText(contextDisplay);
    const pairKey = `${selectedKey}::${contextKey}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    values.push({
      selected: selectedDisplay,
      context: contextDisplay,
      display: contextDisplay
        ? `${selectedDisplay} — ${contextDisplay}`
        : selectedDisplay,
    });
  }

  values.sort((left, right) => {
    const selectedOrder = left.selected.localeCompare(right.selected);
    return selectedOrder || left.context.localeCompare(right.context);
  });

  return {
    column: best.column,
    values: values.map((item) => item.display),
    entityCount: values.length,
    labelCount: selectedUniqueCount,
    ambiguousLabelCount: best.expandedSelectedCount,
    confidence: Math.max(
      0,
      Math.min(1, 1 - (best.averageContextsPerSelected - 1) / 0.6)
    ),
  };
}

function buildDataQualitySummary({ datasets, plan }) {
  if (!plan || plan.route !== "dataset" || !plan.dataset || !plan.column) return null;

  const datasetName = findDatasetName(datasets || {}, plan.dataset) || plan.dataset;
  const rows = datasets?.[datasetName];
  if (!Array.isArray(rows) || !rows.length) return null;

  const column = findColumn(rows, plan.column);
  if (!column) return null;

  const filters = resolveFilters(rows, Array.isArray(plan.filters) ? plan.filters : []);
  const baseScopedRows = applyFilters(rows, filters);
  const operation = String(plan.operation || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  const contractResolution = applySemanticContractScope({
    datasets,
    datasetName,
    rows,
    filteredRows: baseScopedRows,
    plan,
  });

  const grainResolution = applyGrainAwareAggregation({
    rows: contractResolution.allRows,
    filteredRows: contractResolution.rows,
    plan,
    filters,
    operation,
  });

  const scopedRows = grainResolution.rows;
  if (!scopedRows.length) {
    return { totalRows: 0, missingCount: 0, nonMissingCount: 0, missingRate: 0 };
  }

  const missingCount = scopedRows.reduce((count, row) => {
    const value = row?.[column];
    return count + (value === null || value === undefined || String(value).trim() === "" ? 1 : 0);
  }, 0);

  return {
    totalRows: scopedRows.length,
    missingCount,
    nonMissingCount: scopedRows.length - missingCount,
    missingRate: missingCount / scopedRows.length,
  };
}

function executePlan({
  datasets,
  plan,
  question,
}) {
  const crossDatasetGroupedResult =
    executeCrossDatasetGroupedAggregation({
      datasets,
      plan,
      question,
    });

  if (crossDatasetGroupedResult) {
    return crossDatasetGroupedResult;
  }

  const plannedCrossDatasetCount =
    executePlannedCrossDatasetCount({
      datasets,
      plan,
    });

  if (plannedCrossDatasetCount) {
    return plannedCrossDatasetCount;
  }

  const plannedCrossDatasetResult =
    executePlannedCrossDatasetLookup({
      datasets,
      plan,
    });

  if (plannedCrossDatasetResult) {
    return plannedCrossDatasetResult;
  }

  let datasetName = findDatasetName(
    datasets,
    plan.dataset
  );

  if (
    !datasetName &&
    Object.keys(datasets).length === 1
  ) {
    datasetName = Object.keys(datasets)[0];
  }

  if (!datasetName) {
    throw new Error(
      `The worksheet could not be determined. Available worksheets: ` +
      Object.keys(datasets).join(", ")
    );
  }

  const rows = datasets[datasetName];
  const column = plan.column
    ? findColumn(rows, plan.column)
    : null;
  const groupBy = plan.groupBy
    ? findColumn(rows, plan.groupBy)
    : null;

  const explicitFilters = resolveFilters(
    rows,
    plan.filters
  );

  /**
   * Only infer filters from raw question text when the
   * query planner did NOT already provide a filter.
   *
   * If Groq has already resolved:
   *
   *   DIVISION = PMED
   *
   * we trust that structured filter instead of scanning
   * every column for other values that happen to match
   * parts of "PMED".
   */
  const implicitFilters =
    explicitFilters.length > 0
      ? []
      : inferValueFilters(
          rows,
          question,
          [column, groupBy]
        );

  const filters = mergeFilters(
    explicitFilters,
    implicitFilters
  );

  const operation = String(plan.operation || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  const baseFilteredRows = applyFilters(rows, filters);

  // Dataset-provided semantic contracts take precedence over arithmetic
  // guesses. A contract can identify the authoritative record family, source
  // table, result type, and filter profile for a metric. This keeps evaluated
  // parent values separate from alternate visual/summary surfaces before any
  // grain selection or numeric aggregation occurs.
  const semanticContractResolution = applySemanticContractScope({
    datasets,
    datasetName,
    rows,
    filteredRows: baseFilteredRows,
    plan,
  });

  const grainResolution = applyGrainAwareAggregation({
    rows: semanticContractResolution.allRows,
    filteredRows: semanticContractResolution.rows,
    plan,
    filters,
    operation,
  });
  const filteredRows = grainResolution.rows;
  const grainMetadata = grainResolution.metadata;
  const semanticContractMetadata = semanticContractResolution.metadata;

  const semanticContractAggregation = evaluateSemanticContractAggregation({
    policy: semanticContractResolution.policy,
    rows: filteredRows,
    plan,
    operation,
    parseNumber,
  });

  const executionMetadata = {
    ...(semanticContractMetadata || {}),
    ...(grainMetadata || {}),
    ...(semanticContractAggregation?.mode
      ? { semanticContractExecutionMode: semanticContractAggregation.mode }
      : {}),
  };

  const hasExecutionMetadata = Object.keys(executionMetadata).length > 0;
  const filterText = describeFilters(filters);
  const limit = getLimit(plan);

  /*
   * Trigger cross-worksheet lookup whenever even ONE requested
   * output field is missing from the selected worksheet.
   */
  if (operation === "lookup") {
    const requestedColumns = getRequestedColumnNames(plan);

    const selectedColumnsHere = requestedColumns
      .map((item) => findColumn(rows, item))
      .filter(Boolean);

    const hasUsefulLocalFilter =
      explicitFilters.length > 0 ||
      implicitFilters.length > 0;

    const allRequestedColumnsAreLocal =
      requestedColumns.length === 0 ||
      selectedColumnsHere.length === requestedColumns.length;

    const needsCrossDataset =
      !allRequestedColumnsAreLocal ||
      !hasUsefulLocalFilter ||
      filteredRows.length === 0;

    if (needsCrossDataset) {
      const crossResult = tryCrossDatasetLookup({
        datasets,
        plan,
        question,
        preferredDataset: datasetName,
        preferredRows: filteredRows,
        preferredFilters: filters,
      });

      if (crossResult) return crossResult;
    }
  }

  if (semanticContractAggregation?.allowed === false) {
    return {
      success: false,
      source: "router",
      operation: "clarify",
      dataset: datasetName,
      column: plan.column || null,
      filters,
      ...(hasExecutionMetadata ? executionMetadata : {}),
      semanticContractViolation: true,
      semanticContractViolationReason:
        semanticContractAggregation.reason || "recomputation_not_authorized",
      answer:
        "This dataset provides that metric as an authoritative stored/evaluated result rather than a recalculable measure across multiple represented rows. " +
        "Please ask for a single represented scope, or use an output whose dataset contract allows aggregation.",
    };
  }

  if (operation === "row_count") {
    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      value: filteredRows.length,
      filters,
      answer:
        `There are ${formatNumber(filteredRows.length)} record(s) ` +
        `in ${datasetName}${filterText}.`,
    };
  }

  if (
    [
      "list",
      "distinct_count",
      "non_empty_count",
    ].includes(operation)
  ) {
    const selectedColumn = requireColumn(
      rows,
      plan.column,
      "Column"
    );

    const values = filteredRows
      .map((row) => row?.[selectedColumn])
      .filter(
        (value) =>
          value !== null &&
          value !== undefined &&
          String(value).trim() !== ""
      );

    if (operation === "non_empty_count") {
      return {
        success: true,
        source: "dataset",
        dataset: datasetName,
        operation,
        column: selectedColumn,
        value: values.length,
        filters,
        answer:
          `There are ${formatNumber(values.length)} populated ` +
          `${selectedColumn} value(s) in ${datasetName}${filterText}.`,
      };
    }

    const unique = [];
    const seen = new Set();

    for (const value of values) {
      const display = String(value).trim();
      const key = display.toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(display);
      }
    }

    unique.sort((a, b) => a.localeCompare(b));

    if (
      operation === "list" &&
      unique.length === 0
    ) {
      return {
        success: true,
        source: "dataset",
        dataset: datasetName,
        operation,
        column: selectedColumn,
        count: 0,
        results: [],
        filters,
        answer:
          `I couldn't find any ${selectedColumn} values matching the requested filter.`,
      };
    }

    if (operation === "distinct_count") {
      return {
        success: true,
        source: "dataset",
        dataset: datasetName,
        operation,
        column: selectedColumn,
        value: unique.length,
        filters,
        answer:
          `There are ${formatNumber(unique.length)} unique ` +
          `${selectedColumn} value(s) in ${datasetName}${filterText}.`,
      };
    }

    // --------------------------------------------------------
    // LIST BEHAVIOR
    // --------------------------------------------------------
    // Normal list questions should return the COMPLETE list.
    //
    // Examples:
    // "list names"              -> all names
    // "list of farmers"         -> all farmers
    // "what are the provinces"  -> all provinces
    //
    // Only apply a limit when the user explicitly asks for one:
    // "show 5 farmers"          -> 5
    // "first 10 names"          -> 10
    // "list 20 municipalities"  -> 20
    //
    const explicitListLimitPatterns = [
      /\b(?:top|first|last|bottom)\s+(\d+)\b/i,
      /\b(?:show|list|give|display)\s+(?:me\s+)?(?:the\s+)?(?:first\s+)?(\d+)\b/i,
      /\b(\d+)\s+(?:names?|farmers?|records?|rows?|entries?|items?|provinces?|municipalities?|cities?|values?)\b/i,
    ];

    let explicitListLimit = null;

    for (const pattern of explicitListLimitPatterns) {
      const match = String(question || "").match(pattern);

      if (match) {
        const parsed = Number(match[1]);

        if (Number.isInteger(parsed) && parsed > 0) {
          explicitListLimit = Math.min(parsed, MAX_LIMIT);
          break;
        }
      }
    }

    const disambiguation =
      inferListDisambiguationContext({
        rows: filteredRows,
        selectedColumn,
      });

    const listValues =
      disambiguation?.values?.length
        ? disambiguation.values
        : unique;

    const shouldShowAll =
      plan.showAll === true ||
      explicitListLimit === null;

    const shown = shouldShowAll
      ? listValues
      : listValues.slice(0, explicitListLimit);

    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      column: selectedColumn,
      count: listValues.length,
      results: shown,
      filters,
      ...(disambiguation
        ? {
            contextualizedList: true,
            disambiguationColumn: disambiguation.column,
            distinctLabelCount: disambiguation.labelCount,
            ambiguousLabelCount: disambiguation.ambiguousLabelCount,
            disambiguationConfidence: disambiguation.confidence,
          }
        : {}),
      answer:
      filters.length > 0
        ? `I found ${formatNumber(
            listValues.length
          )} ${selectedColumn} value(s) matching your request:\n\n` +
          shown
            .map(
              (value, index) =>
                `${index + 1}. ${value}`
            )
            .join("\n")
        : `Here are the ${selectedColumn} values I found:\n\n` +
          shown
            .map(
              (value, index) =>
                `${index + 1}. ${value}`
            )
            .join("\n"),
    };
  }

  if (operation === "lookup") {
    const requestedSelectedColumns =
      Array.isArray(plan.selectColumns) &&
      plan.selectColumns.length
        ? plan.selectColumns
            .map((item) => findColumn(rows, item))
            .filter(Boolean)
        : plan.outputRequested
          ? []
          : getColumns(rows).slice(0, 10);

    /*
     * Preserve row identity for multi-entity lookups.
     *
     * Example:
     *   Municipality IN ["Dingras", "Badoc"]
     *   return Irrigated Total Area Planted
     *
     * Previously the projection could become:
     *   [{area: 1153}, {area: 6591}]
     * which loses which municipality owns each value. Any response formatter
     * that then paired values with the requested filter list by position could
     * accidentally swap the entities.
     *
     * Keep a verified identity column alongside the requested metric whenever
     * the lookup is scoped by a multi-value filter. This is schema-driven and
     * applies to municipalities, provinces, associations, projects, offices,
     * or any other categorical identity field.
     */
    let lookupLabelColumn = plan.labelColumn
      ? findColumn(rows, plan.labelColumn)
      : null;

    if (!lookupLabelColumn) {
      const multiEntityFilter = filters.find((filter) => {
        const values = Array.isArray(filter?.value)
          ? filter.value
          : [];
        const operator = String(filter?.operator || "")
          .trim()
          .toLowerCase();

        return values.length > 1 &&
          ["in", "one_of", "equals_any"].includes(operator);
      });

      if (multiEntityFilter) {
        lookupLabelColumn = findColumn(
          rows,
          multiEntityFilter.column
        );
      }
    }

    const selectedColumns = [
      ...(lookupLabelColumn ? [lookupLabelColumn] : []),
      ...requestedSelectedColumns.filter(
        (selected) => selected !== lookupLabelColumn
      ),
    ];

    if (
      plan.outputRequested &&
      requestedSelectedColumns.length === 0
    ) {
      throw new Error(
        "I found the matching record, but could not determine which field you want returned."
      );
    }

    // Project first, then deduplicate exact projected rows BEFORE applying the
    // display limit. Denormalized worksheets often repeat the same entity once
    // per intervention/event; a lookup asking which entities match should not
    // print the same projected entity dozens of times.
    const allProjectedResults = filteredRows.map((row) => {
      const projected = {};

      for (const selected of selectedColumns) {
        projected[selected] = transformLookupValue(
          row?.[selected],
          plan.transform
        );
      }

      return projected;
    });

    const distinctProjectedResults = dedupeProjectedLookupResults(
      allProjectedResults,
      selectedColumns
    );

    const projectedResults = plan.showAll
      ? distinctProjectedResults
      : distinctProjectedResults.slice(0, limit);

    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      column:
        column ||
        requestedSelectedColumns[0] ||
        null,
      labelColumn: lookupLabelColumn || null,
      matchedRowCount: filteredRows.length,
      count: distinctProjectedResults.length,
      results: projectedResults,
      filters,
      duplicateLookupRowsRemoved:
        distinctProjectedResults.length !== allProjectedResults.length,
      answer: formatLookupAnswer({
        results: projectedResults,
        selectedColumns,
        count: distinctProjectedResults.length,
        question,
        labelColumn: lookupLabelColumn || null,
      }),
    };
  }


  if (operation === "group_list") {
    const groupColumn = requireColumn(
      rows,
      plan.groupBy,
      "Group column"
    );

    const valueColumn = requireColumn(
      rows,
      plan.column,
      "List column"
    );

    const groups = new Map();

    for (const row of filteredRows) {
      const groupLabel = String(
        row?.[groupColumn] ?? ""
      ).trim();

      const rawValue = String(
        row?.[valueColumn] ?? ""
      ).trim();

      if (!groupLabel) {
        continue;
      }

      if (!groups.has(groupLabel)) {
        groups.set(groupLabel, {
          values: [],
          seen: new Set(),
        });
      }

      if (!rawValue) {
        continue;
      }

      const group = groups.get(groupLabel);
      const key = rawValue.toLowerCase();

      if (!group.seen.has(key)) {
        group.seen.add(key);
        group.values.push(rawValue);
      }
    }

    const results = [...groups.entries()]
      .map(([label, group]) => ({
        label,
        values: group.values.sort(
          (a, b) =>
            a.localeCompare(b)
        ),
      }))
      .sort(
        (a, b) =>
          a.label.localeCompare(
            b.label
          )
      );

    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      groupBy: groupColumn,
      column: valueColumn,
      count: results.length,
      results,
      filters,
      answer:
        results.length
          ? results
              .map((item) => {
                if (item.values.length === 0) {
                  return `${item.label} — No value recorded`;
                }

                if (item.values.length === 1) {
                  return `${item.label} — ${item.values[0]}`;
                }

                return (
                  `${item.label}:\n` +
                  item.values
                    .map(
                      (value, index) =>
                        `${index + 1}. ${value}`
                    )
                    .join("\n")
                );
              })
              .join("\n\n")
          : `No ${valueColumn} values were found grouped by ${groupColumn}.`,
    };
  }

  if (operation === "group_count") {
    const groupColumn = requireColumn(
      rows,
      plan.groupBy,
      "Group column"
    );

    const groups = new Map();

    for (const row of filteredRows) {
      const label = String(
        row?.[groupColumn] ?? ""
      ).trim();

      if (!label) continue;

      groups.set(label, (groups.get(label) || 0) + 1);
    }

    const results = [...groups.entries()]
      .map(([label, value]) => ({
        label,
        value,
      }))
      .sort((a, b) => b.value - a.value);

    const displayedResults = plan.showAll
      ? results
      : results.slice(0, limit);

    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      groupBy: groupColumn,
      results: displayedResults,
      filters,
      answer:
        `Record count by ${groupColumn} in ${datasetName}${filterText}:\n` +
        displayedResults
          .map(
            (item, index) =>
              `${index + 1}. ${item.label}: ${formatNumber(item.value)}`
          )
          .join("\n"),
    };
  }

  if (
    operation === "rank_rows" ||
    operation === "rank_groups"
  ) {
    const metricColumn = requireColumn(
      rows,
      plan.column,
      "Ranking metric column"
    );

    const labelColumn = requireColumn(
      rows,
      plan.labelColumn || plan.groupBy,
      "Ranking label column"
    );

    const direction =
      plan.direction === "asc"
        ? "asc"
        : "desc";

    if (operation === "rank_rows") {
      const ranked = filteredRows
        .map((row) => ({
          label: String(row?.[labelColumn] ?? "").trim(),
          value: parseNumber(row?.[metricColumn]),
          row,
        }))
        .filter(
          (item) =>
            item.label &&
            item.value !== null
        )
        .sort((a, b) =>
          direction === "asc"
            ? a.value - b.value
            : b.value - a.value
        )
        .slice(0, limit);

      if (!ranked.length) {
        throw new Error(
          `No usable values were found for "${labelColumn}" ranked by "${metricColumn}"${filterText}.`
        );
      }

      const requestedDetailColumns =
        (Array.isArray(plan.selectColumns)
          ? plan.selectColumns
          : [])
          .filter((column) =>
            column &&
            column !== labelColumn &&
            column !== metricColumn &&
            Object.prototype.hasOwnProperty.call(filteredRows[0] || {}, column)
          );

      const rankedAnswerLines = ranked.map((item, index) => {
        const details = requestedDetailColumns
          .map((column) => {
            const value = item.row?.[column];
            if (value === null || value === undefined || String(value).trim() === "") {
              return null;
            }
            return `${column}: ${String(value).trim()}`;
          })
          .filter(Boolean);

        return (
          `${index + 1}. ${item.label}: ${formatNumber(item.value)}` +
          (details.length ? ` — ${details.join("; ")}` : "")
        );
      });

      return {
        success: true,
        source: "dataset",
        dataset: datasetName,
        operation,
        column: metricColumn,
        labelColumn,
        direction,
        results: ranked,
        filters,
        answer:
          `${direction === "desc" ? "Top" : "Bottom"} ${ranked.length} ` +
          `${labelColumn} by ${metricColumn} in ${datasetName}${filterText}:\n` +
          rankedAnswerLines.join("\n"),
      };
    }

    const aggregation =
      ["sum", "average", "count"].includes(plan.aggregation)
        ? plan.aggregation
        : "sum";

    const groups = new Map();

    for (const row of filteredRows) {
      const label = String(
        row?.[labelColumn] ?? ""
      ).trim();

      if (!label) continue;

      const numericValue =
        aggregation === "count"
          ? 1
          : parseNumber(row?.[metricColumn]);

      if (
        aggregation !== "count" &&
        numericValue === null
      ) {
        continue;
      }

      if (!groups.has(label)) {
        groups.set(label, {
          sum: 0,
          count: 0,
        });
      }

      const group = groups.get(label);

      if (aggregation === "count") {
        group.sum += 1;
        group.count += 1;
      } else {
        group.sum += numericValue;
        group.count += 1;
      }
    }

    const ranked = [...groups.entries()]
      .map(([label, group]) => ({
        label,
        value:
          aggregation === "average"
            ? group.sum / group.count
            : group.sum,
        recordsUsed: group.count,
      }))
      .sort((a, b) =>
        direction === "asc"
          ? a.value - b.value
          : b.value - a.value
      )
      .slice(0, limit);

    if (!ranked.length) {
      throw new Error(
        `No grouped ranking values were found for "${labelColumn}" by "${metricColumn}"${filterText}.`
      );
    }

    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      column: metricColumn,
      labelColumn,
      aggregation,
      direction,
      results: ranked,
      filters,
      ...(hasExecutionMetadata ? executionMetadata : {}),
      answer:
        `${direction === "desc" ? "Top" : "Bottom"} ${ranked.length} ` +
        `${labelColumn} by ${aggregation} ${metricColumn} in ${datasetName}${filterText}:\n` +
        ranked
          .map(
            (item, index) =>
              `${index + 1}. ${item.label}: ${formatNumber(item.value)}`
          )
          .join("\n"),
    };
  }

  const numericColumn = requireColumn(
    rows,
    plan.column,
    "Numeric column"
  );

  const numericRows = filteredRows
    .map((row, index) => ({
      row,
      rowIndex: index + 1,
      rawValue: row?.[numericColumn],
      value: parseNumber(row?.[numericColumn]),
    }))
    .filter((item) => item.value !== null);

  if (!numericRows.length) {
    return {
      success: false,
      source: "router",
      operation: "clarify",
      dataset: datasetName,
      column: numericColumn,
      filters,
      answer:
        "I’m not sure I understood your question correctly. " +
        "Could you please rephrase it or make it a little clearer?",
    };
  }

  if (
    ["sum", "average", "median"].includes(operation)
  ) {
    const values = numericRows.map((item) => item.value);
    const total = values.reduce(
      (sum, value) => sum + value,
      0
    );

    const value =
      operation === "average"
        ? total / values.length
        : operation === "median"
          ? median(values)
          : total;

    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      column: numericColumn,
      value,
      recordsUsed: values.length,
      filters,
      ...(hasExecutionMetadata ? executionMetadata : {}),

      /**
       * TEMPORARY DIAGNOSTIC ONLY
       *
       * This does NOT change filtering, column selection,
       * parsing, or arithmetic.
       *
       * It only exposes the exact raw/parsed values already
       * used by the current calculation so we can identify
       * the source of any discrepancy.
       */
      debugNumericValues:
        operation === "sum"
          ? numericRows.map((item) => ({
              rowIndex: item.rowIndex,
              rawValue: item.rawValue,
              parsedValue: item.value,
            }))
          : undefined,

      answer:
        `The ${operation} ${numericColumn} in ${datasetName}${filterText} ` +
        `is ${formatNumber(value)}, based on ` +
        `${formatNumber(values.length)} record(s).`,
    };
  }

  if (
    ["minimum", "maximum"].includes(operation)
  ) {
    numericRows.sort((a, b) =>
      operation === "maximum"
        ? b.value - a.value
        : a.value - b.value
    );

    const labelColumn = groupBy;
    const results = numericRows
      .slice(0, limit)
      .map((item) => ({
        label: labelColumn
          ? item.row?.[labelColumn]
          : null,
        value: item.value,
        row: item.row,
      }));

    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      column: numericColumn,
      value: results[0]?.value,
      results,
      filters,
      ...(hasExecutionMetadata ? executionMetadata : {}),
      answer:
        `${operation === "maximum" ? "Highest" : "Lowest"} ` +
        `${numericColumn} in ${datasetName}${filterText}:\n` +
        results
          .map(
            (item, index) =>
              `${index + 1}. ` +
              (
                item.label !== null &&
                item.label !== undefined &&
                String(item.label).trim()
                  ? `${item.label}: `
                  : ""
              ) +
              formatNumber(item.value)
          )
          .join("\n"),
    };
  }

  if (
    [
      "group_sum",
      "group_average",
      "group_minimum",
      "group_maximum",
    ].includes(operation)
  ) {
    const groupColumn = requireColumn(
      rows,
      plan.groupBy,
      "Group column"
    );

    const groups = new Map();

    if (plan.preserveEmptyGroups === true) {
      for (const row of filteredRows) {
        const label = String(
          row?.[groupColumn] ?? ""
        ).trim();

        if (!label || groups.has(label)) continue;

        groups.set(label, {
          sum: 0,
          count: 0,
          minimum: null,
          maximum: null,
        });
      }
    }

    for (const item of numericRows) {
      const label = String(
        item.row?.[groupColumn] ?? ""
      ).trim();

      if (!label) continue;

      if (!groups.has(label)) {
        groups.set(label, {
          sum: 0,
          count: 0,
          minimum: null,
          maximum: null,
        });
      }

      const group = groups.get(label);
      group.sum += item.value;
      group.count += 1;
      group.minimum =
        group.minimum === null
          ? item.value
          : Math.min(group.minimum, item.value);
      group.maximum =
        group.maximum === null
          ? item.value
          : Math.max(group.maximum, item.value);
    }

    const allResults = [...groups.entries()]
      .map(([label, group]) => {
        let value = null;

        if (group.count > 0) {
          if (operation === "group_average") {
            value = group.sum / group.count;
          } else if (operation === "group_minimum") {
            value = group.minimum;
          } else if (operation === "group_maximum") {
            value = group.maximum;
          } else {
            value = group.sum;
          }
        }

        return {
          label,
          value,
          recordsUsed: group.count,
          ...(group.count === 0 ? { missing: true } : {}),
        };
      })
      .filter(
        (item) =>
          item.value !== null ||
          plan.preserveEmptyGroups === true
      )
      .sort((a, b) => {
        if (a.value === null && b.value === null) {
          return a.label.localeCompare(b.label);
        }
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return b.value - a.value;
      });

    const results =
      plan.showAll === true
        ? allResults
        : allResults.slice(0, limit);

    return {
      success: true,
      source: "dataset",
      dataset: datasetName,
      operation,
      column: numericColumn,
      groupBy: groupColumn,
      results,
      filters,
      ...(hasExecutionMetadata ? executionMetadata : {}),
      answer:
        `${operation.replace("group_", "")} ${numericColumn} by ` +
        `${groupColumn} in ${datasetName}${filterText}:\n` +
        results
          .map(
            (item, index) =>
              `${index + 1}. ${item.label}: ` +
              (
                item.value === null
                  ? "No value recorded"
                  : formatNumber(item.value)
              )
          )
          .join("\n"),
    };
  }

  throw new Error(
    `Unsupported dataset operation: ${operation}`
  );
}

module.exports = {
  executePlan,
  buildDataQualitySummary,
};
