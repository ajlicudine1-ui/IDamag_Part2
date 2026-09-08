const { normalizeText, parseNumber } = require('./utils');
const { inferValueFilters } = require('./filterEngine');
const { executePlan } = require('./calculationEngine');
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
  if (/\b(?:across|by)\b/.test(q) && questionMentionsColumnConcept(question, partitionColumn)) return true;

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

function buildDistributedWorksheetResolution({ datasets, schema, question }) {
  const datasetNames = Object.keys(datasets || {}).filter((name) => Array.isArray(datasets[name]));
  if (datasetNames.length < 2) return null;

  const partition = discoverPartitionColumn({ datasets, schema, question });
  if (!partition || !hasDistributedScopeCue(question, partition.column)) return null;

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

  return {
    plan: {
      route: 'dataset',
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
    },
    result: {
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
      })),
      answer,
    },
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

  const answer = operationName === 'rank_worksheets'
    ? outputRows.length
      ? `${outputRows[0].label} has the ${direction === 'asc' ? 'lowest' : 'highest'} ${aggregationLabel}: ${formatNumber(outputRows[0].value)}.`
      : `I couldn't find enough matching values to compare the ${partitionColumn || 'worksheet'} groups.`
    : `${aggregationLabel} by ${partitionColumn || 'worksheet'}:\n` +
      outputRows.map((item, index) => `${index + 1}. ${item.label}: ${formatNumber(item.value)}`).join('\n');

  return {
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
    })),
    answer,
    debugPlan: plan,
  };
}

module.exports = {
  buildDistributedWorksheetResolution,
  executeDistributedWorksheetPlan,
  discoverPartitionColumn,
};
