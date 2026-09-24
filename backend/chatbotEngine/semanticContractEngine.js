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

      matches.push({
        contractDataset: contract.datasetName,
        columns: contract.columns,
        row,
        metricFields,
        allowedOperations: safeJsonArray(
          row?.[contract.columns.allowedOperations]
        ),
      });
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

  const [contractDataset, selectedMatches] = selectedEntry;
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
    matchedContractRows: selectedMatches.length,
  };
}

function applyAllowedValuesConstraint(rows, column, allowedValues) {
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

  // Contract metadata can legitimately describe a separate represented
  // surface. Never erase otherwise valid data just because one optional
  // discriminator is absent in this worksheet version.
  if (!selected.length) {
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

  for (const constraint of constraints) {
    if (!constraint.column || !constraint.values?.length) continue;

    const resolution = applyAllowedValuesConstraint(
      scopedRows,
      constraint.column,
      constraint.values
    );

    if (resolution.applied) {
      appliedConstraints.push({
        field: constraint.name,
        column: constraint.column,
        values: constraint.values,
        rowsBefore: scopedRows.length,
        rowsAfter: resolution.rows.length,
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
      semanticContractAuthoritativeOnly: policy.authoritativeOnly,
      semanticContractAllowedOperations: policy.allowedOperations,
      semanticContractMetricFields: policy.metricFields,
      semanticContractMatchedRows: policy.matchedContractRows,
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
  if (!policy?.authoritativeOnly) {
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

    if (recordsUsed <= 1) {
      return {
        allowed: true,
        mode: 'authoritative_stored_value',
        recordsUsed,
      };
    }

    return {
      allowed: false,
      mode: 'recomputation_blocked',
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
  applySemanticContractScope,
  evaluateSemanticContractAggregation,
  safeJsonArray,
};
