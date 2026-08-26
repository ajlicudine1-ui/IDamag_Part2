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
 * ==========================================================
 * EXTRACT MULTIPLE COMPARABLE VALUES FROM ONE VERIFIED RESULT
 * ==========================================================
 *
 * Grouped calculations often store BOTH compared values in one
 * verified result:
 *
 * {
 *   operation: "group_maximum",
 *   results: [
 *     { label: "A", value: 100 },
 *     { label: "B", value: 80 }
 *   ]
 * }
 *
 * This converts them into the same compact operand shape used by
 * ordinary two-result comparisons.
 */
function extractGroupedOperands(
  item
) {
  const rows =
    Array.isArray(
      item?.result?.results
    )
      ? item.result.results
      : [];

  if (rows.length < 2) {
    return [];
  }

  const metric =
    getMetricLabel(item) ||
    item?.result?.column ||
    "value";

  const operands = [];

  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object"
    ) {
      continue;
    }

    const label =
      row.label ??
      row.group ??
      row.groupValue ??
      null;

    const rawValue =
      row.value ??
      row.result ??
      row.maximum ??
      row.minimum ??
      row.average ??
      row.sum ??
      null;

    const numeric =
      toNumber(rawValue);

    if (
      label === null ||
      label === undefined ||
      numeric === null
    ) {
      continue;
    }

    operands.push({
      label:
        String(label),

      value:
        numeric,

      metric:
        String(metric),

      sourceItem:
        item,
    });
  }

  return operands;
}


/**
 * Convert a normal verified history item into one numeric operand.
 */
function extractSingleOperand(
  item
) {
  if (!item) {
    return null;
  }

  const metric =
    getMetricLabel(item);

  const numeric =
    extractNumericValue(
      item.result,
      metric
    );

  if (!numeric) {
    return null;
  }

  return {
    label:
      getEntityLabel(item),

    value:
      numeric.value,

    metric:
      metric ||
      numeric.field ||
      "value",

    sourceItem:
      item,
  };
}


function sameMetric(
  left,
  right
) {
  return (
    normalizeMetric(
      left?.metric
    ) ===
    normalizeMetric(
      right?.metric
    )
  );
}


/**
 * Find the most recent pair of VERIFIED numeric operands.
 *
 * Priority:
 * 1. A single grouped result containing 2+ labels/values.
 * 2. Two recent standalone verified results using the same metric.
 *
 * This avoids accidentally comparing later text lookups such as
 * "their stations" or "their position titles".
 */
function findRecentComparisonOperands(
  recentResults = []
) {
  const items =
    Array.isArray(
      recentResults
    )
      ? recentResults
      : [];

  for (
    let index =
      items.length - 1;
    index >= 0;
    index -= 1
  ) {
    const grouped =
      extractGroupedOperands(
        items[index]
      );

    if (grouped.length >= 2) {
      return grouped.slice(0, 2);
    }
  }

  const singles = [];

  for (
    let index =
      items.length - 1;
    index >= 0;
    index -= 1
  ) {
    const operand =
      extractSingleOperand(
        items[index]
      );

    if (!operand) {
      continue;
    }

    if (!singles.length) {
      singles.push(
        operand
      );
      continue;
    }

    if (
      sameMetric(
        singles[0],
        operand
      )
    ) {
      singles.push(
        operand
      );
      break;
    }
  }

  return singles.length >= 2
    ? [
        singles[1],
        singles[0],
      ]
    : [];
}


function findLabelOrderInQuestion(
  question,
  operands
) {
  const text =
    normalizeText(question);

  if (
    !text ||
    !Array.isArray(operands)
  ) {
    return operands;
  }

  const scored =
    operands.map(
      (operand, index) => {
        const label =
          normalizeText(
            operand?.label
          );

        const position =
          label
            ? text.indexOf(
                label
              )
            : -1;

        return {
          operand,
          index,
          position,
        };
      }
    );

  const mentioned =
    scored.filter(
      (item) =>
        item.position >= 0
    );

  if (
    mentioned.length < 2
  ) {
    return operands;
  }

  mentioned.sort(
    (a, b) =>
      a.position -
      b.position
  );

  return mentioned.map(
    (item) =>
      item.operand
  );
}


function formatPercent(
  value
) {
  return Number(value)
    .toLocaleString(
      "en-US",
      {
        maximumFractionDigits:
          2,
      }
    );
}


/**
 * Compare the most relevant VERIFIED values from conversation history.
 *
 * Supported modes:
 * - higher
 * - lower
 * - difference
 * - percent_higher
 * - percent_lower
 *
 * JavaScript performs all arithmetic.
 */
