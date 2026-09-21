const { normalizeText } = require('./utils');

function cloneFilter(filter) {
  if (!filter || typeof filter !== 'object') return null;
  return { ...filter, value: Array.isArray(filter.value) ? [...filter.value] : filter.value };
}

function getFilterColumnKey(filter) { return normalizeText(filter?.column || ''); }

function hasDependentCompoundReference(question) {
  const text = normalizeText(question);
  if (!text) return false;
  return Boolean(
    /\b(?:among|of|for|from|within)\s+(?:all\s+)?(?:them|those|these|the same|such)\b/.test(text) ||
    /\b(?:they|their|theirs)\b/.test(text) ||
    /\b(?:those|these|same|such)\s+(?:records?|rows?|items?|entries|entities|results?|groups?|associations?|organizations?|farms?|farmers?|beneficiaries?|projects?|requests?|tasks?)\b/.test(text) ||
    /\b(?:the|that|this)\s+same\s+(?:records?|rows?|items?|entries|entities|results?|groups?)\b/.test(text)
  );
}

function categoriesToFilters(plan) {
  const categories = Array.isArray(plan?.categories) ? plan.categories : [];
  if (!categories.length) return [];
  const byColumn = new Map();
  for (const item of categories) {
    const column = item?.column;
    const value = item?.value;
    const key = normalizeText(column);
    if (!key || value === null || value === undefined || String(value).trim() === '') continue;
    if (!byColumn.has(key)) byColumn.set(key, { column, values: [] });
    byColumn.get(key).values.push(value);
  }
  return [...byColumn.values()].map(({ column, values }) => ({
    column,
    operator: values.length > 1 ? 'in' : 'equals',
    value: values.length > 1 ? values : values[0],
  }));
}

function getPreviousScopeFilters(previousPlan) {
  const filters = Array.isArray(previousPlan?.filters) ? previousPlan.filters.map(cloneFilter).filter(Boolean) : [];
  const categoryFilters = categoriesToFilters(previousPlan);
  const merged = [...filters];
  const seen = new Set(filters.map(getFilterColumnKey));
  for (const filter of categoryFilters) {
    const key = getFilterColumnKey(filter);
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(filter);
    }
  }
  return merged;
}

