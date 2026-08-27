const {
  normalizeText,
  similarity,
  singularizeToken,
} = require("./utils");
const {
  inferValueFilters,
  inferCoherentFilters,
  inferDatasetValueFilters,
  mergeFilters,
} = require("./filterEngine");
const {
  findDatasetsContainingColumn,
} = require("./columnMatcher");

const GENERAL_PATTERNS = [
  /\b(translate|translation)\b/,
  /\b(correct|fix|check|improve)\b.*\b(grammar|sentence|paragraph|writing)\b/,
  /\b(write|rewrite|compose|draft|make)\b.*\b(letter|paragraph|essay|message|caption|report|email)\b/,
  /\b(explain|define|meaning of|what does .* mean)\b/,
  /\b(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you)\b/,
];

const SCHEMA_PATTERNS = {
  datasets: [
    /\b(worksheet|worksheets|sheet|sheets|dataset|datasets)\b.*\b(available|exist|loaded|have)\b/,
    /\bwhat\b.*\b(worksheet|worksheets|sheet|sheets|dataset|datasets)\b/,
  ],
  columns: [
    /\b(column|columns|field|fields|header|headers)\b.*\b(available|exist|have|show|list)\b/,
    /\bwhat\b.*\b(column|columns|field|fields|header|headers)\b/,
  ],
  row_counts: [
    /\b(row count|rows per|records per|entries per)\b/,
    /\bhow many rows\b.*\b(each|worksheet|sheet|dataset)\b/,
  ],
  find_column: [
    /\b(which|what)\b.*\b(worksheet|sheet|dataset)\b.*\b(contain|contains|has|have)\b/,
    /\bwhere\b.*\b(column|field)\b/,
  ],
};

const TARGET_PREFIX_PATTERNS = [
  /^(?:please\s+)?(?:list|show|display|enumerate|name)\s+(?:all\s+)?(?:the\s+)?(.+)$/,
  /^(?:what|which)\s+(?:are|is)\s+(?:all\s+)?(?:the\s+)?(.+?)\??$/,
  /^(?:give|tell)\s+me\s+(?:all\s+)?(?:the\s+)?(.+)$/,
  /^(?:how many|number of|count of)\s+(?:the\s+)?(.+)$/,
  /^(?:what is|what are)\s+(?:the\s+)?(?:total|sum|average|avg|mean|median|highest|lowest|maximum|minimum)\s+(?:of\s+)?(.+)$/,
];

const OPERATION_WORDS = new Set([
  "all",
  "average",
  "avg",
  "bottom",
  "combined",
  "count",
  "different",
  "display",
  "distinct",
  "enumerate",
  "give",
  "highest",
  "in",
  "list",
  "lowest",
  "max",
  "maximum",
  "mean",
  "median",
  "minimum",
  "min",
  "number",
  "of",
  "overall",
  "show",
  "sum",
  "tell",
  "the",
  "top",
  "total",
  "unique",
  "value",
  "values",
]);

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeTarget(value) {
  return normalizeText(value)
    .replace(/[?]+$/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map(singularizeToken)
    .filter((token) => !OPERATION_WORDS.has(token))
    .join(" ")
    .trim();
}


/**
 * Preserve every independent identifier field from the same
 * worksheet instead of collapsing record identity to the first
 * match only.
 *
 * Example:
 *   FIRST NAME = DORIS JOY
 *   LAST NAME  = GARCIA
 *
 * Both filters execute with AND.
 */
function getDatasetIdentifierFilters(
  identifierMatches,
  datasetName
) {
  const selected = [];
  const seen = new Set();

  for (const match of identifierMatches || []) {
    if (
      match?.dataset !==
      datasetName ||
      !match?.column
    ) {
      continue;
    }

    const key =
      normalizeText(
        match.column
      );

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    selected.push({
      column:
        match.column,

      operator:
        match.operator ||
        "equals",

      value:
        match.value,
    });
  }

  return selected;
}


function extractTargetPhrase(question) {
  const text = normalizeText(question);

  for (const pattern of TARGET_PREFIX_PATTERNS) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return normalizeTarget(match[1]);
    }
  }

  const byMatch = text.match(
    /\b(?:by|per|for each|grouped by)\s+(.+)$/
  );

  if (byMatch?.[1]) {
    return normalizeTarget(
      text.replace(byMatch[0], "")
    );
  }

  return normalizeTarget(text);
}

function extractGroupingPhrase(question) {
  const text = normalizeText(question);
  const match = text.match(
    /\b(?:by|per|for each|grouped by)\s+(.+)$/
  );

  return match?.[1]
    ? normalizeTarget(match[1])
    : null;
}

function getAllColumns(schema) {
  const columns = [];

  for (const dataset of schema) {
    for (const column of dataset.columns || []) {
      columns.push({
        dataset: dataset.name,
        name: column.name,
        type: column.type,
        examples: column.examples || [],
      });
    }
  }

  return columns;
}

function scoreColumnTarget(target, columnName) {
  const cleanTarget = normalizeTarget(target);
  const cleanColumn = normalizeTarget(columnName);

  if (!cleanTarget || !cleanColumn) {
    return 0;
  }

  if (cleanTarget === cleanColumn) {
    return 2;
  }

  let score = similarity(cleanTarget, cleanColumn);

  if (
    cleanTarget.includes(cleanColumn) ||
    cleanColumn.includes(cleanTarget)
  ) {
    score += 0.8;
  }

  const targetTokens = new Set(
    cleanTarget.split(/\s+/)
  );
  const columnTokens = new Set(
    cleanColumn.split(/\s+/)
  );

  let matched = 0;

  for (const token of columnTokens) {
    if (targetTokens.has(token)) {
      matched += 1;
    }
  }

  if (columnTokens.size) {
    score += matched / columnTokens.size;
  }

  return score;
}

