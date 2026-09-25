const {
  normalizeText,
  parseNumber,
  singularizeToken,
} = require("./utils");

const {
  inferValueFilters,
} = require("./filterEngine");

function isUnitLikeColumnName(columnName) {
  return /\b(?:unit|uom|unit of measurement|unit of measure|measurement unit)\b/i.test(
    String(columnName || "")
  );
}

function isIdentifierLikeNumericColumn(columnName) {
  const name = normalizeText(columnName);
  if (!name) return false;

  return (
    /\b(?:contact|phone|mobile|telephone|tel|gatepass|reference|ref|id|identifier|code|account|serial|tracking|invoice|receipt|birthdate|date|year)\b/.test(name) ||
    (
      /\b(?:number|no)\b/.test(name) &&
      !/\b(?:quantity|qty|amount|volume|weight|area|value|cost|price|total|member|members|male|female|population|count|beneficiar|farmer|employee|person|people)\b/.test(name)
    )
  );
}

function measureNameScore(columnName) {
  const name = normalizeText(columnName);
  if (!name) return 0;

  if (/\b(?:quantity|qty)\b/.test(name)) return 1;
  if (/\b(?:amount|volume|weight|area|value|cost|price|total)\b/.test(name)) {
    return 0.82;
  }

  return 0;
}

function findBestAdditiveMeasureColumn(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const sample =
    rows.find(
      (row) =>
        row &&
        typeof row === "object"
    ) || {};

  const candidates = [];

  for (const column of Object.keys(sample)) {
    if (isIdentifierLikeNumericColumn(column)) continue;

    const nameScore =
      measureNameScore(column);

    if (nameScore <= 0) continue;

    const values =
      rows
        .map((row) => row?.[column])
        .filter(
          (value) =>
            value !== null &&
            value !== undefined &&
            String(value).trim() !== ""
        );

    if (!values.length) continue;

    const numericCount =
      values.filter(
        (value) =>
          parseNumber(value) !== null
      ).length;

    const numericRatio =
      numericCount / values.length;

    if (numericRatio < 0.7) continue;

    candidates.push({
      column,
      score:
        nameScore * 0.82 +
        numericRatio * 0.18,
    });
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  return candidates[0]?.column || null;
}

function extractObjectPhrase(question) {
  const text = normalizeText(question);
  if (!text) return null;

  const match =
    text.match(
      /\b(?:how many|how much)\b\s+.+?\s+\bof\b\s+(.+?)(?=\s+\b(?:was|were|is|are|has|have|had|been|being|distributed|released|provided|given|issued|allocated|delivered|received|supplied)\b|$)/
    );

  if (!match?.[1]) return null;

  return match[1]
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findExplicitUnitFilter(rows, question, columns) {
  const q = normalizeText(question);

  for (const column of columns) {
    if (!isUnitLikeColumnName(column)) continue;

    const values =
      [...new Set(
        rows
          .map(
            (row) =>
              String(
                row?.[column] ?? ""
              ).trim()
          )
          .filter(Boolean)
      )]
        .sort(
          (a, b) =>
            String(b).length -
            String(a).length
        );

    for (const value of values) {
      const normalizedValue =
        normalizeText(value);

      if (
        normalizedValue &&
        q.includes(normalizedValue)
      ) {
        return {
          column,
          operator: "equals",
          value,
        };
      }
    }
  }

  return null;
}

function findObjectContainsFilter({
  rows,
  columns,
  objectPhrase,
  excludeColumns = [],
}) {
  const phrase =
    normalizeText(objectPhrase);

  if (!phrase) return null;

  const excluded =
    new Set(
      excludeColumns.map(
        (column) =>
          normalizeText(column)
      )
    );

  const candidates = [];

  for (const column of columns) {
    if (
      excluded.has(
        normalizeText(column)
      ) ||
      isUnitLikeColumnName(column) ||
      isIdentifierLikeNumericColumn(column)
    ) {
      continue;
    }

    const values =
      rows
        .map(
          (row) =>
            row?.[column]
        )
        .filter(
          (value) =>
            value !== null &&
            value !== undefined &&
            String(value).trim() !== ""
        );

    if (!values.length) continue;

    const numericRatio =
      values.filter(
        (value) =>
          parseNumber(value) !== null
      ).length /
      values.length;

    if (numericRatio >= 0.7) continue;

    const matchCount =
      values.filter(
        (value) =>
          normalizeText(value).includes(
            phrase
          )
      ).length;

    if (!matchCount) continue;

    candidates.push({
      column,
      matchCount,
      matchRate:
        matchCount /
        values.length,
    });
  }

  candidates.sort(
    (a, b) =>
      b.matchCount -
        a.matchCount ||
      b.matchRate -
        a.matchRate
  );

  if (!candidates.length) {
    return null;
  }

  return {
    column:
      candidates[0].column,
    operator:
      "contains",
    value:
      objectPhrase,
  };
}


// ---------------------------------------------------------------------------
// GENERAL LOCAL MATHEMATICAL PLANNER
// ---------------------------------------------------------------------------
// Schema-driven resolver for ordinary math questions when Groq is unavailable.

const MATH_OPERATION_WORDS = {
  sum: ["sum", "total", "combined", "altogether"],
  average: ["average", "avg", "mean"],
  median: ["median"],
  maximum: ["maximum", "max", "highest", "largest", "greatest", "biggest"],
  minimum: ["minimum", "min", "lowest", "smallest", "least"],
  row_count: ["count"],
};

const MATH_STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","has","have","how",
  "in","is","it","me","of","on","or","per","please","the","their","them",
  "these","they","this","those","to","what","which","who","with","all","each",
  "every","number","no","value","values","record","records","row","rows",
  "entry","entries","association","associations","group","groups",
]);

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);

  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const old = previous[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;

      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + cost
      );

      diagonal = old;
    }
  }

  return previous[right.length];
}