function questionReferencesPreviousCategoryScope(question, previousPlan) {
  const text = normalizeText(question);
  if (!text) return false;
  const categoryColumns = categoriesToFilters(previousPlan).map((f) => normalizeText(f.column)).filter(Boolean);
  return categoryColumns.some((column) => {
    const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(?:each|every|these|those|same)\\s+${escaped}\\b|\\bfor\\s+each\\s+${escaped}\\b`).test(text);
  });
}

function shouldInheritScope(question, previousPlan) {
  return hasDependentCompoundReference(question) || questionReferencesPreviousCategoryScope(question, previousPlan);
}

function getMissingInheritedFilters({ previousPlan, currentPlan, question } = {}) {
  if (!shouldInheritScope(question, previousPlan)) return [];
  if (!previousPlan || typeof previousPlan !== 'object' || previousPlan.route !== 'dataset' || !previousPlan.dataset) return [];
  const currentIsDataset = currentPlan?.route === 'dataset' && currentPlan?.dataset;
  if (currentIsDataset && String(currentPlan.dataset) !== String(previousPlan.dataset)) return [];
  const previousFilters = getPreviousScopeFilters(previousPlan);
  if (!previousFilters.length) return [];
  const currentColumns = new Set((Array.isArray(currentPlan?.filters) ? currentPlan.filters : []).map(getFilterColumnKey).filter(Boolean));
  return previousFilters.filter((filter) => {
    const key = getFilterColumnKey(filter);
    return key && !currentColumns.has(key);
  }).map(cloneFilter).filter(Boolean);
}

function getPreviousIdentityColumn(previousPlan) {
  if (!previousPlan || previousPlan.route !== 'dataset') return null;
  const candidates = [
    previousPlan.labelColumn,
    previousPlan.column,
    ...(Array.isArray(previousPlan.selectColumns) ? previousPlan.selectColumns : []),
  ].filter(Boolean);
  return candidates[0] || null;
}

function hasReferentialRankingIdentity(question) {
  const text = normalizeText(question);
  if (!text) return false;
  return /\b(?:which|what)\s+(?:one|ones|of\s+them|of\s+those|of\s+these)\b/.test(text) ||
    /\b(?:which|what)\s+one\s+(?:has|have|had|is|are)\b/.test(text) ||
    /\b(?:them|those|these)\b/.test(text) && /\b(?:highest|lowest|largest|smallest|most|least|maximum|minimum|top|bottom)\b/.test(text);
}

function applyReferentialIdentity(previousPlan, currentPlan, question) {
  if (!hasReferentialRankingIdentity(question)) return currentPlan;
  if (!currentPlan || currentPlan.route !== 'dataset') return currentPlan;
  const operation = normalizeText(currentPlan.operation || '').replace(/\s+/g, '_');
  if (!['rank_rows','rank_groups','maximum','minimum'].includes(operation)) return currentPlan;
  const identity = getPreviousIdentityColumn(previousPlan);
  if (!identity) return currentPlan;

  const next = {
    ...currentPlan,
    labelColumn: identity,
    compoundIdentityParityApplied: true,
  };

  if (operation === 'rank_groups') {
    next.groupBy = identity;
    const selects = Array.isArray(next.selectColumns) ? next.selectColumns : [];
    next.selectColumns = [...new Set([identity, ...selects.filter((c) => c !== currentPlan.groupBy)])];
  } else if (operation === 'rank_rows') {
    next.groupBy = null;
    const selects = Array.isArray(next.selectColumns) ? next.selectColumns : [];
    next.selectColumns = [...new Set([identity, ...selects])];
  }

  return next;
}

function mergeInheritedScopeIntoPlan({ previousPlan, currentPlan, question } = {}) {
  if (!currentPlan || typeof currentPlan !== 'object') return { plan: currentPlan, changed: false, inheritedFilters: [] };
  const missing = getMissingInheritedFilters({ previousPlan, currentPlan, question });
  let mergedPlan = { ...currentPlan };
  let changed = false;

  if (missing.length) {
    mergedPlan = {
      ...mergedPlan,
      route: 'dataset',
      dataset: currentPlan.dataset || previousPlan?.dataset,
      filters: [...(Array.isArray(currentPlan.filters) ? currentPlan.filters.map(cloneFilter).filter(Boolean) : []), ...missing],
      compoundContextParityApplied: true,
      compoundContextParitySource: 'shared-direct-plan',
    };
    changed = true;
  }

  const identityAdjusted = applyReferentialIdentity(previousPlan, mergedPlan, question);
  if (identityAdjusted !== mergedPlan) {
    mergedPlan = identityAdjusted;
    changed = true;
  }

  return {
    plan: mergedPlan,
    changed,
    inheritedFilters: missing,
  };
}

function stringifyFilterValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(' or ');
  return String(value ?? '').trim();
}

function buildCompoundParityQuestion({ question, previousPlan, currentPlan } = {}) {
  const baseQuestion = String(question || '').trim();
  if (!baseQuestion) return null;
  const missingFilters = getMissingInheritedFilters({ previousPlan, currentPlan, question: baseQuestion });
  if (!missingFilters.length) return null;
  const scopeText = missingFilters.map((filter) => {
    const column = String(filter?.column || '').trim();
    const value = stringifyFilterValue(filter?.value);
    return column && value ? `${column}: ${value}` : null;
  }).filter(Boolean).join('; ');
  return scopeText ? `${baseQuestion} (${scopeText})` : null;
}

function hasAllInheritedScopeColumns({ previousPlan, currentPlan, question } = {}) {
  return getMissingInheritedFilters({ previousPlan, currentPlan, question }).length === 0;
}

module.exports = {
  hasDependentCompoundReference,
  getPreviousScopeFilters,
  getMissingInheritedFilters,
  getPreviousIdentityColumn,
  applyReferentialIdentity,
  mergeInheritedScopeIntoPlan,
  buildCompoundParityQuestion,
  hasAllInheritedScopeColumns,
};