function compareRecentVerifiedResults({
  recentResults = [],
  mode = "higher",
  question = "",
}) {
  let operands =
    findRecentComparisonOperands(
      recentResults
    );

  if (operands.length < 2) {
    return {
      success: false,
      source:
        "comparison",
      operation:
        "clarify",
      answer:
        "I need two previous numeric results for the same measure before I can compare them.",
    };
  }

  operands =
    findLabelOrderInQuestion(
      question,
      operands
    );

  const left =
    operands[0];

  const right =
    operands[1];

  if (
    !sameMetric(
      left,
      right
    )
  ) {
    return {
      success: false,
      source:
        "comparison",
      operation:
        "clarify",
      answer:
        `Those results use different measures (${left.metric} and ${right.metric}), so I can't compare them directly.`,
    };
  }

  const normalizedMode =
    String(mode || "higher")
      .trim()
      .toLowerCase();

  const difference =
    Math.abs(
      left.value -
      right.value
    );

  const signedDifference =
    left.value -
    right.value;

  if (
    normalizedMode ===
      "percent_higher" ||
    normalizedMode ===
      "percent_lower"
  ) {
    const baseline =
      Math.abs(
        right.value
      );

    if (baseline === 0) {
      return {
        success: false,
        source:
          "comparison",
        operation:
          "clarify",
        answer:
          `I can't calculate a percentage relative to ${right.label} because its ${left.metric} is zero.`,
      };
    }

    const percentChange =
      normalizedMode ===
        "percent_lower"
        ? (
            (right.value -
              left.value) /
            baseline
          ) *
          100
        : (
            (left.value -
              right.value) /
            baseline
          ) *
          100;

    const relation =
      normalizedMode ===
        "percent_lower"
        ? "lower"
        : "higher";

    /**
     * If the requested relationship is opposite to reality, say so
     * rather than returning a misleading negative percentage.
     */
    if (percentChange < 0) {
      const opposite =
        relation === "higher"
          ? "lower"
          : "higher";

      return {
        success: true,
        source:
          "comparison",
        operation:
          "percentage",

        metric:
          left.metric,

        leftLabel:
          left.label,

        rightLabel:
          right.label,

        leftValue:
          left.value,

        rightValue:
          right.value,

        difference,

        percentage:
          Math.abs(
            percentChange
          ),

        answer:
          `${left.label} is actually ${formatPercent(
            Math.abs(
              percentChange
            )
          )}% ${opposite} than ${right.label} for ${left.metric}.`,
      };
    }

    return {
      success: true,
      source:
        "comparison",
      operation:
        "percentage",

      metric:
        left.metric,

      leftLabel:
        left.label,

      rightLabel:
        right.label,

      leftValue:
        left.value,

      rightValue:
        right.value,

      difference,

      percentage:
        percentChange,

      answer:
        `${left.label} is ${formatPercent(
          percentChange
        )}% ${relation} than ${right.label} for ${left.metric}.`,
    };
  }

  if (
    normalizedMode ===
      "difference"
  ) {
    /**
     * If the question names A then B, preserve that orientation
     * while still returning an absolute difference.
     */
    const relationship =
      signedDifference === 0
        ? "the same as"
        : signedDifference > 0
          ? "higher than"
          : "lower than";

    return {
      success: true,
      source:
        "comparison",
      operation:
        "difference",

      metric:
        left.metric,

      leftLabel:
        left.label,

      rightLabel:
        right.label,

      leftValue:
        left.value,

      rightValue:
        right.value,

      difference,

      answer:
        signedDifference === 0
          ? `${left.label} and ${right.label} have the same ${left.metric}: ${formatNumber(
              left.value
            )}.`
          : `${left.label} is ${formatNumber(
              difference
            )} ${relationship} ${right.label} for ${left.metric}.`,
    };
  }

  const higher =
    left.value >
    right.value
      ? left
      : right;

  const lower =
    left.value <
    right.value
      ? left
      : right;

  if (
    left.value ===
    right.value
  ) {
    return {
      success: true,
      source:
        "comparison",
      operation:
        "compare",
      metric:
        left.metric,
      leftLabel:
        left.label,
      rightLabel:
        right.label,
      leftValue:
        left.value,
      rightValue:
        right.value,
      difference: 0,
      answer:
        `${left.label} and ${right.label} have the same ${left.metric}: ${formatNumber(
          left.value
        )}.`,
    };
  }

  if (
    normalizedMode ===
      "lower"
  ) {
    return {
      success: true,
      source:
        "comparison",
      operation:
        "compare",
      metric:
        left.metric,
      leftLabel:
        left.label,
      rightLabel:
        right.label,
      leftValue:
        left.value,
      rightValue:
        right.value,
      difference,
      winner:
        lower.label,
      answer:
        `${lower.label} has the lower ${left.metric} at ${formatNumber(
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
      left.metric,
    leftLabel:
      left.label,
    rightLabel:
      right.label,
    leftValue:
      left.value,
    rightValue:
      right.value,
    difference,
    winner:
      higher.label,
    answer:
      `${higher.label} has the higher ${left.metric} at ${formatNumber(
        higher.value
      )}.`,
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
  findRecentComparisonOperands,
  compareRecentVerifiedResults,
};
