const {
  normalizeText,
} = require("./utils");

function cloneFilter(filter) {
  if (!filter || typeof filter !== "object") {
    return null;
  }

  return {
    ...filter,
    value: Array.isArray(filter.value)
      ? [...filter.value]
      : filter.value,
  };
}

function getFilterColumnKey(filter) {
  return normalizeText(filter?.column || "");
}

function hasDependentCompoundReference(question) {
  const text = normalizeText(question);

  if (!text) {
    return false;
  }

  return Boolean(
    /\b(?:among|of|for|from|within)\s+(?:all\s+)?(?:them|those|these|the same|such)\b/.test(text) ||
    /\b(?:they|their|theirs)\b/.test(text) ||
    /\b(?:those|these|same|such)\s+(?:records?|rows?|items?|entries|entities|results?|groups?|associations?|organizations?|farms?|farmers?|beneficiaries?|projects?|requests?|tasks?)\b/.test(text) ||
    /\b(?:the|that|this)\s+same\s+(?:records?|rows?|items?|entries|entities|results?|groups?)\b/.test(text)
  );
}

function getMissingInheritedFilters({
  previousPlan,
  currentPlan,
  question,
} = {}) {
  if (!hasDependentCompoundReference(question)) {
    return [];
  }

  if (
    !previousPlan ||
    typeof previousPlan !== "object" ||
    previousPlan.route !== "dataset" ||
    !previousPlan.dataset
  ) {
    return [];
  }

  const currentIsDataset =
    currentPlan?.route === "dataset" &&
    currentPlan?.dataset;

  if (
    currentIsDataset &&
    String(currentPlan.dataset) !== String(previousPlan.dataset)
  ) {
    return [];
  }

  const previousFilters = Array.isArray(previousPlan.filters)
    ? previousPlan.filters
    : [];

  if (!previousFilters.length) {
    return [];
  }

  const currentColumns = new Set(
    (Array.isArray(currentPlan?.filters) ? currentPlan.filters : [])
      .map(getFilterColumnKey)
      .filter(Boolean)
  );

  return previousFilters
    .filter((filter) => {
      const key = getFilterColumnKey(filter);
      return key && !currentColumns.has(key);
    })
    .map(cloneFilter)
    .filter(Boolean);
}

function stringifyFilterValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join(" or ");
  }

  return String(value ?? "").trim();
}

function buildCompoundParityQuestion({
  question,
  previousPlan,
  currentPlan,
} = {}) {
  const baseQuestion = String(question || "").trim();

  if (!baseQuestion) {
    return null;
  }

  const missingFilters = getMissingInheritedFilters({
    previousPlan,
    currentPlan,
    question: baseQuestion,
  });

  if (!missingFilters.length) {
    return null;
  }

  const scopeText = missingFilters
    .map((filter) => {
      const column = String(filter?.column || "").trim();
      const value = stringifyFilterValue(filter?.value);

      if (!column || !value) {
        return null;
      }

      return `${column}: ${value}`;
    })
    .filter(Boolean)
    .join("; ");

  if (!scopeText) {
    return null;
  }

  return `${baseQuestion} (${scopeText})`;
}

function hasAllInheritedScopeColumns({
  previousPlan,
  currentPlan,
  question,
} = {}) {
  return getMissingInheritedFilters({
    previousPlan,
    currentPlan,
    question,
  }).length === 0;
}

module.exports = {
  hasDependentCompoundReference,
  getMissingInheritedFilters,
  buildCompoundParityQuestion,
  hasAllInheritedScopeColumns,
};