function rankDatasets(question, schema) {
  return schema
    .map((dataset) => {
      let score = similarity(
        question,
        dataset.name
      );

      for (const column of dataset.columns || []) {
        score = Math.max(
          score,
          scoreColumnTarget(
            extractTargetPhrase(question),
            column.name
          ) * 0.9
        );

        for (const example of column.examples || []) {
          const normalizedExample =
            normalizeText(example);

          if (
            normalizedExample.length >= 2 &&
            normalizeText(question).includes(
              normalizedExample
            )
          ) {
            score += Math.min(
              normalizedExample.length / 50,
              0.45
            );
          }
        }
      }

      return {
        dataset: dataset.name,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function rankColumns(
  target,
  schema,
  datasetName = null
) {
  const cleanTarget = extractTargetPhrase(target);

  return getAllColumns(schema)
    .filter(
      (item) =>
        !datasetName ||
        item.dataset === datasetName
    )
    .map((item) => ({
      ...item,
      score: scoreColumnTarget(
        cleanTarget,
        item.name
      ),
    }))
    .sort((a, b) => b.score - a.score);
}

function detectLimit(question, fallback = 10) {
  const text = normalizeText(question);

  const match =
    text.match(
      /\b(?:top|bottom|first|last)\s+(\d{1,3})\b/
    ) ||
    text.match(
      /\b(\d{1,3})\s+(?:highest|lowest|largest|smallest)\b/
    );

  if (!match) return fallback;

  const value = Number(match[1]);

  return Number.isInteger(value)
    ? Math.min(Math.max(value, 1), 100)
    : fallback;
}


function detectShowAll(question) {
  const text = normalizeText(question);

  return (
    /\b(all|every|entire|complete|full)\b/.test(text) ||
    /\blist of\b/.test(text)
  );
}


function detectOperation(
  question,
  selectedColumn
) {
  const text = normalizeText(question);
  const isNumeric =
    selectedColumn?.type === "number";

  const hasGrouping =
    /\b(by|per|for each|grouped by|each)\b/.test(
      text
    );

  let baseOperation = null;

  if (/\b(median|middle value)\b/.test(text)) {
    baseOperation = "median";
  } else if (
    /\b(average|avg|mean)\b/.test(text)
  ) {
    baseOperation = "average";
  } else if (
    /\b(top|highest|maximum|max|largest|greatest|most)\b/.test(
      text
    )
  ) {
    baseOperation = "maximum";
  } else if (
    /\b(bottom|lowest|minimum|min|smallest|least)\b/.test(
      text
    )
  ) {
    baseOperation = "minimum";
  } else if (
    /\b(sum|total|combined|overall|altogether|in all)\b/.test(
      text
    )
  ) {
    baseOperation = "sum";
  } else if (
    /\b(unique|distinct|different)\b/.test(
      text
    ) &&
    /\b(how many|count|number)\b/.test(text)
  ) {
    baseOperation = "distinct_count";
  } else if (
    /\b(list|show all|display all|enumerate|what are|which are|give me all|name all)\b/.test(
      text
    )
  ) {
    baseOperation = "list";
  } else if (
    /\b(show|find|lookup|search|get|retrieve)\b/.test(
      text
    )
  ) {
    baseOperation = "lookup";
  } else if (
    /\b(how many rows|number of rows|row count|records|entries)\b/.test(
      text
    )
  ) {
    baseOperation = "row_count";
  } else if (
    /\b(how many|number of|count)\b/.test(
      text
    )
  ) {
    if (isNumeric) {
      baseOperation = "sum";
    } else if (selectedColumn) {
      baseOperation =
        /\b(unique|distinct|different)\b/.test(text)
          ? "distinct_count"
          : "non_empty_count";
    } else {
      baseOperation = "row_count";
    }
  }

  if (!baseOperation) {
    return null;
  }

  if (hasGrouping) {
    if (baseOperation === "sum") {
      return "group_sum";
    }

    if (baseOperation === "average") {
      return "group_average";
    }

    if (baseOperation === "minimum") {
      return "group_minimum";
    }

    if (baseOperation === "maximum") {
      return "group_maximum";
    }

    if (baseOperation === "row_count") {
      return "group_count";
    }
  }

  return baseOperation;
}

function findGroupingColumn(
  question,
  schema,
  datasetName,
  metricColumn
) {
  const groupingTarget =
    extractGroupingPhrase(question);

  if (!groupingTarget) {
    return null;
  }

  const candidates = rankColumns(
    groupingTarget,
    schema,
    datasetName
  ).filter(
    (item) =>
      item.name !== metricColumn?.name
  );

  return (
    candidates.find(
      (item) =>
        item.type !== "number" &&
        item.score >= 0.75
    ) || null
  );
}

function findExplicitFilters(
  question,
  schema,
  datasetName,
  excluded = []
) {
  const text = normalizeText(question);
  const excludedSet = new Set(
    excluded.filter(Boolean)
  );
  const filters = [];

  const columns = getAllColumns(schema).filter(
    (item) =>
      item.dataset === datasetName &&
      !excludedSet.has(item.name)
  );

  for (const column of columns) {
    for (const example of column.examples || []) {
      const normalizedExample =
        normalizeText(example);

      if (
        normalizedExample.length >= 2 &&
        text.includes(normalizedExample)
      ) {
        filters.push({
          column: column.name,
          operator: "equals",
          value: example,
          score: normalizedExample.length,
        });
      }
    }
  }

  filters.sort((a, b) => b.score - a.score);

  const finalFilters = [];
  const usedColumns = new Set();

  for (const filter of filters) {
    if (!usedColumns.has(filter.column)) {
      usedColumns.add(filter.column);
      const { score, ...clean } = filter;
      finalFilters.push(clean);
    }
  }

  return finalFilters;
}

function detectSchemaPlan(
  question,
  schema
) {
  const text = normalizeText(question);

  for (const [intent, patterns] of Object.entries(
    SCHEMA_PATTERNS
  )) {
    if (!matchesAny(text, patterns)) {
      continue;
    }

    const datasetRank =
      rankDatasets(question, schema);
    const dataset =
      datasetRank[0]?.score >= 0.55
        ? datasetRank[0].dataset
        : null;

    const target =
      extractTargetPhrase(question);
    const columnRank = rankColumns(
      target,
      schema,
      dataset
    );
    const column =
      columnRank[0]?.score >= 0.75
        ? columnRank[0].name
        : null;

    return {
      route: "schema",
      intent,
      dataset,
      column,
      confidence: 0.95,
    };
  }

  return null;
}

function detectGeneralPlan(question) {
  const text = normalizeText(question);

  if (matchesAny(text, GENERAL_PATTERNS)) {
    return {
      route: "general",
      confidence: 0.95,
    };
  }

  return null;
}

function detectRequestedOutputColumns(
  question,
  schema,
  datasetName,
  filterColumns = []
) {
  const text = normalizeText(question);

  const targetMatch = text.match(
    /^(?:what|which|who|show|give|tell me)?\s*(?:is|are|was|were)?\s*(?:the\s+)?(.+?)\s+(?:of|for|from)\s+/
  );

  const rawTarget = targetMatch?.[1]
    ? targetMatch[1].trim()
    : extractTargetPhrase(question);

  let transform = null;

  if (/\bfirst name\b/.test(text)) {
    transform = "first_word";
  } else if (/\blast name\b/.test(text)) {
    transform = "last_word";
  }

  // For "first name" and "last name", match the underlying name/person
  // column, then apply the requested word transformation.
  const targetText = normalizeTarget(
    rawTarget
      .replace(/\bfirst name\b/g, "name")
      .replace(/\blast name\b/g, "name")
  );

  const candidates = rankColumns(
    targetText,
    schema,
    datasetName
  )
    .filter(
      (item) =>
        !filterColumns.includes(item.name)
    )
    .map((item) => {
      let score = item.score;
      const normalizedColumn = normalizeText(item.name);
      const examples = Array.isArray(item.examples)
        ? item.examples
        : [];

      const asksForName =
        /\b(name|person|who)\b/.test(targetText) ||
        transform !== null;

      if (
        asksForName &&
        /\b(name|farmer|person|respondent|beneficiary|owner|operator|employee|staff|applicant|client|customer|student|teacher|member)\b/.test(
          normalizedColumn
        )
      ) {
        score += 1;
      }

      // Generic evidence that a text column contains full names.
      if (
        asksForName &&
        item.type === "text" &&
        examples.some((value) =>
          /^[\p{L}.'-]+(?:\s+[\p{L}.'-]+)+$/u.test(
            String(value).trim()
          )
        )
      ) {
        score += 0.35;
      }

      return {
        ...item,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const selected =
    candidates[0]?.score >= 0.55
      ? [candidates[0].name]
      : [];

  return {
    selectColumns: selected,
    transform,
    outputRequested:
      Boolean(targetMatch?.[1]) ||
      transform !== null,
  };
}



function isNumericLikeSchemaColumn(
  column
) {
  if (!column) {
    return false;
  }

  if (column.type === "number") {
    return true;
  }

  const examples =
    Array.isArray(column.examples)
      ? column.examples
      : [];

  if (!examples.length) {
    return false;
  }

  let usable = 0;
  let numeric = 0;

  for (const value of examples) {
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ""
    ) {
      continue;
    }

    usable += 1;

    const cleaned =
      String(value)
        .trim()
        .replace(/[,₱$€£¥%]/g, "")
        .replace(/\s+/g, "");

    if (
      cleaned !== "" &&
      Number.isFinite(
        Number(cleaned)
      )
    ) {
      numeric += 1;
    }
  }

  return (
    usable > 0 &&
    numeric / usable >= 0.6
  );
}


function extractRankingRequest(
  question,
  schema,
  datasetName
) {
  const text =
    normalizeText(question);

  const hasDescendingMetric =
    /\b(highest|largest|biggest|greatest|most|maximum|max|top)\b/.test(
      text
    );

  const hasAscendingMetric =
    /\b(lowest|smallest|least|minimum|min|bottom)\b/.test(
      text
    );

  const direction =
    hasAscendingMetric
      ? "asc"
      : hasDescendingMetric
        ? "desc"
        : null;

  if (!direction) {
    return null;
  }

  const explicitN =
    text.match(
      /\b(?:top|bottom|first|last)\s+(\d{1,3})\b/
    ) ||
    text.match(
      /\b(\d{1,3})\s+(?:highest|lowest|largest|smallest)\b/
    );

  const limit =
    explicitN?.[1]
      ? Math.min(
          Math.max(
            Number(explicitN[1]),
            1
          ),
          100
        )
      : 1;

  let labelTarget = null;
  let metricTarget = null;
  let aggregation = null;

  /**
   * WHO has the highest/lowest METRIC ...
   *
   * "who" is semantic identity language. The actual label
   * field is inferred dynamically from the current schema.
   */
  let match = text.match(
    /\bwho\s+(?:has|have|had|is|are)\s+(?:the\s+)?(?:highest|lowest|largest|smallest|biggest|greatest|most|least|maximum|minimum)\s+(.+?)(?:\s+\b(?:in|within|among|for)\b\s+.+)?$/
  );

  if (match?.[1]) {
    labelTarget =
      "person name employee";

    metricTarget =
      normalizeTarget(
        match[1]
      );
  }

  /**
   * WHICH/WHAT ENTITY has the highest/lowest METRIC ...
   *
   * Examples:
   * - which municipality has the highest production
   * - what position title has the highest actual salary
   */
  if (
    !labelTarget ||
    !metricTarget
  ) {
    match = text.match(
      /\b(?:which|what)\s+(.+?)\s+(?:has|have|had|is|are)\s+(?:the\s+)?(?:highest|lowest|largest|smallest|biggest|greatest|most|least|maximum|minimum)\s+(.+?)(?:\s+\b(?:in|within|among|for)\b\s+.+)?$/
    );

    if (
      match?.[1] &&
      match?.[2]
    ) {
      labelTarget =
        normalizeTarget(
          match[1]
        );

      metricTarget =
        normalizeTarget(
          match[2]
        );
    }
  }

  /**
   * top/bottom N LABEL by METRIC
   */
  if (
    !labelTarget ||
    !metricTarget
  ) {
    match = text.match(
      /\b(?:top|bottom|first|last)\s+\d{1,3}\s+(.+?)\s+(?:by|based on|according to)\s+(.+)$/
    );

    if (match) {
      labelTarget =
        normalizeTarget(
          match[1]
        );

      metricTarget =
        normalizeTarget(
          match[2]
        );
    }
  }

  /**
   * LABEL with highest/lowest METRIC
   */
  if (
    !labelTarget ||
    !metricTarget
  ) {
    match = text.match(
      /\b(?:top|bottom|first|last)?\s*(?:\d{1,3})?\s*(.+?)\s+(?:with|having)\s+(?:the\s+)?(?:highest|lowest|largest|smallest|biggest|greatest|most|least|maximum|minimum)\s+(.+)$/
    );

    if (match) {
      labelTarget =
        normalizeTarget(
          match[1]
        );

      metricTarget =
        normalizeTarget(
          match[2]
        );
    }
  }

  /**
   * highest/lowest METRIC for/among LABEL
   */
  if (
    !labelTarget ||
    !metricTarget
  ) {
    match = text.match(
      /\b(?:highest|lowest|largest|smallest|biggest|greatest|most|least|maximum|minimum)\s+(.+?)\s+(?:for|among)\s+(.+)$/
    );

    if (match) {
      metricTarget =
        normalizeTarget(
          match[1]
        );

      labelTarget =
        normalizeTarget(
          match[2]
        );
    }
  }

  if (
    !labelTarget ||
    !metricTarget
  ) {
    return null;
  }

  if (
    /\b(total|sum|combined|overall)\b/.test(
      metricTarget
    )
  ) {
    aggregation = "sum";
  } else if (
    /\b(average|avg|mean)\b/.test(
      metricTarget
    )
  ) {
    aggregation = "average";
  } else if (
    /\b(count|number)\b/.test(
      metricTarget
    )
  ) {
    aggregation = "count";
  }

  metricTarget =
    metricTarget
      .replace(
        /\b(total|sum|combined|overall|average|avg|mean|count|number)\b/g,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();

  const asksWho =
    /\bwho\b/.test(text);

  const labelCandidates =
    rankColumns(
      labelTarget,
      schema,
      datasetName
    )
      .filter(
        (item) =>
          !isNumericLikeSchemaColumn(
            item
          )
      )
      .map((item) => {
        let score =
          item.score;

        if (asksWho) {
          const normalizedName =
            normalizeText(
              item.name
            );

          if (
            /\b(full name|name|first name|last name|surname|employee|staff|person|respondent|beneficiary|owner|operator|applicant|client|customer|student|teacher|member)\b/.test(
              normalizedName
            )
          ) {
            score += 1.2;
          }

          const examples =
            Array.isArray(
              item.examples
            )
              ? item.examples
              : [];

          if (
            examples.some(
              (value) =>
                /^[\p{L}.'-]+(?:\s+[\p{L}.'-]+)+$/u.test(
                  String(
                    value
                  ).trim()
                )
            )
          ) {
            score += 0.3;
          }
        }

        return {
          ...item,
          score,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score
      );

  /**
   * Rank numeric metric columns by:
   *
   * 1. How completely the REAL column contains the requested
   *    metric words.
   * 2. Existing semantic score.
   * 3. Fewer unrelated/extra column words.
   * 4. Shorter column name as a final deterministic tie-breaker.
   *
   * This is generic and prevents a loosely similar numeric field
   * from beating a field that actually contains the user's words.
   */
  const metricTargetTokens =
    normalizeTarget(
      metricTarget
    )
      .split(/\s+/)
      .filter(Boolean);

  const metricCandidates =
    rankColumns(
      metricTarget,
      schema,
      datasetName
    )
      .filter(
        (item) =>
          isNumericLikeSchemaColumn(
            item
          )
      )
      .map(
        (item) => {
          const columnTokens =
            normalizeTarget(
              item.name
            )
              .split(/\s+/)
              .filter(Boolean);

          const matchedTargetTokens =
            metricTargetTokens.filter(
              (token) =>
                columnTokens.includes(
                  token
                )
            ).length;

          const targetCoverage =
            metricTargetTokens.length
              ? matchedTargetTokens /
                metricTargetTokens.length
              : 0;

          const extraTokens =
            Math.max(
              0,
              columnTokens.length -
              matchedTargetTokens
            );

          return {
            ...item,
            targetCoverage,
            extraTokens,
          };
        }
      )
      .sort(
        (a, b) =>
          b.targetCoverage -
            a.targetCoverage ||
          b.score -
            a.score ||
          a.extraTokens -
            b.extraTokens ||
          String(a.name).length -
            String(b.name).length
      );

  const labelColumn =
    labelCandidates[0]?.score >=
    0.55
      ? labelCandidates[0]
      : null;

  const metricColumn =
    metricCandidates[0] &&
    metricCandidates[0].score >=
      0.55 &&
    (
      metricTargetTokens.length === 0 ||
      metricCandidates[0]
        .targetCoverage > 0
    )
      ? metricCandidates[0]
      : null;

  if (
    !labelColumn ||
    !metricColumn
  ) {
    return null;
  }

  return {
    labelColumn:
      labelColumn.name,

    metricColumn:
      metricColumn.name,

    direction,
    limit,
    aggregation,
  };
}


function extractCrossDatasetLookupParts(question) {
  const text = normalizeText(question);

  const match = text.match(
    /^(?:what|which|who|show|give|tell me|get|find|lookup)?\s*(?:is|are|was|were)?\s*(?:the\s+)?(.+?)\s+(?:of|for|by|from)\s+(.+?)\??$/
  );

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return {
    requestedField: normalizeTarget(match[1]),
    identifierText: normalizeText(match[2]),
  };
}

function detectCrossDatasetLookup(question, schema, datasets) {
  if (!datasets || Object.keys(datasets).length < 2) {
    return null;
  }

  const parts = extractCrossDatasetLookupParts(question);

  if (!parts?.requestedField || !parts?.identifierText) {
    return null;
  }

  const outputCandidates = findDatasetsContainingColumn(
    datasets,
    parts.requestedField
  );

  if (!outputCandidates.length) {
    return null;
  }

  const identifierMatches = inferDatasetValueFilters(
    datasets,
    parts.identifierText
  );

  if (!identifierMatches.length) {
    return null;
  }

  for (const output of outputCandidates) {
    const identifier =
      identifierMatches.find(
        (item) => item.dataset !== output.dataset
      ) ||
      identifierMatches.find(
        (item) => item.dataset === output.dataset
      );

    if (!identifier) {
      continue;
    }

    if (identifier.dataset === output.dataset) {
      const identifierFilters =
        getDatasetIdentifierFilters(
          identifierMatches,
          output.dataset
        );

      return {
        route: "dataset",
        dataset: output.dataset,
        operation: "lookup",
        column: output.column,
        groupBy: null,
        filters:
          identifierFilters.length
            ? identifierFilters
            : [
                {
                  column:
                    identifier.column,
                  operator:
                    identifier.operator ||
                    "equals",
                  value:
                    identifier.value,
                },
              ],
        selectColumns: [output.column],
        transform: null,
        outputRequested: true,
        limit: detectLimit(question),
        showAll: detectShowAll(question),
        confidence: 0.99,
      };
    }

    return {
      route: "dataset",
      dataset: output.dataset,
      operation: "lookup",
      column: output.column,
      groupBy: null,
      filters: [],
      selectColumns: [output.column],
      transform: null,
      outputRequested: true,

      // calculationEngine uses this to locate the identifier in another
      // worksheet and bridge the worksheets through a shared live column.
      crossDatasetFilter: {
        sourceDataset: identifier.dataset,
        sourceColumn: identifier.column,
        operator: identifier.operator || "equals",
        value: identifier.value,
      },

      limit: detectLimit(question),
      showAll: detectShowAll(question),
      confidence: 0.99,
    };
  }

  return null;
}





function detectGroupedListRequest(
  question,
  schema
) {
  const text = normalizeText(question);

  /*
   * Generic grouped-list requests:
   *
   * - "province and its municipalities"
   * - "province with municipalities"
   * - "list municipalities by province"
   * - "show crops under each municipality"
   *
   * Existing lookup/count logic is untouched.
   */

  const patterns = [
    /^(.+?)\s+and\s+(?:its|their)\s+(.+?)\??$/,
    /^(.+?)\s+with\s+(.+?)\??$/,
    /^(?:list|show|give|display)?\s*(.+?)\s+(?:by|per|under each|for each)\s+(.+?)\??$/,
  ];

  let parentTarget = null;
  let childTarget = null;

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    if (
      /\b(by|per|under each|for each)\b/.test(
        match[0]
      )
    ) {
      childTarget = normalizeTarget(match[1]);
      parentTarget = normalizeTarget(match[2]);
    } else {
      parentTarget = normalizeTarget(match[1]);
      childTarget = normalizeTarget(match[2]);
    }

    break;
  }

  if (!parentTarget || !childTarget) {
    return null;
  }

  const allColumns = getAllColumns(schema);

  const parentCandidates = allColumns
    .map((item) => ({
      ...item,
      score: scoreColumnTarget(
        parentTarget,
        item.name
      ),
    }))
    .filter(
      (item) =>
        item.type !== "number"
    )
    .sort(
      (a, b) =>
        b.score - a.score
    );

  const childCandidates = allColumns
    .map((item) => ({
      ...item,
      score: scoreColumnTarget(
        childTarget,
        item.name
      ),
    }))
    .filter(
      (item) =>
        item.type !== "number"
    )
    .sort(
      (a, b) =>
        b.score - a.score
    );

  /*
   * Safe rule:
   * only create a grouped-list plan when both columns are found
   * in the same worksheet. This avoids interfering with the
   * existing cross-dataset fixes.
   */
  for (const parent of parentCandidates) {
    if (parent.score < 0.75) {
      continue;
    }

    const child = childCandidates.find(
      (item) =>
        item.dataset === parent.dataset &&
        item.score >= 0.75 &&
        item.name !== parent.name
    );

    if (!child) {
      continue;
    }

    return {
      route: "dataset",
      dataset: parent.dataset,
      operation: "group_list",
      column: child.name,
      groupBy: parent.name,
      filters: [],
      selectColumns: [
        parent.name,
        child.name,
      ],
      transform: null,
      outputRequested: true,
      limit: detectLimit(question),
      showAll: true,
      confidence: 0.999,
    };
  }

  return null;
}


function detectFilteredFieldLookup(
  question,
  schema,
  datasets
) {
  const text = normalizeText(question);

  /*
   * Handles direct field + filter requests generically.
   *
   * Examples:
   * - "commodities under registration number CN201708932"
   * - "municipality with registration number CN201708932"
   * - "planting month of farm id 1001"
   *
   * No worksheet names or column names are hardcoded.
   */
  const match = text.match(
    /^(?:what|which|who|show|give|tell me|get|find|lookup|list)?\s*(?:is|are|was|were)?\s*(?:the\s+)?(.+?)\s+(?:under|in|at|within|inside|using|with|for|of|from|by)\s+(.+?)\??$/
  );

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  const requestedText =
    normalizeTarget(match[1]);

  const identifierText =
    normalizeText(match[2]);

  if (!requestedText || !identifierText) {
    return null;
  }

  const outputCandidates =
    findDatasetsContainingColumn(
      datasets,
      requestedText
    );

  if (!outputCandidates.length) {
    return null;
  }

  const identifierMatches =
    inferDatasetValueFilters(
      datasets,
      identifierText
    );

  if (!identifierMatches.length) {
    return null;
  }

  for (const output of outputCandidates) {
    /*
     * Prefer the worksheet that already contains both:
     * - the requested output column
     * - the identifying value/filter
     */
    const sameDatasetIdentifiers =
      getDatasetIdentifierFilters(
        identifierMatches,
        output.dataset
      );

    const sameDatasetIdentifier =
      identifierMatches.find(
        (item) =>
          item.dataset ===
          output.dataset
      );

    if (
      sameDatasetIdentifiers.length ||
      sameDatasetIdentifier
    ) {
      const asksForList =
        /*
         * Generic list intent:
         *
         * "what are the crops in X"
         * "which farmers are in X"
         * "list products under X"
         * "show all municipalities within X"
         *
         * No column names are hardcoded.
         */
        /\b(list|all|every|enumerate)\b/.test(text) ||
        /^(?:what|which)\s+are\b/.test(text) ||
        /\bunder\b/.test(text);

      const coherentFilters =
        inferCoherentFilters(
          datasets[
            output.dataset
          ] || [],
          identifierText
        );

      return {
        route: "dataset",
        dataset: output.dataset,
        operation:
          asksForList
            ? "list"
            : "lookup",
        column: output.column,
        groupBy: null,
        filters:
          coherentFilters.length
            ? coherentFilters
            : (
                sameDatasetIdentifiers.length
                  ? sameDatasetIdentifiers
                  : [
                      {
                        column:
                          sameDatasetIdentifier.column,
                        operator:
                          sameDatasetIdentifier.operator ||
                          "equals",
                        value:
                          sameDatasetIdentifier.value,
                      },
                    ]
              ),
        selectColumns:
          asksForList
            ? []
            : [output.column],
        transform: null,
        outputRequested: true,
        limit: detectLimit(question),
        showAll: true,
        confidence: 1,
      };
    }

    /*
     * If the requested field and identifier are in different worksheets,
     * create a cross-dataset lookup plan.
     */
    const crossIdentifier =
      identifierMatches[0];

    if (crossIdentifier) {
      return {
        route: "dataset",
        dataset: output.dataset,
        operation: "lookup",
        column: output.column,
        groupBy: null,
        filters: [],
        selectColumns: [
          output.column,
        ],
        transform: null,
        outputRequested: true,
        crossDatasetFilter: {
          sourceDataset:
            crossIdentifier.dataset,
          sourceColumn:
            crossIdentifier.column,
          operator:
            crossIdentifier.operator ||
            "equals",
          value:
            crossIdentifier.value,
        },
        limit: detectLimit(question),
        showAll: true,
        confidence: 1,
      };
    }
  }

  return null;
}



function detectFilterFirstTextCount(
  question,
  schema,
  datasets
) {
  const text = normalizeText(question);

  /*
   * Generic filter-first text count requests:
   *
   * - "count of Madupayas commodities"
   * - "count Madupayas commodities"
   * - "number of Solsona farmers"
   * - "how many Madupayas commodities"
   *
   * The function:
   * 1. Finds a real value mentioned in the question.
   * 2. Removes that value from the remaining text.
   * 3. Matches the remaining words to a live text column.
   * 4. Counts only populated values connected to that filter.
   *
   * No column names or dataset names are hardcoded.
   */

  const match = text.match(
    /^(?:count(?:\s+of)?|number\s+of|how\s+many)\s+(.+?)\??$/
  );

  if (!match?.[1]) {
    return null;
  }

  const remainder =
    normalizeText(match[1]);

  const valueMatches =
    inferDatasetValueFilters(
      datasets,
      remainder
    );

  if (!valueMatches.length) {
    return null;
  }

  for (const valueMatch of valueMatches) {
    const normalizedValue =
      normalizeText(
        valueMatch.value
      );

    let requestedText =
      remainder;

    if (normalizedValue) {
      requestedText =
        requestedText.replace(
          normalizedValue,
          " "
        );
    }

    requestedText =
      normalizeTarget(
        requestedText
      );

    if (!requestedText) {
      continue;
    }

    const outputCandidates =
      getAllColumns(schema)
        .map((item) => ({
          ...item,
          score:
            scoreColumnTarget(
              requestedText,
              item.name
            ),
        }))
        .filter(
          (item) =>
            item.score >= 0.75 &&
            item.type !== "number"
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    if (!outputCandidates.length) {
      continue;
    }

    const operation =
      /\b(unique|distinct|different)\b/.test(text)
        ? "distinct_count"
        : "non_empty_count";

    /*
     * Prefer a worksheet containing both:
     * - the filter value
     * - the requested output column
     */
    const sameDatasetOutput =
      outputCandidates.find(
        (item) =>
          item.dataset ===
          valueMatch.dataset
      );

    if (sameDatasetOutput) {
      return {
        route: "dataset",
        dataset:
          sameDatasetOutput.dataset,
        operation,
        column:
          sameDatasetOutput.name,
        groupBy: null,
        filters: [
          {
            column:
              valueMatch.column,
            operator:
              valueMatch.operator ||
              "equals",
            value:
              valueMatch.value,
          },
        ],
        selectColumns: [],
        transform: null,
        outputRequested: false,
        limit:
          detectLimit(question),
        showAll: false,
        confidence: 1,
      };
    }

    /*
     * Preserve existing cross-dataset count support.
     */
    const output =
      outputCandidates[0];

    return {
      route: "dataset",
      dataset:
        output.dataset,
      operation,
      column:
        output.name,
      groupBy: null,
      filters: [],
      selectColumns: [],
      transform: null,
      outputRequested: false,
      crossDatasetFilter: {
        sourceDataset:
          valueMatch.dataset,
        sourceColumn:
          valueMatch.column,
        operator:
          valueMatch.operator ||
          "equals",
        value:
          valueMatch.value,
      },
      limit:
        detectLimit(question),
      showAll: false,
      confidence: 1,
    };
  }

  return null;
}


function detectTextCountWithFilter(
  question,
  schema,
  datasets
) {
  const text = normalizeText(question);

  const match = text.match(
    /\b(?:how many|number of|count of)\s+(?:the\s+)?(.+?)\s+(?:in|at|from|for|within)\s+(.+)$/
  );

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  const requestedTarget =
    normalizeTarget(match[1]);

  const filterText =
    normalizeText(match[2]);

  const outputCandidates =
    getAllColumns(schema)
      .map((item) => ({
        ...item,
        score:
          scoreColumnTarget(
            requestedTarget,
            item.name
          ),
      }))
      .filter(
        (item) =>
          item.score >= 0.75 &&
          item.type !== "number"
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  if (!outputCandidates.length) {
    return null;
  }

  const valueMatches =
    inferDatasetValueFilters(
      datasets,
      filterText
    );

  if (!valueMatches.length) {
    return null;
  }

  const operation =
    /\b(unique|distinct|different)\b/.test(text)
      ? "distinct_count"
      : "non_empty_count";

  for (const output of outputCandidates) {
    const sameDatasetFilter =
      valueMatches.find(
        (item) =>
          item.dataset ===
          output.dataset
      );

    if (sameDatasetFilter) {
      return {
        route: "dataset",
        dataset: output.dataset,
        operation,
        column: output.name,
        groupBy: null,
        filters: [
          {
            column:
              sameDatasetFilter.column,
            operator:
              sameDatasetFilter.operator ||
              "equals",
            value:
              sameDatasetFilter.value,
          },
        ],
        selectColumns: [],
        transform: null,
        outputRequested: false,
        limit: detectLimit(question),
        showAll: detectShowAll(question),
        confidence: 0.999,
      };
    }

    const crossDatasetFilter =
      valueMatches.find(
        (item) =>
          item.dataset !==
          output.dataset
      );

    if (crossDatasetFilter) {
      return {
        route: "dataset",
        dataset: output.dataset,
        operation,
        column: output.name,
        groupBy: null,
        filters: [],
        selectColumns: [],
        transform: null,
        outputRequested: false,

        // Filter value is in another worksheet.
        crossDatasetFilter: {
          sourceDataset:
            crossDatasetFilter.dataset,
          sourceColumn:
            crossDatasetFilter.column,
          operator:
            crossDatasetFilter.operator ||
            "equals",
          value:
            crossDatasetFilter.value,
        },

        limit: detectLimit(question),
        showAll: detectShowAll(question),
        confidence: 0.999,
      };
    }
  }

  return null;
}



function splitExplicitEntitySegments(
  question
) {
  const text =
    normalizeText(question);

  if (!text) {
    return [];
  }

  const tailMatch =
    text.match(
      /\b(?:of|for)\b\s+(.+)$/
    );

  if (!tailMatch?.[1]) {
    return [];
  }

  const entityText =
    tailMatch[1]
      .replace(/[?.!]+$/g, "")
      .trim();

  const segments =
    entityText
      .split(
        /\s+(?:and|vs\.?|versus)\s+/i
      )
      .map(
        (part) =>
          part.trim()
      )
      .filter(Boolean);

  return segments.length >= 2
    ? segments
    : [];
}

function detectMultiEntityLookup(
  question,
  schema,
  datasets
) {
  const segments =
    splitExplicitEntitySegments(
      question
    );

  if (segments.length < 2) {
    return null;
  }

  const candidates = [];

  for (
    const [
      datasetName,
      rows,
    ] of Object.entries(
      datasets || {}
    )
  ) {
    if (
      !Array.isArray(rows) ||
      !rows.length
    ) {
      continue;
    }

    const groups =
      segments.map(
        (segment) =>
          inferCoherentFilters(
            rows,
            segment
          )
      );

    if (
      groups.some(
        (filters) =>
          !filters.length
      )
    ) {
      continue;
    }

    const excludedColumns =
      [...new Set(
        groups
          .flat()
          .map(
            (filter) =>
              filter.column
          )
      )];

    const output =
      detectRequestedOutputColumns(
        question,
        schema,
        datasetName,
        excludedColumns
      );

    const selectColumns =
      Array.isArray(
        output?.selectColumns
      )
        ? output.selectColumns
        : [];

    if (!selectColumns.length) {
      continue;
    }

    candidates.push({
      dataset:
        datasetName,
      groups,
      selectColumns,
      transform:
        output?.transform ||
        null,
      score:
        groups.reduce(
          (sum, filters) =>
            sum + filters.length,
          0
        ) * 1000 +
        selectColumns.length,
    });
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const best =
    candidates[0];

  return {
    route:
      "dataset",

    dataset:
      best.dataset,

    operation:
      "lookup",

    column:
      best.selectColumns.length === 1
        ? best.selectColumns[0]
        : null,

    groupBy:
      null,

    filters:
      [],

    filterGroups:
      best.groups.map(
        (filters) => ({
          logic:
            "and",
          filters,
        })
      ),

    filterGroupLogic:
      "or",

    selectColumns:
      best.selectColumns,

    transform:
      best.transform,

    outputRequested:
      true,

    limit:
      detectLimit(question),

    showAll:
      true,

    confidence:
      0.999,
  };
}


function detectMultiFieldLookup(question, schema, datasets) {
  const text = normalizeText(question);

  /*
   * Deterministic multi-field lookup.
   *
   * Examples:
   * - "municipality with registration number CN201708932 and commodities"
   * - "name of farmer with farm id 1001 and planting month"
   *
   * RULE:
   * Return ONLY columns explicitly requested by the user.
   * The identifying column/value is used only as the filter.
   */

  const identifierMatches =
    inferDatasetValueFilters(
      datasets,
      text
    );

  if (!identifierMatches.length) {
    return null;
  }

  const identifier =
    identifierMatches[0];

  const questionTokens = new Set(
    normalizeTarget(text)
      .split(/\s+/)
      .filter(Boolean)
  );

  const identifierColumnTokens =
    new Set(
      normalizeTarget(
        identifier.column
      )
        .split(/\s+/)
        .filter(Boolean)
    );

  const selectColumns = [];
  const seen = new Set();

  for (const item of getAllColumns(schema)) {
    const columnTokens =
      normalizeTarget(
        item.name
      )
        .split(/\s+/)
        .filter(Boolean);

    if (!columnTokens.length) {
      continue;
    }

    const normalizedColumnName =
      normalizeText(item.name);

    const normalizedIdentifierColumn =
      normalizeText(
        identifier.column
      );

    /*
     * Never return the field being used only as the identifier/filter.
     * Example: Registration Number should not be returned merely because
     * the user said "with registration number CN201708932".
     */
    if (
      normalizedColumnName ===
      normalizedIdentifierColumn
    ) {
      continue;
    }

    /*
     * A requested output column is selected only when ALL meaningful
     * column tokens are explicitly present in the user's question.
     *
     * Examples:
     * "Farmer Name" -> farmer + name must both be present
     * "Planting Month" -> planting + month must both be present
     * "Municipality" -> municipality must be present
     * "Commodities" -> commodity token matches commodities after singularize
     *
     * This prevents unrelated fields like:
     * - IP
     * - Date of Registration
     * - Registration Number
     */
    const explicitlyRequested =
      columnTokens.every(
        (token) =>
          questionTokens.has(token)
      );

    if (!explicitlyRequested) {
      continue;
    }

    const key =
      normalizedColumnName;

    if (!seen.has(key)) {
      seen.add(key);
      selectColumns.push(
        item.name
      );
    }
  }

  /*
   * This helper is specifically for requests containing two or more
   * requested outputs. Single-field questions continue through the
   * normal cross-dataset lookup.
   */
  if (selectColumns.length < 2) {
    return null;
  }

  return {
    route: "dataset",

    /*
     * Start from the worksheet that contains the identifying value.
     * calculationEngine.js can merge requested fields from other
     * worksheets through its dynamic shared-column lookup.
     */
    dataset:
      identifier.dataset,

    operation:
      "lookup",

    column:
      null,

    groupBy:
      null,

    filters:
      (
        inferCoherentFilters(
          datasets[
            identifier.dataset
          ] || [],
          text
        ).length
          ? inferCoherentFilters(
              datasets[
                identifier.dataset
              ] || [],
              text
            )
          : [
              {
                column:
                  identifier.column,

                operator:
                  identifier.operator ||
                  "equals",

                value:
                  identifier.value,
              },
            ]
      ),

    selectColumns,

    transform:
      null,

    outputRequested:
      true,

    limit:
      detectLimit(question),

    showAll:
      detectShowAll(question),

    confidence:
      0.999,
  };
}

function createLocalPlan({
  question,
  schema,
  datasets = {},
}) {
  const schemaPlan =
    detectSchemaPlan(question, schema);

  if (schemaPlan) {
    return schemaPlan;
  }

  const generalPlan =
    detectGeneralPlan(question);

  if (generalPlan) {
    return generalPlan;
  }

  // Resolve filter-first text counts first.
  // Example: "Count of Madupayas commodities"
  const filterFirstTextCount =
    detectFilterFirstTextCount(
      question,
      schema,
      datasets
    );

  if (filterFirstTextCount) {
    return filterFirstTextCount;
  }

  // Resolve grouped parent-child lists first.
  // Example: "province and its municipalities"
  const groupedListRequest =
    detectGroupedListRequest(
      question,
      schema
    );

  if (groupedListRequest) {
    return groupedListRequest;
  }

  // Resolve explicit multi-entity lookups before ordinary
  // multi-field/single-entity lookup logic.
  const multiEntityLookup =
    detectMultiEntityLookup(
      question,
      schema,
      datasets
    );

  if (multiEntityLookup) {
    return multiEntityLookup;
  }

  // Resolve TRUE multi-field lookups BEFORE any single-field lookup.
  //
  // This is important for questions such as:
  // "what is the District, Municipality, and Barangay of 64882"
  //
  // If single-field lookup runs first, it can incorrectly stop after
  // finding only the first matching field (for example "District").
  const multiFieldLookup =
    detectMultiFieldLookup(
      question,
      schema,
      datasets
    );

  if (multiFieldLookup) {
    return multiFieldLookup;
  }

  // Resolve direct SINGLE-field + filter requests after multi-field.
  // Example: "commodities under registration number CN201708932"
  const filteredFieldLookup =
    detectFilteredFieldLookup(
      question,
      schema,
      datasets
    );

  if (filteredFieldLookup) {
    return filteredFieldLookup;
  }

  // Resolve filtered text counts.
  // Example: "How many commodities in Madupayas?"
  const textCountWithFilter =
    detectTextCountWithFilter(
      question,
      schema,
      datasets
    );

  if (textCountWithFilter) {
    return textCountWithFilter;
  }

  // Resolve exact cross-worksheet lookups BEFORE choosing one worksheet.
  // Example: "fertilizer used by Maria Santos" where the name is in one
  // sheet and Fertilizer Used is in another.
  const crossDatasetLookup =
    detectCrossDatasetLookup(
      question,
      schema,
      datasets
    );

  if (crossDatasetLookup) {
    return crossDatasetLookup;
  }

  const datasetRanking =
    rankDatasets(question, schema);
  const bestDataset = datasetRanking[0];

  let datasetName = null;

  if (schema.length === 1) {
    datasetName = schema[0].name;
  } else if (bestDataset?.score >= 0.25) {
    datasetName = bestDataset.dataset;
  }

  const currentRows =
    Array.isArray(datasets?.[datasetName])
      ? datasets[datasetName]
      : [];

  const rankingRequest = extractRankingRequest(
    question,
    schema,
    datasetName
  );

  if (rankingRequest) {
    const schemaFilters = findExplicitFilters(
      question,
      schema,
      datasetName,
      [
        rankingRequest.labelColumn,
        rankingRequest.metricColumn,
      ]
    );

    const liveFilters = currentRows.length
      ? inferValueFilters(
          currentRows,
          question,
          [
            rankingRequest.labelColumn,
            rankingRequest.metricColumn,
          ]
        )
      : [];

    return {
      route: "dataset",
      dataset: datasetName,
      operation: rankingRequest.aggregation
        ? "rank_groups"
        : "rank_rows",
      column: rankingRequest.metricColumn,
      labelColumn: rankingRequest.labelColumn,
      groupBy: rankingRequest.labelColumn,
      aggregation: rankingRequest.aggregation,
      direction: rankingRequest.direction,
      filters: mergeFilters(
        schemaFilters,
        liveFilters
      ),
      selectColumns: [
        rankingRequest.labelColumn,
        rankingRequest.metricColumn,
      ],
      limit: rankingRequest.limit,
      confidence: 0.95,
    };
  }

  if (!datasetName) {
    return {
      route: "clarify",
      question:
        "Which worksheet should I use? Available worksheets: " +
        schema
          .map((item) => item.name)
          .join(", "),
      confidence: 0.2,
    };
  }

  const target =
    extractTargetPhrase(question);
  const columnRanking = rankColumns(
    target,
    schema,
    datasetName
  );

  const selectedColumn =
    columnRanking[0]?.score >= 0.75
      ? columnRanking[0]
      : null;

  const operation = detectOperation(
    question,
    selectedColumn
  );

  if (!operation) {
    const schemaFilters = findExplicitFilters(
      question,
      schema,
      datasetName,
      []
    );

    const liveFilters = currentRows.length
      ? inferValueFilters(
          currentRows,
          question,
          []
        )
      : [];

    const filters = mergeFilters(
      schemaFilters,
      liveFilters
    );

    const output =
      detectRequestedOutputColumns(
        question,
        schema,
        datasetName,
        filters.map(
          (filter) => filter.column
        )
      );

    // If the question identifies a real current-row value, it is a
    // dataset lookup even when the value was added after startup.
    if (filters.length) {
      return {
        route: "dataset",
        dataset: datasetName,
        operation: "lookup",
        column: null,
        groupBy: null,
        filters,
        selectColumns:
          output.selectColumns,
        transform: output.transform,
        outputRequested: output.outputRequested,
        limit: detectLimit(question),
        showAll: detectShowAll(question),
        confidence: 0.9,
      };
    }

    return {
      route: "general",
      confidence: 0.4,
    };
  }

  const groupingColumn =
    operation.startsWith("group_") ||
    ["minimum", "maximum"].includes(
      operation
    )
      ? findGroupingColumn(
          question,
          schema,
          datasetName,
          selectedColumn
        )
      : null;

  const schemaFilters = findExplicitFilters(
    question,
    schema,
    datasetName,
    [
      selectedColumn?.name,
      groupingColumn?.name,
    ]
  );

  const liveFilters = currentRows.length
    ? inferValueFilters(
        currentRows,
        question,
        [
          selectedColumn?.name,
          groupingColumn?.name,
        ]
      )
    : [];

  const filters = mergeFilters(
    schemaFilters,
    liveFilters
  );

  if (
    !selectedColumn &&
    ![
      "row_count",
      "group_count",
      "lookup",
    ].includes(operation)
  ) {
    return {
      route: "clarify",
      question:
        `Which column should I use from ${datasetName}?`,
      confidence: 0.25,
    };
  }

  if (
    operation.startsWith("group_") &&
    !groupingColumn
  ) {
    return {
      route: "clarify",
      question:
        `Which column should I group by in ${datasetName}?`,
      confidence: 0.25,
    };
  }

  const output =
    operation === "lookup"
      ? detectRequestedOutputColumns(
          question,
          schema,
          datasetName,
          filters.map(
            (filter) => filter.column
          )
        )
      : {
          selectColumns: [],
          transform: null,
        };

  return {
    route: "dataset",
    dataset: datasetName,
    operation,
    column:
      selectedColumn?.name || null,
    groupBy:
      groupingColumn?.name || null,
    filters,
    selectColumns:
      output.selectColumns,
    transform: output.transform,
    outputRequested: output.outputRequested,
    limit: detectLimit(question),
    showAll: detectShowAll(question),
    confidence: Math.min(
      1,
      0.65 +
        (selectedColumn?.score || 0) *
          0.2 +
        (bestDataset?.score || 0) *
          0.1
    ),
  };
}

async function createPlan({
  question,
  schema,
  datasets = {},
}) {
  return createLocalPlan({
    question,
    schema,
    datasets,
  });
}

module.exports = {
  createPlan,
  createLocalPlan,
  extractTargetPhrase,
  extractGroupingPhrase,
  detectCrossDatasetLookup,
  detectMultiEntityLookup,
  detectMultiFieldLookup,
  detectTextCountWithFilter,
  detectFilteredFieldLookup,
  detectGroupedListRequest,
  detectFilterFirstTextCount
};
