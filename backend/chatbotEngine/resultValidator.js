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

/**
 * Main validator.
 */
function validateResult({
  plan,
  result,
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