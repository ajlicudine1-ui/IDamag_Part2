const { parseNumber, normalizeText } = require("./utils");
const { compare } = require("./filterEngine");
const { applySemanticContractScope } = require("./semanticContractEngine");

/**
 * RESULT VALIDATOR
 * ----------------
 *
 * Validates results AFTER JavaScript has executed
 * the query plan.
 *
 * It does NOT calculate dataset answers.
 * It does NOT ask Groq to verify calculations.
 *
 * Its job is to detect obviously invalid,
 * inconsistent, or malformed results before
 * they are shown to the user.
 */

function invalid(
  code,
  message,
  details = {}
) {
  return {
    valid: false,
    code,
    message,
    details,
  };
}

function valid(result) {
  return {
    valid: true,
    result,
  };
}

function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function isNumericOperation(
  operation
) {
  return new Set([
    "sum",
    "average",
    "median",
    "minimum",
    "maximum",
    "row_count",
    "non_empty_count",
    "distinct_count",
  ]).has(operation);
}

function isCountOperation(
  operation
) {
  return new Set([
    "row_count",
    "non_empty_count",
    "distinct_count",
  ]).has(operation);
}

/**
 * Validate common result structure.
 */
function validateBaseResult(
  result
) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    return invalid(
      "INVALID_RESULT",
      "The calculation engine returned an invalid result."
    );
  }

  /**
   * A legitimate clarification/error is not
   * a corrupt calculation result.
   */
  if (result.success === false) {
    return valid(result);
  }

  if (
    typeof result.answer !==
      "string" ||
    !result.answer.trim()
  ) {
    return invalid(
      "EMPTY_ANSWER",
      "The calculation completed but produced no readable answer."
    );
  }

  return null;
}

/**
 * Look through likely numeric properties.
 *
 * Different operations may use slightly
 * different result field names, so this
 * checks several common possibilities.
 */
function getNumericResultValue(
  result
) {
  const candidates = [
    "value",
    "result",
    "total",
    "count",
    "average",
    "median",
    "minimum",
    "maximum",
  ];

  for (const key of candidates) {
    if (
      Object.prototype.hasOwnProperty.call(
        result,
        key
      ) &&
      typeof result[key] ===
        "number"
    ) {
      return {
        key,
        value: result[key],
      };
    }
  }

  return null;
}

/**
 * Validate ordinary numeric operations.
 */
function validateNumericResult(
  result,
  operation
) {
  const numeric =
    getNumericResultValue(
      result
    );

  /**
   * Some calculation-engine responses may
   * currently only expose the formatted
   * answer string.
   *
   * We do not reject those yet because that
   * would break existing working operations.
   */
  if (!numeric) {
    return null;
  }

  if (
    !isFiniteNumber(
      numeric.value
    )
  ) {
    return invalid(
      "NON_FINITE_RESULT",
      `The ${operation} calculation produced an invalid numeric value.`,
      {
        field: numeric.key,
        value: numeric.value,
      }
    );
  }

  if (
    isCountOperation(
      operation
    ) &&
    (
      numeric.value < 0 ||
      !Number.isInteger(
        numeric.value
      )
    )
  ) {
    return invalid(
      "INVALID_COUNT",
      "The calculation produced an invalid count.",
      {
        value: numeric.value,
      }
    );
  }

  return null;
}

/**
 * Validate list results.
 */
function validateListResult(
  result
) {
  if (
    Array.isArray(
      result.results
    )
  ) {
    if (
      result.count !==
        undefined &&
      typeof result.count ===
        "number" &&
      result.count !==
        result.results.length
    ) {
      return invalid(
        "LIST_COUNT_MISMATCH",
        "The number of returned list values does not match the reported count.",
        {
          count:
            result.count,

          actual:
            result.results
              .length,
        }
      );
    }

    for (
      const item of
      result.results
    ) {
      if (
        item === undefined ||
        item === null
      ) {
        return invalid(
          "INVALID_LIST_ITEM",
          "The list contains an invalid value."
        );
      }
    }
  }

  return null;
}

/**
 * Validate lookup results.
 */
function validateLookupResult(
  result
) {
  if (
    Array.isArray(
      result.results
    )
  ) {
    for (
      const row of
      result.results
    ) {
      if (
        row === null ||
        row === undefined
      ) {
        return invalid(
          "INVALID_LOOKUP_ROW",
          "The lookup returned an invalid row."
        );
      }
    }
  }

  return null;
}

/**
 * Validate grouped/ranking results.
 */
function validateCollectionResult(
  result
) {
  if (
    !Array.isArray(
      result.results
    )
  ) {
    return null;
  }

  for (
    const item of
    result.results
  ) {
    if (
      !item ||
      typeof item !==
        "object"
    ) {
      continue;
    }

    for (
      const [
        key,
        value,
      ] of Object.entries(
        item
      )
    ) {
      if (
        typeof value ===
          "number" &&
        !Number.isFinite(
          value
        )
      ) {
        return invalid(
          "INVALID_COLLECTION_NUMBER",
          `The result contains an invalid numeric value in "${key}".`,
          {
            key,
            value,
          }
        );
      }
    }
  }

  return null;
}


function getPlanRows({ datasets, plan }) {
  const rows = datasets?.[plan?.dataset];
  if (!Array.isArray(rows)) return null;
  const filters = Array.isArray(plan?.filters) ? plan.filters : [];
  return rows.filter((row) => filters.every((filter) =>
    compare(row?.[filter.column], filter.value, filter.operator || "equals")
  ));
}

