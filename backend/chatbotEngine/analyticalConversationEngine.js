const {
  normalizeText,
  similarity,
  parseNumber,
} = require("./utils");

const {
  inferValueFilters,
} = require("./filterEngine");

const {
  findExplicitSchemaColumns,
  detectRankingDirection,
  isNumericLikeColumn,
  resolveExplicitRankingColumns,
  inferRequestedColumnFromQuestion,
} = require("./plannerNormalizer");

function getUniqueColumnValues(
  rows,
  column
) {
  const values = [];
  const seen = new Set();

  for (const row of rows || []) {
    const raw =
      row?.[column];

    if (
      raw === null ||
      raw === undefined
    ) {
      continue;
    }

    const display =
      String(raw).trim();

    const key =
      normalizeText(display);

    if (
      !display ||
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    values.push(display);
  }

  return values;
}

function tokenSimilarity(
  left,
  right
) {
  const a =
    normalizeText(left);

  const b =
    normalizeText(right);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (
    a.includes(b) ||
    b.includes(a)
  ) {
    return 0.95;
  }

  const aTokens =
    a.split(/\s+/)
      .filter(Boolean);

  const bTokens =
    b.split(/\s+/)
      .filter(Boolean);

  const aSet =
    new Set(aTokens);

  const bSet =
    new Set(bTokens);

  let overlap = 0;

  for (const token of aSet) {
    if (bSet.has(token)) {
      overlap += 1;
    }
  }

  const denominator =
    Math.max(
      aSet.size,
      bSet.size,
      1
    );

  return overlap / denominator;
}

function buildQuestionNgrams(
  question,
  maxWords = 4
) {
  const normalized =
    normalizeText(question);

  const tokens =
    normalized
      .split(/\s+/)
      .filter(
        (token) =>
          token.length >= 2
      );

  const phrases = [];

  for (
    let size = 1;
    size <= Math.min(
      maxWords,
      tokens.length
    );
    size += 1
  ) {
    for (
      let i = 0;
      i <=
      tokens.length - size;
      i += 1
    ) {
      phrases.push(
        tokens
          .slice(
            i,
            i + size
          )
          .join(" ")
      );
    }
  }

  return phrases;
}

function questionValueMatchScore(
  question,
  value
) {
  const q =
    normalizeText(question);

  const v =
    normalizeText(value);

  if (!q || !v) {
    return 0;
  }

  /**
   * Exact phrase present in the question.
   */
  if (q.includes(v)) {
    return 1;
  }

  const valueWords =
    v.split(/\s+/)
      .filter(Boolean);

  const ngrams =
    buildQuestionNgrams(
      question,
      Math.max(
        1,
        valueWords.length
      )
    );

  let best = 0;

  for (const phrase of ngrams) {
    /**
     * Avoid comparing wildly different lengths.
     */
    const shortLength =
      Math.min(
        phrase.length,
        v.length
      );

    const longLength =
      Math.max(
        phrase.length,
        v.length
      );

    if (
      shortLength < 3 ||
      shortLength /
        Math.max(
          longLength,
          1
        ) <
        0.55
    ) {
      continue;
    }

    const score =
      similarity(
        phrase,
        v
      );

    if (score > best) {
      best = score;
    }
  }

  return best;
}

function questionContainsValue(
  question,
  value
) {
  return (
    questionValueMatchScore(
      question,
      value
    ) >= 0.78
  );
}

function collectQuestionMatchesForColumn({
  rows,
  column,
  question,
  seedValues = [],
}) {
  const actualValues =
    getUniqueColumnValues(
      rows,
      column
    );

  if (!actualValues.length) {
    return [];
  }

  const selected = [];
  const selectedKeys =
    new Set();

  const addValue =
    (value) => {
      const key =
        normalizeText(value);

      if (
        !key ||
        selectedKeys.has(key)
      ) {
        return;
      }

      selectedKeys.add(key);
      selected.push(value);
    };

  /**
   * Preserve / resolve values already identified by the planner.
   */
  for (
    const seedValue of
    Array.isArray(seedValues)
      ? seedValues
      : [seedValues]
  ) {
    if (
      seedValue === null ||
      seedValue === undefined ||
      String(seedValue).trim() === ""
    ) {
      continue;
    }

    const exact =
      actualValues.find(
        (candidate) =>
          normalizeText(candidate) ===
          normalizeText(seedValue)
      );

    if (exact) {
      addValue(exact);
      continue;
    }

    let best = null;

    for (const candidate of actualValues) {
      const score =
        similarity(
          normalizeText(
            seedValue
          ),
          normalizeText(
            candidate
          )
        );

      if (
        !best ||
        score > best.score
      ) {
        best = {
          value:
            candidate,
          score,
        };
      }
    }

    if (
      best &&
      best.score >= 0.78
    ) {
      addValue(
        best.value
      );
    }
  }

  /**
   * Search the user's question against EVERY actual value
   * in the dynamically chosen column.
   *
   * This supports small spelling differences, e.g. a user
   * types a name slightly differently from the sheet.
   */
  const fuzzyCandidates =
    actualValues
      .map(
        (candidate) => ({
          value:
            candidate,

          score:
            questionValueMatchScore(
              question,
              candidate
            ),
        })
      )
      .filter(
        (item) =>
          item.score >= 0.78
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  for (
    const candidate of
    fuzzyCandidates
  ) {
    addValue(
      candidate.value
    );
  }

  return selected;
}

/**
 * ==========================================================
 * REPAIR MULTI-ENTITY FILTERS
 * ==========================================================
 *
 * Fully dynamic:
 *
 * - no employee names are hardcoded
 * - no LAST NAME column is hardcoded
 * - no division/province/municipality is hardcoded
 * - no worksheet name is hardcoded
 *
 * The planner's existing filter tells us which column is
 * acting as the entity column. We then scan the ACTUAL values
 * of that column and recover any additional values explicitly
 * present in the user's question.
 */

/**
 * Return true only when the user's wording clearly asks about
 * MORE THAN ONE entity.
 *
 * This prevents a single person's multi-word name, such as
 * "Doris Joy Garcia", from being split into multiple matches
 * merely because another row contains one of those words.
 */
function hasExplicitMultiEntityRequest(
  question
) {
  const text =
    String(question || "")
      .trim()
      .toLowerCase();

  if (!text) {
    return false;
  }

  return (
    /\bboth\b/.test(text) ||
    /\b(?:vs\.?|versus)\b/.test(text) ||
    /\bcompare\b.*\b(?:with|and|to)\b/.test(text) ||
    /\bbetween\b.+\band\b.+/.test(text) ||
    /,\s*\S+/.test(text) ||
    /\b(?:and|or)\b/.test(text)
  );
}


function repairMultiEntityFilters({
  datasets,
  plan,
  question,
}) {
  if (
    !plan ||
    plan.route !== "dataset" ||
    !plan.dataset
  ) {
    return plan;
  }

  /**
   * Structured entity groups already preserve identity correctly.
   * Do not flatten or expand them back into same-column IN filters.
   */
  if (
    Array.isArray(
      plan.filterGroups
    ) &&
    plan.filterGroups.length
  ) {
    return plan;
  }

  const rows =
    datasets?.[plan.dataset];

  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return plan;
  }

  /**
   * CRITICAL SINGLE-ENTITY SAFETY RULE
   * ----------------------------------
   *
   * Do not scan the question for additional row values unless
   * the user clearly requested multiple entities.
   *
   * Example:
   * "What is the position title of Doris Joy Garcia?"
   *
   * must remain a single-person lookup and must not be expanded
   * to another employee just because that employee also contains
   * the word "Joy".
   */
  if (
    !hasExplicitMultiEntityRequest(
      question
    )
  ) {
    return plan;
  }

  const currentFilters =
    Array.isArray(
      plan.filters
    )
      ? plan.filters.map(
          (filter) => ({
            ...filter,

            value:
              Array.isArray(
                filter?.value
              )
                ? [...filter.value]
                : filter?.value,
          })
        )
      : [];

  /**
   * Keep the existing exact inference as an additional source.
   */
  const inferred =
    inferValueFilters(
      rows,
      question,
      []
    );

  let repaired = false;

  const repairedFilters =
    currentFilters.map(
      (filter) => {
        if (
          !filter ||
          !filter.column
        ) {
          return filter;
        }

        const operator =
          String(
            filter.operator ||
              "equals"
          )
            .trim()
            .toLowerCase();

        if (
          operator !== "equals" &&
          operator !== "in"
        ) {
          return filter;
        }

        const seedValues =
          Array.isArray(
            filter.value
          )
            ? filter.value
            : [filter.value];

        const matches =
          collectQuestionMatchesForColumn({
            rows,

            column:
              filter.column,

            question,

            seedValues,
          });

        /**
         * Also merge any values found by inferValueFilters()
         * for this same dynamically selected column.
         */
        const inferredSameColumn =
          (Array.isArray(inferred)
            ? inferred
            : []
          ).filter(
            (candidate) =>
              candidate &&
              normalizeText(
                candidate.column
              ) ===
                normalizeText(
                  filter.column
                )
          );

        for (
          const candidate of
          inferredSameColumn
        ) {
          const values =
            Array.isArray(
              candidate.value
            )
              ? candidate.value
              : [candidate.value];

          for (const value of values) {
            if (
              value === null ||
              value === undefined ||
              String(value).trim() === ""
            ) {
              continue;
            }

            if (
              !matches.some(
                (existing) =>
                  normalizeText(
                    existing
                  ) ===
                  normalizeText(
                    value
                  )
              )
            ) {
              matches.push(value);
            }
          }
        }

        if (
          matches.length <= 1
        ) {
          return filter;
        }

        repaired = true;

        return {
          ...filter,

          operator:
            "in",

          value:
            matches,
        };
      }
    );

  /**
   * If the planner produced no filter at all, retain the
   * previous generic inference behavior only when one
   * unambiguous multi-value column is discovered.
   */
  if (
    currentFilters.length === 0 &&
    Array.isArray(inferred)
  ) {
    const multiCandidates =
      inferred.filter(
        (candidate) =>
          candidate &&
          candidate.column &&
          String(
            candidate.operator || ""
          )
            .trim()
            .toLowerCase() === "in" &&
          Array.isArray(
            candidate.value
          ) &&
          candidate.value.length > 1
      );

    if (
      multiCandidates.length === 1
    ) {
      repaired = true;

      repairedFilters.push({
        column:
          multiCandidates[0].column,

        operator:
          "in",

        value: [
          ...multiCandidates[0].value,
        ],
      });
    }
  }

  if (!repaired) {
    return plan;
  }

  return {
    ...plan,

    filters:
      repairedFilters,

    showAll:
      plan.operation === "lookup"
        ? true
        : plan.showAll,
  };
}



/**
 * ==========================================================
 * CONVERSATIONAL ANALYTICS
 * ==========================================================
 *
 * Transform a previous VERIFIED analytical plan instead of asking
 * Groq to rediscover the whole question.
 *
 * Examples:
 *
 *   "Which division has the highest average salary?"
 *   "Show the top 5 instead."
 *   "What about the total?"
 *   "What about actual obligation?"
 *   "Show the bottom 3."
 *
 * No dashboard field or entity is hardcoded.
 */

function detectAnalyticalAggregationFollowUp(
  question
) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return null;
  }

  if (
    /\b(?:total|sum|combined|altogether)\b/.test(
      text
    )
  ) {
    return "sum";
  }

  if (
    /\b(?:average|avg|mean)\b/.test(
      text
    )
  ) {
    return "average";
  }

  if (
    /\b(?:count|how many|number of)\b/.test(
      text
    )
  ) {
    return "count";
  }

  if (
    /\b(?:minimum|min|lowest|smallest|least)\b/.test(
      text
    )
  ) {
    return "minimum";
  }

  if (
    /\b(?:maximum|max|highest|largest|greatest)\b/.test(
      text
    )
  ) {
    return "maximum";
  }

  return null;
}



