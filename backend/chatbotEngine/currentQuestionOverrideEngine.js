const { normalizeText } = require("./utils");
const { inferDatasetValueFilters } = require("./filterEngine");

function normalizeFilterValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).sort().join("|");
  }
  return normalizeText(value);
}

function getPreviousFilters(context) {
  const semantic = context?.semanticPlan;
  const plan = context?.lastPlan;
  const filters = Array.isArray(semantic?.filters)
    ? semantic.filters
    : Array.isArray(plan?.filters)
      ? plan.filters
      : [];
  return filters;
}

function questionContainsExplicitWorksheet({ question, datasets }) {
  const q = ` ${normalizeText(question)} `;
  for (const name of Object.keys(datasets || {})) {
    const n = normalizeText(name);
    if (n && q.includes(` ${n} `)) return true;
  }
  return false;
}

function questionContainsDistributedScope(question) {
  const q = normalizeText(question);
  if (!q) return false;
  return /\b(?:across|throughout|regionwide|region wide|overall|all worksheets|all sheets|all provinces|each province|every province|among (?:the )?(?:provinces|worksheets|sheets)|whole region|entire region|region 1)\b/i.test(q);
}

function detectExplicitCurrentValueOverrides({ datasets, question, previousFilters }) {
  const inferred = inferDatasetValueFilters(datasets, question, {});
  if (!Array.isArray(inferred) || !inferred.length) return [];

  const previousByColumn = new Map();
  for (const f of previousFilters || []) {
    if (!f?.column) continue;
    previousByColumn.set(normalizeText(f.column), normalizeFilterValue(f.value));
  }

  const overrides = [];
  const seen = new Set();
  for (const match of inferred) {
    const col = normalizeText(match?.column || "");
    if (!col) continue;
    const value = normalizeFilterValue(match?.value);
    const previous = previousByColumn.get(col);

    // An explicitly mentioned row value is a semantic override when it
    // changes an existing filter or introduces a new filter into a prior
    // analytical result set. This is intentionally dataset-agnostic.
    if (previous === undefined || previous !== value) {
      const key = `${col}|${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        overrides.push(match);
      }
    }
  }
  return overrides;
}

/**
 * Decide whether CURRENT wording changes the semantic query enough that
 * reusing the previous verified result array would be unsafe.
 *
 * This guard is deliberately generic: it reacts to explicit schema-group
 * changes, explicit data-value/filter changes, worksheet changes, and
 * distributed-scope wording. It does not know about provinces, commodities,
 * months, or any specific dashboard.
 */
function currentQuestionRequiresReplan({
  datasets,
  question,
  conversationContext,
  explicitGroupOverride = false,
}) {
  const reasons = [];

  if (explicitGroupOverride) reasons.push("group_override");

  if (questionContainsExplicitWorksheet({ question, datasets })) {
    reasons.push("worksheet_scope_override");
  }

  if (questionContainsDistributedScope(question)) {
    reasons.push("distributed_scope_override");
  }

  const valueOverrides = detectExplicitCurrentValueOverrides({
    datasets,
    question,
    previousFilters: getPreviousFilters(conversationContext),
  });
  if (valueOverrides.length) reasons.push("filter_override");

  return {
    requiresReplan: reasons.length > 0,
    reasons,
    valueOverrides,
  };
}

module.exports = {
  currentQuestionRequiresReplan,
  detectExplicitCurrentValueOverrides,
  questionContainsDistributedScope,
};
