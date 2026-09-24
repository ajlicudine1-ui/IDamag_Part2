const { normalizeText } = require('./utils');

function cloneFilters(filters) {
  return Array.isArray(filters)
    ? filters.map((filter) => ({
        ...filter,
        value: Array.isArray(filter?.value) ? [...filter.value] : filter?.value,
      }))
    : [];
}

function buildSemanticPlan({ plan, result } = {}) {
  if (!plan || typeof plan !== 'object') return null;

  const operation = normalizeText(plan.operation || result?.operation);
  const distributed = ['rank_worksheets','multi_worksheet','rank_across_worksheets'].includes(operation) || plan.dataset == null && Array.isArray(result?.datasets);

  return {
    scope: operation === 'rank_across_worksheets'
      ? 'cross_worksheet_group'
      : distributed
        ? 'multi_worksheet'
        : plan.dataset
          ? 'single_worksheet'
          : 'non_dataset',
    dataset: plan.dataset ?? result?.dataset ?? null,
    worksheets: Array.isArray(plan.worksheets)
      ? [...plan.worksheets]
      : Array.isArray(result?.datasets)
        ? [...result.datasets]
        : [],
    operation,
    metric: plan.column || result?.column || null,
    metricMeaning: plan.metricMeaning || result?.metricMeaning || result?.metricSemantics || plan.metricSemantics || null,
    metricSource: plan.metricSource || null,
    groupBy: plan.groupBy || result?.groupBy || null,
    labelColumn: plan.labelColumn || result?.labelColumn || null,
    aggregation: plan.aggregation || result?.aggregation || null,
    direction: plan.direction || result?.direction || null,
    limit: Number(plan.limit) || null,
    filters: cloneFilters(plan.filters),
    selectColumns: Array.isArray(plan.selectColumns) ? [...plan.selectColumns] : [],
    displayUnit: plan.displayUnit || result?.displayUnit || result?.unit || plan.unit || null,
    coveragePolicy: result?.aggregationPolicy || plan?.aggregationPolicy || null,
  };
}

function semanticPlanToExecutable(semanticPlan) {
  if (!semanticPlan || typeof semanticPlan !== 'object') return null;
  return {
    route: 'dataset',
    dataset: semanticPlan.dataset ?? null,
    operation: semanticPlan.operation || null,
    column: semanticPlan.metric || null,
    labelColumn: semanticPlan.labelColumn || null,
    groupBy: semanticPlan.groupBy || null,
    aggregation: semanticPlan.aggregation || null,
    direction: semanticPlan.direction || null,
    limit: semanticPlan.limit || 1,
    filters: cloneFilters(semanticPlan.filters),
    selectColumns: Array.isArray(semanticPlan.selectColumns) ? [...semanticPlan.selectColumns] : [],
    outputRequested: true,
    displayUnit: semanticPlan.displayUnit || null,
    metricMeaning: semanticPlan.metricMeaning || null,
    metricSource: semanticPlan.metricSource || null,
    worksheets: Array.isArray(semanticPlan.worksheets) ? [...semanticPlan.worksheets] : [],
    semanticPlanInherited: true,
  };
}

module.exports = {
  buildSemanticPlan,
  semanticPlanToExecutable,
};
