const { normalizeText, parseNumber } = require('./utils');
const { inferValueFilters } = require('./filterEngine');
const { executePlan } = require('./calculationEngine');
const { inferMetricMeaning } = require('./metricMeaningEngine');
const { semanticPlanToExecutable } = require('./semanticPlan');
const { buildSemanticVerifiedAnswer } = require('./responseNarrativeEngine');
const {
  findExplicitSchemaColumns,
  detectQuestionAggregation,
  detectRankingDirection,
  detectRankingLimit,
  isNumericLikeColumn,
} = require('./plannerNormalizer');

function cloneFilter(filter) {
  return {
    ...filter,
    value: Array.isArray(filter?.value) ? [...filter.value] : filter?.value,
  };
}

function normalizeWords(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
      if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
      return word;
    });
}

function questionMentionsColumnConcept(question, columnName) {
  const q = new Set(normalizeWords(question));
  const c = normalizeWords(columnName);
  return c.length > 0 && c.every((token) => q.has(token));
}

function getSharedColumns(schema) {
  const usable = (schema || []).filter((d) => Array.isArray(d?.columns));
  if (usable.length < 2) return [];

  const first = usable[0].columns.map((c) => c?.name).filter(Boolean);
  return first.filter((name) =>
    usable.every((dataset) =>
      dataset.columns.some((column) => String(column?.name || '') === String(name))
    )
  );
}

function getDistinctNonEmpty(rows, column, limit = 20) {
  const values = [];
  const seen = new Set();
  for (const row of rows || []) {
    const value = row?.[column];
    if (value === null || value === undefined || String(value).trim() === '') continue;
    const key = normalizeText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
    if (values.length >= limit) break;
  }
  return values;
}

