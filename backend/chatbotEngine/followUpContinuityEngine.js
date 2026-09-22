const {
  normalizeText,
} = require("./utils");

function isEllipticalFilterFollowUp(question) {
  const text =
    normalizeText(question);

  if (!text) return false;

  return (
    /^(?:what|how)\s+about\b/.test(text) ||
    /^and\b/.test(text) ||
    /^for\b/.test(text)
  );
}

function uniqueColumns(filters) {
  return new Set(
    (Array.isArray(filters) ? filters : [])
      .map(
        (filter) =>
          normalizeText(
            filter?.column
          )
      )
      .filter(Boolean)
  );
}

function chooseContinuitySubjectColumn({
  previousPlan,
  newFilters,
} = {}) {
  if (
    !previousPlan ||
    typeof previousPlan !==
      "object"
  ) {
    return null;
  }

  const filterColumns =
    uniqueColumns(
      newFilters
    );

  const candidates = [
    previousPlan.column,
    previousPlan.labelColumn,
    previousPlan.conversationalPairColumn,
    ...(Array.isArray(
      previousPlan.selectColumns
    )
      ? previousPlan.selectColumns
      : []),
  ].filter(Boolean);

  const seen =
    new Set();

  for (const candidate of candidates) {
    const normalized =
      normalizeText(candidate);

    if (
      !normalized ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);

    if (
      !filterColumns.has(
        normalized
      )
    ) {
      return candidate;
    }
  }

  return null;
}

function filtersByColumn(filters) {
  const map =
    new Map();

  for (const filter of Array.isArray(filters) ? filters : []) {
    if (!filter?.column) continue;

    map.set(
      normalizeText(
        filter.column
      ),
      filter
    );
  }

  return map;
}

function escapeRegex(value) {
  return String(value || "")
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}

function valueText(value) {
  if (
    Array.isArray(value)
  ) {
    return value
      .map(
        (item) =>
          String(item)
      )
      .join(" and ");
  }

  return String(
    value ?? ""
  );
}

function rewriteContinuityQuestionWithFilters({
  subjectQuestion,
  previousFilters,
  newFilters,
  fallbackQuestion,
} = {}) {
  let rewritten =
    String(
      subjectQuestion ||
      fallbackQuestion ||
      ""
    ).trim();

  if (!rewritten) {
    return fallbackQuestion || "";
  }

  const previousByColumn =
    filtersByColumn(
      previousFilters
    );

  let replacementCount =
    0;

  for (const nextFilter of Array.isArray(newFilters) ? newFilters : []) {
    const key =
      normalizeText(
        nextFilter?.column
      );

    if (!key) continue;

    const previous =
      previousByColumn.get(
        key
      );

    if (!previous) continue;

    const oldValue =
      valueText(
        previous.value
      ).trim();

    const newValue =
      valueText(
        nextFilter.value
      ).trim();

    if (
      !oldValue ||
      !newValue ||
      normalizeText(oldValue) ===
        normalizeText(newValue)
    ) {
      continue;
    }

    const pattern =
      new RegExp(
        escapeRegex(oldValue),
        "ig"
      );

    if (
      pattern.test(rewritten)
    ) {
      rewritten =
        rewritten.replace(
          pattern,
          newValue
        );

      replacementCount += 1;
    }
  }

  return replacementCount >
      0
    ? rewritten
    : (
        fallbackQuestion ||
        rewritten
      );
}

function shouldPreferExplicitValueFilter({
  isFollowUp,
  question,
  explicitValueFilters,
} = {}) {
  return Boolean(
    isFollowUp === true &&
    isEllipticalFilterFollowUp(
      question
    ) &&
    Array.isArray(
      explicitValueFilters
    ) &&
    explicitValueFilters.length
  );
}

module.exports = {
  isEllipticalFilterFollowUp,
  chooseContinuitySubjectColumn,
  rewriteContinuityQuestionWithFilters,
  shouldPreferExplicitValueFilter,
};
