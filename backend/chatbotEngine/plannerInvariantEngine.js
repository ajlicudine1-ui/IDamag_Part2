const { normalizeText, parseNumber } = require('./utils');
const {
  findExplicitSchemaColumns,
  detectQuestionAggregation,
  detectRankingDirection,
  detectRankingLimit,
  parseRankingTargets,
  scoreTargetToColumn,
  findStrongMorphologicalQuestionColumn,
  inferRequestedColumnFromQuestion,
} = require('./plannerNormalizer');
const { findColumn } = require('./columnMatcher');
const { applyFilters } = require('./filterEngine');

function cloneFilter(filter) {
  if (!filter || typeof filter !== 'object') return null;
  return { ...filter, value: Array.isArray(filter.value) ? [...filter.value] : filter.value };
}

function normalizeSameColumnEqualityFilters(plan) {
  if (!plan || plan.route !== 'dataset' || !Array.isArray(plan.filters) || plan.filters.length < 2) return plan;
  const groups = new Map();
  const passthrough = [];
  for (const filter of plan.filters) {
    const op = normalizeText(filter?.operator || 'equals');
    const key = normalizeText(filter?.column || '');
    if (key && ['equals', 'equal', '='].includes(op)) {
      if (!groups.has(key)) groups.set(key, { column: filter.column, filters: [] });
      groups.get(key).filters.push(filter);
    } else {
      passthrough.push(cloneFilter(filter));
    }
  }
  let changed = false;
  const normalized = [...passthrough];
  for (const { column, filters } of groups.values()) {
    const values = [];
    const seen = new Set();
    for (const filter of filters) {
      const items = Array.isArray(filter.value) ? filter.value : [filter.value];
      for (const item of items) {
        const key = normalizeText(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        values.push(item);
      }
    }
    if (values.length > 1) {
      changed = true;
      normalized.push({ column, operator: 'in', value: values });
    } else if (values.length === 1) {
      normalized.push({ column, operator: 'equals', value: values[0] });
    }
  }
  return changed ? { ...plan, filters: normalized, sameColumnScopeNormalized: true } : plan;
}


function dedupePlanFilters(plan) {
  if (!plan || plan.route !== 'dataset' || !Array.isArray(plan.filters) || plan.filters.length < 2) return plan;
  const seen = new Set();
  const filters = [];
  for (const filter of plan.filters) {
    if (!filter || !filter.column) continue;
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const valueKey = values.map((value) => normalizeText(value)).sort().join('|');
    const key = `${normalizeText(filter.column)}::${normalizeText(filter.operator || 'equals')}::${valueKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filters.push(cloneFilter(filter));
  }
  return filters.length === plan.filters.length
    ? plan
    : { ...plan, filters, duplicateFiltersRemoved: true };
}

function removeProjectionFieldFilterArtifacts({ datasets, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset || !Array.isArray(plan.filters) || !plan.filters.length) return plan;
  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  const { core, detail } = splitRankingDetailQuestion(question);
  if (!detail) return plan;
  const requestedDetailColumns = resolveDetailColumns(rows, detail);
  if (!requestedDetailColumns.length) return plan;

  const detailNames = new Set(requestedDetailColumns.map((column) => normalizeText(column)));
  const coreText = normalizeText(core);
  const filtered = plan.filters.filter((filter) => {
    if (!filter?.column) return false;
    const columnName = normalizeText(filter.column);
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const valuesAreRequestedFields = values.length > 0 && values.every((value) => detailNames.has(normalizeText(value)));
    if (!valuesAreRequestedFields) return true;

    // Keep a real user filter when its column was explicitly stated in the
    // ranking core. Otherwise a planner may have mistaken requested output
    // fields (e.g. province/municipality) for categorical filter values.
    const escaped = columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Boolean(columnName && new RegExp(`\\b${escaped}\\b`).test(coreText));
  });

  return filtered.length === plan.filters.length
    ? plan
    : { ...plan, filters: filtered, projectionFieldFilterArtifactRemoved: true };
}

function isNumericColumn(rows, column) {
  if (!column || !Array.isArray(rows) || !rows.length) return false;
  let usable = 0;
  let numeric = 0;
  for (const row of rows.slice(0, 100)) {
    const value = row?.[column];
    if (value === null || value === undefined || String(value).trim() === '') continue;
    usable += 1;
    const text = String(value).trim();
    const numericShape = /^\(?[+-]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?%?\)?$/.test(text);
    if (numericShape && parseNumber(value) !== null) numeric += 1;
  }
  return usable > 0 && numeric / usable >= 0.6;
}

/**
 * Decide whether a numeric field represents an additive measure rather than
 * an identifier/rate/category encoded as a number.  The vocabulary here is
 * intentionally semantic and reusable across reports; it never names a
 * worksheet, province, commodity, project, or other dataset-specific value.
 */
function isAdditiveMeasureColumn(column) {
  const raw = String(column || '');
  const name = normalizeText(raw);
  if (!name) return false;

  // Numeric identifiers and non-additive rates must not be summed merely
  // because the cells contain numbers.
  if (
    /\b(?:id|identifier|code|reference|ref|serial|contact|phone|mobile|telephone|year|month|day|date|phase|status|grade|level|rate|ratio|percent|percentage|average|avg|mean|price|yield|latitude|longitude)\b/.test(name)
  ) {
    return false;
  }

  if (
    /\b(?:quantity|qty|amount|cost|value|area|land|volume|weight|production|harvested|planted|damage|damaged|loss|member|members|implementer|implementers|beneficiary|beneficiaries|recipient|recipients|farmer|farmers|male|males|female|females|person|persons|people|population|count|number)\b/.test(name)
  ) {
    return true;
  }

  // Common area units embedded in a metric header (for example "(...ha)")
  // are reliable evidence that the field is an additive physical measure.
  return /(?:\(|\b)(?:ha|hectare|hectares)(?:\)|\b)/i.test(raw);
}

function hasExplicitCountCue(question) {
  return /\b(?:how many|number of|count(?: of)?)\b/.test(normalizeText(question));
}

function hasExplicitRowCountCue(question) {
  return /\b(?:how many\s+(?:rows|records|entries)|number of\s+(?:rows|records|entries)|(?:row|record|entry)\s+count|count of\s+(?:rows|records|entries))\b/.test(
    normalizeText(question)
  );
}

/**
 * Repair plans that counted rows merely because the question contained the
 * word "records" even though the user actually asked which entity values are
 * present (e.g. "What municipalities have ... records?").
 */
function repairEntityListIntent({ datasets, schema, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset) return plan;
  if (String(plan.operation || '').toLowerCase() !== 'row_count') return plan;
  if (hasExplicitCountCue(question) || hasExplicitRowCountCue(question)) return plan;

  const text = normalizeText(question);
  if (!/^(?:what|which|who)\b/.test(text)) return plan;
  if (/^(?:what|which)\s+about\b/.test(text)) return plan;

  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  const match = findStrongMorphologicalQuestionColumn({
    schema,
    question,
    preferredDataset: plan.dataset,
  });

  const column = match?.column ? (findColumn(rows, match.column) || match.column) : null;
  if (!column || isNumericColumn(rows, column)) return plan;

  return {
    ...plan,
    operation: 'list',
    column,
    labelColumn: column,
    groupBy: null,
    aggregation: null,
    selectColumns: [column],
    outputRequested: true,
    showAll: true,
    entityListIntentParityApplied: true,
  };
}

/**
 * "How many <numeric measure> ..." means SUM for additive count/quantity
 * fields, not "how many non-empty cells".  Identifier-like numeric fields
 * stay untouched, preserving questions such as counts of salary grades.
 */
function repairNumericMeasureCountIntent({ datasets, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset) return plan;
  if (!hasExplicitCountCue(question) || hasExplicitRowCountCue(question)) return plan;
  if (/\b(?:distinct|unique|different)\b/.test(normalizeText(question))) return plan;

  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  const column = plan.column ? (findColumn(rows, plan.column) || plan.column) : null;
  if (!column || !isNumericColumn(rows, column) || !isAdditiveMeasureColumn(column)) return plan;

  const op = String(plan.operation || '').toLowerCase();
  const repairable = new Set(['row_count', 'non_empty_count', 'distinct_count', 'lookup', 'list', 'value', 'select', 'get']);
  if (!repairable.has(op)) return plan;

  return {
    ...plan,
    operation: 'sum',
    column,
    labelColumn: null,
    groupBy: null,
    aggregation: null,
    selectColumns: [column],
    outputRequested: true,
    numericMeasureCountParityApplied: true,
  };
}

/**
 * A filtered request for one additive metric can represent a roll-up even
 * without the literal word "total":
 *   "What is the totally damaged area for Rice?"
 * When several rows match the filter, return their sum instead of a raw list.
 */
function repairImplicitFilteredAdditiveAggregate({ datasets, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset) return plan;
  if (detectRankingDirection(question) || detectQuestionAggregation(question)) return plan;
  if (hasGroupingCue(question)) return plan;

  const op = String(plan.operation || '').toLowerCase();
  if (!['lookup', 'list', 'value', 'select', 'get'].includes(op)) return plan;

  const text = normalizeText(question);
  if (!/^(?:what|which|show|give|tell|get|find)\b/.test(text)) return plan;
  if (/\b(?:list|show all|display all|each value|values)\b/.test(text)) return plan;

  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  const column = plan.column ? (findColumn(rows, plan.column) || plan.column) : null;
  if (!column || !isNumericColumn(rows, column) || !isAdditiveMeasureColumn(column)) return plan;

  const filters = Array.isArray(plan.filters) ? plan.filters : [];
  if (!filters.length) return plan;

  const matchedRows = applyFilters(rows, filters);
  if (matchedRows.length <= 1) return plan;

  return {
    ...plan,
    operation: 'sum',
    column,
    labelColumn: null,
    groupBy: null,
    aggregation: null,
    selectColumns: [column],
    outputRequested: true,
    showAll: false,
    implicitAdditiveAggregateParityApplied: true,
  };
}

function hasGroupingCue(question) {
  return Boolean(extractGroupingTarget(question));
}

function explicitColumnsForDataset(schema, question, dataset) {
  return findExplicitSchemaColumns({ schema, question, preferredDataset: dataset })
    .map((item) => item.column)
    .filter(Boolean);
}

function extractGroupingTarget(question) {
  const raw = String(question || '').replace(/[?!.]+$/g, ' ').trim();

  // These patterns describe generic grouping grammar only. The captured noun
  // is still resolved against the live worksheet schema, so no dashboard
  // field or business value is hardcoded here.
  const patterns = [
    /\b(?:for\s+each|for\s+every|per|by|grouped\s+by|broken\s+down\s+by)\s+(?:the\s+)?(.+?)(?=\s+(?:with|where|that|which|who|and\s+then|then)\b|[,;]|$)/i,
    /\bof\s+each\s+(?:the\s+)?(.+?)(?=\s+(?:with|where|that|which|who|and\s+then|then)\b|[,;]|$)/i,
    /\b(?:does|do|did)\s+each\s+(?:the\s+)?(.+?)\s+(?:have|has|contain|contains|include|includes|receive|receives|use|uses)\b/i,
    /\beach\s+(?:the\s+)?(.+?)\s+(?:has|have|contains|includes|receives|uses)\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    const target = match[1]
      .replace(/\b(?:respectively|separately)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (target) return target;
  }

  return null;
}

function inferQuestionColumn({ schema, dataset, rows, question, excludedColumns = [] }) {
  const excluded = new Set(
    (excludedColumns || []).map((item) => normalizeText(item)).filter(Boolean)
  );

  const direct = findColumn(rows, question);
  if (direct && !excluded.has(normalizeText(direct))) return direct;

  const inferred = inferRequestedColumnFromQuestion({
    schema,
    question,
    preferredDataset: dataset,
    excludedColumns,
  });

  const column = inferred?.column
    ? (findColumn(rows, inferred.column) || inferred.column)
    : null;

  return column && !excluded.has(normalizeText(column))
    ? column
    : null;
}

function inferNumericQuestionColumn({
  schema,
  dataset,
  rows,
  question,
  excludedColumns = [],
}) {
  const excluded = new Set(
    (excludedColumns || []).map((item) => normalizeText(item)).filter(Boolean)
  );

  const explicit = explicitColumnsForDataset(schema, question, dataset)
    .filter(
      (column) =>
        !excluded.has(normalizeText(column)) &&
        isNumericColumn(rows, column)
    );

  if (explicit.length) {
    return explicit
      .map((column) => ({
        column,
        score: scoreTargetToColumn(question, column),
      }))
      .sort((a, b) => b.score - a.score)[0].column;
  }

  const candidates = Object.keys(rows?.[0] || {})
    .filter(
      (column) =>
        !excluded.has(normalizeText(column)) &&
        isNumericColumn(rows, column)
    )
    .map((column) => ({
      column,
      score: scoreTargetToColumn(question, column),
    }))
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.score >= 0.72
    ? candidates[0].column
    : null;
}

function groupingValueQuestion(question) {
  const raw = String(question || '').replace(/[?!.]+$/g, ' ').trim();
  const cuts = [
    /\b(?:for\s+each|for\s+every|per|grouped\s+by|broken\s+down\s+by)\b/i,
    /\bof\s+each\b/i,
    /\b(?:does|do|did)\s+each\b/i,
    /\beach\b/i,
  ];

  for (const cut of cuts) {
    const index = raw.search(cut);
    if (index > 0) return raw.slice(0, index).trim();
  }

  return raw;
}

/**
 * Repair schema-backed categorical parent/child requests such as
 * "What enterprises are listed for each association?".
 *
 * The relationship is inferred from question grammar plus the live schema;
 * no dashboard-specific field name or value is encoded.
 */
function repairGroupedListPlan({ datasets, schema, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset) return plan;

  const groupingTarget = extractGroupingTarget(question);
  if (!groupingTarget) return plan;

  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  const group = inferQuestionColumn({
    schema,
    dataset: plan.dataset,
    rows,
    question: groupingTarget,
  });

  if (!group || isNumericColumn(rows, group)) return plan;

  const currentOp = String(plan.operation || '').toLowerCase();
  if (
    [
      'group_sum',
      'group_average',
      'group_minimum',
      'group_maximum',
      'group_count',
      'rank_groups',
    ].includes(currentOp)
  ) {
    return plan;
  }

  const valueText = groupingValueQuestion(question);
  let valueColumn = inferQuestionColumn({
    schema,
    dataset: plan.dataset,
    rows,
    question: valueText,
    excludedColumns: [group],
  });

  if (!valueColumn && plan.column) {
    const candidate = findColumn(rows, plan.column) || plan.column;
    if (normalizeText(candidate) !== normalizeText(group)) {
      valueColumn = candidate;
    }
  }

  if (
    !valueColumn ||
    normalizeText(valueColumn) === normalizeText(group) ||
    isNumericColumn(rows, valueColumn)
  ) {
    return plan;
  }

  return {
    ...plan,
    operation: 'group_list',
    column: valueColumn,
    labelColumn: group,
    groupBy: group,
    aggregation: null,
    selectColumns: [group, valueColumn],
    outputRequested: true,
    showAll: true,
    groupedListParityApplied: true,
  };
}

function repairGroupedAggregatePlan({ datasets, schema, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset || !hasGroupingCue(question)) return plan;
  let aggregation = detectQuestionAggregation(question);
  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  const groupingTarget = extractGroupingTarget(question);
  const group = groupingTarget ? findColumn(rows, groupingTarget) : null;
  if (!group) return plan;

  const explicit = [...new Set(explicitColumnsForDataset(schema, question, plan.dataset))];
  const numeric = explicit.filter((column) => isNumericColumn(rows, column));
  let metric = numeric.find((column) => normalizeText(column) === normalizeText(plan.column)) || null;
  if (!metric && plan.column && isNumericColumn(rows, findColumn(rows, plan.column) || plan.column)) {
    metric = findColumn(rows, plan.column) || plan.column;
  }
  if (!metric) {
    const valueText = groupingValueQuestion(question);
    const inferredMetric = inferQuestionColumn({
      schema,
      dataset: plan.dataset,
      rows,
      question: valueText,
      excludedColumns: [group],
    });

    if (inferredMetric && isNumericColumn(rows, inferredMetric)) {
      metric = inferredMetric;
    }
  }

  /**
   * Grouped additive measures do not need the user to literally say "sum".
   * Natural questions such as "What is the value loss for each commodity?"
   * and "What quantity was distributed for each intervention?" clearly ask
   * for one rolled-up additive value per group.
   */
  if (!aggregation && metric && isAdditiveMeasureColumn(metric)) {
    aggregation = 'sum';
  }

  /**
   * "How many <numeric measure> for each <group>" is also a grouped SUM,
   * not a count of populated rows.  If no additive numeric metric is present,
   * keep ordinary group-count semantics.
   */
  if (
    aggregation === 'count' &&
    metric &&
    isAdditiveMeasureColumn(metric) &&
    !/\b(?:distinct|unique|different)\b/.test(normalizeText(question))
  ) {
    aggregation = 'sum';
  }

  if (!aggregation) return plan;
  if (aggregation !== 'count' && !metric) return plan;

  const opMap = { average: 'group_average', sum: 'group_sum', count: 'group_count' };
  const operation = opMap[aggregation];
  if (!operation) return plan;
  return {
    ...plan,
    operation,
    column: aggregation === 'count' ? (plan.column || group) : metric,
    labelColumn: group,
    groupBy: group,
    aggregation: aggregation === 'count' ? 'count' : aggregation,
    selectColumns: aggregation === 'count' ? [group] : [group, metric],
    showAll: !/\b(?:top|bottom|first|last)\s+\d+\b/i.test(String(question || '')),
    preserveEmptyGroups: /\b(?:each|every)\b/i.test(String(question || '')),
    groupedSemanticParityApplied: true,
  };
}

function splitRankingDetailQuestion(question) {
  const raw = String(question || '').trim();
  const match = raw.match(/^(.*?)(?:,?\s+and\s+)(?=(?:what|which|where|who)\b)(.*)$/i);
  if (!match) return { core: raw, detail: '' };
  return { core: match[1].trim(), detail: match[2].trim() };
}

function findBestColumnForTarget(rows, target, { numeric = null } = {}) {
  if (!target) return null;
  const direct = findColumn(rows, target);
  if (direct && (numeric === null || isNumericColumn(rows, direct) === numeric)) return direct;
  const columns = Object.keys(rows[0] || {});
  const ranked = columns
    .map((column) => ({ column, score: scoreTargetToColumn(target, column) }))
    .filter((item) => numeric === null || isNumericColumn(rows, item.column) === numeric)
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score >= 0.75) return ranked[0].column;

  // Generic identity fallback: ranking questions often use a business/domain
  // noun ("subproject", "association", "employee") while the schema
  // exposes a compact identity header such as "SP Name". If semantic
  // matching cannot connect the noun to the abbreviation, a single text
  // identity/name field is still a safe row label. This uses schema shape,
  // not dataset-specific aliases or question strings.
  if (numeric === false) {
    const identityColumns = columns.filter((column) => {
      if (isNumericColumn(rows, column)) return false;
      const name = normalizeText(column);
      return /(?:^|\s)(?:name|title|label)(?:$|\s)/.test(name);
    });
    if (identityColumns.length === 1) return identityColumns[0];
  }

  return null;
}

function resolveDetailColumns(rows, detailText) {
  if (!detailText) return [];
  let body = String(detailText)
    .replace(/^(?:what|which|where|who)\s+/i, '')
    .replace(/\b(?:is|are|was|were)\s+(?:it|they|this|that|these|those)\b.*$/i, '')
    .replace(/\b(?:is|are|was|were)\s+.*$/i, '')
    .trim();
  if (!body) return [];
  const pieces = body.split(/\s*(?:,|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const piece of pieces) {
    const column = findColumn(rows, piece);
    if (column && !out.includes(column)) out.push(column);
  }
  return out;
}

function buildRankingDetailRescuePlan({ datasets, schema, question }) {
  const direction = detectRankingDirection(question);
  if (!direction) return null;
  const { core, detail } = splitRankingDetailQuestion(question);
  const targets = parseRankingTargets(core);
  if (!targets?.labelTarget || !targets?.metricTarget) return null;

  const candidates = [];
  for (const [dataset, rows] of Object.entries(datasets || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const labelColumn = findBestColumnForTarget(rows, targets.labelTarget, { numeric: false });
    const metricColumn = findBestColumnForTarget(rows, targets.metricTarget, { numeric: true });
    if (!labelColumn || !metricColumn) continue;
    const labelScore = scoreTargetToColumn(targets.labelTarget, labelColumn);
    const metricScore = scoreTargetToColumn(targets.metricTarget, metricColumn);
    candidates.push({ dataset, rows, labelColumn, metricColumn, score: labelScore + metricScore });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;

  const detailColumns = resolveDetailColumns(best.rows, detail);
  const selectColumns = [...new Set([best.labelColumn, best.metricColumn, ...detailColumns])];
  return {
    route: 'dataset',
    dataset: best.dataset,
    operation: 'rank_rows',
    column: best.metricColumn,
    labelColumn: best.labelColumn,
    groupBy: null,
    aggregation: null,
    direction,
    filters: [],
    filterGroups: [],
    filterGroupLogic: null,
    selectColumns,
    outputRequested: true,
    transform: null,
    showAll: false,
    limit: detectRankingLimit(core) || 1,
    referentialDetailEnrichment: detailColumns.length > 0,
    universalSemanticRescue: true,
  };
}

function repairCategoricalCountIntent({ datasets, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset) return plan;
  const text = normalizeText(question);
  if (!/\b(?:how many|count(?: of)?|number of)\b/.test(text)) return plan;
  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;
  const column = plan.column ? (findColumn(rows, plan.column) || plan.column) : null;
  if (!column || isNumericColumn(rows, column)) return plan;

  const distinct = /\b(?:distinct|unique|different)\b/.test(text);
  if (distinct) {
    return {
      ...plan,
      operation: 'distinct_count',
      column,
      groupBy: null,
      aggregation: null,
      labelColumn: null,
      selectColumns: [column],
      categoricalCountParityApplied: true,
    };
  }

  return {
    ...plan,
    operation: 'row_count',
    column: null,
    groupBy: null,
    aggregation: null,
    labelColumn: null,
    selectColumns: [],
    categoricalCountParityApplied: true,
  };
}

function questionExplicitlyNamesNumericRankingMetric({ datasets, schema, question }) {
  const { core } = splitRankingDetailQuestion(question);
  const targets = parseRankingTargets(core);
  if (!targets?.metricTarget) return false;

  for (const [dataset, rows] of Object.entries(datasets || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const metricColumn = findBestColumnForTarget(rows, targets.metricTarget, { numeric: true });
    if (!metricColumn) continue;

    const explicitColumns = explicitColumnsForDataset(schema, core, dataset);
    if (explicitColumns.some((column) => normalizeText(column) === normalizeText(metricColumn))) {
      return true;
    }

    // A very strong schema match is also safe when the header itself contains
    // an aggregation-looking word (for example a stored column named
    // "Total SP Cost"). In that case "highest total SP cost" ranks rows by
    // the stored metric; it does not mean "group rows, sum SP cost, then rank".
    if (scoreTargetToColumn(targets.metricTarget, metricColumn) >= 0.92) {
      return true;
    }
  }

  return false;
}

function repairAggregateIntent({ datasets, schema, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset) return plan;

  // Ranking words take precedence over aggregation words. This avoids
  // treating a stored metric like "Total SP Cost" as a SUM request in
  // questions such as "which subproject has the highest total SP cost?".
  if (detectRankingDirection(question)) return plan;

  const aggregation = detectQuestionAggregation(question);
  if (!['sum', 'average'].includes(aggregation)) return plan;

  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  let column = plan.column
    ? (findColumn(rows, plan.column) || plan.column)
    : null;

  if (!column || !isNumericColumn(rows, column)) {
    column = inferNumericQuestionColumn({
      schema,
      dataset: plan.dataset,
      rows,
      question,
    });
  }

  if (!column || !isNumericColumn(rows, column)) return plan;

  const operation = aggregation === 'sum' ? 'sum' : 'average';
  if (
    plan.operation === operation &&
    normalizeText(plan.column) === normalizeText(column)
  ) {
    return plan;
  }

  // Only repair scalar/value plans. Count/group/rank operations carry
  // distinct semantics and must not be silently converted. An already-correct
  // aggregate operation is also repairable when only its metric was wrong.
  const repairable = new Set([
    'lookup',
    'list',
    'value',
    'select',
    'get',
    'sum',
    'average',
    null,
    undefined,
  ]);

  if (!repairable.has(plan.operation)) return plan;

  return {
    ...plan,
    operation,
    column,
    groupBy: null,
    aggregation: null,
    labelColumn: null,
    selectColumns: [column],
    aggregateIntentParityApplied: true,
  };
}

function applySimpleRowRankingInvariant({ datasets, schema, plan, question }) {
  const core = splitRankingDetailQuestion(question).core;
  // Aggregated rankings such as "which province has the highest total sales"
  // genuinely rank groups. But do NOT reject a row ranking merely because a
  // real stored metric header contains words such as "Total" or "Average".
  const hasAggregateWord = /\b(?:average|avg|mean|total|sum|median)\b/i.test(core);
  if (hasAggregateWord && !questionExplicitlyNamesNumericRankingMetric({ datasets, schema, question })) {
    return plan;
  }
  const rescue = buildRankingDetailRescuePlan({ datasets, schema, question });
  if (!rescue) return plan;

  const rescueRows = datasets?.[rescue.dataset] || [];
  const existingFilters = Array.isArray(plan?.filters) ? plan.filters : [];
  const safeFilters = existingFilters.filter((filter) =>
    filter?.column && findColumn(rescueRows, filter.column)
  );

  return {
    ...plan,
    ...rescue,
    filters: safeFilters,
    filterGroups: [],
    filterGroupLogic: null,
    sharedRankingParityApplied: true,
  };
}


function repairListProjectionIntent({ datasets, plan, question }) {
  if (!plan || plan.route !== 'dataset' || String(plan.operation || '').toLowerCase() !== 'list' || !plan.dataset) return plan;
  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  const raw = String(question || '').trim();
  const match = raw.match(/\b(?:list|show|display|give|name)\s+(?:me\s+)?(?:the\s+)?(.+?)(?=\s+(?:whose|that|which|who|with|where|having|containing|including)\b|[?.!,;]|$)/i);
  if (!match?.[1]) return plan;

  let target = match[1]
    .replace(/^(?:all|every|each)\s+/i, '')
    .replace(/\b(?:records?|rows?|entries?)$/i, '')
    .trim();
  if (!target) return plan;

  const outputColumn = findBestColumnForTarget(rows, target, { numeric: false });
  if (!outputColumn) return plan;

  const currentColumn = plan.column ? (findColumn(rows, plan.column) || plan.column) : null;
  const filterColumns = new Set((Array.isArray(plan.filters) ? plan.filters : [])
    .map((filter) => filter?.column ? (findColumn(rows, filter.column) || filter.column) : null)
    .filter(Boolean)
    .map((column) => normalizeText(column)));

  const currentIsFilterField = currentColumn && filterColumns.has(normalizeText(currentColumn));
  const outputDiffers = !currentColumn || normalizeText(currentColumn) !== normalizeText(outputColumn);

  // Only override when the planner is returning the field used to constrain
  // the rows, while the question explicitly asks to list a different entity.
  // This keeps filter semantics and projection semantics separate.
  if (!outputDiffers || (!currentIsFilterField && currentColumn)) return plan;

  return {
    ...plan,
    column: outputColumn,
    labelColumn: plan.labelColumn || outputColumn,
    selectColumns: [outputColumn],
    outputRequested: true,
    listProjectionGrounded: true,
  };
}

function removeRedundantContainsEqualsFilters(plan) {
  if (!plan || plan.route !== 'dataset' || !Array.isArray(plan.filters) || plan.filters.length < 2) return plan;

  const containsKeys = new Set();
  for (const filter of plan.filters) {
    if (normalizeText(filter?.operator || '') !== 'contains') continue;
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    for (const value of values) {
      containsKeys.add(`${normalizeText(filter.column)}::${normalizeText(value)}`);
    }
  }

  if (!containsKeys.size) return plan;
  const filtered = plan.filters.filter((filter) => {
    const op = normalizeText(filter?.operator || 'equals');
    if (!['equals', 'equal', '='].includes(op)) return true;
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    return !values.some((value) => containsKeys.has(`${normalizeText(filter.column)}::${normalizeText(value)}`));
  });

  return filtered.length === plan.filters.length
    ? plan
    : { ...plan, filters: filtered, redundantExactFilterRemoved: true };
}

function enforcePlannerInvariants({ datasets, schema, plan, question }) {
  let next = plan;
  next = normalizeSameColumnEqualityFilters(next);
  next = repairListProjectionIntent({ datasets, plan: next, question });
  next = removeRedundantContainsEqualsFilters(next);
  next = repairEntityListIntent({ datasets, schema, plan: next, question });
  next = repairCategoricalCountIntent({ datasets, plan: next, question });
  next = repairNumericMeasureCountIntent({ datasets, plan: next, question });
  next = repairAggregateIntent({ datasets, schema, plan: next, question });
  next = repairImplicitFilteredAdditiveAggregate({ datasets, plan: next, question });
  next = repairGroupedAggregatePlan({ datasets, schema, plan: next, question });
  next = repairGroupedListPlan({ datasets, schema, plan: next, question });
  next = applySimpleRowRankingInvariant({ datasets, schema, plan: next, question });
  next = removeProjectionFieldFilterArtifacts({ datasets, plan: next, question });
  next = dedupePlanFilters(next);
  return next;
}

module.exports = {
  normalizeSameColumnEqualityFilters,
  dedupePlanFilters,
  removeProjectionFieldFilterArtifacts,
  repairListProjectionIntent,
  removeRedundantContainsEqualsFilters,
  repairGroupedAggregatePlan,
  repairGroupedListPlan,
  repairEntityListIntent,
  repairCategoricalCountIntent,
  repairNumericMeasureCountIntent,
  repairAggregateIntent,
  repairImplicitFilteredAdditiveAggregate,
  isAdditiveMeasureColumn,
  buildRankingDetailRescuePlan,
  applySimpleRowRankingInvariant,
  enforcePlannerInvariants,
};
