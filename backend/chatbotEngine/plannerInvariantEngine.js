const { normalizeText, parseNumber } = require('./utils');
const { findExplicitSchemaColumns, detectQuestionAggregation, detectRankingDirection, detectRankingLimit, parseRankingTargets, scoreTargetToColumn } = require('./plannerNormalizer');
const { findColumn } = require('./columnMatcher');

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

function hasGroupingCue(question) {
  const text = normalizeText(question);
  return /\b(?:for\s+each|for\s+every|per|by|grouped\s+by|broken\s+down\s+by)\b/.test(text);
}

function explicitColumnsForDataset(schema, question, dataset) {
  return findExplicitSchemaColumns({ schema, question, preferredDataset: dataset })
    .map((item) => item.column)
    .filter(Boolean);
}

function extractGroupingTarget(question) {
  const raw = String(question || '').replace(/[?!.]+$/g, ' ').trim();
  const match = raw.match(/\b(?:for\s+each|for\s+every|per|by|grouped\s+by|broken\s+down\s+by)\s+(?:the\s+)?(.+?)(?=\s+(?:with|where|that|which|who|and\s+then|then)\b|[,;]|$)/i);
  if (!match?.[1]) return null;
  return match[1].replace(/\b(?:respectively|separately)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

function repairGroupedAggregatePlan({ datasets, schema, plan, question }) {
  if (!plan || plan.route !== 'dataset' || !plan.dataset || !hasGroupingCue(question)) return plan;
  const aggregation = detectQuestionAggregation(question);
  if (!aggregation) return plan;
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
  if (!metric && aggregation !== 'count') {
    const beforeGrouping = String(question || '').split(/\b(?:for\s+each|for\s+every|per|by)\b/i)[0];
    metric = findColumn(rows, beforeGrouping);
    if (metric && !isNumericColumn(rows, metric)) metric = null;
  }
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
  return ranked[0]?.score >= 0.75 ? ranked[0].column : null;
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

function applySimpleRowRankingInvariant({ datasets, schema, plan, question }) {
  const core = splitRankingDetailQuestion(question).core;
  // Aggregated rankings (highest average/total/sum/median) genuinely rank
  // groups and must not be converted into row rankings.
  if (/\b(?:average|avg|mean|total|sum|median)\b/i.test(core)) return plan;
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

function enforcePlannerInvariants({ datasets, schema, plan, question }) {
  let next = plan;
  next = normalizeSameColumnEqualityFilters(next);
  next = repairCategoricalCountIntent({ datasets, plan: next, question });
  next = repairGroupedAggregatePlan({ datasets, schema, plan: next, question });
  next = applySimpleRowRankingInvariant({ datasets, schema, plan: next, question });
  return next;
}

module.exports = {
  normalizeSameColumnEqualityFilters,
  repairGroupedAggregatePlan,
  repairCategoricalCountIntent,
  buildRankingDetailRescuePlan,
  applySimpleRowRankingInvariant,
  enforcePlannerInvariants,
};