function discoverPartitionColumn({ datasets, schema, question }) {
  const shared = getSharedColumns(schema);
  if (!shared.length) return null;

  const q = normalizeText(question);
  const worksheetCue = /\b(?:worksheet|worksheets|sheet|sheets)\b/.test(q);

  const candidates = shared
    .map((column) => {
      const mentioned = questionMentionsColumnConcept(question, column);
      const perDataset = [];
      let distinctAcrossDatasets = true;
      const seenValues = new Set();
      let singletonCount = 0;

      for (const dataset of schema || []) {
        const rows = datasets?.[dataset?.name];
        if (!Array.isArray(rows)) continue;
        const values = getDistinctNonEmpty(rows, column, 3);
        if (values.length === 1) {
          singletonCount += 1;
          const key = normalizeText(values[0]);
          if (seenValues.has(key)) distinctAcrossDatasets = false;
          seenValues.add(key);
          perDataset.push({ dataset: dataset.name, value: values[0] });
        }
      }

      let score = 0;
      if (mentioned) score += 5;
      if (singletonCount >= 2) score += 2;
      if (distinctAcrossDatasets && singletonCount >= 2) score += 2;
      if (worksheetCue && singletonCount >= 2) score += 1;

      return { column, score, perDataset, singletonCount, distinctAcrossDatasets };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] || null;
  if (!best) return null;

  // For a generic "each <dimension>" query, require the dimension to be
  // explicitly named unless the user literally says worksheets/sheets.
  if (!worksheetCue && !questionMentionsColumnConcept(question, best.column)) {
    return null;
  }

  return best;
}

function hasDistributedScopeCue(question, partitionColumn) {
  const q = normalizeText(question);
  if (/\b(?:each|every|all)\b/.test(q)) return true;
  if (/\b(?:across|throughout|regionwide|systemwide|nationwide|overall)\b/.test(q)) return true;
  if (/\b(?:by)\b/.test(q) && questionMentionsColumnConcept(question, partitionColumn)) return true;

  // Cross-partition superlatives are distributed by definition:
  // "which province has the highest ...", "which branch has the lowest ...".
  // The partition concept must still be explicitly named in the question.
  if (
    questionMentionsColumnConcept(question, partitionColumn) &&
    /\b(?:which|what)\b/.test(q) &&
    /\b(?:highest|lowest|largest|smallest|greatest|most|least|maximum|minimum|top|bottom)\b/.test(q)
  ) {
    return true;
  }

  return false;
}

function chooseMetricColumn({ datasets, schema, question }) {
  const explicit = findExplicitSchemaColumns({ schema, question });

  const scoredExplicit = explicit
    .map((item) => {
      const datasetSchema = (schema || []).find((d) => String(d?.name) === String(item.dataset));
      const rows = datasets?.[item.dataset];
      const column = datasetSchema?.columns?.find((c) => String(c?.name) === String(item.column));
      if (!column || !Array.isArray(rows)) return null;
      return {
        column: item.column,
        dataset: item.dataset,
        numeric: isNumericLikeColumn({ column, rows }),
        length: normalizeText(item.column).length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.numeric) - Number(a.numeric) || b.length - a.length);

  if (scoredExplicit[0]?.numeric) return scoredExplicit[0].column;

  // Some schema matchers intentionally avoid aggressive one-word matching.
  // For distributed queries we can safely recover an explicitly mentioned
  // numeric field by checking the LIVE shared schema directly. This remains
  // generic: any numeric header named in the question can win.
  const shared = getSharedColumns(schema);
  const directlyMentionedNumeric = shared
    .map((name) => {
      if (!questionMentionsColumnConcept(question, name)) return null;
      let numericVotes = 0;
      let usableVotes = 0;
      for (const datasetSchema of schema || []) {
        const rows = datasets?.[datasetSchema?.name];
        const column = datasetSchema?.columns?.find((c) => String(c?.name) === String(name));
        if (!column || !Array.isArray(rows)) continue;
        usableVotes += 1;
        if (isNumericLikeColumn({ column, rows })) numericVotes += 1;
      }
      return { name, numericVotes, usableVotes, length: normalizeText(name).length };
    })
    .filter((item) => item && item.usableVotes > 0 && item.numericVotes / item.usableVotes >= 0.6)
    .sort((a, b) => b.numericVotes - a.numericVotes || b.length - a.length);

  if (directlyMentionedNumeric[0]?.name) return directlyMentionedNumeric[0].name;

  return scoredExplicit[0]?.column || null;
}

function operationForQuestion(question, metricColumn) {
  const aggregation = detectQuestionAggregation(question);
  if (aggregation === 'count') return 'count';
  if (aggregation === 'sum') return 'sum';
  if (aggregation === 'average') return 'average';

  const q = normalizeText(question);
  if (/\b(?:minimum|min|lowest|smallest)\b/.test(q)) return 'minimum';
  if (/\b(?:maximum|max|highest|largest)\b/.test(q)) return 'maximum';
  if (/\bmedian\b/.test(q)) return 'median';

  // An explicitly requested numeric field with no calculation wording is a
  // value lookup. This also protects headers named Average/Total/Count.
  return metricColumn ? 'lookup' : null;
}

function cleanInferredFilters(filters, partitionColumn, metricColumn) {
  const blocked = new Set([normalizeText(partitionColumn), normalizeText(metricColumn)].filter(Boolean));
  return (Array.isArray(filters) ? filters : [])
    .filter((filter) => filter?.column && !blocked.has(normalizeText(filter.column)))
    .map(cloneFilter);
}

function firstPartitionLabel(rows, partitionColumn, fallback) {
  if (!partitionColumn) return fallback;
  const values = getDistinctNonEmpty(rows, partitionColumn, 2);
  return values.length === 1 ? String(values[0]) : fallback;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'no data';
  const n = Number(value);
  return Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function extractScalar(result) {
  if (result?.value !== undefined && result?.value !== null) return Number(result.value);
  if (Array.isArray(result?.results) && result.results.length === 1) {
    const value = result.results[0]?.value ?? result.results[0];
    const n = parseNumber(value);
    return n;
  }
  return null;
}

function findExplicitDatasetMentions({ datasets, question }) {
  const q = normalizeText(question);
  if (!q) return [];

  const names = Object.keys(datasets || {}).filter((name) => Array.isArray(datasets[name]));
  return names.filter((name) => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return false;

    const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(q);
  });
}

function hasExplicitCrossWorksheetCue(question) {
  const q = normalizeText(question);

  // When exactly one live worksheet is explicitly named, only unmistakable
  // cross-worksheet wording may expand the query beyond that worksheet.
  // This prevents "top 5 commodities ... in <worksheet>" from being
  // mistaken for a worksheet ranking.
  if (/\b(?:each|every|all|across)\b/.test(q)) return true;
  if (/\b(?:compare|comparison|versus|vs\.?)\b/.test(q)) return true;

  return false;
}

function buildDistributedWorksheetResolution({ datasets, schema, question }) {
  const datasetNames = Object.keys(datasets || {}).filter((name) => Array.isArray(datasets[name]));
  if (datasetNames.length < 2) return null;

  const explicitDatasetMentions = findExplicitDatasetMentions({ datasets, question });

  const partition = discoverPartitionColumn({ datasets, schema, question });
  if (!partition || !hasDistributedScopeCue(question, partition.column)) return null;

  // If the question explicitly names exactly one live worksheet, keep the
  // request scoped to that worksheet unless the wording ALSO clearly asks
  // for a cross-worksheet comparison/distribution. This prevents queries like:
  //   "top 5 commodities by average price in Pangasinan"
  // from being misread as a ranking of worksheets simply because "top" and
  // "commodities" are present. No worksheet names are hardcoded here.
  if (
    explicitDatasetMentions.length === 1 &&
    !hasExplicitCrossWorksheetCue(question)
  ) {
    return null;
  }

  const metricColumn = chooseMetricColumn({ datasets, schema, question });
  if (!metricColumn) return null;

  const operation = operationForQuestion(question, metricColumn);
  if (!operation) return null;

  const rankingDirection = detectRankingDirection(question);
  const rankingLimit = detectRankingLimit(question);
  const rowsOut = [];

  for (const datasetName of datasetNames) {
    const datasetSchema = (schema || []).find((d) => String(d?.name) === String(datasetName));
    const rows = datasets[datasetName];
    if (!datasetSchema || !Array.isArray(rows) || !rows.length) continue;

    const realMetric = datasetSchema.columns?.find((c) => String(c?.name) === String(metricColumn))?.name;
    if (!realMetric) continue;

    const inferred = inferValueFilters(rows, question, [realMetric, partition.column]);
    const filters = cleanInferredFilters(inferred, partition.column, realMetric);

    const plan = {
      route: 'dataset',
      dataset: datasetName,
      operation,
      column: realMetric,
      labelColumn: null,
      groupBy: null,
      aggregation: null,
      direction: null,
      filters,
      selectColumns: [realMetric],
      outputRequested: true,
      transform: null,
      limit: 1,
      showAll: false,
      distributedWorksheetQuery: true,
      distributedBy: partition.column,
    };

    let result;
    try {
      result = executePlan({ datasets, plan, question });
    } catch (error) {
      result = { success: false, error: error?.message || String(error) };
    }

    rowsOut.push({
      dataset: datasetName,
      label: firstPartitionLabel(rows, partition.column, datasetName),
      value: extractScalar(result),
      filters,
      plan,
      result,
    });
  }

  if (rowsOut.length < 2) return null;

  let ordered = [...rowsOut];
  if (rankingDirection) {
    ordered = ordered
      .filter((item) => item.value !== null && Number.isFinite(Number(item.value)))
      .sort((a, b) => rankingDirection === 'asc' ? a.value - b.value : b.value - a.value)
      .slice(0, Math.max(1, rankingLimit || 1));
  }

  const normalizedMetric = normalizeText(metricColumn);
  const operationLabel =
    operation === 'lookup' ||
    (operation === 'average' && normalizedMetric === 'average') ||
    (operation === 'sum' && normalizedMetric === 'total') ||
    (operation === 'minimum' && normalizedMetric === 'minimum') ||
    (operation === 'maximum' && normalizedMetric === 'maximum')
      ? metricColumn
      : `${operation} ${metricColumn}`;
  const answer = rankingDirection
    ? ordered.length
      ? `${ordered[0].label} has the ${rankingDirection === 'asc' ? 'lowest' : 'highest'} ${operationLabel}: ${formatNumber(ordered[0].value)}.`
      : `I couldn't find enough matching values to compare the ${partition.column} groups.`
    : `${operationLabel} by ${partition.column}:\n` +
      rowsOut.map((item, index) => `${index + 1}. ${item.label}: ${formatNumber(item.value)}`).join('\n');

  const distributedPlan = {
    route: 'dataset',
    dataset: null,
    operation: rankingDirection ? 'rank_worksheets' : 'multi_worksheet',
    column: metricColumn,
    groupBy: partition.column,
    aggregation: operation,
    direction: rankingDirection || null,
    limit: rankingDirection ? Math.max(1, rankingLimit || 1) : rowsOut.length,
    filters: [],
    selectColumns: [partition.column, metricColumn],
    outputRequested: true,
    distributedWorksheetQuery: true,
    worksheets: datasetNames,
    aggregationPolicy: {
      mode: 'available_values',
      requireCompleteCoverage: false,
    },
  };

  const rawResult = {
    success: true,
    source: 'dataset',
    dataset: null,
    datasets: rowsOut.map((item) => item.dataset),
    operation: rankingDirection ? 'rank_worksheets' : 'multi_worksheet',
    column: metricColumn,
    groupBy: partition.column,
    aggregation: operation,
    results: (rankingDirection ? ordered : rowsOut).map((item) => ({
      dataset: item.dataset,
      label: item.label,
      value: item.value,
      filters: item.filters,
      recordsUsed: item.result?.recordsUsed ?? null,
      dataQuality: item.result?.dataQuality || null,
    })),
    aggregationPolicy: {
      mode: 'available_values',
      description: 'Each worksheet is evaluated independently using available non-missing metric values.',
      requireCompleteCoverage: false,
      totalWorksheets: rowsOut.length,
    },
    crossWorksheetDataQuality: {
      totalWorksheets: rowsOut.length,
      worksheetsWithValue: rowsOut.filter((item) => item.value !== null && Number.isFinite(Number(item.value))).length,
      worksheetsWithoutValue: rowsOut.filter((item) => item.value === null || !Number.isFinite(Number(item.value))).map((item) => item.label),
    },
    answer,
  };

  return {
    plan: distributedPlan,
    result: attachCrossWorksheetMetricMeaning({
      result: rawResult,
      plan: distributedPlan,
      datasets,
      schema,
      question,
    }),
  };
}

function executeDistributedWorksheetPlan({ datasets, schema, plan, question = '' }) {
  const operationName = normalizeText(plan?.operation);
  if (!['rank_worksheets', 'multi_worksheet'].includes(operationName)) return null;

  const datasetNames = Object.keys(datasets || {}).filter((name) => Array.isArray(datasets[name]));
  if (datasetNames.length < 2) return null;

  const partitionColumn = plan?.groupBy || discoverPartitionColumn({ datasets, schema, question })?.column || null;
  const metricColumn = plan?.column || null;
  if (!metricColumn) return null;

  const requestedAggregation = normalizeText(plan?.aggregation);
  const childOperation = ['sum', 'average', 'median', 'minimum', 'maximum', 'count', 'distinct_count', 'non_empty_count'].includes(requestedAggregation)
    ? requestedAggregation
    : 'lookup';

  const baseFilters = (Array.isArray(plan?.filters) ? plan.filters : [])
    .filter((filter) => filter?.column && normalizeText(filter.column) !== normalizeText(partitionColumn))
    .map(cloneFilter);

  const rowsOut = [];

  for (const datasetName of datasetNames) {
    const datasetSchema = (schema || []).find((d) => String(d?.name) === String(datasetName));
    const rows = datasets[datasetName];
    if (!datasetSchema || !Array.isArray(rows) || !rows.length) continue;

    const realMetric = datasetSchema.columns?.find((c) => String(c?.name) === String(metricColumn))?.name;
    if (!realMetric) continue;

    const availableColumns = new Set((datasetSchema.columns || []).map((c) => String(c?.name || '')));
    const filters = baseFilters.filter((filter) => availableColumns.has(String(filter.column)));

    const childPlan = {
      route: 'dataset',
      dataset: datasetName,
      operation: childOperation,
      column: realMetric,
      labelColumn: null,
      groupBy: null,
      aggregation: null,
      direction: null,
      filters,
      selectColumns: [realMetric],
      outputRequested: true,
      transform: null,
      limit: 1,
      showAll: false,
      distributedWorksheetQuery: true,
      distributedBy: partitionColumn,
    };

    let result;
    try {
      result = executePlan({ datasets, schema, plan: childPlan, question });
    } catch (error) {
      result = { success: false, error: error?.message || String(error) };
    }

    const value = extractScalar(result);
    rowsOut.push({
      dataset: datasetName,
      label: firstPartitionLabel(rows, partitionColumn, datasetName),
      value,
      filters,
      dataQuality: result?.dataQuality || null,
      recordsUsed: result?.recordsUsed ?? null,
    });
  }

  if (rowsOut.length < 2) return null;

  const direction = normalizeText(plan?.direction) === 'asc' ? 'asc' : 'desc';
  const limit = Math.max(1, Number(plan?.limit) || 1);
  let outputRows = [...rowsOut];

  if (operationName === 'rank_worksheets') {
    outputRows = outputRows
      .filter((item) => item.value !== null && Number.isFinite(Number(item.value)))
      .sort((a, b) => direction === 'asc' ? Number(a.value) - Number(b.value) : Number(b.value) - Number(a.value))
      .slice(0, limit);
  }

  const aggregationLabel = requestedAggregation && requestedAggregation !== 'lookup'
    ? `${requestedAggregation} ${metricColumn}`
    : metricColumn;

  const fallbackAnswer = operationName === 'rank_worksheets'
    ? outputRows.length
      ? `${outputRows[0].label} has the ${direction === 'asc' ? 'lowest' : 'highest'} ${aggregationLabel}: ${formatNumber(outputRows[0].value)}.`
      : `I couldn't find enough matching values to compare the ${partitionColumn || 'worksheet'} groups.`
    : `${aggregationLabel} by ${partitionColumn || 'worksheet'}:\n` +
      outputRows.map((item, index) => `${index + 1}. ${item.label}: ${formatNumber(item.value)}`).join('\n');

  const enriched = attachCrossWorksheetMetricMeaning({
    result: {
      success: true,
      source: 'dataset',
      dataset: null,
      datasets: rowsOut.map((item) => item.dataset),
      operation: operationName,
      column: metricColumn,
      groupBy: partitionColumn,
      aggregation: requestedAggregation || null,
      direction: operationName === 'rank_worksheets' ? direction : null,
      results: outputRows.map((item) => ({
        dataset: item.dataset,
        label: item.label,
        value: item.value,
        filters: item.filters,
        recordsUsed: item.recordsUsed,
        dataQuality: item.dataQuality,
      })),
      aggregationPolicy: {
        mode: 'available_values',
        description: 'Each worksheet is evaluated independently using non-missing metric values.',
        requireCompleteCoverage: false,
        totalWorksheets: rowsOut.length,
      },
      crossWorksheetDataQuality: {
        totalWorksheets: rowsOut.length,
        worksheetsWithValue: rowsOut.filter((item) => item.value !== null && Number.isFinite(Number(item.value))).length,
        worksheetsWithoutValue: rowsOut.filter((item) => item.value === null || !Number.isFinite(Number(item.value))).map((item) => item.label),
      },
      answer: fallbackAnswer,
      debugPlan: plan,
    },
    plan,
    datasets,
    schema,
    question,
  });

  const naturalAnswer = buildSemanticVerifiedAnswer({ question, plan, result: enriched });
  return { ...enriched, answer: naturalAnswer || fallbackAnswer };
}


function discoverPhysicalPartitionColumn({ datasets, schema }) {
  const shared = getSharedColumns(schema);
  const candidates = [];

  for (const column of shared) {
    let singletonCount = 0;
    let distinctAcrossDatasets = true;
    const seen = new Set();

    for (const datasetSchema of schema || []) {
      const rows = datasets?.[datasetSchema?.name];
      if (!Array.isArray(rows) || !rows.length) continue;

      const values = getDistinctNonEmpty(rows, column, 3);
      if (values.length !== 1) continue;

      singletonCount += 1;
      const key = normalizeText(values[0]);
      if (seen.has(key)) distinctAcrossDatasets = false;
      seen.add(key);
    }

    if (singletonCount >= 2 && distinctAcrossDatasets) {
      candidates.push({ column, singletonCount });
    }
  }

  return candidates.sort((a, b) => b.singletonCount - a.singletonCount)[0] || null;
}

function chooseExplicitGroupingColumn({ datasets, schema, question, metricColumn, partitionColumn }) {
  const shared = getSharedColumns(schema);
  const candidates = [];

  for (const name of shared) {
    if (normalizeText(name) === normalizeText(metricColumn)) continue;
    if (normalizeText(name) === normalizeText(partitionColumn)) continue;
    if (!questionMentionsColumnConcept(question, name)) continue;

    let numericVotes = 0;
    let usableVotes = 0;
    for (const datasetSchema of schema || []) {
      const rows = datasets?.[datasetSchema?.name];
      const column = datasetSchema?.columns?.find((c) => String(c?.name) === String(name));
      if (!column || !Array.isArray(rows)) continue;
      usableVotes += 1;
      if (isNumericLikeColumn({ column, rows })) numericVotes += 1;
    }

    if (usableVotes && numericVotes / usableVotes < 0.5) {
      candidates.push({ name, length: normalizeText(name).length });
    }
  }

  return candidates.sort((a, b) => b.length - a.length)[0]?.name || null;
}


function rowMatchesFilter(row, filter) {
  if (!filter?.column) return true;
  const actual = normalizeText(row?.[filter.column]);
  const op = normalizeText(filter.operator || 'equals');
  const expected = filter.value;
  if (op === 'equals') return actual === normalizeText(expected);
  if (op === 'contains') return actual.includes(normalizeText(expected));
  if (op === 'in') {
    const list = Array.isArray(expected) ? expected : [expected];
    return list.some((value) => actual === normalizeText(value));
  }
  return true;
}

function buildCrossWorksheetCoverage({ combinedRows, groupColumn, metricColumn, filters, datasetNames }) {
  const map = new Map();
  const normalizedFilters = Array.isArray(filters) ? filters : [];
  for (const row of combinedRows || []) {
    if (!normalizedFilters.every((filter) => rowMatchesFilter(row, filter))) continue;
    const label = row?.[groupColumn];
    if (label === null || label === undefined || String(label).trim() === '') continue;
    const key = normalizeText(label);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { label: String(label).trim(), worksheets: new Set(), usableValues: 0, missingValues: 0 });
    }
    const item = map.get(key);
    const parsed = parseNumber(row?.[metricColumn]);
    if (parsed === null) {
      item.missingValues += 1;
    } else {
      item.usableValues += 1;
      if (row?.__worksheet) item.worksheets.add(String(row.__worksheet));
    }
  }

  const totalWorksheets = datasetNames.length;
  return new Map([...map.entries()].map(([key, item]) => {
    const used = [...item.worksheets];
    const missingWorksheets = datasetNames.filter((name) => !item.worksheets.has(name));
    return [key, {
      totalWorksheets,
      worksheetsUsed: used.length,
      coverageRate: totalWorksheets ? used.length / totalWorksheets : 0,
      usedWorksheets: used,
      missingWorksheets,
      usableValues: item.usableValues,
      missingValues: item.missingValues,
    }];
  }));
}