function fuzzyWordSimilarity(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);

  if (!left || !right) return 0;
  if (left === right) return 1;

  const maxLen = Math.max(left.length, right.length);
  const editScore = maxLen
    ? 1 - levenshteinDistance(left, right) / maxLen
    : 0;

  // Generic morphology bridge for related inflections/noun forms that share
  // a substantial lexical stem (for example register/registered/registration).
  // Requiring a six-character alphabetic prefix keeps this conservative and
  // avoids turning short coincidental prefixes into semantic matches.
  let prefixLength = 0;
  const limit = Math.min(left.length, right.length);
  while (prefixLength < limit && left[prefixLength] === right[prefixLength]) {
    prefixLength += 1;
  }

  const stemScore =
    prefixLength >= 6 && /^[a-z]+$/.test(left) && /^[a-z]+$/.test(right)
      ? Math.min(0.96, 0.86 + (prefixLength - 6) * 0.02)
      : 0;

  return Math.max(editScore, stemScore);
}

function tokenizeMathText(value) {
  return normalizeText(value)
    // Treat common schema separators as token boundaries for semantic
    // matching. This lets machine-friendly headers such as
    // "registry_registration_count" participate in the same local fallback
    // logic as human-readable headers without changing the stored schema.
    .replace(/[._/()+-]+/g, " ")
    .split(/\s+/)
    .map((token) => singularizeToken(token))
    .filter(Boolean);
}

function detectLocalMathOperation(question) {
  const text = normalizeText(question);
  const tokens = tokenizeMathText(question);

  if (!text) return null;

  // "average number of members" is an average, not a count. Resolve
  // explicit aggregate words first, then fall back to count cues.
  let best = null;

  for (const [operation, words] of Object.entries(MATH_OPERATION_WORDS)) {
    if (operation === "row_count") continue;

    for (const word of words) {
      for (const token of tokens) {
        const score = fuzzyWordSimilarity(token, word);
        const threshold = word.length <= 3 ? 0.99 : 0.72;

        if (score < threshold) continue;

        if (!best || score > best.confidence) {
          best = {
            operation,
            confidence: score,
            matched: token,
            canonical: word,
          };
        }
      }
    }
  }

  if (best) return best;

  if (/\b(?:how many|number of|count of|count)\b/.test(text)) {
    return {
      operation: "row_count",
      confidence: 1,
      matched: "count",
      canonical: "count",
    };
  }

  return null;
}

function getSchemaColumnNames(datasetSchema) {
  return (datasetSchema?.columns || [])
    .map((column) =>
      typeof column === "string"
        ? column
        : column?.name
    )
    .filter(Boolean);
}

function isStrictNumericValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, "");

  if (!text) return false;

  return /^[₱$€£]?[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(text);
}

function numericRatio(rows, column) {
  const values = (rows || [])
    .map((row) => row?.[column])
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
    );

  if (!values.length) return 0;

  return (
    values.filter(
      (value) =>
        isStrictNumericValue(value) &&
        parseNumber(value) !== null
    ).length / values.length
  );
}