function detectAnalyticalRankIndexFollowUp(
  question
) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return null;
  }

  const numericOrdinal =
    text.match(
      /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:highest|lowest|largest|smallest)\b/
    );

  if (
    numericOrdinal?.[1]
  ) {
    const position =
      Number(
        numericOrdinal[1]
      );

    if (
      Number.isInteger(
        position
      ) &&
      position >= 1 &&
      position <= 100
    ) {
      return position - 1;
    }
  }

  const wordOrdinals =
    new Map([
      ["first", 0],
      ["second", 1],
      ["third", 2],
      ["fourth", 3],
      ["fifth", 4],
      ["sixth", 5],
      ["seventh", 6],
      ["eighth", 7],
      ["ninth", 8],
      ["tenth", 9],
    ]);

  const wordMatch =
    text.match(
      /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:highest|lowest|largest|smallest)\b/
    );

  if (
    wordMatch?.[1] &&
    wordOrdinals.has(
      wordMatch[1]
    )
  ) {
    return wordOrdinals.get(
      wordMatch[1]
    );
  }

  return null;
}


function detectAnalyticalLimitFollowUp(
  question
) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return null;
  }

  const explicit =
    text.match(
      /\b(?:top|bottom|first|last)\s+(\d{1,3})\b/
    );

  if (explicit?.[1]) {
    const value =
      Number(
        explicit[1]
      );

    if (
      Number.isInteger(value)
    ) {
      return Math.min(
        Math.max(
          value,
          1
        ),
        100
      );
    }
  }

  const rankIndex =
    detectAnalyticalRankIndexFollowUp(
      question
    );

  if (
    rankIndex !== null
  ) {
    return rankIndex + 1;
  }

  return null;
}


function detectAnalyticalDirectionFollowUp(
  question
) {
  const text =
    normalizeText(
      question
    );

  if (
    /\b(bottom|lowest|smallest|least|minimum|min)\b/.test(
      text
    )
  ) {
    return "asc";
  }

  if (
    /\b(top|highest|largest|greatest|maximum|max)\b/.test(
      text
    )
  ) {
    return "desc";
  }

  return null;
}


function isAnalyticalTransformQuestion(
  question
) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return false;
  }

  return (
    /^(?:what|how) about\b/.test(
      text
    ) ||
    /\b(?:top|bottom)\s+\d{1,3}\b/.test(
      text
    ) ||
    /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th))\s+(?:highest|lowest|largest|smallest)\b/.test(
      text
    ) ||
    /\binstead\b/.test(
      text
    ) ||
    /\b(?:exclude|excluding|without|except|remove|omit|leave out)\b/.test(
      text
    ) ||
    /\b(?:recalculate|recompute|run again|calculate again)\b/.test(
      text
    ) ||
    /\bcompare\s+(?:it|that|this|the result)\s+with\s+(?:the\s+)?(?:highest|lowest|largest|smallest)\b/.test(
      text
    )
  );
}


function aggregationToGroupedOperation(
  aggregation
) {
  const map = {
    sum:
      "group_sum",

    average:
      "group_average",

    count:
      "group_count",

    minimum:
      "group_minimum",

    maximum:
      "group_maximum",
  };

  return (
    map[
      String(
        aggregation || ""
      )
        .trim()
        .toLowerCase()
    ] ||
    null
  );
}



function detectAnalyticalExtremeComparison(
  question
) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return null;
  }

  if (
    /\bcompare\s+(?:it|that|this|the result)\s+with\s+(?:the\s+)?(?:lowest|smallest|least|minimum|min)\b/.test(
      text
    )
  ) {
    return "asc";
  }

  if (
    /\bcompare\s+(?:it|that|this|the result)\s+with\s+(?:the\s+)?(?:highest|largest|greatest|maximum|max)\b/.test(
      text
    )
  ) {
    return "desc";
  }

  return null;
}


function getLastVerifiedAnalyticalLabel(
  context
) {
  const result =
    context?.lastResult;

  if (
    !result ||
    !Array.isArray(
      result.results
    ) ||
    result.results.length !== 1
  ) {
    return null;
  }

  const label =
    result.results[0]
      ?.label;

  if (
    label === null ||
    label === undefined ||
    String(label).trim() === ""
  ) {
    return null;
  }

  return String(label).trim();
}


