const { getColumns, normalizeText } = require('./utils');
const { findColumn } = require('./columnMatcher');

function normalizeContractKey(value) {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeJsonArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  }

  const text = String(value ?? '').trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item ?? '').trim())
        .filter(Boolean);
    }
  } catch (_) {
    // Fall through to conservative delimited parsing below.
  }

  if (/[,;|]/.test(text)) {
    return text
      .split(/[,;|]/)
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  return [text.replace(/^['"]|['"]$/g, '')].filter(Boolean);
}

function findContractColumn(rows, aliases) {
  const columns = getColumns(rows);
  const aliasKeys = new Set((aliases || []).map(normalizeContractKey));

  for (const column of columns) {
    if (aliasKeys.has(normalizeContractKey(column))) {
      return column;
    }
  }

  return null;
}

function detectSemanticContractDatasets(datasets) {
  const results = [];

  for (const [datasetName, rows] of Object.entries(datasets || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;

    const resultTableColumn = findContractColumn(rows, ['result_table']);
    const resultFieldsColumn = findContractColumn(rows, ['result_fields_json']);
    const originalFieldsColumn = findContractColumn(rows, ['original_result_fields_json']);
    const allowedOperationsColumn = findContractColumn(rows, ['allowed_operations_json']);

    // A semantic contract must identify the represented table, fields, and
    // permitted operation family. This signature is intentionally structural
    // rather than dependent on a worksheet name such as "contract".
    if (
      !resultTableColumn ||
      !allowedOperationsColumn ||
      (!resultFieldsColumn && !originalFieldsColumn)
    ) {
      continue;
    }

    results.push({
      datasetName,
      rows,
      columns: {
        resultTable: resultTableColumn,
        resultFields: resultFieldsColumn,
        originalResultFields: originalFieldsColumn,
        allowedOperations: allowedOperationsColumn,
        resultRecordType: findContractColumn(rows, ['result_record_type']),
        resultType: findContractColumn(rows, ['result_type']),
        filterProfileId: findContractColumn(rows, ['filter_profile_id']),
        sourceTable: findContractColumn(rows, ['source_table']),
        exposureStatus: findContractColumn(rows, ['exposure_status']),
        blockReason: findContractColumn(rows, ['block_reason']),
        semanticRestrictions: findContractColumn(rows, ['semantic_restrictions']),
        intentId: findContractColumn(rows, ['intent_id']),
        intentIds: findContractColumn(rows, ['intent_ids_json']),
        capabilityId: findContractColumn(rows, ['capability_id']),
        requiredParameters: findContractColumn(rows, ['required_parameters_json']),
        dimensions: findContractColumn(rows, ['dimensions_json']),
        geographyLevels: findContractColumn(rows, ['geography_levels_json']),
        outputId: findContractColumn(rows, ['output_id']),
        outputName: findContractColumn(rows, ['output_name']),
        publicTerminology: findContractColumn(rows, ['public_terminology']),
      },
    });
  }

  return results;
}

function isBlockedContractRow(row, columns) {
  if (!columns?.exposureStatus) return false;

  const status = normalizeContractKey(row?.[columns.exposureStatus]);
  if (!status) return false;

  return new Set([
    'blocked',
    'block',
    'fail',
    'failed',
    'disabled',
    'unsupported',
    'not available',
  ]).has(status);
}

function rowMatchesTargetDataset(row, columns, datasetName) {
  const target = normalizeContractKey(datasetName);
  if (!target) return false;

  const represented = normalizeContractKey(row?.[columns.resultTable]);
  return represented === target;
}

function getContractMetricFields(row, columns) {
  return [
    ...safeJsonArray(columns.resultFields ? row?.[columns.resultFields] : null),
    ...safeJsonArray(columns.originalResultFields ? row?.[columns.originalResultFields] : null),
  ];
}

function valuesMatchAny(leftValues, rightValues) {
  const right = new Set(
    (rightValues || [])
      .map(normalizeContractKey)
      .filter(Boolean)
  );

  return (leftValues || []).some((value) => {
    const key = normalizeContractKey(value);
    return key && right.has(key);
  });
}

function uniqueStrings(values) {
  const seen = new Set();
  const results = [];

  for (const value of values || []) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const key = normalizeContractKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(text);
  }

  return results;
}

function isAuthoritativeRetrieveOperation(operation) {
  const key = normalizeContractKey(operation);
  return key === 'retrieve' || key.startsWith('retrieve ');
}

function contractRowValue(row, columns, key) {
  const column = columns?.[key];
  return column ? String(row?.[column] ?? '').trim() : '';
}

function buildSemanticContextSignature(match) {
  const { row, columns, metricFields, allowedOperations } = match;
  const parts = [
    contractRowValue(row, columns, 'resultTable'),
    contractRowValue(row, columns, 'resultRecordType'),
    contractRowValue(row, columns, 'resultType'),
    contractRowValue(row, columns, 'sourceTable'),
    contractRowValue(row, columns, 'filterProfileId'),
    uniqueStrings(metricFields).map(normalizeContractKey).sort().join(','),
    uniqueStrings(allowedOperations).map(normalizeContractKey).sort().join(','),
  ];
  return parts.map(normalizeContractKey).join('||');
}

function rowMatchesBoundIntentContext(match, plan) {
  if (!plan?.semanticContractIntentRepaired) return true;

  const expectedOutputId = normalizeContractKey(plan.semanticContractIntentOutputId);
  if (expectedOutputId) {
    const actualOutputId = normalizeContractKey(
      contractRowValue(match.row, match.columns, 'outputId')
    );
    if (actualOutputId !== expectedOutputId) return false;
  }

  const expectedSignature = String(plan.semanticContractIntentContextSignature || '').trim();
  if (expectedSignature && buildSemanticContextSignature(match) !== expectedSignature) {
    return false;
  }

  return true;
}

function resolveSemanticContractPolicy({
  datasets,
  datasetName,
  rows,
  plan,
}) {
  if (!datasets || !datasetName || !Array.isArray(rows) || !rows.length) {
    return null;
  }

  const resolvedMetric = plan?.column ? findColumn(rows, plan.column) : null;
  const metricCandidates = uniqueStrings([
    plan?.column,
    resolvedMetric,
  ]);

  if (!metricCandidates.length) return null;

  const contracts = detectSemanticContractDatasets(datasets);
  if (!contracts.length) return null;

  const matches = [];

  for (const contract of contracts) {
    for (const row of contract.rows) {
      if (isBlockedContractRow(row, contract.columns)) continue;
      if (!rowMatchesTargetDataset(row, contract.columns, datasetName)) continue;

      const metricFields = getContractMetricFields(row, contract.columns);
      if (!valuesMatchAny(metricCandidates, metricFields)) continue;

      const match = {
        contractDataset: contract.datasetName,
        columns: contract.columns,
        row,
        metricFields,
        allowedOperations: safeJsonArray(
          row?.[contract.columns.allowedOperations]
        ),
      };

      if (!rowMatchesBoundIntentContext(match, plan)) continue;
      matches.push(match);
    }
  }

  if (!matches.length) return null;

  // Prefer the contract table with the most matches for this exact target.
  const byDataset = new Map();
  for (const match of matches) {
    if (!byDataset.has(match.contractDataset)) {
      byDataset.set(match.contractDataset, []);
    }
    byDataset.get(match.contractDataset).push(match);
  }

  const selectedEntry = [...byDataset.entries()]
    .sort((a, b) => b[1].length - a[1].length)[0];

  const [contractDataset, candidateMatches] = selectedEntry;

  // Multiple contract rows may legitimately describe the same semantic
  // result context (for example the same stored scalar exposed on two
  // visuals). Collapse only rows whose complete execution context is
  // identical. Never union different contexts merely because they share a
  // header and geography.
  const byContext = new Map();
  for (const match of candidateMatches) {
    const signature = buildSemanticContextSignature(match);
    if (!byContext.has(signature)) byContext.set(signature, []);
    byContext.get(signature).push(match);
  }

  const contextEntries = [...byContext.entries()];
  const hasBoundContext = Boolean(
    plan?.semanticContractIntentOutputId ||
    plan?.semanticContractIntentContextSignature
  );

  // A bound intent must resolve to exactly one semantic context. An unbound
  // metric with several distinct contexts is unsafe for scalar retrieval and
  // is carried forward as ambiguous so execution can fail closed.
  const ambiguousContext = contextEntries.length > 1;
  const selectedContextEntry = contextEntries[0];
  const selectedMatches = selectedContextEntry?.[1] || [];
  const selectedContextSignature = selectedContextEntry?.[0] || null;
  const allowedOperations = uniqueStrings(
    selectedMatches.flatMap((item) => item.allowedOperations)
  );

  const authoritativeOnly =
    allowedOperations.length > 0 &&
    allowedOperations.every(isAuthoritativeRetrieveOperation);

  const collectColumnValues = (contractColumnName) =>
    uniqueStrings(
      selectedMatches.map((item) => {
        const column = item.columns?.[contractColumnName];
        return column ? item.row?.[column] : '';
      })
    );

  return {
    contractDataset,
    ambiguousContext,
    hasBoundContext,
    contextCount: contextEntries.length,
    contextSignature: selectedContextSignature,
    authoritativeOnly,
    allowedOperations,
    metricFields: uniqueStrings(
      selectedMatches.flatMap((item) => item.metricFields)
    ),
    resultRecordTypes: collectColumnValues('resultRecordType'),
    resultTypes: collectColumnValues('resultType'),
    filterProfileIds: collectColumnValues('filterProfileId'),
    sourceTables: collectColumnValues('sourceTable'),
    semanticRestrictions: collectColumnValues('semanticRestrictions'),
    outputIds: collectColumnValues('outputId'),
    outputNames: collectColumnValues('outputName'),
    publicTerminology: collectColumnValues('publicTerminology'),
    intentIds: uniqueStrings(
      selectedMatches.flatMap((item) => [
        contractRowValue(item.row, item.columns, 'intentId'),
        ...safeJsonArray(contractRowValue(item.row, item.columns, 'intentIds')),
      ])
    ),
    capabilityIds: collectColumnValues('capabilityId'),
    requiredParameters: collectColumnValues('requiredParameters'),
    dimensions: collectColumnValues('dimensions'),
    geographyLevels: collectColumnValues('geographyLevels'),
    matchedContractRows: selectedMatches.length,
    candidateContractRows: candidateMatches.length,
  };
}


function singularizeContractToken(token) {
  const word = String(token || '').trim();
  if (!word) return '';
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

const CONTRACT_INTENT_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by',
  'with', 'without', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'how', 'many', 'much', 'what', 'which', 'who', 'whom', 'whose',
  'show', 'give', 'tell', 'list', 'number', 'count', 'total', 'overall',
  'each', 'every', 'all', 'per', 'value', 'values', 'result', 'results',
]);

function semanticContractTokens(value) {
  return normalizeContractKey(value)
    .split(/\s+/)
    .map(singularizeContractToken)
    .filter((token) => token && !CONTRACT_INTENT_STOPWORDS.has(token));
}

function scoreContractIntentLabel(question, label) {
  const questionTokens = new Set(semanticContractTokens(question));
  const labelTokens = [...new Set(semanticContractTokens(label))];
  if (!questionTokens.size || !labelTokens.length) return null;

  const overlap = labelTokens.filter((token) => questionTokens.has(token));
  const overlapCount = overlap.length;
  const labelCoverage = overlapCount / labelTokens.length;

  // Multi-token semantic labels require at least two independently matching
  // concepts. One-token labels can still be decisive (for example a stored
  // metric whose public name is simply "Farmers").
  const strong = labelTokens.length === 1
    ? overlapCount === 1 && labelTokens[0].length >= 4
    : overlapCount >= 2 && labelCoverage >= 0.66;

  if (!strong) return null;

  const normalizedQuestion = normalizeContractKey(question);
  const normalizedLabel = normalizeContractKey(label);
  const phraseBonus = normalizedLabel && normalizedQuestion.includes(normalizedLabel) ? 2 : 0;

  return {
    score: overlapCount * 2 + labelCoverage + phraseBonus,
    overlapCount,
    labelCoverage,
    labelTokens,
  };
}

function numericCoverage(rows, column) {
  if (!column || !Array.isArray(rows) || !rows.length) return 0;
  let numeric = 0;
  let populated = 0;

  for (const row of rows) {
    const raw = row?.[column];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    populated += 1;
    const value = Number(String(raw).replace(/,/g, '').trim());
    if (Number.isFinite(value)) numeric += 1;
  }

  return populated ? numeric / populated : 0;
}

/**
 * Recover a metric-bearing plan from a dataset-declared semantic contract
 * when a planner interpreted "how many <metric>" as a physical row count.
 *
 * This is intentionally conservative and generic:
 *   - explicit requests to count rows/records/entries are never changed;
 *   - the contract row must structurally target the already selected dataset;
 *   - a public/output semantic label must strongly match the question;
 *   - the contract must expose a real numeric result field in that dataset.
 *
 * Both Groq and local-fallback plans pass through the shared planner
 * invariants, so this repair gives the two planners the same behavior.
 */
function resolveSemanticContractIntentPlan({ datasets, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset) return null;
  if (normalizeContractKey(plan.operation) !== 'row count') return null;

  const questionText = normalizeContractKey(question);
  if (!/\b(?:how many|number of|count of|count)\b/.test(questionText)) return null;
  // "rows" and "entries" are unambiguously physical-record requests. The
  // word "records" is not: many semantic contracts legitimately expose a
  // business metric called registered records. We decide that only after
  // attempting to bind the question to a contract metric below.
  if (/\b(?:rows?|entries?)\b/.test(questionText)) return null;

  const targetRows = datasets?.[plan.dataset];
  if (!Array.isArray(targetRows) || !targetRows.length) return null;

  const contracts = detectSemanticContractDatasets(datasets);
  if (!contracts.length) return null;

  const candidates = [];

  for (const contract of contracts) {
    for (const row of contract.rows) {
      if (isBlockedContractRow(row, contract.columns)) continue;
      if (!rowMatchesTargetDataset(row, contract.columns, plan.dataset)) continue;

      const semanticLabels = [
        contract.columns.outputName ? row?.[contract.columns.outputName] : '',
        contract.columns.publicTerminology ? row?.[contract.columns.publicTerminology] : '',
      ].filter(Boolean);

      let bestLabel = null;
      let bestMatch = null;
      for (const label of semanticLabels) {
        const match = scoreContractIntentLabel(question, label);
        if (!match) continue;
        if (!bestMatch || match.score > bestMatch.score) {
          bestLabel = String(label).trim();
          bestMatch = match;
        }
      }
      if (!bestMatch) continue;

      const metricFields = getContractMetricFields(row, contract.columns);
      const resolvedMetricCandidates = uniqueStrings(metricFields)
        .map((field) => findColumn(targetRows, field))
        .filter(Boolean)
        .map((column) => ({ column, numericCoverage: numericCoverage(targetRows, column) }))
        .filter((item) => item.numericCoverage >= 0.5)
        .sort((a, b) => b.numericCoverage - a.numericCoverage);

      const metric = resolvedMetricCandidates[0];
      if (!metric) continue;

      const allowedOperations = safeJsonArray(row?.[contract.columns.allowedOperations]);
      if (!allowedOperations.length) continue;

      candidates.push({
        contractDataset: contract.datasetName,
        row,
        columns: contract.columns,
        metricColumn: metric.column,
        numericCoverage: metric.numericCoverage,
        label: bestLabel,
        semanticScore: bestMatch.score,
        overlapCount: bestMatch.overlapCount,
        labelCoverage: bestMatch.labelCoverage,
        allowedOperations,
        outputId: contractRowValue(row, contract.columns, 'outputId'),
        resultTable: contractRowValue(row, contract.columns, 'resultTable'),
        resultRecordType: contractRowValue(row, contract.columns, 'resultRecordType'),
        resultType: contractRowValue(row, contract.columns, 'resultType'),
        sourceTable: contractRowValue(row, contract.columns, 'sourceTable'),
        filterProfileId: contractRowValue(row, contract.columns, 'filterProfileId'),
        contextSignature: buildSemanticContextSignature({
          row,
          columns: contract.columns,
          metricFields,
          allowedOperations,
        }),
      });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((left, right) => {
    if (right.semanticScore !== left.semanticScore) return right.semanticScore - left.semanticScore;
    if (right.labelCoverage !== left.labelCoverage) return right.labelCoverage - left.labelCoverage;
    if (right.overlapCount !== left.overlapCount) return right.overlapCount - left.overlapCount;
    return right.numericCoverage - left.numericCoverage;
  });

  const best = candidates[0];
  const runnerUp = candidates[1];

  // Do not make an arbitrary choice when two different metrics have equally
  // strong semantic evidence. Duplicate contract rows for the same metric are
  // harmless and intentionally allowed.
  if (runnerUp &&
      runnerUp.metricColumn !== best.metricColumn &&
      Math.abs(runnerUp.semanticScore - best.semanticScore) < 0.25) {
    return null;
  }

  // Preserve genuine physical row-count questions such as "How many records
  // are in this dataset?". A question containing "records" is only treated as
  // a semantic metric when a strong contract label already matched it.
  if (/\brecords?\b/.test(questionText)) {
    const physicalContext = /\b(?:dataset|table|sheet|worksheet|rows?)\b/.test(questionText);
    if (physicalContext && !best.labelCoverage) return null;
    if (physicalContext && best.labelCoverage < 0.99) return null;
  }

  const groupBy = plan.groupBy ? findColumn(targetRows, plan.groupBy) : null;
  const operation = groupBy ? 'group_sum' : 'sum';

  return {
    ...plan,
    operation,
    column: best.metricColumn,
    groupBy: groupBy || null,
    aggregation: groupBy ? 'sum' : null,
    labelColumn: groupBy || null,
    selectColumns: groupBy ? [groupBy, best.metricColumn] : [best.metricColumn],
    outputRequested: true,
    semanticContractIntentRepaired: true,
    semanticContractIntentDataset: best.contractDataset,
    semanticContractIntentLabel: best.label,
    semanticContractIntentAllowedOperations: best.allowedOperations,
    semanticContractIntentOutputId: best.outputId || null,
    semanticContractIntentResultTable: best.resultTable || null,
    semanticContractIntentResultRecordType: best.resultRecordType || null,
    semanticContractIntentResultType: best.resultType || null,
    semanticContractIntentSourceTable: best.sourceTable || null,
    semanticContractIntentFilterProfileId: best.filterProfileId || null,
    semanticContractIntentContextSignature: best.contextSignature,
  };
}

function applyAllowedValuesConstraint(rows, column, allowedValues, options = {}) {
  if (!column || !Array.isArray(rows) || !rows.length || !allowedValues?.length) {
    return { rows, applied: false };
  }

  const allowed = new Set(
    allowedValues.map(normalizeContractKey).filter(Boolean)
  );

  if (!allowed.size) return { rows, applied: false };

  const selected = rows.filter((row) =>
    allowed.has(normalizeContractKey(row?.[column]))
  );

  // For an intent-bound authoritative retrieval the contract context is a
  // required part of the lookup key. If the discriminator exists but no row
  // matches, fail closed by preserving the empty selection. Legacy/unbound
  // metric plans keep the earlier permissive fallback behavior.
  if (!selected.length) {
    if (options.strict === true) {
      return { rows: [], applied: true, strictMiss: true };
    }
    return { rows, applied: false };
  }

  return { rows: selected, applied: selected.length < rows.length };
}

function resolveTargetScopeColumns(rows) {
  return {
    sourceTable: findContractColumn(rows, ['source_table']),
    recordType: findContractColumn(rows, ['record_type']),
    resultType: findContractColumn(rows, ['result_type']),
    filterProfileId: findContractColumn(rows, ['filter_profile_id']),
  };
}

function scopeRowsToSemanticContract(rows, policy) {
  if (!policy || !Array.isArray(rows) || !rows.length) {
    return { rows, constraints: [] };
  }

  const targetColumns = resolveTargetScopeColumns(rows);
  const constraints = [
    {
      name: 'source_table',
      column: targetColumns.sourceTable,
      values: policy.sourceTables,
    },
    {
      name: 'record_type',
      column: targetColumns.recordType,
      values: policy.resultRecordTypes,
    },
    {
      name: 'result_type',
      column: targetColumns.resultType,
      values: policy.resultTypes,
    },
    {
      name: 'filter_profile_id',
      column: targetColumns.filterProfileId,
      values: policy.filterProfileIds,
    },
  ];

  let scopedRows = rows;
  const appliedConstraints = [];
  const strict = Boolean(policy.hasBoundContext && policy.authoritativeOnly);

  for (const constraint of constraints) {
    if (!constraint.column || !constraint.values?.length) continue;

    const resolution = applyAllowedValuesConstraint(
      scopedRows,
      constraint.column,
      constraint.values,
      { strict }
    );

    if (resolution.applied) {
      appliedConstraints.push({
        field: constraint.name,
        column: constraint.column,
        values: constraint.values,
        rowsBefore: scopedRows.length,
        rowsAfter: resolution.rows.length,
        strictMiss: Boolean(resolution.strictMiss),
      });
    }

    scopedRows = resolution.rows;
  }

  return {
    rows: scopedRows,
    constraints: appliedConstraints,
  };
}

function applySemanticContractScope({
  datasets,
  datasetName,
  rows,
  filteredRows,
  plan,
}) {
  const policy = resolveSemanticContractPolicy({
    datasets,
    datasetName,
    rows,
    plan,
  });

  if (!policy) {
    return {
      allRows: rows,
      rows: filteredRows,
      policy: null,
      metadata: null,
    };
  }

  const allScope = scopeRowsToSemanticContract(rows, policy);
  const filteredScope = scopeRowsToSemanticContract(filteredRows, policy);

  return {
    allRows: allScope.rows,
    rows: filteredScope.rows,
    policy,
    metadata: {
      semanticContractAware: true,
      semanticContractDataset: policy.contractDataset,
      semanticContractContextSignature: policy.contextSignature,
      semanticContractContextCount: policy.contextCount,
      semanticContractContextAmbiguous: policy.ambiguousContext,
      semanticContractIntentBound: policy.hasBoundContext,
      semanticContractAuthoritativeOnly: policy.authoritativeOnly,
      semanticContractAllowedOperations: policy.allowedOperations,
      semanticContractMetricFields: policy.metricFields,
      semanticContractMatchedRows: policy.matchedContractRows,
      semanticContractCandidateRows: policy.candidateContractRows,
      semanticContractOutputIds: policy.outputIds,
      semanticContractOutputNames: policy.outputNames,
      semanticContractScopeConstraints: filteredScope.constraints,
      rowsBeforeSemanticContractScope: filteredRows.length,
      rowsAfterSemanticContractScope: filteredScope.rows.length,
    },
  };
}

function countNonEmptyNumericRows(rows, column, parseNumber) {
  if (!column) return 0;
  return (rows || []).reduce((count, row) => {
    return count + (parseNumber(row?.[column]) === null ? 0 : 1);
  }, 0);
}

function evaluateSemanticContractAggregation({
  policy,
  rows,
  plan,
  operation,
  parseNumber,
}) {
  if (!policy) {
    return { allowed: true, mode: null };
  }

  if (policy.ambiguousContext) {
    return {
      allowed: false,
      mode: 'semantic_context_ambiguous',
      diagnostic: 'MULTIPLE_SEMANTIC_CONTEXT_MATCH',
      contextCount: policy.contextCount,
      reason: 'multiple_semantic_contract_contexts',
    };
  }

  if (!policy.authoritativeOnly) {
    return { allowed: true, mode: null };
  }

  const scalarOperations = new Set([
    'sum',
    'average',
    'median',
    'minimum',
    'maximum',
  ]);

  const groupedOperations = new Set([
    'group_sum',
    'group_average',
    'group_minimum',
    'group_maximum',
  ]);

  if (!scalarOperations.has(operation) && !groupedOperations.has(operation)) {
    return {
      allowed: true,
      mode: 'authoritative_nonaggregate_operation',
    };
  }

  const metricColumn = plan?.column ? findColumn(rows, plan.column) : null;
  if (!metricColumn) {
    return { allowed: true, mode: 'authoritative_metric_unresolved' };
  }

  if (scalarOperations.has(operation)) {
    const recordsUsed = countNonEmptyNumericRows(rows, metricColumn, parseNumber);

    if (recordsUsed === 1) {
      return {
        allowed: true,
        mode: 'authoritative_stored_value',
        recordsUsed,
      };
    }

    if (recordsUsed === 0) {
      return {
        allowed: false,
        mode: 'authoritative_scalar_missing',
        diagnostic: 'NO_SCALAR_MATCH',
        recordsUsed,
        reason: 'no_authoritative_scalar_row',
      };
    }

    return {
      allowed: false,
      mode: 'recomputation_blocked',
      diagnostic: 'MULTIPLE_SCALAR_MATCH',
      recordsUsed,
      reason: 'multiple_authoritative_rows',
    };
  }

  const groupColumn = plan?.groupBy ? findColumn(rows, plan.groupBy) : null;
  if (!groupColumn) {
    return { allowed: true, mode: 'authoritative_group_unresolved' };
  }

  const groupCounts = new Map();
  for (const row of rows || []) {
    const label = String(row?.[groupColumn] ?? '').trim();
    if (!label || parseNumber(row?.[metricColumn]) === null) continue;
    groupCounts.set(label, (groupCounts.get(label) || 0) + 1);
  }

  const maxRowsPerGroup = groupCounts.size
    ? Math.max(...groupCounts.values())
    : 0;

  if (maxRowsPerGroup <= 1) {
    return {
      allowed: true,
      mode: 'authoritative_grouped_retrieval',
      groupCount: groupCounts.size,
      maxRowsPerGroup,
    };
  }

  return {
    allowed: false,
    mode: 'recomputation_blocked',
    groupCount: groupCounts.size,
    maxRowsPerGroup,
    reason: 'multiple_authoritative_rows_per_group',
  };
}

module.exports = {
  detectSemanticContractDatasets,
  resolveSemanticContractPolicy,
  resolveSemanticContractIntentPlan,
  applySemanticContractScope,
  evaluateSemanticContractAggregation,
  safeJsonArray,
};