function isNumericMeasure(rows, column) {
  return (
    !isIdentifierLikeNumericColumn(column) &&
    numericRatio(rows, column) >= 0.65
  );
}

function normalizedMetricTokens(value) {
  return tokenizeMathText(value).filter((token) => {
    if (MATH_STOP_WORDS.has(token)) return false;

    for (const words of Object.values(MATH_OPERATION_WORDS)) {
      if (
        words.some(
          (word) =>
            fuzzyWordSimilarity(token, word) >= 0.86
        )
      ) {
        return false;
      }
    }

    return true;
  });
}

function scoreColumnPhrase(columnName, phrase) {
  const columnTokens = normalizedMetricTokens(columnName);
  const phraseTokens = normalizedMetricTokens(phrase);

  if (!columnTokens.length || !phraseTokens.length) return 0;

  let matched = 0;

  for (const columnToken of columnTokens) {
    let best = 0;

    for (const phraseToken of phraseTokens) {
      best = Math.max(
        best,
        fuzzyWordSimilarity(columnToken, phraseToken)
      );
    }

    matched += best;
  }

  const coverage =
    matched / Math.max(1, columnTokens.length);

  const columnText = normalizeText(columnName);
  const phraseText = normalizeText(phrase);

  const phraseBonus =
    columnText &&
    phraseText &&
    (
      phraseText.includes(columnText) ||
      columnText.includes(phraseText)
    )
      ? 0.1
      : 0;

  return Math.min(1, coverage * 0.9 + phraseBonus);
}