function detectAnalyticalExclusions({
  datasets,
  context,
  question,
}) {
  const previous =
    context?.analyticalContext;

  if (
    !previous ||
    !previous.dataset
  ) {
    return [];
  }

  const text =
    normalizeText(
      question
    );

  if (
    !/\b(?:exclude|excluding|without|except|remove|omit|leave out)\b/.test(
      text
    )
  ) {
    return [];
  }

  const groupColumn =
    previous.groupBy ||
    previous.labelColumn ||
    null;

  const rows =
    datasets?.[
      previous.dataset
    ];

  if (
    !groupColumn ||
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return [];
  }

  const uniqueValues =
    getUniqueColumnValues(
      rows,
      groupColumn
    )
      .map(
        (value) => ({
          value,
          normalized:
            normalizeText(
              value
            ),
        })
      )
      .filter(
        (item) =>
          item.normalized
      )
      .sort(
        (a, b) =>
          b.normalized.length -
          a.normalized.length
      );

  const matched = [];

  for (
    const item of
    uniqueValues
  ) {
    const escaped =
      item.normalized.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const regex =
      new RegExp(
        `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
        "u"
      );

    if (
      regex.test(text)
    ) {
      matched.push(
        item.value
      );
    }
  }

  if (
    !matched.length &&
    /\b(?:that|this|it|the same)\s+(?:group|one|result|item)?\b/.test(
      text
    )
  ) {
    const lastLabel =
      getLastVerifiedAnalyticalLabel(
        context
      );

    if (lastLabel) {
      matched.push(
        lastLabel
      );
    }
  }

  return [
    ...new Set(
      matched
    ),
  ];
}


function mergeAnalyticalExclusionFilter({
  filters,
  groupColumn,
  excludedValues,
}) {
  const cloned =
    Array.isArray(filters)
      ? filters.map(
          (filter) => ({
            ...filter,

            value:
              Array.isArray(
                filter?.value
              )
                ? [
                    ...filter.value,
                  ]
                : filter?.value,
          })
        )
      : [];

  if (
    !groupColumn ||
    !Array.isArray(
      excludedValues
    ) ||
    !excludedValues.length
  ) {
    return cloned;
  }

  const normalizedGroup =
    normalizeText(
      groupColumn
    );

  const existing =
    cloned.find(
      (filter) =>
        normalizeText(
          filter?.column ||
          ""
        ) ===
          normalizedGroup &&
        [
          "not_equals",
          "not_in",
        ].includes(
          String(
            filter?.operator ||
            ""
          )
            .trim()
            .toLowerCase()
        )
    );

  if (existing) {
    const oldValues =
      Array.isArray(
        existing.value
      )
        ? existing.value
        : [
            existing.value,
          ].filter(
            (value) =>
              value !== null &&
              value !== undefined &&
              String(value).trim() !== ""
          );

    existing.operator =
      "not_in";

    existing.value = [
      ...new Set([
        ...oldValues,
        ...excludedValues,
      ]),
    ];

    return cloned;
  }

  cloned.push({
    column:
      groupColumn,

    operator:
      excludedValues.length === 1
        ? "not_equals"
        : "not_in",

    value:
      excludedValues.length === 1
        ? excludedValues[0]
        : [
            ...excludedValues,
          ],
  });

  return cloned;
}


function buildAnalyticalFollowUpPlan({
  schema,
  datasets,
  context,
  question,
}) {
  const previous =
    context?.analyticalContext;

  if (
    !previous ||
    !previous.dataset ||
    !isAnalyticalTransformQuestion(
      question
    )
  ) {
    return null;
  }

  const previousOperation =
    String(
      previous.operation ||
      ""
    )
      .trim()
      .toLowerCase();

  const wasRanking =
    previousOperation ===
      "rank_groups" ||
    previousOperation ===
      "rank_rows";

  const hasGrouping =
    Boolean(
      previous.groupBy ||
      previous.labelColumn
    );

  const nextAggregation =
    detectAnalyticalAggregationFollowUp(
      question
    );

  const nextDirection =
    detectAnalyticalDirectionFollowUp(
      question
    );

  const nextLimit =
    detectAnalyticalLimitFollowUp(
      question
    );

  const analyticalRankIndex =
    detectAnalyticalRankIndexFollowUp(
      question
    );

  /**
   * Resolve a newly requested REAL schema metric.
   *
   * If the wording is only "what about the total?" this may resolve
   * nothing, which is correct: keep the previous metric.
   */
  /**
   * Resolve a NEW metric only when the user explicitly names a real
   * schema column.
   *
   * IMPORTANT:
   * Do NOT use fuzzy column inference for aggregation-only follow-ups.
   *
   * Example:
   *
   *   previous metric: ACTUAL SALARY
   *   question: "What about the average?"
   *
   * The word "average" must change ONLY the aggregation. It must not
   * fuzzy-match an unrelated column such as AGE.
   *
   * But:
   *
   *   "What about authorized salary?"
   *
   * explicitly names a real schema field, so the metric should change.
   */
  const explicitMetricMatches =
    findExplicitSchemaColumns({
      schema,
      question,

      preferredDataset:
        previous.dataset,
    })
      .filter(
        (item) =>
          normalizeText(
            item?.column ||
            ""
          ) !==
          normalizeText(
            previous.groupBy ||
            ""
          ) &&
          normalizeText(
            item?.column ||
            ""
          ) !==
          normalizeText(
            previous.labelColumn ||
            ""
          )
      );

  const requestedMetric =
    explicitMetricMatches[0] ||
    null;

  let metricColumn =
    previous.column ||
    null;

  if (
    requestedMetric?.column
  ) {
    metricColumn =
      requestedMetric.column;
  }

  let aggregation =
    nextAggregation ||
    previous.aggregation ||
    null;

  /**
   * CONVERSATIONAL ANALYTICS SAFEGUARD
   * ==================================
   *
   * "number of <numeric metric>" describes the metric itself.
   * It must NOT become aggregation = "count".
   *
   * Example:
   *
   *   Show me the top 5 associations by number of members.
   *
   * If the live schema resolves "number of members" to a real numeric
   * field such as "No. of members", rank that numeric value directly.
   *
   * This also repairs stale conversation state from an earlier bad plan
   * where previous.aggregation was already "count".
   */
  const questionText =
    normalizeText(
      question
    );

  const metricDatasetSchema =
    (schema || []).find(
      (item) =>
        String(
          item?.name || ""
        ) ===
        String(
          previous.dataset || ""
        )
    );

  const metricDatasetRows =
    datasets?.[
      previous.dataset
    ];

  const metricSchemaColumn =
    metricDatasetSchema
      ?.columns
      ?.find(
        (column) =>
          String(
            column?.name || ""
          ) ===
          String(
            metricColumn || ""
          )
      ) ||
    null;

  const metricIsNumeric =
    metricSchemaColumn &&
    Array.isArray(
      metricDatasetRows
    ) &&
    isNumericLikeColumn({
      column:
        metricSchemaColumn,

      rows:
        metricDatasetRows,
    });

  const numberOfPhrase =
    /\bnumber\s+of\b/.test(
      questionText
    );

  const explicitCountPhrase =
    /\b(?:count|how many)\b/.test(
      questionText
    );

  if (
    metricIsNumeric &&
    numberOfPhrase &&
    !explicitCountPhrase
  ) {
    aggregation =
      null;
  }

  /**
   * Rank operations express highest/lowest through direction.
   * Words like "highest" should not accidentally replace an existing
   * aggregate such as average with maximum.
   */
  if (
    wasRanking &&
    !/\b(?:average|avg|mean|total|sum|combined|count|how many|number of)\b/.test(
      questionText
    )
  ) {
    aggregation =
      previous.aggregation ||
      aggregation;
  }

  /**
   * Re-apply the numeric "number of" safeguard AFTER the ranking
   * inheritance block so a stale previous aggregation="count" cannot
   * leak back into the new plan.
   */
  if (
    metricIsNumeric &&
    numberOfPhrase &&
    !explicitCountPhrase
  ) {
    aggregation =
      null;
  }

  let operation =
    previousOperation;

  if (wasRanking) {
    operation =
      hasGrouping &&
      aggregation
        ? "rank_groups"
        : "rank_rows";
  } else if (
    hasGrouping &&
    aggregation
  ) {
    operation =
      aggregationToGroupedOperation(
        aggregation
      ) ||
      previousOperation;
  } else if (
    aggregation === "sum"
  ) {
    operation =
      "sum";
  } else if (
    aggregation === "average"
  ) {
    operation =
      "average";
  } else if (
    aggregation === "minimum"
  ) {
    operation =
      "minimum";
  } else if (
    aggregation === "maximum"
  ) {
    operation =
      "maximum";
  }

  /**
   * "Show top/bottom N" turns a grouped calculation into a ranking.
   */
  if (
    nextLimit &&
    hasGrouping
  ) {
    operation =
      aggregation
        ? "rank_groups"
        : "rank_rows";
  }

  let groupBy =
    operation === "rank_rows"
      ? null
      : (
          previous.groupBy ||
          previous.labelColumn ||
          null
        );

  /*
   * An explicitly named CURRENT grouping field must override remembered
   * analytical grouping. This is live-schema driven and therefore works
   * for Item, Year, Municipality, Commodity, Category, or any future
   * dataset field without hardcoding names.
   */
  const explicitRankingFields =
    resolveExplicitRankingColumns({
      datasets,
      schema,
      question,
      preferredDataset:
        previous.dataset || null,
    });

  if (
    explicitRankingFields?.groupColumn &&
    detectRankingDirection(question)
  ) {
    groupBy =
      explicitRankingFields.groupColumn;

    if (explicitRankingFields.metricColumn) {
      metricColumn =
        explicitRankingFields.metricColumn;
    }

    operation =
      aggregation
        ? "rank_groups"
        : "rank_rows";

    if (operation === "rank_rows") {
      groupBy = null;
    }
  }

  const excludedValues =
    detectAnalyticalExclusions({
      datasets,
      context,
      question,
    });

  const labelColumn =
    groupBy ||
    (
      explicitRankingFields?.groupColumn ||
      previous.labelColumn ||
      null
    );

  const direction =
    nextDirection ||
    previous.direction ||
    (
      operation ===
        "rank_groups" ||
      operation ===
        "rank_rows"
        ? "desc"
        : null
    );

  const limit =
    nextLimit ||
    previous.limit ||
    (
      operation ===
        "rank_groups" ||
      operation ===
        "rank_rows"
        ? 1
        : 100
    );

  const selectColumns =
    [
      groupBy,
      labelColumn,
      metricColumn,
    ].filter(
      (value, index, array) =>
        value &&
        array.indexOf(value) ===
          index
    );

  return {
    route:
      "dataset",

    dataset:
      previous.dataset,

    operation,

    column:
      metricColumn,

    labelColumn,

    groupBy,

    aggregation:
      operation ===
        "rank_groups"
        ? aggregation
        : (
            operation.startsWith(
              "group_"
            )
              ? null
              : aggregation
          ),

    direction,

    filters:
      mergeAnalyticalExclusionFilter({
        filters:
          previous.filters,

        groupColumn:
          groupBy,

        excludedValues,
      }),

    filterGroups:
      Array.isArray(
        previous.filterGroups
      )
        ? previous.filterGroups.map(
            (group) => ({
              ...group,

              filters:
                Array.isArray(
                  group?.filters
                )
                  ? group.filters.map(
                      (filter) => ({
                        ...filter,

                        value:
                          Array.isArray(
                            filter?.value
                          )
                            ? [
                                ...filter.value,
                              ]
                            : filter?.value,
                      })
                    )
                  : [],
            })
          )
        : [],

    filterGroupLogic:
      previous.filterGroupLogic ||
      null,

    selectColumns,

    outputRequested:
      true,

    transform:
      null,

    limit,

    showAll:
      false,

    /**
     * This flag is ignored by the calculation engine. It is useful
     * in debug output to show that the plan came from verified memory.
     */
    conversationalAnalytics:
      true,

    /**
     * Optional zero-based ordinal selection.
     *
     * Example:
     *   "What is the second highest?"
     *   -> execute top 2
     *   -> keep result index 1
     */
    analyticalRankIndex:
      analyticalRankIndex !==
        null
        ? analyticalRankIndex
        : null,
  };
}


/**
 * ==========================================================
 * CHAINED MULTI-ROW FOLLOW-UPS
 * ==========================================================
 *
 * Examples:
 *
 *   "Who are those persons?"
 *   -> [two verified rows]
 *
 *   "What are their position titles?"
 *   "What are their stations?"
 *
 * The same filter groups are preserved and only the requested
 * output field changes.
 *
 * This is schema-driven and dataset-agnostic.
 */

function hasPluralSelectionReference(
  question
) {
  const text =
    normalizeText(question);

  if (!text) {
    return false;
  }

  return (
    /\b(their|them|those|these|the two|both)\b/i.test(
      text
    )
  );
}


function buildMultiRowFieldFollowUpPlan({
  schema,
  context,
  question,
}) {
  if (
    !context?.isFollowUp ||
    !hasPluralSelectionReference(
      question
    )
  ) {
    return null;
  }

  const previousPlan =
    context.lastPlan;

  if (
    !previousPlan ||
    previousPlan.route !==
      "dataset" ||
    !previousPlan.dataset ||
    !Array.isArray(
      previousPlan.filterGroups
    ) ||
    previousPlan.filterGroups.length <
      2
  ) {
    return null;
  }

  /**
   * The new follow-up must explicitly resolve to a real field.
   * Otherwise questions such as "compare them" should continue to
   * the existing comparison follow-up logic.
   */
  const requested =
    inferRequestedColumnFromQuestion({
      schema,
      question,

      preferredDataset:
        previousPlan.dataset,

      excludedColumns:
        [],
    });

  if (!requested?.column) {
    return null;
  }

  const requestedColumn =
    requested.column;

  /**
   * Preserve the previous identity/label column when available.
   * That lets the natural response pair each requested value with
   * the same person/project/municipality/etc. from the prior turn.
   */
  const previousIdentityColumn =
    previousPlan.labelColumn ||
    (
      Array.isArray(
        previousPlan.selectColumns
      )
        ? previousPlan.selectColumns.find(
            (column) =>
              column &&
              normalizeText(
                column
              ) !==
                normalizeText(
                  previousPlan.column ||
                  ""
                )
          )
        : null
    ) ||
    null;

  const selectColumns = [];

  if (
    previousIdentityColumn &&
    normalizeText(
      previousIdentityColumn
    ) !==
      normalizeText(
        requestedColumn
      )
  ) {
    selectColumns.push(
      previousIdentityColumn
    );
  }

  selectColumns.push(
    requestedColumn
  );

  return {
    route:
      "dataset",

    dataset:
      previousPlan.dataset,

    operation:
      "lookup",

    column:
      requestedColumn,

    labelColumn:
      previousIdentityColumn ||
      null,

    groupBy:
      null,

    aggregation:
      null,

    direction:
      null,

    filters:
      [],

    filterGroups:
      previousPlan.filterGroups.map(
        (group) => ({
          ...group,

          filters:
            Array.isArray(
              group?.filters
            )
              ? group.filters.map(
                  (filter) => ({
                    ...filter,

                    value:
                      Array.isArray(
                        filter?.value
                      )
                        ? [
                            ...filter.value,
                          ]
                        : filter?.value,
                  })
                )
              : [],
        })
      ),

    filterGroupLogic:
      previousPlan.filterGroupLogic ||
      "or",

    selectColumns,

    outputRequested:
      true,

    transform:
      null,

    limit:
      100,

    showAll:
      true,
  };
}


/**
 * ==========================================================
 * PREVIOUS-RESULT IDENTITY FOLLOW-UPS
 * ==========================================================
 *
 * Handles:
 *   "Who are those persons?"
 *   "Who are those employees?"
 *   "Show those records."
 *   "Which municipalities are those?"
 *
 * It uses the previous VERIFIED JavaScript result, not Groq prose.
 * No dashboard, worksheet, person, division, province, municipality,
 * or business field is hardcoded.
 */

function detectPreviousResultIdentityRequest(
  question
) {
  const text =
    normalizeText(question);

  if (!text) {
    return false;
  }

  const hasReference =
    /\b(those|these|them|the two)\b/i.test(
      text
    );

  if (!hasReference) {
    return false;
  }

  return (
    /\bwho\b/i.test(text) ||
    /\bwhich\b/i.test(text) ||
    /\bwhat\b/i.test(text) ||
    /\bshow\b/i.test(text) ||
    /\blist\b/i.test(text) ||
    /\bgive\b/i.test(text) ||
    /\bpersons?\b/i.test(text) ||
    /\bpeople\b/i.test(text) ||
    /\bemployees?\b/i.test(text) ||
    /\bincumbents?\b/i.test(text) ||
    /\bstaff\b/i.test(text) ||
    /\brecords?\b/i.test(text) ||
    /\brows?\b/i.test(text)
  );
}


function getDatasetSchema(
  schema,
  datasetName
) {
  return (
    (schema || []).find(
      (item) =>
        String(item?.name || "") ===
        String(datasetName || "")
    ) ||
    null
  );
}


function findPreviousResultIdentityColumn({
  schema,
  rows,
  datasetName,
  question,
  excludedColumns = [],
}) {
  const datasetSchema =
    getDatasetSchema(
      schema,
      datasetName
    );

  if (!datasetSchema) {
    return null;
  }

  const excluded =
    new Set(
      (excludedColumns || [])
        .filter(Boolean)
        .map(
          (column) =>
            normalizeText(column)
        )
    );

  // Honor a real field explicitly requested by the follow-up.
  const requested =
    inferRequestedColumnFromQuestion({
      schema,
      question,
      preferredDataset:
        datasetName,
      excludedColumns,
    });

  if (
    requested?.column &&
    !excluded.has(
      normalizeText(
        requested.column
      )
    )
  ) {
    return requested.column;
  }

  const normalizedQuestion =
    normalizeText(question);

  const asksForPerson =
    /\b(who|person|persons|people|employee|employees|incumbent|incumbents|staff)\b/i.test(
      normalizedQuestion
    );

  const candidates =
    (datasetSchema.columns || [])
      .filter(
        (column) =>
          column?.name &&
          !excluded.has(
            normalizeText(
              column.name
            )
          )
      )
      .map(
        (column, index) => {
          const name =
            normalizeText(
              column.name
            );

          let score =
            similarity(
              normalizedQuestion,
              name
            );

          const questionTokens =
            new Set(
              normalizedQuestion
                .split(/\s+/)
                .filter(Boolean)
            );

          const columnTokens =
            name
              .split(/\s+/)
              .filter(Boolean);

          if (
            columnTokens.length
          ) {
            const overlap =
              columnTokens.filter(
                (token) =>
                  questionTokens.has(token)
              ).length;

            score +=
              overlap /
              columnTokens.length;
          }

          if (asksForPerson) {
            if (
              /\b(full name|name of incumbent|employee name|person name)\b/.test(
                name
              )
            ) {
              score += 3;
            } else if (
              /\b(name|incumbent|employee|person|staff)\b/.test(
                name
              )
            ) {
              score += 2;
            } else if (
              /\b(first name|last name|surname)\b/.test(
                name
              )
            ) {
              score += 1;
            }
          }

          const samples =
            (rows || [])
              .slice(0, 40)
              .map(
                (row) =>
                  row?.[
                    column.name
                  ]
              )
              .filter(
                (value) =>
                  value !== null &&
                  value !== undefined &&
                  String(value).trim() !== ""
              );

          if (
            samples.some(
              (value) =>
                /[\p{L}]/u.test(
                  String(value)
                )
            )
          ) {
            score += 0.25;
          }

          if (
            samples.some(
              (value) =>
                /^[\p{L}.'-]+(?:\s+[\p{L}.'-]+)+$/u.test(
                  String(value).trim()
                )
            )
          ) {
            score += 0.25;
          }

          return {
            column:
              column.name,
            score,
            index,
          };
        })
      .sort(
        (a, b) =>
          b.score -
            a.score ||
          a.index -
            b.index
      );

  return (
    candidates[0]?.column ||
    null
  );
}


function valuesMatchForPreviousResult(
  actual,
  expected
) {
  if (
    actual === null ||
    actual === undefined ||
    expected === null ||
    expected === undefined
  ) {
    return false;
  }

  const actualNumber =
    parseNumber(actual);

  const expectedNumber =
    parseNumber(expected);

  if (
    actualNumber !== null &&
    expectedNumber !== null
  ) {
    const tolerance =
      Math.max(
        1e-9,
        Math.abs(
          expectedNumber
        ) * 1e-9
      );

    return (
      Math.abs(
        actualNumber -
        expectedNumber
      ) <= tolerance
    );
  }

  return (
    normalizeText(actual) ===
    normalizeText(expected)
  );
}


function buildPreviousResultIdentityPlan({
  datasets,
  schema,
  context,
  question,
}) {
  const previousPlan =
    context?.lastPlan;

  const previousResult =
    context?.lastResult;

  if (
    !previousPlan ||
    !previousResult ||
    previousPlan.route !==
      "dataset"
  ) {
    return null;
  }

  const datasetName =
    previousPlan.dataset;

  const groupColumn =
    previousPlan.groupBy;

  const metricColumn =
    previousPlan.column;

  const rows =
    datasets?.[
      datasetName
    ];

  if (
    !datasetName ||
    !groupColumn ||
    !metricColumn ||
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return null;
  }

  const verifiedRows =
    Array.isArray(
      previousResult.results
    )
      ? previousResult.results
      : [];

  if (!verifiedRows.length) {
    return null;
  }

  const identityColumn =
    findPreviousResultIdentityColumn({
      schema,
      rows,
      datasetName,
      question,
      excludedColumns: [
        groupColumn,
        metricColumn,
      ],
    });

  if (!identityColumn) {
    return null;
  }

  const filterGroups = [];
  const seen =
    new Set();

  for (
    const resultRow of
    verifiedRows
  ) {
    if (
      !resultRow ||
      typeof resultRow !==
        "object"
    ) {
      continue;
    }

    let groupValue =
      resultRow[
        groupColumn
      ];

    let metricValue =
      resultRow[
        metricColumn
      ];

    if (
      groupValue === undefined
    ) {
      groupValue =
        resultRow.label ??
        resultRow.group ??
        resultRow.groupValue;
    }

    if (
      metricValue === undefined
    ) {
      metricValue =
        resultRow.value ??
        resultRow.result ??
        resultRow.maximum ??
        resultRow.minimum ??
        resultRow.average ??
        resultRow.sum;
    }

    if (
      groupValue === undefined ||
      groupValue === null ||
      metricValue === undefined ||
      metricValue === null
    ) {
      continue;
    }

    // Resolve calculated values back to a real worksheet row.
    const matchingRow =
      rows.find(
        (row) =>
          valuesMatchForPreviousResult(
            row?.[
              groupColumn
            ],
            groupValue
          ) &&
          valuesMatchForPreviousResult(
            row?.[
              metricColumn
            ],
            metricValue
          )
      );

    if (!matchingRow) {
      continue;
    }

    const realGroupValue =
      matchingRow[
        groupColumn
      ];

    const realMetricValue =
      matchingRow[
        metricColumn
      ];

    const key = [
      normalizeText(
        realGroupValue
      ),
      normalizeText(
        realMetricValue
      ),
    ].join("::");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    filterGroups.push({
      logic:
        "and",

      filters: [
        {
          column:
            groupColumn,
          operator:
            "equals",
          value:
            realGroupValue,
        },

        {
          column:
            metricColumn,
          operator:
            "equals",
          value:
            realMetricValue,
        },
      ],
    });
  }

  if (!filterGroups.length) {
    return null;
  }

  return {
    route:
      "dataset",

    dataset:
      datasetName,

    operation:
      "lookup",

    column:
      identityColumn,

    labelColumn:
      identityColumn,

    groupBy:
      null,

    aggregation:
      null,

    direction:
      null,

    filters:
      [],

    filterGroups,

    filterGroupLogic:
      "or",

    selectColumns: [
      identityColumn,
      groupColumn,
      metricColumn,
    ],

    outputRequested:
      true,

    transform:
      null,

    limit:
      100,

    showAll:
      true,
  };
}


/**
 * ==========================================================
 * STEP 10 — DETECT ANALYTICAL COMPARISONS
 * ==========================================================
 *
 * Examples:
 *
 * "Who has the higher salary?"
 * "Which one is lower?"
 * "What is the difference?"
 * "Compare them."
 *
 * This does NOT perform calculations.
 *
 * It only determines which comparison operation
 * JavaScript should execute.
 */
function detectComparisonRequest(
  question
) {
  const text = String(
    question || ""
  )
    .toLowerCase()
    .trim();

  if (!text) {
    return null;
  }

  // ========================================================
  // PERCENTAGE COMPARISONS
  // ========================================================

  if (
    /\b(?:what|how much|how many)?\s*(?:is\s+the\s+)?percentage\s+difference\b/i.test(
      text
    ) ||
    /\bpercent(?:age)?\s+difference\b/i.test(
      text
    )
  ) {
    return "percentage_difference";
  }

  if (
    /\b(?:what|how much|how many)?\s*(?:percentage|percent)\s+higher\b/i.test(
      text
    ) ||
    /\bhow many percent higher\b/i.test(
      text
    )
  ) {
    return "percentage_higher";
  }

  if (
    /\b(?:what|how much|how many)?\s*(?:percentage|percent)\s+lower\b/i.test(
      text
    ) ||
    /\bhow many percent lower\b/i.test(
      text
    )
  ) {
    return "percentage_lower";
  }

  // ========================================================
  // RATIO / TIMES COMPARISON
  // ========================================================

  if (
    /\b(?:what(?:'s| is) )?(?:the )?ratio\b/i.test(
      text
    ) ||
    /\bhow many times\b/i.test(
      text
    ) ||
    /\b(?:times|x) (?:higher|larger|greater|more)\b/i.test(
      text
    )
  ) {
    return "ratio";
  }

  // ========================================================
  // PERCENT HIGHER / LOWER — conversational variants
  // ========================================================

  if (
    /\bby what percent(?:age)?\b/i.test(
      text
    ) ||
    /\bwhat percent(?:age)? (?:more|greater)\b/i.test(
      text
    )
  ) {
    return "percentage_higher";
  }

  if (
    /\bwhat percent(?:age)? less\b/i.test(
      text
    )
  ) {
    return "percentage_lower";
  }

  // ========================================================
  // DIFFERENCE
  // ========================================================

  if (
    /\b(?:what(?:'s| is) )?(?:the )?difference\b/i.test(
      text
    ) ||
    /\bhow much (?:more|less|higher|lower)\b/i.test(
      text
    )
  ) {
    return "difference";
  }

  // ========================================================
  // LOWER
  // ========================================================

  if (
    /\bwhich (?:one )?is (?:the )?lower\b/i.test(
      text
    ) ||
    /\bwho (?:has|have) (?:the )?lower\b/i.test(
      text
    ) ||
    /\bwhich (?:one )?has (?:the )?lower\b/i.test(
      text
    )
  ) {
    return "lower";
  }

  // ========================================================
  // HIGHER
  // ========================================================

  if (
    /\bwhich (?:one )?is (?:the )?higher\b/i.test(
      text
    ) ||
    /\bwho (?:has|have) (?:the )?higher\b/i.test(
      text
    ) ||
    /\bwhich (?:one )?has (?:the )?higher\b/i.test(
      text
    )
  ) {
    return "higher";
  }

  // ========================================================
  // GENERIC COMPARISON
  // ========================================================

  if (
    /\bcompare (?:them|those|the two)\b/i.test(
      text
    )
  ) {
    return "higher";
  }

  return null;
}


/**
 * ==========================================================
 * CONVERSATIONAL ANALYTICS V2 — RESULT COMPARISONS
 * ==========================================================
 *
 * Compare two values that were returned inside ONE verified grouped/
 * ranked analytical result.
 *
 * Example:
 *   Compare average X for Group A and Group B
 *   -> [{ label: A, value: ... }, { label: B, value: ... }]
 *
 * Follow-ups:
 *   "Which one is higher?"
 *   "What is the difference?"
 *   "What percentage higher?"
 *
 * This is fully schema/dataset agnostic.
 */

function formatAnalyticalNumber(
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


function getVerifiedAnalyticalPair(
  context
) {
  const lastResult =
    context?.lastResult;

  const lastPlan =
    context?.lastPlan;

  if (
    !lastResult ||
    !lastPlan ||
    lastResult.success === false
  ) {
    return null;
  }

  const operation =
    String(
      lastResult.operation ||
      lastPlan.operation ||
      ""
    )
      .trim()
      .toLowerCase();

  const isAnalytical =
    operation ===
      "rank_groups" ||
    operation ===
      "group_sum" ||
    operation ===
      "group_average" ||
    operation ===
      "group_minimum" ||
    operation ===
      "group_maximum" ||
    operation ===
      "group_count";

  if (!isAnalytical) {
    return null;
  }

  const usable =
    Array.isArray(
      lastResult.results
    )
      ? lastResult.results
          .map(
            (item) => ({
              label:
                item?.label ??
                null,

              value:
                Number(
                  item?.value
                ),
            })
          )
          .filter(
            (item) =>
              item.label !==
                null &&
              item.label !==
                undefined &&
              String(
                item.label
              ).trim() !==
                "" &&
              Number.isFinite(
                item.value
              )
          )
      : [];

  if (
    usable.length !== 2
  ) {
    return {
      ambiguous:
        usable.length > 2,

      count:
        usable.length,

      items:
        usable,

      metric:
        lastResult.column ||
        lastPlan.column ||
        "value",
    };
  }

  return {
    ambiguous:
      false,

    count:
      2,

    items:
      usable,

    metric:
      lastResult.column ||
      lastPlan.column ||
      "value",
  };
}



function cleanAnalyticalLabel(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /[\r\n]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    /*
     * Strip presentation-only Markdown that may have been stored in a
     * previous conversational result. This prevents labels such as
     * "*2024*" from becoming "***2024***" when rendered again.
     * Real inner punctuation is preserved.
     */
    .replace(
      /^(?:\*{1,3}|_{1,3}|`+)\s*/,
      ""
    )
    .replace(
      /\s*(?:\*{1,3}|_{1,3}|`+)$/,
      ""
    )
    .trim();
}


function getVerifiedAnalyticalSet(
  context
) {
  const lastResult =
    context?.lastResult;

  const lastPlan =
    context?.lastPlan;

  if (
    !lastResult ||
    !lastPlan ||
    lastResult.success === false
  ) {
    return null;
  }

  const operation =
    String(
      lastResult.operation ||
      lastPlan.operation ||
      ""
    )
      .trim()
      .toLowerCase();

  const isAnalytical =
    [
      "rank_groups",
      "rank_rows",
      "group_sum",
      "group_average",
      "group_minimum",
      "group_maximum",
      "group_count",
    ].includes(
      operation
    );

  if (!isAnalytical) {
    return null;
  }

  const items =
    Array.isArray(
      lastResult.results
    )
      ? lastResult.results
          .map(
            (item, index) => ({
              index,

              label:
                item?.label ??
                item?.name ??
                null,

              value:
                Number(
                  item?.value
                ),
            })
          )
          .filter(
            (item) =>
              item.label !==
                null &&
              item.label !==
                undefined &&
              cleanAnalyticalLabel(
                item.label
              ) !==
                "" &&
              Number.isFinite(
                item.value
              )
          )
      : [];

  if (!items.length) {
    return null;
  }

  return {
    items,

    count:
      items.length,

    metric:
      lastResult.column ||
      lastPlan.column ||
      "value",

    aggregation:
      lastResult.aggregation ||
      lastPlan.aggregation ||
      null,

    groupBy:
      lastResult.groupBy ||
      lastResult.labelColumn ||
      lastPlan.groupBy ||
      lastPlan.labelColumn ||
      "group",

    direction:
      lastResult.direction ||
      lastPlan.direction ||
      null,
  };
}


function detectRequestedResultSubset(
  question
) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return null;
  }

  const topMatch =
    text.match(
      /\b(?:top|first)\s+(\d{1,2})\b/
    );

  if (topMatch?.[1]) {
    return {
      direction:
        "top",
      limit:
        Math.max(
          1,
          Math.min(
            Number(
              topMatch[1]
            ),
            100
          )
        ),
    };
  }

  const bottomMatch =
    text.match(
      /\b(?:bottom|last)\s+(\d{1,2})\b/
    );

  if (bottomMatch?.[1]) {
    return {
      direction:
        "bottom",
      limit:
        Math.max(
          1,
          Math.min(
            Number(
              bottomMatch[1]
            ),
            100
          )
        ),
    };
  }

  return null;
}


function detectMultiResultIntent({
  question,
  mode,
}) {
  const text =
    normalizeText(
      question
    );

  const normalizedMode =
    String(
      mode || ""
    )
      .trim()
      .toLowerCase();

  if (
    /\b(?:explain|summarize|summary|interpret|what does this mean|what do these mean|tell me about|describe)\b/.test(
      text
    )
  ) {
    return "summary";
  }

  if (
    /\b(?:largest|biggest|greatest)\s+(?:gap|difference|drop)\b/.test(
      text
    ) ||
    /\bwhere is the biggest (?:gap|drop)\b/.test(
      text
    )
  ) {
    return "largest_gap";
  }

  if (
    /\b(?:smallest|closest|nearest)\s+(?:gap|difference|values?|pair)\b/.test(
      text
    ) ||
    /\bwhich (?:two|ones?) are closest\b/.test(
      text
    )
  ) {
    return "closest_pair";
  }

  if (
    /\b(?:above|higher than)\s+(?:the\s+)?(?:overall\s+)?average\b/.test(
      text
    )
  ) {
    return "above_average";
  }

  if (
    /\b(?:below|lower than)\s+(?:the\s+)?(?:overall\s+)?average\b/.test(
      text
    )
  ) {
    return "below_average";
  }

  if (
    /\b(?:outlier|outliers|stand out|stands out|unusual|extreme values?)\b/.test(
      text
    )
  ) {
    return "outliers";
  }

  if (
    /\bmedian\b/.test(
      text
    )
  ) {
    return "median";
  }

  if (
    /\b(?:average|mean)\s+(?:of\s+)?(?:these|them|the results?|the values?)\b/.test(
      text
    ) ||
    /\bwhat(?:'s| is) the average\b/.test(
      text
    )
  ) {
    return "average";
  }

  if (
    /\b(?:range|spread|overall difference|difference across|how spread out)\b/.test(
      text
    )
  ) {
    return "spread";
  }

  if (
    /\b(?:highest|largest|maximum|max|top one)\b/.test(
      text
    ) &&
    !/\bsecond|third|fourth|fifth|\d+(?:st|nd|rd|th)\b/.test(
      text
    )
  ) {
    return "highest";
  }

  if (
    /\b(?:lowest|smallest|minimum|min|bottom one)\b/.test(
      text
    ) &&
    !/\bsecond|third|fourth|fifth|\d+(?:st|nd|rd|th)\b/.test(
      text
    )
  ) {
    return "lowest";
  }

  if (
    /\b(?:trend|pattern|distribution|how do they compare|compare all|compare these|compare them)\b/.test(
      text
    )
  ) {
    return "summary";
  }

  if (
    normalizedMode ===
      "difference"
  ) {
    return "spread";
  }

  if (
    normalizedMode ===
      "ratio"
  ) {
    return "top_bottom_ratio";
  }

  if (
    normalizedMode ===
      "percentage_higher" ||
    normalizedMode ===
      "percentage_lower" ||
    normalizedMode ===
      "percentage_difference"
  ) {
    return normalizedMode;
  }

  if (
    normalizedMode ===
      "higher"
  ) {
    return "highest";
  }

  if (
    normalizedMode ===
      "lower"
  ) {
    return "lowest";
  }

  return "summary";
}


function findExplicitAnalyticalItems({
  items,
  question,
}) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return [];
  }

  const matches =
    items
      .filter(
        (item) => {
          const label =
            normalizeText(
              item.label
            );

          if (!label) {
            return false;
          }

          const escaped =
            label.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            );

          return new RegExp(
            `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
            "u"
          ).test(
            text
          );
        }
      );

  if (
    matches.length >= 2
  ) {
    return matches.slice(
      0,
      2
    );
  }

  const ordinalMap = [
    ["first", 0],
    ["second", 1],
    ["third", 2],
    ["fourth", 3],
    ["fifth", 4],
    ["sixth", 5],
    ["seventh", 6],
    ["eighth", 7],
    ["ninth", 8],
    ["tenth", 9],
  ];

  const ordinalIndexes = [];

  for (
    const [word, index]
    of ordinalMap
  ) {
    if (
      new RegExp(
        `\\b${word}\\b`
      ).test(
        text
      )
    ) {
      ordinalIndexes.push(
        index
      );
    }
  }

  const numericRefs =
    [
      ...text.matchAll(
        /(?:#|number\s+)?(\d{1,2})(?:st|nd|rd|th)?/g
      ),
    ]
      .map(
        (match) =>
          Number(
            match[1]
          ) - 1
      )
      .filter(
        (index) =>
          Number.isInteger(
            index
          ) &&
          index >= 0 &&
          index < items.length
      );

  const indexes = [
    ...new Set([
      ...ordinalIndexes,
      ...numericRefs,
    ]),
  ];

  if (
    indexes.length >= 2
  ) {
    return indexes
      .slice(
        0,
        2
      )
      .map(
        (index) =>
          items[index]
      )
      .filter(Boolean);
  }

  if (
    /\b(?:highest|top|first)\b/.test(
      text
    ) &&
    /\b(?:lowest|bottom|last)\b/.test(
      text
    )
  ) {
    const sorted =
      [...items].sort(
        (a, b) =>
          b.value -
          a.value
      );

    return [
      sorted[0],
      sorted[
        sorted.length - 1
      ],
    ].filter(Boolean);
  }

  return matches;
}


