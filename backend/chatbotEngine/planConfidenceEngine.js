const { normalizeText } = require('./utils');

const SUPPORTED_OPERATIONS = new Set([
  'lookup','list','row_count','count','non_empty_count','distinct_count',
  'sum','average','median','minimum','maximum','group_sum','group_average',
  'group_minimum','group_maximum','group_count','rank_rows','rank_groups',
  'rank_worksheets','multi_worksheet','rank_across_worksheets'
]);

function evaluateLocalPlanConfidence({ plan, datasets = {}, schema = [] } = {}) {
  const breakdown = {
    route: 0,
    dataset: 0,
    operation: 0,
    column: 0,
    group: 1,
    filters: 1,
  };
  const issues = [];

  if (!plan || typeof plan !== 'object') {
    return { score: 0, breakdown, issues: ['missing-plan'], critical: true };
  }

  breakdown.route = ['dataset','schema','general','clarify'].includes(normalizeText(plan.route)) ? 1 : 0;
  if (!breakdown.route) issues.push('unknown-route');

  if (plan.route !== 'dataset') {
    const score = breakdown.route;
    return { score, breakdown, issues, critical: score < 0.5 };
  }

  const distributed = ['rank_worksheets','multi_worksheet','rank_across_worksheets'].includes(normalizeText(plan.operation));
  if (distributed) {
    breakdown.dataset = plan.dataset == null ? 1 : 0.8;
  } else {
    breakdown.dataset = plan.dataset && Array.isArray(datasets?.[plan.dataset]) ? 1 : 0;
    if (!breakdown.dataset) issues.push('dataset-not-resolved');
  }

  breakdown.operation = SUPPORTED_OPERATIONS.has(normalizeText(plan.operation)) ? 1 : 0;
  if (!breakdown.operation) issues.push('unsupported-operation');

  const relevantSchemas = distributed
    ? (schema || [])
    : (schema || []).filter((item) => String(item?.name || '') === String(plan.dataset || ''));
  const sharedColumnExists = (name) => {
    if (!name) return false;
    return relevantSchemas.some((item) => (item?.columns || []).some((column) => String(column?.name || '') === String(name)));
  };

  const operationNeedsColumn = !['row_count','count'].includes(normalizeText(plan.operation));
  breakdown.column = !operationNeedsColumn ? 1 : (sharedColumnExists(plan.column) ? 1 : 0);
  if (!breakdown.column && operationNeedsColumn) issues.push('metric-column-not-resolved');

  const groupNeeded = ['rank_groups','group_sum','group_average','group_minimum','group_maximum','group_count','rank_across_worksheets'].includes(normalizeText(plan.operation));
  if (groupNeeded) {
    const groupName = plan.groupBy || plan.labelColumn;
    breakdown.group = sharedColumnExists(groupName) ? 1 : 0;
    if (!breakdown.group) issues.push('group-column-not-resolved');
  }

  const filters = Array.isArray(plan.filters) ? plan.filters : [];
  if (filters.length) {
    let valid = 0;
    for (const filter of filters) {
      if (filter?.column && sharedColumnExists(filter.column) && filter.value !== undefined && filter.value !== null) valid += 1;
    }
    breakdown.filters = valid / filters.length;
    if (breakdown.filters < 1) issues.push('one-or-more-filters-not-resolved');
  }

  const weights = { route:0.1, dataset:0.2, operation:0.15, column:0.25, group:0.15, filters:0.15 };
  let score = Object.entries(weights).reduce((sum, [key, weight]) => sum + breakdown[key] * weight, 0);
  const critical = breakdown.route === 0 || breakdown.dataset === 0 || breakdown.operation === 0 || breakdown.column === 0 || breakdown.group === 0;
  if (critical) score = Math.min(score, 0.4);
  return { score: Number(score.toFixed(4)), breakdown, issues, critical };
}

function attachLocalConfidence({ plan, datasets, schema } = {}) {
  const evaluation = evaluateLocalPlanConfidence({ plan, datasets, schema });
  return {
    plan: {
      ...plan,
      localConfidence: evaluation.score,
      localConfidenceBreakdown: evaluation.breakdown,
      localConfidenceIssues: evaluation.issues,
    },
    evaluation,
  };
}

module.exports = {
  evaluateLocalPlanConfidence,
  attachLocalConfidence,
};