function attachCrossWorksheetMetricMeaning({ result, plan, datasets, schema, question }) {
  const firstDataset = Object.keys(datasets || {}).find((name) => Array.isArray(datasets[name]));
  const meaning = inferMetricMeaning({
    plan: { ...plan, dataset: firstDataset },
    question,
    datasets,
    schema,
  });

  // Prefer semantic meaning already carried by the conversation plan. A short
  // follow-up such as "What about January?" may not repeat words like "price",
  // so re-inferring from that short utterance alone can lose the verified
  // metric meaning/unit from the previous turn.
  const metricMeaning =
    plan?.metricMeaning ||
    plan?.metricSemantics ||
    result?.metricMeaning ||
    result?.metricSemantics ||
    meaning.type ||
    null;

  const displayUnit =
    plan?.displayUnit ||
    result?.displayUnit ||
    meaning.displayUnit ||
    null;

  return {
    ...result,
    metricMeaning,
    metricSemantics: metricMeaning,
    displayUnit,
    denominatorUnit: meaning.denominatorUnit || result?.denominatorUnit || null,
  };
}

function executeCrossWorksheetGroupedPlan({ datasets, schema, plan, question = '' }) {
  if (normalizeText(plan?.operation) !== 'rank_across_worksheets') return null;

  const datasetNames = Object.keys(datasets || {}).filter((name) => Array.isArray(datasets[name]));
  if (datasetNames.length < 2) return null;

  const metricColumn = plan?.column || null;
  const groupColumn = plan?.groupBy || plan?.labelColumn || null;
  if (!metricColumn || !groupColumn) return null;

  const combinedRows = [];
  for (const datasetName of datasetNames) {
    const datasetSchema = (schema || []).find((d) => String(d?.name) === String(datasetName));
    const rows = datasets?.[datasetName];
    if (!datasetSchema || !Array.isArray(rows)) continue;

    const hasMetric = datasetSchema.columns?.some((c) => String(c?.name) === String(metricColumn));
    const hasGroup = datasetSchema.columns?.some((c) => String(c?.name) === String(groupColumn));
    if (!hasMetric || !hasGroup) continue;

    for (const row of rows) combinedRows.push({ ...row, __worksheet: datasetName });
  }

  if (!combinedRows.length) return null;

  const syntheticDataset = '__combined_worksheets__';
  const direction = normalizeText(plan?.direction) === 'asc' ? 'asc' : 'desc';
  const aggregation = ['sum', 'average', 'count'].includes(normalizeText(plan?.aggregation))
    ? normalizeText(plan.aggregation)
    : 'average';
  const limit = Math.max(1, Number(plan?.limit) || 1);

  const childPlan = {
    route: 'dataset',
    dataset: syntheticDataset,
    operation: 'rank_groups',
    column: metricColumn,
    labelColumn: groupColumn,
    groupBy: groupColumn,
    aggregation,
    direction,
    filters: Array.isArray(plan?.filters) ? plan.filters.map(cloneFilter) : [],
    selectColumns: [groupColumn, metricColumn],
    outputRequested: true,
    limit,
    showAll: false,
  };

  let ranked;
  try {
    ranked = executePlan({ datasets: { [syntheticDataset]: combinedRows }, plan: childPlan, question });
  } catch (error) {
    return null;
  }

  const rawResults = Array.isArray(ranked?.results) ? ranked.results : [];
  const coverageByGroup = buildCrossWorksheetCoverage({
    combinedRows,
    groupColumn,
    metricColumn,
    filters: childPlan.filters,
    datasetNames,
  });

  const results = rawResults.map((item) => ({
    ...item,
    coverage: coverageByGroup.get(normalizeText(item?.label)) || {
      totalWorksheets: datasetNames.length,
      worksheetsUsed: 0,
      coverageRate: 0,
      usedWorksheets: [],
      missingWorksheets: [...datasetNames],
    },
  }));

  const aggregationPolicy = {
    mode: 'available_values',
    description: 'Aggregate only non-missing values and report worksheet coverage.',
    requireCompleteCoverage: false,
    totalWorksheets: datasetNames.length,
  };

  const fallbackAnswer = results.length
    ? `${direction === 'asc' ? 'Lowest' : 'Highest'} ${groupColumn} by ${aggregation} ${metricColumn} across worksheets:\n` +
      results.map((item, index) => {
        const coverage = item.coverage;
        const note = coverage && coverage.worksheetsUsed < coverage.totalWorksheets
          ? ` (based on ${coverage.worksheetsUsed}/${coverage.totalWorksheets} worksheets)`
          : '';
        return `${index + 1}. ${item.label}: ${formatNumber(item.value)}${note}`;
      }).join('\n')
    : `I couldn't find enough matching values to rank ${groupColumn} across worksheets.`;

  const enriched = attachCrossWorksheetMetricMeaning({
    result: {
      success: true,
      source: 'dataset',
      dataset: null,
      datasets: datasetNames,
      operation: 'rank_across_worksheets',
      column: metricColumn,
      groupBy: groupColumn,
      aggregation,
      direction,
      results,
      filters: childPlan.filters,
      aggregationPolicy,
      crossWorksheetDataQuality: {
        totalWorksheets: datasetNames.length,
        groupsEvaluated: coverageByGroup.size,
      },
      answer: fallbackAnswer,
      debugPlan: plan,
    },
    plan,
    datasets,
    schema,
    question,
  });

  const naturalAnswer = buildSemanticVerifiedAnswer({ question, plan, result: enriched });
  return { ...enriched, answer: naturalAnswer || fallbackAnswer };
}

