const {
  normalizeText,
} = require("./utils");

/**
 * COMPARISON ENGINE
 * -----------------
 *
 * Handles analytical follow-ups using VERIFIED
 * results from conversation history.
 *
 * Groq does NOT perform calculations here.
 */

function toNumber(value) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  const cleaned = String(
    value ?? ""
  )
    .replace(/,/g, "")
    .replace(/[₱$€£%]/g, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  const number =
    Number(cleaned);

  return Number.isFinite(number)
    ? number
    : null;
}

function formatNumber(value) {
  return Number(value).toLocaleString(
    "en-US",
    {
      maximumFractionDigits: 2,
    }
  );
}

/**
 * Extract a usable numeric value from a
 * verified calculation result.
 *
 * IMPORTANT:
 * For lookup operations, read the requested
 * metric from result.results before falling
 * back to count. This prevents comparing
 * "1 matched row" instead of the actual value.
 */
function extractNumericValue(
  result,
  metric = null
) {
  if (!result) {
    return null;
  }

  // ========================================================
  // 1. LOOKUP RESULTS
  // ========================================================

  if (
    String(
      result.operation || ""
    )
      .trim()
      .toLowerCase() ===
      "lookup" &&
    Array.isArray(
      result.results
    ) &&
    result.results.length
  ) {
    const firstRow =
      result.results[0];

    if (
      firstRow &&
      typeof firstRow ===
        "object"
    ) {
      if (metric) {
        const requestedMetric =
          Array.isArray(metric)
            ? metric[0]
            : metric;

        const metricKey =
          Object.keys(
            firstRow
          ).find(
            (key) =>
              normalizeText(key) ===
              normalizeText(
                requestedMetric
              )
          );

        if (metricKey) {
          const number =
            toNumber(
              firstRow[
                metricKey
              ]
            );

          if (
            number !== null
          ) {
            return {
              field:
                metricKey,
              value:
                number,
            };
          }
        }
      }

      for (
        const [
          key,
          rawValue,
        ] of Object.entries(
          firstRow
        )
      ) {
        const number =
          toNumber(
            rawValue
          );

        if (
          number !== null
        ) {
          return {
            field:
              key,
            value:
              number,
          };
        }
      }
    }
  }

  // ========================================================
  // 2. NORMAL NUMERIC OPERATIONS
  // ========================================================

  const fields = [
    "value",
    "total",
    "average",
    "median",
    "minimum",
    "maximum",
    "count",
  ];

  for (
    const field of fields
  ) {
    if (
      result[field] !==
        undefined
    ) {
      const number =
        toNumber(
          result[field]
        );

      if (
        number !== null
      ) {
        return {
          field,
          value:
            number,
        };
      }
    }
  }

  return null;
}

/**
 * Determine a human-readable entity label
 * from a verified conversation item.
 */
function getEntityLabel(item) {
  if (
    item?.entity?.value
  ) {
    return String(
      item.entity.value
    );
  }

  const filters =
    item?.plan?.filters;

  if (
    Array.isArray(filters) &&
    filters.length
  ) {
    const useful =
      filters.find(
        (filter) =>
          filter?.value !==
            undefined &&
          filter?.value !== null
      );

    if (useful) {
      return String(
        useful.value
      );
    }
  }

  return (
    item?.dataset ||
    "Result"
  );
}

/**
 * Determine which metric was being compared.
 */
function getMetricLabel(item) {
  if (
    item?.metric
  ) {
    if (
      Array.isArray(
        item.metric
      )
    ) {
      return item.metric.join(
        ", "
      );
    }

    return String(
      item.metric
    );
  }

  if (
    item?.plan?.column
  ) {
    return String(
      item.plan.column
    );
  }

  if (
    Array.isArray(
      item?.plan?.selectColumns
    ) &&
    item.plan.selectColumns
      .length === 1
  ) {
    return String(
      item.plan
        .selectColumns[0]
    );
  }

  return null;
}

function normalizeMetric(value) {
  return normalizeText(
    Array.isArray(value)
      ? value.join(" ")
      : value || ""
  );
}

/**
 * Make sure two stored results are actually
 * comparable.
 */