function calculateMedian(
  values
) {
  const sorted =
    [...values].sort(
      (a, b) =>
        a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2
  ) {
    return sorted[
      middle
    ];
  }

  return (
    sorted[
      middle - 1
    ] +
    sorted[
      middle
    ]
  ) / 2;
}


function analyzeVerifiedAnalyticalSet({
  context,
  question,
  mode,
}) {
  const set =
    getVerifiedAnalyticalSet(
      context
    );

  if (
    !set ||
    set.count < 2
  ) {
    return null;
  }

  const metric =
    cleanAnalyticalLabel(
      set.metric
    );

  const groupLabel =
    cleanAnalyticalLabel(
      set.groupBy
    );

  const explicitPair =
    findExplicitAnalyticalItems({
      items:
        set.items,
      question,
    });

  if (
    explicitPair.length === 2
  ) {
    const [
      left,
      right,
    ] = explicitPair;

    const difference =
      Math.abs(
        left.value -
        right.value
      );

    const higher =
      left.value >= right.value
        ? left
        : right;

    const lower =
      left.value <= right.value
        ? left
        : right;

    const normalizedMode =
      String(
        mode || "difference"
      )
        .trim()
        .toLowerCase();

    if (
      normalizedMode ===
        "ratio"
    ) {
      if (
        Math.abs(
          lower.value
        ) === 0
      ) {
        return {
          success: false,
          source:
            "conversation-analytics",
          operation:
            "clarify",
          answer:
            `I can't calculate the ratio because ${cleanAnalyticalLabel(
              lower.label
            )}'s ${metric} is zero.`,
        };
      }

      const ratio =
        Math.abs(
          higher.value
        ) /
        Math.abs(
          lower.value
        );

      return {
        success: true,
        source:
          "conversation-analytics",
        operation:
          "ratio",
        metric,
        results:
          explicitPair,
        ratio,
        answer:
          `${cleanAnalyticalLabel(
            higher.label
          )}'s ${metric} is approximately ${formatAnalyticalNumber(
            ratio
          )} times ${cleanAnalyticalLabel(
            lower.label
          )}'s.`,
      };
    }

    if (
      normalizedMode ===
        "percentage_higher" ||
      normalizedMode ===
        "percentage_lower"
    ) {
      const denominator =
        normalizedMode ===
          "percentage_higher"
          ? Math.abs(
              lower.value
            )
          : Math.abs(
              higher.value
            );

      if (denominator === 0) {
        return {
          success: false,
          source:
            "conversation-analytics",
          operation:
            "clarify",
          answer:
            "I can't calculate that percentage because the comparison baseline is zero.",
        };
      }

      const percentage =
        difference /
        denominator *
        100;

      return {
        success: true,
        source:
          "conversation-analytics",
        operation:
          normalizedMode,
        metric,
        results:
          explicitPair,
        percentage,
        answer:
          normalizedMode ===
            "percentage_higher"
            ? `${cleanAnalyticalLabel(
                higher.label
              )} is ${formatAnalyticalNumber(
                percentage
              )}% higher than ${cleanAnalyticalLabel(
                lower.label
              )} for ${metric}.`
            : `${cleanAnalyticalLabel(
                lower.label
              )} is ${formatAnalyticalNumber(
                percentage
              )}% lower than ${cleanAnalyticalLabel(
                higher.label
              )} for ${metric}.`,
      };
    }

    if (
      normalizedMode ===
        "higher"
    ) {
      return {
        success: true,
        source:
          "conversation-analytics",
        operation:
          "compare",
        metric,
        results:
          explicitPair,
        winner:
          higher.label,
        answer:
          `${cleanAnalyticalLabel(
            higher.label
          )} is higher at ${formatAnalyticalNumber(
            higher.value
          )}, compared with ${cleanAnalyticalLabel(
            lower.label
          )} at ${formatAnalyticalNumber(
            lower.value
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
          "conversation-analytics",
        operation:
          "compare",
        metric,
        results:
          explicitPair,
        winner:
          lower.label,
        answer:
          `${cleanAnalyticalLabel(
            lower.label
          )} is lower at ${formatAnalyticalNumber(
            lower.value
          )}, compared with ${cleanAnalyticalLabel(
            higher.label
          )} at ${formatAnalyticalNumber(
            higher.value
          )}.`,
      };
    }

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "difference",
      metric,
      results:
        explicitPair,
      difference,
      answer:
        `The difference between ${cleanAnalyticalLabel(
          left.label
        )} and ${cleanAnalyticalLabel(
          right.label
        )} for ${metric} is ${formatAnalyticalNumber(
          difference
        )}.`,
    };
  }

  const sortedDesc =
    [...set.items].sort(
      (a, b) =>
        b.value -
        a.value
    );

  const highest =
    sortedDesc[0];

  const lowest =
    sortedDesc[
      sortedDesc.length - 1
    ];

  const values =
    set.items.map(
      (item) =>
        item.value
    );

  const average =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length;

  const median =
    calculateMedian(
      values
    );

  const range =
    highest.value -
    lowest.value;

  const sortedByValue =
    [...set.items].sort(
      (a, b) =>
        b.value -
        a.value
    );

  const adjacentGaps = [];

  for (
    let index = 0;
    index <
      sortedByValue.length - 1;
    index += 1
  ) {
    const upper =
      sortedByValue[index];

    const lower =
      sortedByValue[
        index + 1
      ];

    adjacentGaps.push({
      upper,
      lower,
      gap:
        Math.abs(
          upper.value -
          lower.value
        ),
    });
  }

  const largestGap =
    [...adjacentGaps].sort(
      (a, b) =>
        b.gap -
        a.gap
    )[0] ||
    null;

  const closestPair =
    [...adjacentGaps].sort(
      (a, b) =>
        a.gap -
        b.gap
    )[0] ||
    null;

  const subset =
    detectRequestedResultSubset(
      question
    );

  if (subset) {
    const chosen =
      subset.direction ===
        "top"
        ? sortedDesc.slice(
            0,
            subset.limit
          )
        : [...sortedDesc]
            .reverse()
            .slice(
              0,
              subset.limit
            );

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "multi_result_subset",
      metric,
      groupBy:
        groupLabel,
      results:
        chosen,
      answer:
        `${subset.direction === "top" ? "Top" : "Bottom"} ${chosen.length} ${groupLabel.toLowerCase()}${chosen.length === 1 ? "" : "s"} by ${metric}:\n\n` +
        chosen
          .map(
            (item, index) =>
              `${index + 1}. **${cleanAnalyticalLabel(
                item.label
              )}** — ${formatAnalyticalNumber(
                item.value
              )}`
          )
          .join(
            "\n"
          ),
    };
  }

  const intent =
    detectMultiResultIntent({
      question,
      mode,
    });

  if (
    intent ===
      "highest"
  ) {
    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "multi_result_highest",
      metric,
      result:
        highest,
      answer:
        `${cleanAnalyticalLabel(
          highest.label
        )} is the highest at ${formatAnalyticalNumber(
          highest.value
        )} for ${metric}.`,
    };
  }

  if (
    intent ===
      "lowest"
  ) {
    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "multi_result_lowest",
      metric,
      result:
        lowest,
      answer:
        `${cleanAnalyticalLabel(
          lowest.label
        )} is the lowest at ${formatAnalyticalNumber(
          lowest.value
        )} for ${metric}.`,
    };
  }

  if (
    intent ===
      "average"
  ) {
    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "multi_result_average",
      metric,
      average,
      answer:
        `The average ${metric} across these ${set.count} results is ${formatAnalyticalNumber(
          average
        )}.`,
    };
  }

  if (
    intent ===
      "median"
  ) {
    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "multi_result_median",
      metric,
      median,
      answer:
        `The median ${metric} across these ${set.count} results is ${formatAnalyticalNumber(
          median
        )}.`,
    };
  }

  if (
    intent ===
      "above_average" ||
    intent ===
      "below_average"
  ) {
    const matched =
      set.items.filter(
        (item) =>
          intent ===
            "above_average"
            ? item.value >
              average
            : item.value <
              average
      );

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        intent,
      metric,
      average,
      results:
        matched,
      answer:
        `${matched.length} of the ${set.count} ${groupLabel.toLowerCase()}${set.count === 1 ? "" : "s"} are ${intent === "above_average" ? "above" : "below"} the returned-results average of ${formatAnalyticalNumber(
          average
        )}:\n\n` +
        (
          matched.length
            ? matched
                .sort(
                  (a, b) =>
                    b.value -
                    a.value
                )
                .map(
                  (item) =>
                    `- **${cleanAnalyticalLabel(
                      item.label
                    )}** — ${formatAnalyticalNumber(
                      item.value
                    )}`
                )
                .join(
                  "\n"
                )
            : "None."
        ),
    };
  }

  if (
    intent ===
      "largest_gap" &&
    largestGap
  ) {
    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "largest_gap",
      metric,
      gap:
        largestGap.gap,
      results: [
        largestGap.upper,
        largestGap.lower,
      ],
      answer:
        `The largest gap is between ${cleanAnalyticalLabel(
          largestGap.upper.label
        )} (${formatAnalyticalNumber(
          largestGap.upper.value
        )}) and ${cleanAnalyticalLabel(
          largestGap.lower.label
        )} (${formatAnalyticalNumber(
          largestGap.lower.value
        )}), a difference of ${formatAnalyticalNumber(
          largestGap.gap
        )}.`,
    };
  }

  if (
    intent ===
      "closest_pair" &&
    closestPair
  ) {
    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "closest_pair",
      metric,
      gap:
        closestPair.gap,
      results: [
        closestPair.upper,
        closestPair.lower,
      ],
      answer:
        `${cleanAnalyticalLabel(
          closestPair.upper.label
        )} and ${cleanAnalyticalLabel(
          closestPair.lower.label
        )} are the closest, separated by ${formatAnalyticalNumber(
          closestPair.gap
        )}.`,
    };
  }

  if (
    intent ===
      "top_bottom_ratio"
  ) {
    if (
      Math.abs(
        lowest.value
      ) === 0
    ) {
      return {
        success: false,
        source:
          "conversation-analytics",
        operation:
          "clarify",
        answer:
          `I can't calculate the highest-to-lowest ratio because ${cleanAnalyticalLabel(
            lowest.label
          )}'s ${metric} is zero.`,
      };
    }

    const ratio =
      Math.abs(
        highest.value
      ) /
      Math.abs(
        lowest.value
      );

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "top_bottom_ratio",
      metric,
      ratio,
      results: [
        highest,
        lowest,
      ],
      answer:
        `${cleanAnalyticalLabel(
          highest.label
        )}'s ${metric} is approximately ${formatAnalyticalNumber(
          ratio
        )} times ${cleanAnalyticalLabel(
          lowest.label
        )}'s.`,
    };
  }

  if (
    intent ===
      "percentage_higher" ||
    intent ===
      "percentage_lower"
  ) {
    const denominator =
      intent ===
        "percentage_higher"
        ? Math.abs(
            lowest.value
          )
        : Math.abs(
            highest.value
          );

    if (denominator === 0) {
      return {
        success: false,
        source:
          "conversation-analytics",
        operation:
          "clarify",
        answer:
          "I can't calculate that percentage because the comparison baseline is zero.",
      };
    }

    const percentage =
      range /
      denominator *
      100;

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        intent,
      metric,
      percentage,
      results: [
        highest,
        lowest,
      ],
      answer:
        intent ===
          "percentage_higher"
          ? `${cleanAnalyticalLabel(
              highest.label
            )} is ${formatAnalyticalNumber(
              percentage
            )}% higher than ${cleanAnalyticalLabel(
              lowest.label
            )} among these results.`
          : `${cleanAnalyticalLabel(
              lowest.label
            )} is ${formatAnalyticalNumber(
              percentage
            )}% lower than ${cleanAnalyticalLabel(
              highest.label
            )} among these results.`,
    };
  }

  if (
    intent ===
      "percentage_difference"
  ) {
    const denominator =
      (
        Math.abs(
          highest.value
        ) +
        Math.abs(
          lowest.value
        )
      ) / 2;

    const percentage =
      denominator === 0
        ? 0
        : range /
          denominator *
          100;

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "percentage_difference",
      metric,
      percentage,
      results: [
        highest,
        lowest,
      ],
      answer:
        `The percentage difference between the highest and lowest ${metric} in these results is ${formatAnalyticalNumber(
          percentage
        )}%.`,
    };
  }

  if (
    intent ===
      "outliers"
  ) {
    const sortedValues =
      [...values].sort(
        (a, b) =>
          a - b
      );

    const percentile = (
      arr,
      p
    ) => {
      if (
        arr.length === 1
      ) {
        return arr[0];
      }

      const position =
        (
          arr.length - 1
        ) * p;

      const lowerIndex =
        Math.floor(
          position
        );

      const upperIndex =
        Math.ceil(
          position
        );

      if (
        lowerIndex ===
        upperIndex
      ) {
        return arr[
          lowerIndex
        ];
      }

      const weight =
        position -
        lowerIndex;

      return (
        arr[
          lowerIndex
        ] *
          (
            1 - weight
          ) +
        arr[
          upperIndex
        ] *
          weight
      );
    };

    const q1 =
      percentile(
        sortedValues,
        0.25
      );

    const q3 =
      percentile(
        sortedValues,
        0.75
      );

    const iqr =
      q3 - q1;

    let outliers =
      set.items.filter(
        (item) =>
          item.value <
            q1 -
              1.5 *
                iqr ||
          item.value >
            q3 +
              1.5 *
                iqr
      );

    if (
      !outliers.length
    ) {
      const farthest =
        [...set.items].sort(
          (a, b) =>
            Math.abs(
              b.value -
              average
            ) -
            Math.abs(
              a.value -
              average
            )
        )[0];

      return {
        success: true,
        source:
          "conversation-analytics",
        operation:
          "outliers",
        metric,
        results:
          [],
        standout:
          farthest,
        answer:
          `No clear 1.5×IQR outlier appears among these ${set.count} values. The value farthest from their average is ${cleanAnalyticalLabel(
            farthest.label
          )} at ${formatAnalyticalNumber(
            farthest.value
          )}.`,
      };
    }

    outliers =
      outliers.sort(
        (a, b) =>
          b.value -
          a.value
      );

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "outliers",
      metric,
      results:
        outliers,
      answer:
        `Using the 1.5×IQR rule, ${outliers.length} result${outliers.length === 1 ? "" : "s"} stand out as outliers:\n\n` +
        outliers
          .map(
            (item) =>
              `- **${cleanAnalyticalLabel(
                item.label
              )}** — ${formatAnalyticalNumber(
                item.value
              )}`
          )
          .join(
            "\n"
          ),
    };
  }

  const summaryParts = [
    `${cleanAnalyticalLabel(
      highest.label
    )} is highest at ${formatAnalyticalNumber(
      highest.value
    )}, while ${cleanAnalyticalLabel(
      lowest.label
    )} is lowest at ${formatAnalyticalNumber(
      lowest.value
    )}.`,
    `The overall range is ${formatAnalyticalNumber(
      range
    )}.`,
    `The average of these ${set.count} returned values is ${formatAnalyticalNumber(
      average
    )}, and the median is ${formatAnalyticalNumber(
      median
    )}.`,
  ];

  if (
    largestGap
  ) {
    summaryParts.push(
      `The largest adjacent gap is ${formatAnalyticalNumber(
        largestGap.gap
      )}, between ${cleanAnalyticalLabel(
        largestGap.upper.label
      )} and ${cleanAnalyticalLabel(
        largestGap.lower.label
      )}.`
    );
  }

  return {
    success: true,
    source:
      "conversation-analytics",
    operation:
      intent ===
        "spread"
        ? "multi_result_spread"
        : "multi_result_summary",
    metric,
    groupBy:
      groupLabel,
    count:
      set.count,
    highest,
    lowest,
    range,
    average,
    median,
    largestGap,
    answer:
      summaryParts.join(
        " "
      ),
  };
}


