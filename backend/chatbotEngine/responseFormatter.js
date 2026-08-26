/**
 * ============================================================
 * I-DAMAG RESPONSE FORMATTER
 * ============================================================
 *
 * Deterministic presentation layer for VERIFIED JavaScript results.
 *
 * IMPORTANT:
 * - Never recalculates dataset values.
 * - Never invents data.
 * - Never changes names/dates/text values.
 * - Never exposes internal worksheet/dataset terminology unless needed.
 * - Works with any dashboard/schema because no business field is hardcoded.
 */


function normalizeText(
  value
) {
  return String(
    value ?? ""
  )
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[_\n\r\t]+/g, " ")
    .replace(/[^\p{L}\p{N}%.\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function humanizeLabel(
  value
) {
  return String(
    value || ""
  )
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function lowerLabel(
  value
) {
  const label =
    humanizeLabel(
      value
    );

  if (!label) {
    return "";
  }

  /**
   * FIELD LABELS should read naturally in sentences:
   *
   * ACTUAL SALARY
   * -> actual salary
   *
   * POSITION TITLE
   * -> position title
   *
   * UNIT/SECTION/STATION
   * -> unit/section/station
   *
   * This function is used for schema/metric labels only.
   * Entity VALUES such as ORED, PMED, DIRECTOR IV, names, etc.
   * are never passed through this lowercasing helper.
   */
  return label
    .toLowerCase();
}


function formatVerifiedValue(
  value,
  {
    maximumFractionDigits = 2,
  } = {}
) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return new Intl.NumberFormat(
      "en-US",
      {
        maximumFractionDigits,
      }
    ).format(
      value
    );
  }

  /**
   * Preserve strings EXACTLY.
   *
   * This is important for:
   * - names
   * - dates
   * - identifiers
   * - values already formatted by the worksheet
   */
  return String(
    value ?? ""
  ).trim();
}


function nonEmpty(
  value
) {
  return (
    value !== null &&
    value !== undefined &&
    String(value).trim() !==
      ""
  );
}


function uniqueValues(
  values = []
) {
  const result = [];
  const seen =
    new Set();

  for (
    const value of values
  ) {
    if (!nonEmpty(value)) {
      continue;
    }

    const display =
      String(value).trim();

    const key =
      normalizeText(
        display
      );

    if (
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    result.push(
      display
    );
  }

  return result;
}


function getFilterDisplayValues(
  filters = []
) {
  const values = [];

  for (
    const filter of
    filters || []
  ) {
    const rawValues =
      Array.isArray(
        filter?.value
      )
        ? filter.value
        : [
            filter?.value,
          ];

    for (
      const raw of
      rawValues
    ) {
      if (nonEmpty(raw)) {
        values.push(
          String(raw).trim()
        );
      }
    }
  }

  return uniqueValues(
    values
  );
}


function buildFilterLabel(
  filters = [],
  question = ""
) {
  const values =
    getFilterDisplayValues(
      filters
    );

  if (!values.length) {
    return "";
  }

  const q =
    normalizeText(
      question
    );

  return values
    .map(
      (value, index) => {
        const normalized =
          normalizeText(
            value
          );

        return {
          value,
          index,
          position:
            normalized
              ? q.indexOf(
                  normalized
                )
              : -1,
        };
      }
    )
    .sort(
      (a, b) =>
        (
          a.position < 0
            ? Number.MAX_SAFE_INTEGER
            : a.position
        ) -
          (
            b.position < 0
              ? Number.MAX_SAFE_INTEGER
              : b.position
          ) ||
        a.index -
          b.index
    )
    .map(
      (item) =>
        item.value
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}


function getSelectedColumns({
  plan,
  result,
  rows = [],
}) {
  const preferred = [
    ...(
      Array.isArray(
        plan?.selectColumns
      )
        ? plan.selectColumns
        : []
    ),
  ];

  if (
    !preferred.length &&
    result?.column
  ) {
    preferred.push(
      result.column
    );
  }

  if (
    !preferred.length &&
    plan?.column
  ) {
    preferred.push(
      plan.column
    );
  }

  if (
    !preferred.length &&
    rows.length &&
    rows[0] &&
    typeof rows[0] ===
      "object" &&
    !Array.isArray(rows[0])
  ) {
    preferred.push(
      ...Object.keys(
        rows[0]
      )
    );
  }

  return uniqueValues(
    preferred
  );
}


function formatKeyValue(
  key,
  value
) {
  return (
    `${humanizeLabel(key)}: ` +
    `${formatVerifiedValue(value)}`
  );
}


function formatRowFields(
  row,
  columns = []
) {
  if (
    !row ||
    typeof row !== "object" ||
    Array.isArray(row)
  ) {
    return formatVerifiedValue(
      row
    );
  }

  const selected =
    columns.length
      ? columns
      : Object.keys(row);

  return selected
    .filter(
      (column) =>
        nonEmpty(
          row?.[
            column
          ]
        )
    )
    .map(
      (column) =>
        formatKeyValue(
          column,
          row?.[
            column
          ]
        )
    )
    .join("; ");
}


function inferQuestionSubject(
  question
) {
  const text =
    String(
      question || ""
    )
      .replace(
        /[?!.]+$/g,
        ""
      )
      .trim();

  if (!text) {
    return "";
  }

  let match =
    text.match(
      /^how many\s+(.+)$/i
    );

  if (match?.[1]) {
    return String(
      match[1]
    )
      .replace(
        /^(?:is|are)\s+/i,
        ""
      )
      .trim();
  }

  match =
    text.match(
      /(?:number|count)\s+of\s+(.+)$/i
    );

  if (match?.[1]) {
    return String(
      match[1]
    ).trim();
  }

  return "";
}


function isFollowUpQuestion(
  question
) {
  const text =
    normalizeText(
      question
    );

  return (
    /\b(his|her|their|its|those|these|them|that person|that one|the two|both)\b/.test(
      text
    )
  );
}


function getOperation(
  plan,
  result
) {
  return String(
    result?.operation ||
    plan?.operation ||
    ""
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}


function getMetricColumn(
  plan,
  result
) {
  return (
    result?.column ||
    plan?.column ||
    ""
  );
}


function getGroupColumn(
  plan,
  result
) {
  return (
    result?.groupBy ||
    result?.labelColumn ||
    plan?.groupBy ||
    plan?.labelColumn ||
    ""
  );
}


function getAggregationWord(
  operation,
  result
) {
  const explicit =
    String(
      result?.aggregation ||
      ""
    )
      .trim()
      .toLowerCase();

  if (explicit) {
    return explicit;
  }

  const map = {
    sum:
      "total",
    average:
      "average",
    avg:
      "average",
    mean:
      "average",
    median:
      "median",
    minimum:
      "lowest",
    min:
      "lowest",
    lowest:
      "lowest",
    maximum:
      "highest",
    max:
      "highest",
    highest:
      "highest",
    group_sum:
      "total",
    group_average:
      "average",
    group_minimum:
      "lowest",
    group_maximum:
      "highest",
    group_count:
      "count",
  };

  return (
    map[
      operation
    ] ||
    operation
  );
}


function makePossessive(
  subject
) {
  const text =
    String(
      subject || ""
    ).trim();

  if (!text) {
    return "";
  }

  return /s$/i.test(text)
    ? `${text}'`
    : `${text}'s`;
}


/**
 * ============================================================
 * LOOKUP
 * ============================================================
 */

function formatLookupAnswer({
  results = [],
  selectedColumns = [],
  count = 0,
  subject = null,
  question = "",
  labelColumn = null,
}) {
  if (!results.length) {
    return (
      subject
        ? `I couldn't find a matching value for ${subject}.`
        : "I couldn't find a matching result."
    );
  }

  const columns =
    selectedColumns.length
      ? selectedColumns
      : (
          results[0] &&
          typeof results[0] ===
            "object" &&
          !Array.isArray(
            results[0]
          )
        )
        ? Object.keys(
            results[0]
          )
        : [];

  const effectiveCount =
    Number.isFinite(
      Number(count)
    )
      ? Number(count)
      : results.length;

  const effectiveLabelColumn =
    labelColumn &&
    columns.includes(
      labelColumn
    )
      ? labelColumn
      : null;

  const outputColumns =
    effectiveLabelColumn
      ? columns.filter(
          (column) =>
            column !==
            effectiveLabelColumn
        )
      : columns;

  // One row, one field.
  if (
    effectiveCount === 1 &&
    outputColumns.length ===
      1
  ) {
    const column =
      outputColumns[0];

    const value =
      results[0]?.[
        column
      ];

    if (!nonEmpty(value)) {
      return "I found the matching result, but that field is empty.";
    }

    const label =
      subject ||
      (
        effectiveLabelColumn
          ? results[0]?.[
              effectiveLabelColumn
            ]
          : ""
      ) ||
      buildFilterLabel(
        [],
        question
      );

    if (label) {
      return (
        `${makePossessive(label)} ` +
        `${lowerLabel(column)} is ` +
        `${formatVerifiedValue(value)}.`
      );
    }

    return (
      `The ${lowerLabel(column)} is ` +
      `${formatVerifiedValue(value)}.`
    );
  }

  // One row, multiple fields.
  if (
    effectiveCount === 1 &&
    outputColumns.length > 1
  ) {
    const row =
      results[0];

    const parts =
      outputColumns
        .filter(
          (column) =>
            nonEmpty(
              row?.[
                column
              ]
            )
        )
        .map(
          (column) =>
            `${humanizeLabel(column)}: ` +
            `${formatVerifiedValue(
              row?.[
                column
              ]
            )}`
        );

    if (!parts.length) {
      return "I found the matching result, but the requested fields are empty.";
    }

    const rowLabel =
      subject ||
      (
        effectiveLabelColumn
          ? row?.[
              effectiveLabelColumn
            ]
          : ""
      );

    if (rowLabel) {
      return (
        `${rowLabel} — ` +
        `${parts.join("; ")}.`
      );
    }

    return (
      `${parts.join("; ")}.`
    );
  }

  // Multiple rows, one output field.
  if (
    outputColumns.length ===
      1
  ) {
    const column =
      outputColumns[0];

    const lines =
      results
        .filter(
          (row) =>
            nonEmpty(
              row?.[
                column
              ]
            )
        )
        .map(
          (row, index) => {
            const label =
              effectiveLabelColumn
                ? row?.[
                    effectiveLabelColumn
                  ]
                : null;

            const value =
              formatVerifiedValue(
                row?.[
                  column
                ]
              );

            return label
              ? `${index + 1}. ${label} — ${value}`
              : `${index + 1}. ${value}`;
          }
        );

    if (!lines.length) {
      return "The matching results do not contain a value for that field.";
    }

    const heading =
      isFollowUpQuestion(
        question
      )
        ? `Here are their ${lowerLabel(column)} values:`
        : `${humanizeLabel(column)}:`;

    return (
      `${heading}\n` +
      `${lines.join("\n")}`
    );
  }

  // Multiple rows, multiple fields.
  const lines =
    results.map(
      (row, index) => {
        const label =
          effectiveLabelColumn
            ? row?.[
                effectiveLabelColumn
              ]
            : null;

        const fields =
          outputColumns
            .filter(
              (column) =>
                nonEmpty(
                  row?.[
                    column
                  ]
                )
            )
            .map(
              (column) =>
                `${humanizeLabel(column)}: ` +
                `${formatVerifiedValue(
                  row?.[
                    column
                  ]
                )}`
            )
            .join("; ");

        if (label) {
          return (
            `${index + 1}. ${label}` +
            (
              fields
                ? ` — ${fields}`
                : ""
            )
          );
        }

        return (
          `${index + 1}. ${fields}`
        );
      }
    )
    .filter(
      (line) =>
        !/\.\s*$/.test(line) ||
        line.trim() !==
          "."
    );

  return lines.join(
    "\n"
  );
}


/**
 * ============================================================
 * SINGLE AGGREGATE
 * ============================================================
 */

function formatAggregateAnswer({
  operation,
  column,
  value,
  recordsUsed,
  dataset,
  subject = "",
}) {
  const label =
    lowerLabel(
      column
    );

  const formatted =
    formatVerifiedValue(
      value
    );

  const prefix =
    subject
      ? `For ${subject}, `
      : "";

  switch (
    String(operation || "")
      .trim()
      .toLowerCase()
  ) {
    case "sum":
      return (
        `${prefix}the total ${label || "value"} is ${formatted}.`
      );

    case "average":
    case "avg":
    case "mean":
      return (
        `${prefix}the average ${label || "value"} is ${formatted}.`
      );

    case "median":
      return (
        `${prefix}the median ${label || "value"} is ${formatted}.`
      );

    case "minimum":
    case "min":
      return (
        `${prefix}the lowest ${label || "value"} is ${formatted}.`
      );

    case "maximum":
    case "max":
      return (
        `${prefix}the highest ${label || "value"} is ${formatted}.`
      );

    default:
      return (
        `${prefix}${humanizeLabel(column) || "Value"}: ${formatted}.`
      );
  }
}


/**
 * ============================================================
 * COUNTS
 * ============================================================
 */

function formatCountAnswer({
  count,
  column = null,
  question = "",
  subject = "",
}) {
  const resolvedSubject =
    subject ||
    inferQuestionSubject(
      question
    );

  const formatted =
    formatVerifiedValue(
      count
    );

  if (resolvedSubject) {
    return (
      `There are ${formatted} ${resolvedSubject}.`
    );
  }

  if (column) {
    return (
      `The count for ${lowerLabel(column)} is ${formatted}.`
    );
  }

  return (
    `The total count is ${formatted}.`
  );
}


/**
 * ============================================================
 * GROUPED AGGREGATES
 * ============================================================
 */

function formatGroupedAggregateAnswer({
  operation,
  column,
  groupBy,
  results = [],
  question = "",
}) {
  if (!results.length) {
    return "I couldn't find values for that grouped calculation.";
  }

  const aggregation =
    getAggregationWord(
      operation,
      {}
    );

  const metric =
    lowerLabel(
      column
    ) ||
    "value";

  const groupLabel =
    lowerLabel(
      groupBy
    ) ||
    "group";

  const lines =
    results.map(
      (item) =>
        `${item.label}: ` +
        `${formatVerifiedValue(
          item.value
        )}`
    );

  if (
    results.length === 1
  ) {
    return (
      `The ${aggregation} ${metric} for ` +
      `${results[0].label} is ` +
      `${formatVerifiedValue(
        results[0].value
      )}.`
    );
  }

  if (
    results.length === 2
  ) {
    const first =
      results[0];

    const second =
      results[1];

    const firstValue =
      formatVerifiedValue(
        first.value
      );

    const secondValue =
      formatVerifiedValue(
        second.value
      );

    if (
      operation ===
        "group_maximum"
    ) {
      return (
        `The highest ${metric} for ${first.label} is ${firstValue}, ` +
        `while the highest for ${second.label} is ${secondValue}.`
      );
    }

    if (
      operation ===
        "group_minimum"
    ) {
      return (
        `The lowest ${metric} for ${first.label} is ${firstValue}, ` +
        `while the lowest for ${second.label} is ${secondValue}.`
      );
    }

    if (
      operation ===
        "group_average"
    ) {
      return (
        `The average ${metric} for ${first.label} is ${firstValue}, ` +
        `while the average for ${second.label} is ${secondValue}.`
      );
    }

    if (
      operation ===
        "group_sum"
    ) {
      return (
        `The total ${metric} for ${first.label} is ${firstValue}, ` +
        `compared with ${secondValue} for ${second.label}.`
      );
    }

    if (
      operation ===
        "group_count"
    ) {
      return (
        `${first.label} has ${firstValue}, while ${second.label} has ${secondValue}.`
      );
    }
  }

  const heading =
    operation ===
      "group_count"
      ? `Count by ${humanizeLabel(groupBy) || "group"}:`
      : `${humanizeLabel(aggregation)} ${humanizeLabel(column) || "value"} by ${humanizeLabel(groupBy) || "group"}:`;

  return (
    `${heading}\n` +
    results
      .map(
        (item, index) =>
          `${index + 1}. ${item.label}: ` +
          `${formatVerifiedValue(
            item.value
          )}`
      )
      .join("\n")
  );
}


/**
 * ============================================================
 * RANKINGS
 * ============================================================
 */

function formatRankingAnswer({
  operation,
  column,
  labelColumn,
  aggregation,
  direction,
  results = [],
}) {
  if (!results.length) {
    return "I couldn't find values for that ranking.";
  }

  const isAscending =
    String(
      direction || ""
    )
      .toLowerCase() ===
    "asc";

  const rankWord =
    isAscending
      ? "lowest"
      : "highest";

  const metric =
    lowerLabel(
      column
    ) ||
    "value";

  const aggregationText =
    aggregation
      ? `${aggregation} `
      : "";

  if (
    results.length === 1
  ) {
    const item =
      results[0];

    const aggregatePhrase =
      aggregation
        ? `${aggregation} ${metric}`
        : metric;

    return (
      `${item.label} has the ${rankWord} ` +
      `${aggregatePhrase} at ` +
      `${formatVerifiedValue(
        item.value
      )}.`
    );
  }

  const heading =
    `${isAscending ? "Bottom" : "Top"} ` +
    `${results.length} by ` +
    `${aggregationText}${humanizeLabel(column) || "value"}:`;

  return (
    `${heading}\n` +
    results
      .map(
        (item, index) =>
          `${index + 1}. ${item.label} — ` +
          `${formatVerifiedValue(
            item.value
          )}`
      )
      .join("\n")
  );
}


/**
 * ============================================================
 * MIN / MAX ROW RESULTS
 * ============================================================
 */

function formatExtremumAnswer({
  operation,
  column,
  results = [],
  value,
}) {
  const isMax =
    operation ===
      "maximum";

  const adjective =
    isMax
      ? "highest"
      : "lowest";

  const metric =
    lowerLabel(
      column
    ) ||
    "value";

  if (
    Array.isArray(results) &&
    results.length
  ) {
    const first =
      results[0];

    if (
      first?.label !== null &&
      first?.label !== undefined &&
      String(
        first.label
      ).trim()
    ) {
      return (
        `${first.label} has the ${adjective} ${metric} at ` +
        `${formatVerifiedValue(
          first.value
        )}.`
      );
    }

    return (
      `The ${adjective} ${metric} is ` +
      `${formatVerifiedValue(
        first?.value
      )}.`
    );
  }

  return (
    `The ${adjective} ${metric} is ` +
    `${formatVerifiedValue(
      value
    )}.`
  );
}


/**
 * ============================================================
 * MULTI-ENTITY FILTER GROUPS
 * ============================================================
 */

function formatFilterGroupAnswer({
  question = "",
  plan,
  result,
}) {
  const groups =
    Array.isArray(
      result?.filterGroups
    )
      ? result.filterGroups
      : [];

  if (!groups.length) {
    return "";
  }

  const labelColumn =
    result?.labelColumn ||
    plan?.labelColumn ||
    null;

  const selectedColumns =
    getSelectedColumns({
      plan,
      result,
      rows:
        Array.isArray(
          result?.results
        )
          ? result.results
          : [],
    });

  const sections = [];

  for (
    const group of groups
  ) {
    const rows =
      Array.isArray(
        group?.results
      )
        ? group.results
        : [];

    if (!rows.length) {
      continue;
    }

    const filterLabel =
      buildFilterLabel(
        group?.filters ||
        [],
        question
      );

    const row =
      rows[0];

    const rowIdentity =
      labelColumn &&
      nonEmpty(
        row?.[
          labelColumn
        ]
      )
        ? row[
            labelColumn
          ]
        : "";

    const heading =
      rowIdentity ||
      filterLabel ||
      `Result ${sections.length + 1}`;

    const outputColumns =
      selectedColumns.filter(
        (column) =>
          column !==
          labelColumn &&
          nonEmpty(
            row?.[
              column
            ]
          )
      );

    if (
      rows.length === 1 &&
      outputColumns.length ===
        1
    ) {
      const column =
        outputColumns[0];

      sections.push(
        `${heading} — ` +
        `${humanizeLabel(column)}: ` +
        `${formatVerifiedValue(
          row?.[
            column
          ]
        )}`
      );

      continue;
    }

    if (
      rows.length === 1
    ) {
      const content =
        formatRowFields(
          row,
          outputColumns
        );

      sections.push(
        content
          ? `${heading} — ${content}`
          : String(
              heading
            )
      );

      continue;
    }

    const items =
      rows.map(
        (item, index) =>
          `${index + 1}. ` +
          `${formatRowFields(
            item,
            outputColumns
          )}`
      );

    sections.push(
      `${heading}:\n` +
      `${items.join("\n")}`
    );
  }

  if (!sections.length) {
    return "";
  }

  return sections.join(
    "\n"
  );
}


/**
 * ============================================================
 * COMPARISON RESULTS
 * ============================================================
 */

function formatComparisonAnswer(
  result
) {
  const operation =
    String(
      result?.operation ||
      ""
    )
      .trim()
      .toLowerCase();

  const metric =
    lowerLabel(
      result?.metric
    ) ||
    "value";

  const leftLabel =
    result?.leftLabel;

  const rightLabel =
    result?.rightLabel;

  if (
    operation ===
      "difference" &&
    nonEmpty(
      result?.difference
    )
  ) {
    return (
      `The difference between ${leftLabel} and ${rightLabel} ` +
      `for ${metric} is ` +
      `${formatVerifiedValue(
        result.difference
      )}.`
    );
  }

  if (
    operation ===
      "percentage" &&
    nonEmpty(
      result?.percentage
    )
  ) {
    if (
      typeof result?.answer ===
        "string" &&
      result.answer.trim()
    ) {
      return result.answer.trim();
    }

    return (
      `The percentage difference between ${leftLabel} and ${rightLabel} ` +
      `for ${metric} is ` +
      `${formatVerifiedValue(
        result.percentage
      )}%.`
    );
  }

  if (
    nonEmpty(
      result?.winner
    )
  ) {
    const winner =
      result.winner;

    const winnerValue =
      normalizeText(
        winner
      ) ===
      normalizeText(
        leftLabel
      )
        ? result.leftValue
        : result.rightValue;

    return (
      `${winner} has the higher ${metric} at ` +
      `${formatVerifiedValue(
        winnerValue
      )}.`
    );
  }

  return "";
}


/**
 * ============================================================
 * MASTER VERIFIED RESULT FORMATTER
 * ============================================================
 */

function formatVerifiedResultAnswer({
  question = "",
  plan = {},
  result = {},
}) {
  if (!result) {
    return "";
  }

  if (
    result.success ===
      false
  ) {
    return String(
      result.answer ||
      result.message ||
      "I couldn't complete that request."
    ).trim();
  }

  if (
    result.source ===
      "comparison"
  ) {
    const comparison =
      formatComparisonAnswer(
        result
      );

    if (comparison) {
      return comparison;
    }
  }

  const operation =
    getOperation(
      plan,
      result
    );

  const column =
    getMetricColumn(
      plan,
      result
    );

  const groupBy =
    getGroupColumn(
      plan,
      result
    );

  const rows =
    Array.isArray(
      result?.results
    )
      ? result.results
      : [];

  // Filter groups take precedence over raw flattened rows.
  if (
    Array.isArray(
      result?.filterGroups
    ) &&
    result.filterGroups.some(
      (group) =>
        Array.isArray(
          group?.results
        ) &&
        group.results.length
    )
  ) {
    const grouped =
      formatFilterGroupAnswer({
        question,
        plan,
        result,
      });

    if (grouped) {
      return grouped;
    }
  }

  // Grouped calculations.
  if (
    [
      "group_sum",
      "group_average",
      "group_minimum",
      "group_maximum",
      "group_count",
    ].includes(
      operation
    )
  ) {
    return formatGroupedAggregateAnswer({
      operation,
      column,
      groupBy,
      results:
        rows,
      question,
    });
  }

  // Rankings.
  if (
    [
      "rank_rows",
      "rank_groups",
    ].includes(
      operation
    )
  ) {
    return formatRankingAnswer({
      operation,
      column,
      labelColumn:
        result?.labelColumn ||
        plan?.labelColumn,
      aggregation:
        result?.aggregation ||
        plan?.aggregation,
      direction:
        result?.direction ||
        plan?.direction,
      results:
        rows,
    });
  }

  // Single max/min operations may include labeled rows.
  if (
    [
      "minimum",
      "maximum",
    ].includes(
      operation
    )
  ) {
    return formatExtremumAnswer({
      operation,
      column,
      results:
        rows,
      value:
        result?.value,
    });
  }

  // Standard aggregate operations.
  if (
    [
      "sum",
      "average",
      "avg",
      "mean",
      "median",
    ].includes(
      operation
    ) &&
    nonEmpty(
      result?.value
    )
  ) {
    return formatAggregateAnswer({
      operation,
      column,
      value:
        result.value,
      recordsUsed:
        result.recordsUsed,
      dataset:
        result.dataset,
      subject:
        buildFilterLabel(
          result?.filters ||
          plan?.filters ||
          [],
          question
        ),
    });
  }

  // Counts.
  if (
    [
      "count",
      "non_empty_count",
      "distinct_count",
    ].includes(
      operation
    ) &&
    (
      nonEmpty(
        result?.value
      ) ||
      nonEmpty(
        result?.count
      )
    )
  ) {
    return formatCountAnswer({
      count:
        nonEmpty(
          result?.value
        )
          ? result.value
          : result.count,
      column,
      question,
    });
  }

  // Lookup / list.
  if (
    [
      "lookup",
      "list",
      "value",
    ].includes(
      operation
    ) &&
    rows.length
  ) {
    const selectedColumns =
      getSelectedColumns({
        plan,
        result,
        rows,
      });

    const subject =
      buildFilterLabel(
        result?.filters ||
        plan?.filters ||
        [],
        question
      );

    return formatLookupAnswer({
      results:
        rows,
      selectedColumns,
      count:
        result?.count ??
        rows.length,
      subject:
        subject || null,
      question,
      labelColumn:
        result?.labelColumn ||
        plan?.labelColumn ||
        null,
    });
  }

  // Generic structured rows.
  if (rows.length) {
    const selectedColumns =
      getSelectedColumns({
        plan,
        result,
        rows,
      });

    return formatLookupAnswer({
      results:
        rows,
      selectedColumns,
      count:
        result?.count ??
        rows.length,
      question,
      labelColumn:
        result?.labelColumn ||
        plan?.labelColumn ||
        null,
    });
  }

  // Direct verified scalar value.
  if (
    nonEmpty(
      result?.value
    )
  ) {
    if (column) {
      return (
        `${humanizeLabel(column)}: ` +
        `${formatVerifiedValue(
          result.value
        )}.`
      );
    }

    return (
      `${formatVerifiedValue(
        result.value
      )}.`
    );
  }

  return String(
    result?.answer ||
    ""
  )
    .replace(
      /\s+in\s+Sheet\d+\s+/gi,
      " "
    )
    .replace(
      /,?\s*based on\s+\d+\s+record\(s\)\.?/gi,
      "."
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


module.exports = {
  humanizeLabel,
  formatVerifiedValue,
  formatLookupAnswer,
  formatAggregateAnswer,
  formatCountAnswer,
  formatGroupedAggregateAnswer,
  formatRankingAnswer,
  formatComparisonAnswer,
  formatVerifiedResultAnswer,
};