function buildCrossWorksheetGroupedRankingResolution({ datasets, schema, question }) {
  const datasetNames = Object.keys(datasets || {}).filter((name) => Array.isArray(datasets[name]));
  if (datasetNames.length < 2) return null;

  const direction = detectRankingDirection(question);
  if (!direction) return null;

  const explicitDatasetMentions = findExplicitDatasetMentions({ datasets, question });
  if (explicitDatasetMentions.length === 1) return null;

  const metricColumn = chooseMetricColumn({ datasets, schema, question });
  if (!metricColumn) return null;

  const physicalPartition = discoverPhysicalPartitionColumn({ datasets, schema });
  const partitionColumn = physicalPartition?.column || null;
  const groupColumn = chooseExplicitGroupingColumn({
    datasets,
    schema,
    question,
    metricColumn,
    partitionColumn,
  });

  if (!groupColumn) return null;

  const combinedRows = datasetNames.flatMap((name) => Array.isArray(datasets[name]) ? datasets[name] : []);
  const inferredFilters = inferValueFilters(
    combinedRows,
    question,
    [metricColumn, groupColumn, partitionColumn].filter(Boolean)
  );
  const filters = cleanInferredFilters(inferredFilters, partitionColumn, metricColumn)
    .filter((filter) => normalizeText(filter?.column) !== normalizeText(groupColumn));

  const requestedAggregation = detectQuestionAggregation(question);
  const aggregation = ['sum', 'average', 'count'].includes(requestedAggregation)
    ? requestedAggregation
    : 'average';

  const plan = {
    route: 'dataset',
    dataset: null,
    operation: 'rank_across_worksheets',
    column: metricColumn,
    labelColumn: groupColumn,
    groupBy: groupColumn,
    aggregation,
    direction,
    filters,
    selectColumns: [groupColumn, metricColumn],
    outputRequested: true,
    showAll: false,
    limit: detectRankingLimit(question) || 1,
    distributedWorksheetQuery: true,
    crossWorksheetGroupedRanking: true,
    worksheets: datasetNames,
    aggregationPolicy: {
      mode: 'available_values',
      requireCompleteCoverage: false,
    },
  };

  const result = executeCrossWorksheetGroupedPlan({ datasets, schema, plan, question });
  return result ? { plan, result } : null;
}