function areComparable(
  left,
  right
) {
  const leftMetric =
    getMetricLabel(left);

  const rightMetric =
    getMetricLabel(right);

  const leftNumeric =
    extractNumericValue(
      left?.result,
      leftMetric
    );

  const rightNumeric =
    extractNumericValue(
      right?.result,
      rightMetric
    );

  if (
    !leftNumeric ||
    !rightNumeric
  ) {
    return {
      comparable: false,
      reason:
        "NON_NUMERIC_RESULTS",
    };
  }

  if (
    leftMetric &&
    rightMetric &&
    normalizeMetric(
      leftMetric
    ) !==
      normalizeMetric(
        rightMetric
      )
  ) {
    return {
      comparable: false,
      reason:
        "DIFFERENT_METRICS",
      leftMetric,
      rightMetric,
    };
  }

  return {
    comparable: true,

    leftValue:
      leftNumeric.value,

    rightValue:
      rightNumeric.value,

    metric:
      leftMetric ||
      rightMetric ||
      "value",
  };
}

/**
 * Compare two VERIFIED results.
 */
function compareVerifiedResults({
  left,
  right,
  mode = "higher",
}) {
  const check =
    areComparable(
      left,
      right
    );

  if (!check.comparable) {
    return {
      success: false,
      source:
        "comparison",

      operation:
        "clarify",

      reason:
        check.reason,

      answer:
        check.reason ===
        "DIFFERENT_METRICS"
          ? `Those results use different measures (${check.leftMetric} and ${check.rightMetric}), so I can't compare them directly.`
          : "I need two numeric results for the same measure before I can compare them.",
    };
  }

  const leftLabel =
    getEntityLabel(left);

  const rightLabel =
    getEntityLabel(right);

  const leftValue =
    check.leftValue;

  const rightValue =
    check.rightValue;

  const difference =
    Math.abs(
      leftValue -
      rightValue
    );

  const normalizedMode =
    String(mode || "higher")
      .trim()
      .toLowerCase();

  if (
    normalizedMode ===
      "difference"
  ) {
    return {
      success: true,
      source:
        "comparison",
      operation:
        "difference",

      metric:
        check.metric,

      leftLabel,
      rightLabel,

      leftValue,
      rightValue,

      difference,

      answer:
        `The difference between ${leftLabel} and ${rightLabel} is ${formatNumber(
          difference
        )}.`,
    };
  }

  if (
    leftValue === rightValue
  ) {
    return {
      success: true,
      source:
        "comparison",
      operation:
        "compare",

      metric:
        check.metric,

      leftLabel,
      rightLabel,

      leftValue,
      rightValue,

      difference: 0,

      answer:
        `${leftLabel} and ${rightLabel} have the same ${check.metric}: ${formatNumber(
          leftValue
        )}.`,
    };
  }

  const higher =
    leftValue >
    rightValue
      ? {
          label:
            leftLabel,
          value:
            leftValue,
        }
      : {
          label:
            rightLabel,
          value:
            rightValue,
        };

  const lower =
    leftValue <
    rightValue
      ? {
          label:
            leftLabel,
          value:
            leftValue,
        }
      : {
          label:
            rightLabel,
          value:
            rightValue,
        };

  if (
    normalizedMode === "lower"
  ) {
    return {
      success: true,
      source:
        "comparison",
      operation:
        "compare",

      metric:
        check.metric,

      leftLabel,
      rightLabel,

      leftValue,
      rightValue,

      difference,

      winner:
        lower.label,

      answer:
        `${lower.label} has the lower ${check.metric} at ${formatNumber(
          lower.value
        )}.`,
    };
  }

  return {
    success: true,
    source:
      "comparison",
    operation:
      "compare",

    metric:
      check.metric,

    leftLabel,
    rightLabel,

    leftValue,
    rightValue,

    difference,

    winner:
      higher.label,

    answer:
      `${higher.label} has the higher ${check.metric} at ${formatNumber(
        higher.value
      )}.`,
  };
}

module.exports = {
  toNumber,
  extractNumericValue,
  getEntityLabel,
  getMetricLabel,
  areComparable,
  compareVerifiedResults,
};
