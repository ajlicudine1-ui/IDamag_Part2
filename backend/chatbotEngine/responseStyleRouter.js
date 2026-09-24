const {
  normalizeText,
} = require("./utils");


const NUMERIC_OPERATIONS =
  new Set([
    "sum",
    "average",
    "median",
    "minimum",
    "maximum",
    "row_count",
    "non_empty_count",
    "distinct_count",
    "group_sum",
    "group_average",
    "group_minimum",
    "group_maximum",
  ]);


function isFollowUpQuestion(
  question,
  plan
) {
  if (
    plan?.conversationalFilterSwitch ===
      true ||
    plan?.conversationalWorksheetSwitch ===
      true ||
    plan?.conversationFollowUp ===
      true ||
    plan?.distributedFollowUp ===
      true
  ) {
    return true;
  }

  const text =
    normalizeText(
      question
    );

  return /^(?:what|how)\s+about\b|^and\b|^for\b/.test(
    text
  );
}


function hasRelationshipShape(
  plan,
  result
) {
  const operation =
    normalizeText(
      result?.operation ||
      plan?.operation
    );

  const labelColumn =
    result?.labelColumn ||
    plan?.labelColumn ||
    null;

  const valueColumn =
    result?.column ||
    plan?.column ||
    null;

  const results =
    Array.isArray(
      result?.results
    )
      ? result.results
      : [];

  const pairedLookup =
    operation ===
      "lookup" &&
    labelColumn &&
    valueColumn &&
    normalizeText(
      labelColumn
    ) !==
      normalizeText(
        valueColumn
      ) &&
    results.some(
      (row) =>
        row &&
        typeof row ===
          "object" &&
        Object.prototype.hasOwnProperty.call(
          row,
          labelColumn
        ) &&
        Object.prototype.hasOwnProperty.call(
          row,
          valueColumn
        )
    );

  if (pairedLookup) {
    return true;
  }

  /**
   * Explicit grouping is also a relationship-style answer when the engine
   * returns several verified group/value pairs. This lets the narrative layer
   * explain the groups naturally instead of forcing a raw list template.
   */
  const groupBy =
    result?.groupBy ||
    plan?.groupBy ||
    null;

  return Boolean(
    groupBy &&
    results.length
  );
}


function isRankingShape(
  plan,
  result
) {
  const operation =
    normalizeText(
      result?.operation ||
      plan?.operation
    );

  if (
    operation.startsWith(
      "rank"
    )
  ) {
    return true;
  }

  return Boolean(
    (
      plan?.direction ||
      result?.direction
    ) &&
    Array.isArray(
      result?.results
    ) &&
    result.results.length
  );
}


function isNumericShape(
  plan,
  result
) {
  const operation =
    normalizeText(
      result?.operation ||
      plan?.operation
    );

  if (
    NUMERIC_OPERATIONS.has(
      operation
    )
  ) {
    return true;
  }

  return (
    result?.value !==
      undefined &&
    result?.value !==
      null &&
    typeof result.value ===
      "number"
  );
}


function isSimpleRawList(
  plan,
  result
) {
  const operation =
    normalizeText(
      result?.operation ||
      plan?.operation
    );

  if (
    operation !==
      "list"
  ) {
    return false;
  }

  const results =
    Array.isArray(
      result?.results
    )
      ? result.results
      : [];

  if (
    !results.length
  ) {
    return false;
  }

  /**
   * A list of plain scalar values is a raw list. Object rows with different
   * label/value fields belong to relationship/grouped narrative instead.
   */
  return results.every(
    (item) =>
      item === null ||
      item === undefined ||
      typeof item !==
        "object"
  );
}


function classifyResponseStyle({
  question,
  plan,
  result,
} = {}) {
  /**
   * Priority matters:
   *
   * follow-up -> conversational continuation
   * ranking -> natural ranking sentence
   * relationship/grouping -> human narrative
   * numeric -> concise analytical sentence
   * raw list -> clean list
   */
  if (
    isFollowUpQuestion(
      question,
      plan
    )
  ) {
    return "follow_up";
  }

  if (
    isRankingShape(
      plan,
      result
    )
  ) {
    return "ranking";
  }

  if (
    hasRelationshipShape(
      plan,
      result
    )
  ) {
    return "relationship_grouped";
  }

  if (
    isNumericShape(
      plan,
      result
    )
  ) {
    return "numeric_analysis";
  }

  if (
    isSimpleRawList(
      plan,
      result
    )
  ) {
    return "simple_list";
  }

  return "general";
}


function getResponseStyleInstruction(
  style
) {
  switch (style) {
    case "simple_list":
      return [
        "Use a clean list.",
        "Do not turn a simple enumeration into a long explanation.",
        "Preserve every verified item and its ordering.",
      ].join(" ");

    case "relationship_grouped":
      return [
        "Use a human-like narrative.",
        "Summarize shared values first when useful, then explain meaningful differences by entity or group.",
        "Avoid reducing a relationship answer to repetitive label-value lines unless the user explicitly asks for a table or per-group list.",
      ].join(" ");

    case "numeric_analysis":
      return [
        "Use a concise analytical sentence.",
        "State the verified value, metric meaning, unit, and important scope only when relevant.",
        "Do not add unnecessary commentary.",
      ].join(" ");

    case "ranking":
      return [
        "Use a natural ranking sentence.",
        "Clearly identify the highest, lowest, top, or bottom entity and preserve the verified value and order.",
      ].join(" ");

    case "follow_up":
      return [
        "Use a conversational continuation.",
        "Do not unnecessarily restate the whole previous question.",
        "Preserve the prior subject or metric only when the verified plan carries it forward, and make the new scope clear.",
      ].join(" ");

    default:
      return [
        "Use concise natural language that matches the verified result type.",
        "Do not force the answer into a list when a sentence is more natural.",
      ].join(" ");
  }
}


module.exports = {
  classifyResponseStyle,
  getResponseStyleInstruction,
  isSimpleRawList,
  hasRelationshipShape,
  isRankingShape,
  isNumericShape,
  isFollowUpQuestion,
};