function compareVerifiedAnalyticalPair({
  context,
  mode,
  question = "",
}) {
  const pair =
    getVerifiedAnalyticalPair(
      context
    );

  if (!pair) {
    return null;
  }

  if (
    pair.ambiguous
  ) {
    return analyzeVerifiedAnalyticalSet({
      context,
      question,
      mode,
    });
  }

  if (
    pair.count !== 2
  ) {
    return null;
  }

  const [
    left,
    right,
  ] = pair.items;

  const difference =
    Math.abs(
      left.value -
      right.value
    );

  const higher =
    left.value >=
    right.value
      ? left
      : right;

  const lower =
    left.value <=
    right.value
      ? left
      : right;

  const normalizedMode =
    String(
      mode || "higher"
    )
      .trim()
      .toLowerCase();

  if (
    normalizedMode ===
      "ratio"
  ) {
    const denominator =
      Math.abs(
        lower.value
      );

    if (denominator === 0) {
      return {
        success: false,
        source:
          "conversation-analytics",
        operation:
          "clarify",
        answer:
          `I can't calculate the ratio because ${lower.label}'s ${pair.metric} is zero.`,
      };
    }

    const ratio =
      Math.abs(
        higher.value
      ) / denominator;

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "ratio",

      metric:
        pair.metric,

      leftLabel:
        left.label,
      rightLabel:
        right.label,

      leftValue:
        left.value,
      rightValue:
        right.value,

      ratio,

      answer:
        `${higher.label}'s ${pair.metric} is approximately ${formatAnalyticalNumber(
          ratio
        )} times ${lower.label}'s.`,
    };
  }

  if (
    normalizedMode ===
      "difference"
  ) {
    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "difference",

      metric:
        pair.metric,

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
        `The difference between ${left.label} and ${right.label} for ${pair.metric} is ${formatAnalyticalNumber(
          difference
        )}.`,
    };
  }

  if (
    normalizedMode ===
      "percentage_higher" ||
    normalizedMode ===
      "percentage_lower" ||
    normalizedMode ===
      "percentage_difference"
  ) {
    let percentage = null;
    let answer = "";

    if (
      normalizedMode ===
        "percentage_higher"
    ) {
      const denominator =
        Math.abs(
          lower.value
        );

      if (denominator === 0) {
        return {
          success: false,
          source:
            "conversation-analytics",
          operation:
            "clarify",
          answer:
            `I can't calculate how many percent higher ${higher.label} is because the comparison baseline is zero.`,
        };
      }

      percentage =
        difference /
        denominator *
        100;

      answer =
        `${higher.label} is ${formatAnalyticalNumber(
          percentage
        )}% higher than ${lower.label} for ${pair.metric}.`;
    } else if (
      normalizedMode ===
        "percentage_lower"
    ) {
      const denominator =
        Math.abs(
          higher.value
        );

      if (denominator === 0) {
        return {
          success: false,
          source:
            "conversation-analytics",
          operation:
            "clarify",
          answer:
            `I can't calculate how many percent lower ${lower.label} is because the comparison baseline is zero.`,
        };
      }

      percentage =
        difference /
        denominator *
        100;

      answer =
        `${lower.label} is ${formatAnalyticalNumber(
          percentage
        )}% lower than ${higher.label} for ${pair.metric}.`;
    } else {
      const denominator =
        (
          Math.abs(
            left.value
          ) +
          Math.abs(
            right.value
          )
        ) / 2;

      percentage =
        denominator === 0
          ? 0
          : difference /
            denominator *
            100;

      answer =
        `The percentage difference between ${left.label} and ${right.label} for ${pair.metric} is ${formatAnalyticalNumber(
          percentage
        )}%.`;
    }

    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        normalizedMode,

      metric:
        pair.metric,

      leftLabel:
        left.label,
      rightLabel:
        right.label,

      leftValue:
        left.value,
      rightValue:
        right.value,

      difference,
      percentage,

      answer,
    };
  }

  if (
    left.value ===
    right.value
  ) {
    return {
      success: true,
      source:
        "conversation-analytics",
      operation:
        "compare",

      metric:
        pair.metric,

      leftLabel:
        left.label,
      rightLabel:
        right.label,

      leftValue:
        left.value,
      rightValue:
        right.value,

      difference:
        0,

      answer:
        `${left.label} and ${right.label} have the same ${pair.metric}: ${formatAnalyticalNumber(
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
        "conversation-analytics",
      operation:
        "compare",

      metric:
        pair.metric,

      winner:
        lower.label,

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
        `${lower.label} has the lower ${pair.metric} at ${formatAnalyticalNumber(
          lower.value
        )}.`,
    };
  }

  return {
    success: true,
    source:
      "conversation-analytics",
    operation:
      "compare",

    metric:
      pair.metric,

    winner:
      higher.label,

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
      `${higher.label} has the higher ${pair.metric} at ${formatAnalyticalNumber(
        higher.value
      )}.`,
  };
}



/**
 * ==========================================================
 * ORDINAL ANALYTICAL RESPONSE HELPERS
 * ==========================================================
 *
 * These helpers are schema/dataset agnostic.
 *
 * They only describe a VERIFIED ranked result that has already been
 * calculated by calculationEngine.js.
 */

function formatConversationNumber(
  value
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return String(
      value ?? ""
    );
  }

  return numeric.toLocaleString(
    "en-US",
    {
      maximumFractionDigits:
        2,
    }
  );
}


function ordinalLabel(
  position
) {
  const value =
    Number(position);

  const words = {
    1: "highest",
    2: "second highest",
    3: "third highest",
    4: "fourth highest",
    5: "fifth highest",
    6: "sixth highest",
    7: "seventh highest",
    8: "eighth highest",
    9: "ninth highest",
    10: "tenth highest",
  };

  return (
    words[value] ||
    `${value}${(
      value % 100 >= 11 &&
      value % 100 <= 13
    )
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th"} highest`
  );
}


function ordinalDirectionLabel(
  position,
  direction
) {
  const base =
    ordinalLabel(
      position
    );

  if (
    String(
      direction || ""
    )
      .trim()
      .toLowerCase() ===
      "asc"
  ) {
    return base.replace(
      /highest$/,
      "lowest"
    );
  }

  return base;
}


function buildOrdinalAnalyticalAnswer({
  result,
  plan,
}) {
  const item =
    Array.isArray(
      result?.results
    )
      ? result.results[0]
      : null;

  if (
    !item ||
    item.label ===
      null ||
    item.label ===
      undefined ||
    !Number.isFinite(
      Number(
        item.value
      )
    )
  ) {
    return null;
  }

  const position =
    Number(
      result?.rankPosition ||
      (
        Number.isInteger(
          plan?.analyticalRankIndex
        )
          ? plan.analyticalRankIndex +
            1
          : 1
      )
    );

  const rankText =
    ordinalDirectionLabel(
      position,
      plan?.direction ||
      result?.direction
    );

  const groupLabel =
    String(
      result?.labelColumn ||
      result?.groupBy ||
      plan?.labelColumn ||
      plan?.groupBy ||
      "group"
    )
      .replace(
        /[\r\n]+/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const metricLabel =
    String(
      result?.column ||
      plan?.column ||
      "value"
    )
      .replace(
        /[\r\n]+/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const aggregation =
    String(
      result?.aggregation ||
      plan?.aggregation ||
      ""
    )
      .trim()
      .toLowerCase();

  const aggregationText =
    aggregation === "average"
      ? "average "
      : aggregation === "sum"
        ? "total "
        : aggregation === "count"
          ? "count of "
          : "";

  return (
    `The ${rankText} ${groupLabel.toLowerCase()} ` +
    `by ${aggregationText}${metricLabel.toLowerCase()} is ` +
    `**${item.label}**, at ${formatConversationNumber(
      item.value
    )}.`
  );
}



/**
 * ==========================================================
 * DETERMINISTIC MULTI-CATEGORY COUNT RESOLVER
 * ==========================================================
 *
 * Handles count questions that mention multiple real category
 * values, even when those values live in different columns.
 *
 * No worksheet names, column names, category values, project
 * names, report names, or IDs are hardcoded.
 */

function containsNormalizedPhrase(
  normalizedQuestion,
  normalizedValue
) {
  const questionText =
    String(
      normalizedQuestion || ""
    ).trim();

  const valueText =
    String(
      normalizedValue || ""
    ).trim();

  if (
    !questionText ||
    !valueText
  ) {
    return -1;
  }

  const paddedQuestion =
    ` ${questionText} `;

  const paddedValue =
    ` ${valueText} `;

  const index =
    paddedQuestion.indexOf(
      paddedValue
    );

  return index < 0
    ? -1
    : Math.max(
        0,
        index - 1
      );
}


function isUsefulCategoryColumn(
  rows,
  column
) {
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

  if (
    values.length < 2
  ) {
    return false;
  }

  const uniqueTextValues =
    new Set();

  for (
    const rawValue of
    values
  ) {
    const display =
      String(
        rawValue
      ).trim();

    if (
      !display ||
      parseNumber(display) !== null
    ) {
      continue;
    }

    const normalized =
      normalizeText(
        display
      );

    if (
      !normalized
    ) {
      continue;
    }

    const words =
      normalized
        .split(/\s+/)
        .filter(Boolean);

    if (
      words.length > 7 ||
      normalized.length > 80
    ) {
      continue;
    }

    uniqueTextValues.add(
      normalized
    );
  }

  const uniqueCount =
    uniqueTextValues.size;

  if (
    uniqueCount < 2
  ) {
    return false;
  }

  const maxUsefulDistinct =
    Math.min(
      80,
      Math.max(
        12,
        Math.ceil(
          rows.length * 0.65
        )
      )
    );

  return (
    uniqueCount <=
    maxUsefulDistinct
  );
}


function findMentionedCategoriesInDataset({
  rows,
  question,
}) {
  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return [];
  }

  const normalizedQuestion =
    normalizeText(
      question
    );

  if (
    !normalizedQuestion
  ) {
    return [];
  }

  const columns =
    Array.from(
      new Set(
        rows.flatMap(
          (row) =>
            Object.keys(
              row || {}
            )
        )
      )
    );

  const candidates = [];

  for (
    const column of
    columns
  ) {
    if (
      !isUsefulCategoryColumn(
        rows,
        column
      )
    ) {
      continue;
    }

    const distinctValues =
      new Map();

    for (
      const row of
      rows
    ) {
      const rawValue =
        row?.[column];

      if (
        rawValue === null ||
        rawValue === undefined
      ) {
        continue;
      }

      const displayValue =
        String(
          rawValue
        ).trim();

      if (
        !displayValue ||
        parseNumber(
          displayValue
        ) !== null
      ) {
        continue;
      }

      const normalizedValue =
        normalizeText(
          displayValue
        );

      if (
        !normalizedValue ||
        normalizedValue.length < 2
      ) {
        continue;
      }

      const words =
        normalizedValue
          .split(/\s+/)
          .filter(Boolean);

      if (
        words.length > 7 ||
        normalizedValue.length > 80
      ) {
        continue;
      }

      if (
        !distinctValues.has(
          normalizedValue
        )
      ) {
        distinctValues.set(
          normalizedValue,
          displayValue
        );
      }
    }

    for (
      const [
        normalizedValue,
        displayValue,
      ] of
      distinctValues.entries()
    ) {
      const mentionIndex =
        containsNormalizedPhrase(
          normalizedQuestion,
          normalizedValue
        );

      if (
        mentionIndex < 0
      ) {
        continue;
      }

      candidates.push({
        column,
        value:
          displayValue,
        normalizedValue,
        mentionIndex,
      });
    }
  }

  const distinctCountCache =
    new Map();

  const getDistinctCount =
    (columnName) => {
      if (
        distinctCountCache.has(
          columnName
        )
      ) {
        return distinctCountCache.get(
          columnName
        );
      }

      const count =
        new Set(
          rows
            .map(
              (row) =>
                normalizeText(
                  row?.[
                    columnName
                  ]
                )
            )
            .filter(Boolean)
        ).size;

      distinctCountCache.set(
        columnName,
        count
      );

      return count;
    };

  const byValue =
    new Map();

  for (
    const candidate of
    candidates
  ) {
    const key =
      candidate.normalizedValue;

    const previous =
      byValue.get(
        key
      );

    if (
      !previous ||
      getDistinctCount(
        candidate.column
      ) <
      getDistinctCount(
        previous.column
      )
    ) {
      byValue.set(
        key,
        candidate
      );
    }
  }

  let uniqueCandidates =
    Array.from(
      byValue.values()
    );

  uniqueCandidates =
    uniqueCandidates.filter(
      (candidate) =>
        !uniqueCandidates.some(
          (other) => {
            if (
              other === candidate
            ) {
              return false;
            }

            const candidateStart =
              candidate.mentionIndex;

            const candidateEnd =
              candidateStart +
              candidate
                .normalizedValue
                .length;

            const otherStart =
              other.mentionIndex;

            const otherEnd =
              otherStart +
              other
                .normalizedValue
                .length;

            const overlaps =
              candidateStart <
                otherEnd &&
              otherStart <
                candidateEnd;

            return (
              overlaps &&
              other
                .normalizedValue
                .length >
                candidate
                  .normalizedValue
                  .length
            );
          }
        )
    );

  uniqueCandidates.sort(
    (a, b) =>
      a.mentionIndex -
        b.mentionIndex ||
      b.normalizedValue.length -
        a.normalizedValue.length
  );

  return uniqueCandidates;
}


function buildMultiCategoryCountResolution({
  datasets,
  question,
  preferredDataset,
}) {
  const isCountQuestion =
    /\b(?:how many|number of|count(?: of)?|counts? of)\b/i.test(
      String(
        question || ""
      )
    );

  if (
    !isCountQuestion
  ) {
    return null;
  }

  const ranked = [];

  for (
    const [
      datasetName,
      rows,
    ] of
    Object.entries(
      datasets || {}
    )
  ) {
    const categories =
      findMentionedCategoriesInDataset({
        rows,
        question,
      });

    if (
      categories.length < 2
    ) {
      continue;
    }

    ranked.push({
      datasetName,
      rows,
      categories,
      preferred:
        preferredDataset &&
        datasetName ===
          preferredDataset
          ? 1
          : 0,
    });
  }

  if (
    !ranked.length
  ) {
    return null;
  }

  ranked.sort(
    (a, b) =>
      b.categories.length -
        a.categories.length ||
      b.preferred -
        a.preferred
  );

  const best =
    ranked[0];

  const second =
    ranked[1];

  if (
    second &&
    second.categories.length ===
      best.categories.length &&
    second.preferred ===
      best.preferred
  ) {
    return null;
  }

  const categoryResults =
    best.categories.map(
      (category) => {
        const target =
          normalizeText(
            category.value
          );

        const count =
          best.rows.reduce(
            (
              total,
              row
            ) =>
              normalizeText(
                row?.[
                  category.column
                ]
              ) === target
                ? total + 1
                : total,
            0
          );

        return {
          column:
            category.column,
          value:
            category.value,
          count,
        };
      }
    );

  if (
    categoryResults.length < 2
  ) {
    return null;
  }

  const answer =
    categoryResults
      .map(
        (item) =>
          `${item.value}: ${item.count}`
      )
      .join("; ") +
    ".";

  const plan = {
    route:
      "dataset",
    dataset:
      best.datasetName,
    operation:
      "multi_category_count",
    categories:
      categoryResults.map(
        (item) => ({
          column:
            item.column,
          operator:
            "equals",
          value:
            item.value,
        })
      ),
    outputRequested:
      true,
  };

  const result = {
    success:
      true,
    source:
      "dataset",
    dataset:
      best.datasetName,
    operation:
      "multi_category_count",
    categories:
      categoryResults,
    answer,
    responseStyle:
      "natural",
    debugPlan:
      plan,
    debugEntityChanges:
      [],
  };

  return {
    plan,
    result,
  };
}


/**
 * ==========================================================
 * GENERIC COMPOUND / MULTI-QUESTION SPLITTER
 * ==========================================================
 *
 * Allows multiple independent questions/calculations inside one
 * message while preserving normal category lists.
 *
 * No dataset, worksheet, field, category, or business term is
 * hardcoded.
 */


module.exports = {
  getUniqueColumnValues,
  tokenSimilarity,
  buildQuestionNgrams,
  questionValueMatchScore,
  questionContainsValue,
  collectQuestionMatchesForColumn,
  hasExplicitMultiEntityRequest,
  repairMultiEntityFilters,
  detectAnalyticalAggregationFollowUp,
  detectAnalyticalRankIndexFollowUp,
  detectAnalyticalLimitFollowUp,
  detectAnalyticalDirectionFollowUp,
  isAnalyticalTransformQuestion,
  aggregationToGroupedOperation,
  detectAnalyticalExtremeComparison,
  getLastVerifiedAnalyticalLabel,
  detectAnalyticalExclusions,
  mergeAnalyticalExclusionFilter,
  buildAnalyticalFollowUpPlan,
  hasPluralSelectionReference,
  buildMultiRowFieldFollowUpPlan,
  detectPreviousResultIdentityRequest,
  getDatasetSchema,
  findPreviousResultIdentityColumn,
  valuesMatchForPreviousResult,
  buildPreviousResultIdentityPlan,
  detectComparisonRequest,
  formatAnalyticalNumber,
  getVerifiedAnalyticalPair,
  cleanAnalyticalLabel,
  getVerifiedAnalyticalSet,
  detectRequestedResultSubset,
  detectMultiResultIntent,
  findExplicitAnalyticalItems,
  calculateMedian,
  analyzeVerifiedAnalyticalSet,
  compareVerifiedAnalyticalPair,
  formatConversationNumber,
  ordinalLabel,
  ordinalDirectionLabel,
  buildOrdinalAnalyticalAnswer,
  containsNormalizedPhrase,
  isUsefulCategoryColumn,
  findMentionedCategoriesInDataset,
  buildMultiCategoryCountResolution,
};