function buildDistributedWorksheetFollowUpResolution({
  datasets,
  schema,
  question,
  previousPlan,
  previousSemanticPlan = null,
}) {
  const semanticExecutable = semanticPlanToExecutable(previousSemanticPlan);

  // Backfill semantic fields from the verified semantic conversation plan.
  // The raw previous executable plan may not contain response-enrichment
  // fields such as metricMeaning/displayUnit, especially after a distributed
  // execution. Preserve the executable structure, but let semantic memory fill
  // only missing fields. This keeps follow-ups generic across datasets.
  previousPlan = previousPlan && typeof previousPlan === 'object'
    ? {
        ...(semanticExecutable || {}),
        ...previousPlan,
        metricMeaning: previousPlan.metricMeaning || semanticExecutable?.metricMeaning || null,
        metricSemantics: previousPlan.metricSemantics || semanticExecutable?.metricMeaning || null,
        displayUnit: previousPlan.displayUnit || semanticExecutable?.displayUnit || null,
        metricSource: previousPlan.metricSource || semanticExecutable?.metricSource || null,
        worksheets: Array.isArray(previousPlan.worksheets) && previousPlan.worksheets.length
          ? [...previousPlan.worksheets]
          : Array.isArray(semanticExecutable?.worksheets)
            ? [...semanticExecutable.worksheets]
            : [],
      }
    : semanticExecutable;
  if (!previousPlan || typeof previousPlan !== 'object') return null;

  const previousOperation = normalizeText(previousPlan.operation);
  if (!['rank_worksheets', 'multi_worksheet', 'rank_across_worksheets'].includes(previousOperation)) {
    return null;
  }

  const q = normalizeText(question);
  if (!q) return null;

  // Only reconstruct genuinely short analytical continuations. A complete
  // new question should go through normal deterministic/Groq/local planning.
  const followUpCue =
    /^(?:what|how)\s+about\b/.test(q) ||
    /^(?:and|also|then|now)\b/.test(q) ||
    /\b(?:lowest|highest|top|bottom|least|most|minimum|maximum)\b/.test(q);

  if (!followUpCue) return null;

  const metricColumn = previousPlan.column || null;
  const partitionColumn = previousPlan.groupBy || null;
  if (!metricColumn) return null;

  // A short distributed follow-up can change more than ranking direction.
  // Example: "What about January?" after a February cross-worksheet ranking.
  // Infer any values explicitly mentioned in the CURRENT question from the
  // live shared rows, then replace only filters on the same columns. This is
  // generic and works for Month, Year, Stage, Status, Category, etc.
  const combinedRows = Object.keys(datasets || {})
    .filter((name) => Array.isArray(datasets?.[name]))
    .flatMap((name) => datasets[name]);

  const currentInferredFilters = cleanInferredFilters(
    inferValueFilters(
      combinedRows,
      question,
      [metricColumn, partitionColumn, previousPlan.labelColumn].filter(Boolean)
    ),
    partitionColumn,
    metricColumn
  );

  const explicitCurrentFilters = currentInferredFilters.filter((filter) => {
    const column = normalizeText(filter?.column);
    return column && column !== normalizeText(partitionColumn);
  });

  const direction = detectRankingDirection(question) || previousPlan.direction || null;
  const hasDirectionOverride = Boolean(detectRankingDirection(question));
  const hasFilterOverride = explicitCurrentFilters.length > 0;

  // Do not reconstruct arbitrary "what about ..." turns unless the current
  // question actually changes a supported analytical slot.
  if (!hasDirectionOverride && !hasFilterOverride) return null;

  const previousFilters = Array.isArray(previousPlan.filters)
    ? previousPlan.filters.map(cloneFilter)
    : [];

  const overriddenColumns = new Set(
    explicitCurrentFilters.map((filter) => normalizeText(filter?.column))
  );

  const mergedFilters = [
    ...previousFilters.filter(
      (filter) => !overriddenColumns.has(normalizeText(filter?.column))
    ),
    ...explicitCurrentFilters.map(cloneFilter),
  ];

  const reconstructedPlan = {
    ...previousPlan,
    route: 'dataset',
    dataset: null,
    operation: previousOperation === 'rank_across_worksheets' ? 'rank_across_worksheets' : 'rank_worksheets',
    column: metricColumn,
    groupBy: partitionColumn,
    aggregation: previousPlan.aggregation || 'lookup',
    direction,
    limit: detectRankingLimit(question) || previousPlan.limit || 1,
    filters: mergedFilters,
    selectColumns: Array.isArray(previousPlan.selectColumns)
      ? [...previousPlan.selectColumns]
      : [partitionColumn, metricColumn].filter(Boolean),
    outputRequested: true,
    distributedWorksheetQuery: true,
    reconstructedDistributedFollowUp: true,
  };

  const result = previousOperation === 'rank_across_worksheets'
    ? executeCrossWorksheetGroupedPlan({ datasets, schema, plan: reconstructedPlan, question })
    : executeDistributedWorksheetPlan({ datasets, schema, plan: reconstructedPlan, question });

  if (!result) return null;

  return {
    plan: reconstructedPlan,
    result,
  };
}

module.exports = {
  buildCrossWorksheetGroupedRankingResolution,
  executeCrossWorksheetGroupedPlan,
  buildDistributedWorksheetResolution,
  buildDistributedWorksheetFollowUpResolution,
  executeDistributedWorksheetPlan,
  discoverPartitionColumn,
};