function extractGroupingPhrase(question) {
  const text = normalizeText(question);

  const match = text.match(
    /\b(?:by|per|for each|grouped by)\s+(.+?)(?=[?.]|$)/
  );

  if (!match?.[1]) return null;

  return match[1]
    .replace(
      /\b(?:association|associations|record|records|row|rows)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function findBestColumnForPhrase({
  rows,
  columns,
  phrase,
  numericOnly = false,
  excluded = [],
}) {
  const excludedSet =
    new Set(
      (excluded || []).map(
        (value) => normalizeText(value)
      )
    );

  const candidates = [];

  for (const column of columns) {
    if (excludedSet.has(normalizeText(column))) continue;

    const ratio = numericRatio(rows, column);

    if (
      numericOnly &&
      !isNumericMeasure(rows, column)
    ) {
      continue;
    }

    const score =
      scoreColumnPhrase(
        column,
        phrase
      );

    if (score <= 0) continue;

    candidates.push({
      column,
      score,
      numericRatio: ratio,
    });
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.numericRatio - a.numericRatio
  );

  return candidates[0] || null;
}


function scoreIdentityColumn(columnName, question) {
  const columnTokens = tokenizeMathText(columnName)
    .filter((token) => !["name", "title", "id", "identifier", "code", "no", "number"].includes(token));
  const questionTokens = tokenizeMathText(question);

  if (!columnTokens.length || !questionTokens.length) return 0;

  let matched = 0;

  for (const token of columnTokens) {
    let best = 0;

    for (const qToken of questionTokens) {
      best = Math.max(
        best,
        fuzzyWordSimilarity(token, qToken)
      );
    }

    matched += best;
  }

  return matched / Math.max(1, columnTokens.length);
}

function findBestIdentityColumn({
  rows,
  columns,
  question,
  excluded = [],
}) {
  const excludedSet =
    new Set(
      (excluded || []).map(
        (value) => normalizeText(value)
      )
    );

  const candidates = [];

  for (const column of columns) {
    if (excludedSet.has(normalizeText(column))) continue;
    if (numericRatio(rows, column) >= 0.85) continue;

    const score =
      scoreIdentityColumn(
        column,
        question
      );

    if (score <= 0) continue;

    candidates.push({
      column,
      score,
    });
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score
  );

  return candidates[0] || null;
}

function cleanMetricQuestion(
  question,
  operationMatch,
  groupingPhrase
) {
  let text = normalizeText(question);

  if (operationMatch?.matched) {
    const escaped =
      String(operationMatch.matched)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    text = text.replace(
      new RegExp(`\\b${escaped}\\b`, "g"),
      " "
    );
  }

  text = text.replace(
    /\b(?:how many|number of|count of)\b/g,
    " "
  );

  if (groupingPhrase) {
    const escaped =
      String(groupingPhrase)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    text = text.replace(
      new RegExp(
        `\\b(?:by|per|for each|grouped by)\\s+${escaped}\\b`,
        "g"
      ),
      " "
    );
  }

  return text
    .replace(/\s+/g, " ")
    .trim();
}

function operationToGrouped(operation) {
  const map = {
    sum: "group_sum",
    average: "group_average",
    minimum: "group_minimum",
    maximum: "group_maximum",
    row_count: "group_count",
  };

  return map[operation] || null;
}

function hasExplicitMetricPhrase(
  question,
  operationMatch
) {
  const groupingPhrase =
    extractGroupingPhrase(question);

  // Existing local semantic logic is better at ordinary ungrouped entity
  // counts (including distinct-count semantics). This math resolver takes
  // ownership of counting only when the user explicitly asks for grouping.
  if (
    operationMatch.operation === "row_count" &&
    !groupingPhrase
  ) {
    return null;
  }

  const metricPhrase =
    cleanMetricQuestion(
      question,
      operationMatch,
      groupingPhrase
    );

  return normalizedMetricTokens(metricPhrase).length > 0;
}

function resolveLocalMathematicalPlan({
  question,
  schema = [],
  datasets = {},
} = {}) {
  const operationMatch =
    detectLocalMathOperation(question);

  if (!operationMatch) return null;

  const normalizedQuestion =
    normalizeText(question);

  const entityRanking =
    ["maximum", "minimum"].includes(operationMatch.operation) &&
    (
      /\b(?:which|who)\b/.test(normalizedQuestion) ||
      /\bwhat\b.+\b(?:has|have|had)\b/.test(normalizedQuestion)
    );

  const groupingPhrase =
    extractGroupingPhrase(question);

  // Existing local semantic logic is better at ordinary ungrouped entity
  // counts (including distinct-count semantics). This math resolver takes
  // ownership of counting only when the user explicitly asks for grouping.
  if (
    operationMatch.operation === "row_count" &&
    !groupingPhrase
  ) {
    return null;
  }

  const metricPhrase =
    cleanMetricQuestion(
      question,
      operationMatch,
      groupingPhrase
    );

  const hasExplicitMetric =
    hasExplicitMetricPhrase(
      question,
      operationMatch
    );

  // Do not invent a metric for a bare aggregate question.
  if (
    operationMatch.operation !== "row_count" &&
    !hasExplicitMetric
  ) {
    return {
      route: "clarify",
      question:
        "What specific metric or column would you like me to calculate?",
      confidence: 0.35,
      localSemanticResolved: false,
      localMathAmbiguous: true,
    };
  }

  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName =
      datasetSchema?.name;

    const rows =
      datasets?.[datasetName];

    if (
      !datasetName ||
      !Array.isArray(rows) ||
      !rows.length
    ) {
      continue;
    }

    const columns =
      getSchemaColumnNames(
        datasetSchema
      );

    if (!columns.length) continue;

    let groupCandidate = null;

    if (groupingPhrase) {
      groupCandidate =
        findBestColumnForPhrase({
          rows,
          columns,
          phrase: groupingPhrase,
          numericOnly: false,
        });

      if (
        !groupCandidate ||
        groupCandidate.score < 0.48
      ) {
        continue;
      }
    }

    let metricCandidate = null;

    if (
      operationMatch.operation !==
      "row_count"
    ) {
      metricCandidate =
        findBestColumnForPhrase({
          rows,
          columns,
          phrase: metricPhrase,
          numericOnly: true,
          excluded: [
            groupCandidate?.column,
          ].filter(Boolean),
        });

      if (
        !metricCandidate ||
        metricCandidate.score < 0.42
      ) {
        continue;
      }
    } else if (hasExplicitMetric) {
      metricCandidate =
        findBestColumnForPhrase({
          rows,
          columns,
          phrase: metricPhrase,
          numericOnly: false,
          excluded: [
            groupCandidate?.column,
          ].filter(Boolean),
        });
    }

    let rankingLabelCandidate = null;

    if (entityRanking) {
      rankingLabelCandidate =
        findBestIdentityColumn({
          rows,
          columns,
          question,
          excluded: [
            metricCandidate?.column,
            groupCandidate?.column,
          ].filter(Boolean),
        });

      if (
        !rankingLabelCandidate ||
        rankingLabelCandidate.score < 0.42 ||
        numericRatio(
          rows,
          rankingLabelCandidate.column
        ) >= 0.85
      ) {
        rankingLabelCandidate = null;
      }
    }

    const filters =
      inferValueFilters(
        rows,
        question,
        [
          metricCandidate?.column,
          groupCandidate?.column,
          rankingLabelCandidate?.column,
        ].filter(Boolean)
      ) || [];

    const groupedOperation =
      groupingPhrase
        ? operationToGrouped(
            operationMatch.operation
          )
        : null;

    const operation =
      entityRanking &&
      rankingLabelCandidate
        ? "rank_rows"
        : (
            groupedOperation ||
            operationMatch.operation
          );

    const filterScore =
      filters.length
        ? Math.min(
            1,
            0.65 +
              filters.length * 0.1
          )
        : 0.45;

    const metricScore =
      operationMatch.operation ===
      "row_count"
        ? (
            metricCandidate?.score ||
            0.65
          )
        : metricCandidate.score;

    const groupScore =
      groupingPhrase
        ? groupCandidate.score
        : 0.7;

    const totalScore =
      operationMatch.confidence *
        0.2 +
      metricScore * 0.5 +
      groupScore * 0.15 +
      filterScore * 0.15;

    candidates.push({
      route: "dataset",
      dataset: datasetName,
      operation,
      column:
        operation === "row_count"
          ? null
          : (
              metricCandidate?.column ||
              null
            ),
      labelColumn:
        operation === "rank_rows"
          ? rankingLabelCandidate?.column
          : (
              groupCandidate?.column ||
              metricCandidate?.column ||
              null
            ),
      groupBy:
        operation === "rank_rows"
          ? null
          : (
              groupCandidate?.column ||
              null
            ),
      aggregation:
        operation === "rank_rows"
          ? null
          : (
              groupedOperation
                ? (
                    operationMatch.operation ===
                    "row_count"
                      ? "count"
                      : operationMatch.operation
                  )
                : null
            ),
      direction:
        operation === "rank_rows"
          ? (
              operationMatch.operation ===
              "minimum"
                ? "asc"
                : "desc"
            )
          : null,
      filters,
      selectColumns: [
        operation === "rank_rows"
          ? rankingLabelCandidate?.column
          : groupCandidate?.column,
        metricCandidate?.column,
      ].filter(Boolean),
      outputRequested: true,
      transform: null,
      showAll: false,
      limit: 100,
      localSemanticResolved: true,
      localMathematicalResolved: true,
      localMathConfidence:
        Math.min(
          1,
          totalScore
        ),
      localSemanticConfidence:
        Math.min(
          1,
          totalScore
        ),
      localMathEvidence: {
        operationMatched:
          operationMatch.matched,
        operationCanonical:
          operationMatch.canonical ||
          operationMatch.matched,
        operationConfidence:
          Number(
            operationMatch.confidence.toFixed(4)
          ),
        metricScore:
          Number(
            (
              metricCandidate?.score ||
              0
            ).toFixed(4)
          ),
        groupingScore:
          Number(
            (
              groupCandidate?.score ||
              0
            ).toFixed(4)
          ),
        filterCount:
          filters.length,
      },
    });
  }

  if (!candidates.length) {
    return {
      route: "clarify",
      question:
        "I could not confidently match the requested calculation to a numeric field in the current worksheets. Please name the metric you want to calculate.",
      confidence: 0.35,
      localSemanticResolved: false,
      localMathGroundingFailed: true,
    };
  }

  candidates.sort(
    (a, b) =>
      b.localMathConfidence -
      a.localMathConfidence
  );

  const best = candidates[0];
  const second = candidates[1];

  if (
    second &&
    second.dataset !== best.dataset &&
    Math.abs(
      best.localMathConfidence -
      second.localMathConfidence
    ) < 0.025 &&
    best.localMathConfidence < 0.82
  ) {
    return {
      route: "clarify",
      question:
        `I found similarly strong calculation matches in ${best.dataset} and ${second.dataset}. Which worksheet should I use?`,
      confidence: 0.4,
      localSemanticResolved: false,
      localMathAmbiguous: true,
    };
  }

  return best;
}

function resolveLocalQuantityAggregationPlan({
  question,
  schema = [],
  datasets = {},
} = {}) {
  const text =
    normalizeText(question);

  if (
    !/\b(?:how many|how much)\b/.test(text) ||
    !/\b(?:distributed?|released?|provided?|given|issued|allocated|delivered|received?|supplied)\b/.test(text)
  ) {
    return null;
  }

  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName =
      datasetSchema?.name;

    const rows =
      datasets?.[datasetName];

    if (
      !datasetName ||
      !Array.isArray(rows) ||
      !rows.length
    ) {
      continue;
    }

    const columns =
      (datasetSchema.columns || [])
        .map(
          (column) =>
            typeof column === "string"
              ? column
              : column?.name
        )
        .filter(Boolean);

    const unitFilter =
      findExplicitUnitFilter(
        rows,
        question,
        columns
      );

    if (!unitFilter) continue;

    const measureColumn =
      findBestAdditiveMeasureColumn(
        rows
      );

    if (!measureColumn) continue;

    const objectPhrase =
      extractObjectPhrase(question);

    const objectFilter =
      objectPhrase
        ? findObjectContainsFilter({
            rows,
            columns,
            objectPhrase,
            excludeColumns: [
              unitFilter.column,
              measureColumn,
            ],
          })
        : null;

    /**
     * Grounding rule:
     *
     * If the question explicitly names an object/category after "of"
     * (for example "kilograms of fertilizer"), that object must map to
     * a live categorical value in the selected worksheet.
     *
     * Never silently drop an ungrounded object and broaden the query to
     * "all kilogram rows" because that changes the user's meaning.
     */
    if (
      objectPhrase &&
      !objectFilter
    ) {
      candidates.push({
        route: "clarify",
        question:
          `I could not find a dataset value matching "${objectPhrase}" in ${datasetName}. Please specify an available intervention or category.`,
        confidence: 0.35,
        localSemanticResolved: false,
        localSemanticAmbiguous: false,
        localGroundingFailed: true,
        localGroundingFailure: {
          phrase:
            objectPhrase,
          dataset:
            datasetName,
          unitColumn:
            unitFilter.column,
          unitValue:
            unitFilter.value,
        },
      });

      continue;
    }

    const filters = [
      unitFilter,
      ...(objectFilter
        ? [objectFilter]
        : []),
    ];

    const matchedRows =
      rows.filter(
        (row) =>
          filters.every(
            (filter) => {
              const actual =
                normalizeText(
                  row?.[filter.column]
                );

              const expected =
                normalizeText(
                  filter.value
                );

              return filter.operator === "contains"
                ? actual.includes(expected)
                : actual === expected;
            }
          )
      );

    const numericValues =
      matchedRows
        .map(
          (row) =>
            parseNumber(
              row?.[measureColumn]
            )
        )
        .filter(
          (value) =>
            value !== null
        );

    if (!numericValues.length) continue;

    candidates.push({
      route: "dataset",
      dataset: datasetName,
      operation: "sum",
      column: measureColumn,
      labelColumn: measureColumn,
      groupBy: null,
      aggregation: "sum",
      direction: null,
      filters,
      selectColumns: [
        measureColumn,
      ],
      outputRequested: true,
      transform: null,
      showAll: false,
      limit: 10,
      localSemanticResolved: true,
      localAggregationResolved: true,
      localSemanticConfidence:
        Math.min(
          1,
          0.78 +
            (objectFilter
              ? 0.14
              : 0)
        ),
      localAggregationEvidence: {
        unitColumn:
          unitFilter.column,
        unitValue:
          unitFilter.value,
        objectPhrase:
          objectPhrase || null,
        objectColumn:
          objectFilter?.column || null,
        recordsMatched:
          numericValues.length,
      },
    });
  }

  if (!candidates.length) {
    return null;
  }

  const grounded =
    candidates.filter(
      (candidate) =>
        candidate?.route === "dataset"
    );

  if (!grounded.length) {
    return candidates[0];
  }

  grounded.sort(
    (a, b) =>
      Number(
        b.localSemanticConfidence ||
        0
      ) -
      Number(
        a.localSemanticConfidence ||
        0
      )
  );

  const best =
    grounded[0];

  const second =
    grounded[1];

  if (
    second &&
    Math.abs(
      Number(
        best.localSemanticConfidence ||
        0
      ) -
      Number(
        second.localSemanticConfidence ||
        0
      )
    ) < 0.04
  ) {
    return {
      route: "clarify",
      question:
        `I found more than one worksheet that could answer this quantity question: ${best.dataset} and ${second.dataset}. Which one should I use?`,
      confidence: 0.35,
      localSemanticResolved: false,
      localSemanticAmbiguous: true,
    };
  }

  return best;
}

module.exports = {
  isUnitLikeColumnName,
  isIdentifierLikeNumericColumn,
  measureNameScore,
  findBestAdditiveMeasureColumn,
  extractObjectPhrase,
  findExplicitUnitFilter,
  findObjectContainsFilter,
  detectLocalMathOperation,
  resolveLocalMathematicalPlan,
  resolveLocalQuantityAggregationPlan,
};