function getValidationRows({ datasets, plan, result }) {
  const allRows = datasets?.[plan?.dataset];
  if (!Array.isArray(allRows)) return null;

  let rows = getPlanRows({ datasets, plan });
  if (!Array.isArray(rows)) return null;

  // The calculation engine may intentionally narrow the raw geography/filter
  // scope to a contract-authorized semantic result family before arithmetic.
  // The validator must verify against that SAME authorized scope rather than
  // recomputing from every raw row that happened to match the geography.
  if (result?.semanticContractAware || plan?.semanticContractIntentRepaired) {
    const contractResolution = applySemanticContractScope({
      datasets,
      datasetName: plan.dataset,
      rows: allRows,
      filteredRows: rows,
      plan,
    });

    rows = contractResolution?.rows || rows;
  }

  // Grain-aware execution can further narrow the authorized context to one
  // hierarchy level (for example Province instead of Province+Municipality+
  // Barangay). Reuse the execution metadata instead of independently guessing
  // the hierarchy a second time inside validation.
  if (
    result?.grainAwareAggregation === true &&
    result?.grainColumn &&
    result?.grainValue !== undefined &&
    result?.grainValue !== null
  ) {
    const wanted = normalizeText(result.grainValue);
    rows = rows.filter(
      (row) => normalizeText(row?.[result.grainColumn]) === wanted
    );
  }

  return rows;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function nearlyEqual(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const tolerance = Math.max(1e-9, Math.abs(b) * 1e-9);
  return Math.abs(a - b) <= tolerance;
}

function validateAgainstLiveRows({ datasets, plan, result, operation }) {
  if (!datasets || !plan?.dataset || result?.success === false) return null;
  const rows = getValidationRows({ datasets, plan, result });
  if (!rows) return null;

  if (operation === "row_count" && typeof result.value === "number") {
    if (result.value !== rows.length) {
      return invalid("ROW_COUNT_SOURCE_MISMATCH", "The returned count does not match the filtered live rows.", { returned: result.value, expected: rows.length });
    }
  }

  if (["sum", "average", "median", "minimum", "maximum"].includes(operation) && plan.column && typeof result.value === "number") {
    const values = rows.map((row) => parseNumber(row?.[plan.column])).filter((value) => value !== null);
    if (!values.length) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    const expected = operation === "sum" ? total
      : operation === "average" ? total / values.length
      : operation === "median" ? median(values)
      : operation === "minimum" ? Math.min(...values)
      : Math.max(...values);
    if (!nearlyEqual(result.value, expected)) {
      return invalid("NUMERIC_SOURCE_MISMATCH", `The returned ${operation} does not match the filtered live data.`, { returned: result.value, expected, column: plan.column, recordsUsed: values.length });
    }
  }

  if (operation === "rank_rows" && Array.isArray(result.results) && plan.column) {
    const direction = String(plan.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc";
    for (let i = 0; i < result.results.length; i += 1) {
      const item = result.results[i];
      const rowMetric = parseNumber(item?.row?.[plan.column]);
      if (rowMetric === null || typeof item?.value !== "number" || !nearlyEqual(item.value, rowMetric)) {
        return invalid("RANK_VALUE_SOURCE_MISMATCH", "A ranked value does not match its source row.", { index: i, column: plan.column, returned: item?.value, source: rowMetric });
      }
      if (i > 0) {
        const prev = result.results[i - 1]?.value;
        const curr = item?.value;
        if (typeof prev === "number" && typeof curr === "number") {
          const outOfOrder = direction === "asc" ? curr < prev : curr > prev;
          if (outOfOrder) {
            return invalid("RANK_ORDER_MISMATCH", "The ranked result order does not match the requested direction.", { direction, previous: prev, current: curr });
          }
        }
      }
    }
  }

  return null;
}

/**
 * Main validator.
 */
function validateResult({
  plan,
  result,
  datasets = null,
}) {
  const baseCheck =
    validateBaseResult(
      result
    );

  if (baseCheck) {
    return baseCheck;
  }

  /**
   * Do not treat legitimate unsuccessful
   * responses as corrupt calculations.
   */
  if (
    result.success === false
  ) {
    return valid(result);
  }

  const operation =
    String(
      plan?.operation ||
      result?.operation ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    isNumericOperation(
      operation
    )
  ) {
    const numericCheck =
      validateNumericResult(
        result,
        operation
      );

    if (numericCheck) {
      return numericCheck;
    }
  }

  if (
    operation === "list"
  ) {
    const listCheck =
      validateListResult(
        result
      );

    if (listCheck) {
      return listCheck;
    }
  }

  if (
    operation === "lookup"
  ) {
    const lookupCheck =
      validateLookupResult(
        result
      );

    if (lookupCheck) {
      return lookupCheck;
    }
  }

  const liveCheck = validateAgainstLiveRows({
    datasets,
    plan,
    result,
    operation,
  });

  if (liveCheck) {
    return liveCheck;
  }

  if (
    [
      "group_count",
      "group_sum",
      "group_average",
      "group_minimum",
      "group_maximum",
      "rank_rows",
      "rank_groups",
      "group_list",
    ].includes(operation)
  ) {
    const collectionCheck =
      validateCollectionResult(
        result
      );

    if (collectionCheck) {
      return collectionCheck;
    }
  }

  return valid(result);
}

module.exports = {
  validateResult,
};