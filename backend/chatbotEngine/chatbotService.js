const {
  buildSchema,
} = require("./schemaBuilder");

const {
  createPlan,
} = require("./intentParser");

const {
  executePlan,
} = require("./calculationEngine");

const {
  answerSchemaQuestion,
} = require("./schemaEngine");

const {
  answerGeneralQuestion,
  createSchemaAwarePlan,
} = require("./groqService");

const {
  normalizeDatasets,
  normalizeText,
  similarity,
  parseNumber,
} = require("./utils");

const {
  getRelevantContext,
  updateConversation,
  getRecentResults,
} = require("./conversationManager");

const {
  normalizeQuestion,
} = require("./questionNormalizer");

const {
  validateQueryPlan,
} = require("./queryValidator");

const {
  validateResult,
} = require("./resultValidator");

const {
  generateNaturalResponse,
} = require("./responseGenerator");

const {
  resolvePlanEntities,
} = require("./entityResolver");

const {
  compareVerifiedResults,
} = require("./comparisonEngine");

const {
  inferValueFilters,
  inferCoherentFilters,
} = require("./filterEngine");

const {
  retrieveRelevantData,
  buildRetrievalContext,
} = require("./dataRetriever");


function normalizeExplicitColumnText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactExplicitColumnText(value) {
  return normalizeExplicitColumnText(value)
    .replace(/\s+/g, "")
    .trim();
}


function expandExplicitColumnWords(
  value
) {
  const text =
    normalizeExplicitColumnText(
      value
    );

  if (!text) {
    return "";
  }

  /**
   * Generic schema-label abbreviation expansion.
   *
   * This is NOT tied to one dashboard or one field.
   *
   * Examples:
   *   NO / NO. / NUM / # -> NUMBER
   *   QTY              -> QUANTITY
   *   AMT              -> AMOUNT
   *   DESC             -> DESCRIPTION
   *   DEPT             -> DEPARTMENT
   *   DIV              -> DIVISION
   *
   * It allows natural user wording to match compact column headers.
   */
  const replacements = new Map([
    ["no", "number"],
    ["num", "number"],
    ["nbr", "number"],
    ["qty", "quantity"],
    ["amt", "amount"],
    ["desc", "description"],
    ["dept", "department"],
    ["div", "division"],
    ["pos", "position"],
  ]);

  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (token) =>
        replacements.get(token) ||
        token
    )
    .join(" ")
    .trim();
}


function buildExplicitColumnAliases(
  columnName
) {
  const base =
    normalizeExplicitColumnText(
      columnName
    );

  const expanded =
    expandExplicitColumnWords(
      columnName
    );

  const aliases =
    new Set(
      [
        base,
        expanded,
      ].filter(Boolean)
    );

  /**
   * Also support a compact form for headers that contain spacing
   * or punctuation differences.
   */
  for (
    const alias of
    [...aliases]
  ) {
    const compact =
      alias
        .replace(/\s+/g, "")
        .trim();

    if (compact) {
      aliases.add(
        compact
      );
    }
  }

  return [
    ...aliases,
  ];
}


/**
 * Return every real schema column explicitly named in the question.
 *
 * Longer overlapping column names win:
 * "POSITION TITLE" suppresses a shorter "POSITION" match that occupies
 * the same phrase.
 */
function findExplicitSchemaColumns({
  schema,
  question,
  preferredDataset = null,
}) {
  const normalizedQuestion =
    normalizeExplicitColumnText(
      question
    );

  if (!normalizedQuestion) {
    return [];
  }

  const matches = [];

  for (const dataset of schema || []) {
    if (
      preferredDataset &&
      String(dataset?.name || "") !==
        String(preferredDataset)
    ) {
      continue;
    }

    for (const column of dataset?.columns || []) {
      const name =
        column?.name;

      if (!name) {
        continue;
      }

      const aliases =
        buildExplicitColumnAliases(
          name
        );

      if (!aliases.length) {
        continue;
      }

      const normalizedRealColumn =
        normalizeExplicitColumnText(
          name
        );

      const realColumnWordCount =
        normalizedRealColumn
          .split(/\s+/)
          .filter(Boolean)
          .length;

      /**
       * Search both the normalized question and an abbreviation-expanded
       * version of it.
       *
       * Example:
       * schema:   "PLANTILLA ITEM NO."
       * question: "plantilla item number"
       *
       * Both become:
       * "plantilla item number"
       */
      const searchableQuestions = [
        {
          text:
            normalizedQuestion,
          compact:
            false,
        },

        {
          text:
            expandExplicitColumnWords(
              question
            ),
          compact:
            false,
        },

        {
          text:
            compactExplicitColumnText(
              question
            ),
          compact:
            true,
        },

        {
          text:
            expandExplicitColumnWords(
              question
            )
              .replace(
                /\s+/g,
                ""
              ),
          compact:
            true,
        },
      ];

      for (
        const alias of aliases
      ) {
        const aliasIsCompact =
          !/\s/.test(alias);

        for (
          const searchable of
          searchableQuestions
        ) {
          if (
            searchable.compact !==
            aliasIsCompact
          ) {
            continue;
          }

          const haystack =
            searchable.text;

          if (
            !haystack ||
            !alias
          ) {
            continue;
          }

          if (
            searchable.compact
          ) {
            /**
             * Compact matching exists only to bridge punctuation/spacing
             * differences in MULTI-WORD schema labels.
             *
             * Never compact-match a one-word field name by raw substring.
             *
             * Example of the old bug:
             *
             *   schema column: AGE
             *   question:      "What about the average?"
             *
             * compact question:
             *   whatabouttheaverage
             *
             * raw substring matching found:
             *   ...averAGE
             *
             * and incorrectly changed the metric to AGE.
             *
             * Multi-word fields such as:
             *   PLANTILLA ITEM NO.
             *
             * may still use compact matching safely.
             */
            if (
              realColumnWordCount < 2
            ) {
              continue;
            }

            const start =
              haystack.indexOf(
                alias
              );

            if (start >= 0) {
              matches.push({
                dataset:
                  dataset.name,

                column:
                  name,

                start,

                end:
                  start +
                  alias.length,

                length:
                  alias.length,
              });
            }

            continue;
          }

          const escaped =
            alias.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            );

          const regex =
            new RegExp(
              `(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`,
              "gu"
            );

          let match;

          while (
            (match =
              regex.exec(
                haystack
              )) !== null
          ) {
            const prefixLength =
              match[1]?.length ||
              0;

            const start =
              match.index +
              prefixLength;

            matches.push({
              dataset:
                dataset.name,

              column:
                name,

              start,

              end:
                start +
                match[2].length,

              length:
                match[2].length,
            });

            if (
              regex.lastIndex ===
              match.index
            ) {
              regex.lastIndex += 1;
            }
          }
        }
      }
    }
  }

  matches.sort(
    (a, b) =>
      b.length -
        a.length ||
      a.start -
        b.start
  );

  const accepted = [];

  for (const candidate of matches) {
    const covered =
      accepted.some(
        (stronger) =>
          stronger.dataset ===
            candidate.dataset &&
          stronger.start <=
            candidate.start &&
          stronger.end >=
            candidate.end &&
          stronger.length >
            candidate.length
      );

    if (!covered) {
      accepted.push(
        candidate
      );
    }
  }

  const seen = new Set();

  return accepted.filter(
    (item) => {
      const key =
        `${item.dataset}::${item.column}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    }
  );
}

function splitExplicitEntitySegments(
  question
) {
  const text =
    normalizeText(
      question
    );

  const tailMatch =
    text.match(
      /\b(?:of|for)\b\s+(.+)$/
    );

  if (!tailMatch?.[1]) {
    return [];
  }

  const segments =
    tailMatch[1]
      .replace(/[?.!]+$/g, "")
      .split(
        /\s+(?:and|vs\.?|versus)\s+/i
      )
      .map(
        (value) =>
          value.trim()
      )
      .filter(Boolean);

  return segments.length >= 2
    ? segments
    : [];
}



function detectQuestionAggregation(
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
    /\b(average|avg|mean)\b/.test(
      text
    )
  ) {
    return "average";
  }

  if (
    /\b(total|sum|combined|overall|altogether|in all)\b/.test(
      text
    )
  ) {
    return "sum";
  }

  if (
    /\b(count|how many|number of)\b/.test(
      text
    )
  ) {
    return "count";
  }

  return null;
}


function detectRankingDirection(
  question
) {
  const text =
    normalizeText(question);

  if (
    /\b(lowest|smallest|least|minimum|min|bottom)\b/.test(
      text
    )
  ) {
    return "asc";
  }

  if (
    /\b(highest|largest|biggest|greatest|most|maximum|max|top)\b/.test(
      text
    )
  ) {
    return "desc";
  }

  return null;
}


function detectRankingLimit(
  question
) {
  const text =
    normalizeText(question);

  const match =
    text.match(
      /\b(?:top|bottom|first|last)\s+(\d{1,3})\b/
    ) ||
    text.match(
      /\b(\d{1,3})\s+(?:highest|lowest|largest|smallest)\b/
    );

  if (match?.[1]) {
    const value =
      Number(
        match[1]
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

  return 1;
}


function looksNumericValue(
  value
) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return false;
  }

  const cleaned =
    String(value)
      .trim()
      .replace(
        /[,₱$€£¥%]/g,
        ""
      )
      .replace(/\s+/g, "");

  return (
    cleaned !== "" &&
    Number.isFinite(
      Number(cleaned)
    )
  );
}


function isNumericLikeColumn({
  column,
  rows,
}) {
  if (!column) {
    return false;
  }

  if (
    column.type === "number"
  ) {
    return true;
  }

  const examples =
    Array.isArray(
      column.examples
    )
      ? column.examples
      : [];

  const samples = [
    ...examples,
    ...(Array.isArray(rows)
      ? rows
          .slice(0, 40)
          .map(
            (row) =>
              row?.[
                column.name
              ]
          )
      : []),
  ];

  let usable = 0;
  let numeric = 0;

  for (
    const value of samples
  ) {
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ""
    ) {
      continue;
    }

    usable += 1;

    if (
      looksNumericValue(
        value
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


function parseRankingTargets(
  question
) {
  const text =
    normalizeText(question);

  let match =
    text.match(
      /\bwho\s+(?:has|have|had|is|are)\s+(?:the\s+)?(?:highest|lowest|largest|smallest|biggest|greatest|most|least|maximum|minimum)\s+(.+?)(?:\s+\b(?:in|within|among|for)\b\s+.+)?$/
    );

  if (match?.[1]) {
    return {
      asksWho: true,
      labelTarget:
        "person name employee",
      metricTarget:
        normalizeText(
          match[1]
        ),
    };
  }

  match =
    text.match(
      /\b(?:which|what)\s+(.+?)\s+(?:has|have|had|is|are)\s+(?:the\s+)?(?:highest|lowest|largest|smallest|biggest|greatest|most|least|maximum|minimum)\s+(.+?)(?:\s+\b(?:in|within|among|for)\b\s+.+)?$/
    );

  if (
    match?.[1] &&
    match?.[2]
  ) {
    return {
      asksWho: false,
      labelTarget:
        normalizeText(
          match[1]
        ),
      metricTarget:
        normalizeText(
          match[2]
        ),
    };
  }

  return null;
}


function scoreTargetToColumn(
  target,
  columnName
) {
  const left =
    normalizeText(
      target
    );

  const right =
    normalizeText(
      columnName
    );

  if (
    !left ||
    !right
  ) {
    return 0;
  }

  if (left === right) {
    return 3;
  }

  let score =
    similarity(
      left,
      right
    );

  if (
    left.includes(
      right
    ) ||
    right.includes(
      left
    )
  ) {
    score += 1;
  }

  const leftTokens =
    new Set(
      left
        .split(/\s+/)
        .filter(Boolean)
    );

  const rightTokens =
    right
      .split(/\s+/)
      .filter(Boolean);

  if (
    rightTokens.length
  ) {
    const overlap =
      rightTokens.filter(
        (token) =>
          leftTokens.has(
            token
          )
      ).length;

    score +=
      overlap /
      rightTokens.length;
  }

  return score;
}



function sanitizeRankingStructuralFilters({
  plan,
  question,
}) {
  if (
    !plan ||
    !Array.isArray(
      plan.filters
    ) ||
    !plan.filters.length
  ) {
    return plan;
  }

  const text =
    normalizeText(
      question
    );

  /**
   * Words that often describe the requested calculation itself rather
   * than a real row filter.
   *
   * Examples:
   *   "most number of members"
   *   "highest average salary"
   *   "largest total area"
   *
   * A planner must not turn those structural words into:
   *   Unit = "number"
   *   Type = "average"
   *   Category = "total"
   *
   * This remains conservative: the filter is removed only when the
   * value is used in a recognizable analytical phrase in the question.
   */
  const structuralPhrasePatterns = [
    /\bnumber\s+of\b/,
    /\bcount\s+of\b/,
    /\baverage\s+(?:of\s+)?/,
    /\bavg\s+(?:of\s+)?/,
    /\bmean\s+(?:of\s+)?/,
    /\btotal\s+(?:of\s+)?/,
    /\bsum\s+(?:of\s+)?/,
    /\bhighest\b/,
    /\blowest\b/,
    /\bmaximum\b/,
    /\bminimum\b/,
    /\bmost\b/,
    /\bleast\b/,
  ];

  const hasAnalyticalStructure =
    structuralPhrasePatterns.some(
      (pattern) =>
        pattern.test(
          text
        )
    );

  if (!hasAnalyticalStructure) {
    return plan;
  }

  const structuralValues =
    new Set([
      "number",
      "count",
      "average",
      "avg",
      "mean",
      "total",
      "sum",
      "highest",
      "lowest",
      "maximum",
      "minimum",
      "most",
      "least",
    ]);

  const cleanedFilters =
    plan.filters.filter(
      (filter) => {
        const value =
          normalizeText(
            Array.isArray(
              filter?.value
            )
              ? filter.value.join(
                  " "
                )
              : filter?.value
          );

        if (
          !structuralValues.has(
            value
          )
        ) {
          return true;
        }

        /**
         * Keep a structural-looking value only if the question clearly
         * uses it as an explicit filter value rather than as part of
         * the analytical wording.
         *
         * Examples kept:
         *   "where Unit is number"
         *   "filter Unit by number"
         *   "only number"
         *
         * Example removed:
         *   "most number of members"
         */
        const escaped =
          value.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

        const explicitFilterUse =
          new RegExp(
            `\\b(?:where|with|filter(?:ed)?(?:\\s+by)?|only|equals?|equal\\s+to|is)\\s+(?:\\w+\\s+){0,4}${escaped}\\b`
          ).test(
            text
          );

        return explicitFilterUse;
      }
    );

  if (
    cleanedFilters.length ===
      plan.filters.length
  ) {
    return plan;
  }

  return {
    ...plan,

    filters:
      cleanedFilters,
  };
}


function repairRankingIdentityPlan({
  datasets,
  schema,
  plan,
  question,
}) {
  if (
    !plan ||
    plan.route !== "dataset"
  ) {
    return plan;
  }

  plan =
    sanitizeRankingStructuralFilters({
      plan,
      question,
    });

  const direction =
    detectRankingDirection(
      question
    );

  const targets =
    parseRankingTargets(
      question
    );

  if (
    !direction ||
    !targets
  ) {
    return plan;
  }

  /**
   * Prefer the planner's selected dataset, but verify it against the
   * requested metric across all live worksheets.
   *
   * This prevents:
   *   "Which association has the most members?"
   *
   * from choosing a worksheet merely because it is named "Association"
   * and then ranking an unrelated numeric field such as QTY.
   *
   * We only switch worksheets when:
   *   - there are no existing filters to invalidate, and
   *   - another worksheet has a clearly stronger numeric metric match.
   */
  let selectedDatasetName =
    plan.dataset || null;

  let datasetSchema =
    (schema || []).find(
      (item) =>
        String(
          item?.name || ""
        ) ===
        String(
          selectedDatasetName || ""
        )
    );

  let rows =
    datasets?.[
      selectedDatasetName
    ];

  const hasPlanFilters =
    Array.isArray(
      plan.filters
    ) &&
    plan.filters.length > 0;

  const scoreDatasetForRanking =
    (candidateSchema) => {
      const candidateRows =
        datasets?.[
          candidateSchema?.name
        ];

      if (
        !candidateSchema ||
        !Array.isArray(
          candidateRows
        )
      ) {
        return null;
      }

      const candidateColumns =
        Array.isArray(
          candidateSchema.columns
        )
          ? candidateSchema.columns
          : [];

      const numeric =
        candidateColumns
          .filter(
            (column) =>
              isNumericLikeColumn({
                column,
                rows:
                  candidateRows,
              })
          )
          .map(
            (column) => ({
              column,

              score:
                scoreTargetToColumn(
                  targets.metricTarget,
                  column.name
                ),
            })
          )
          .sort(
            (a, b) =>
              b.score -
              a.score
          )[0] ||
        null;

      const label =
        candidateColumns
          .filter(
            (column) =>
              column?.name &&
              (
                !numeric ||
                column.name !==
                  numeric.column.name
              ) &&
              !isNumericLikeColumn({
                column,
                rows:
                  candidateRows,
              })
          )
          .map(
            (column) => ({
              column,

              score:
                scoreTargetToColumn(
                  targets.labelTarget,
                  column.name
                ),
            })
          )
          .sort(
            (a, b) =>
              b.score -
              a.score
          )[0] ||
        null;

      return {
        datasetName:
          candidateSchema.name,

        schema:
          candidateSchema,

        rows:
          candidateRows,

        numeric,

        label,

        combinedScore:
          (
            numeric?.score ||
            0
          ) *
            2 +
          (
            label?.score ||
            0
          ),
      };
    };

  if (!hasPlanFilters) {
    const rankedDatasets =
      (schema || [])
        .map(
          scoreDatasetForRanking
        )
        .filter(Boolean)
        .sort(
          (a, b) =>
            b.combinedScore -
            a.combinedScore
        );

    const bestGlobal =
      rankedDatasets[0] ||
      null;

    const currentScore =
      rankedDatasets.find(
        (item) =>
          String(
            item.datasetName
          ) ===
          String(
            selectedDatasetName
          )
      ) ||
      null;

    if (
      bestGlobal?.numeric?.score >=
        0.55 &&
      (
        !currentScore ||
        currentScore
          .numeric?.score <
          0.55 ||
        bestGlobal
          .combinedScore >
          currentScore
            .combinedScore +
            0.35
      )
    ) {
      selectedDatasetName =
        bestGlobal.datasetName;

      datasetSchema =
        bestGlobal.schema;

      rows =
        bestGlobal.rows;
    }
  }

  if (
    !datasetSchema ||
    !Array.isArray(rows)
  ) {
    return plan;
  }

  const columns =
    Array.isArray(
      datasetSchema.columns
    )
      ? datasetSchema.columns
      : [];

  const numericCandidates =
    columns
      .filter(
        (column) =>
          isNumericLikeColumn({
            column,
            rows,
          })
      )
      .map(
        (column) => ({
          column,
          score:
            scoreTargetToColumn(
              targets.metricTarget,
              column.name
            ),
        })
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  const metric =
    numericCandidates[0];

  if (
    !metric ||
    metric.score < 0.55
  ) {
    return plan;
  }

  const textCandidates =
    columns
      .filter(
        (column) =>
          column?.name &&
          column.name !==
            metric.column.name &&
          !isNumericLikeColumn({
            column,
            rows,
          })
      )
      .map((column, index) => {
        let score =
          scoreTargetToColumn(
            targets.labelTarget,
            column.name
          );

        const normalizedName =
          normalizeText(
            column.name
          );

        if (targets.asksWho) {
          if (
            /\b(full name|name|first name|last name|surname|employee|staff|person|respondent|beneficiary|owner|operator|applicant|client|customer|student|teacher|member)\b/.test(
              normalizedName
            )
          ) {
            score += 1.2;
          }

          const values =
            rows
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
            values.length &&
            values.some(
              (value) =>
                /^[\p{L}.'-]+(?:\s+[\p{L}.'-]+)+$/u.test(
                  String(value).trim()
                )
            )
          ) {
            score += 0.3;
          }
        }

        return {
          column,
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

  const label =
    textCandidates[0];

  if (
    !label ||
    label.score < 0.55
  ) {
    return plan;
  }

  const identityColumns = [
    label.column.name,
  ];

  /**
   * For "who", keep closely related name components when the
   * schema stores identity across multiple fields.
   */
  if (targets.asksWho) {
    for (
      const candidate of
      textCandidates.slice(1)
    ) {
      const name =
        normalizeText(
          candidate.column.name
        );

      if (
        /\b(first name|last name|surname|middle name|middle initial|full name|name)\b/.test(
          name
        ) &&
        !identityColumns.includes(
          candidate.column.name
        )
      ) {
        identityColumns.push(
          candidate.column.name
        );
      }

      if (
        identityColumns.length >= 3
      ) {
        break;
      }
    }
  }

  const selectColumns = [
    ...identityColumns,
    metric.column.name,
  ];

  /**
   * Preserve grouped aggregate rankings.
   *
   * IMPORTANT:
   * repairRankingIdentityPlan() runs at the END of
   * normalizePlannerPlan(). Previously it always forced the plan
   * back to rank_rows, which undid an earlier rank_groups repair.
   *
   * Example:
   *   "Which division has the highest average actual salary?"
   *
   * Must remain:
   *   rank_groups + aggregation average + groupBy DIVISION
   *
   * while:
   *   "Who has the highest actual salary?"
   *
   * remains:
   *   rank_rows
   */
  const normalizedAggregation =
    String(
      plan?.aggregation ||
      ""
    )
      .trim()
      .toLowerCase();

  /**
   * A numeric metric should be ranked by its VALUE even when the
   * wording contains "number of".
   *
   * The planner may encode:
   *   aggregation = "count"
   *
   * for:
   *   "most number of members"
   *
   * But when the metric has already resolved to a numeric field such as
   * "No. of members", COUNT would count records per group and return 1
   * for one-row associations. Clear that false count aggregation.
   */
  const countActuallyMeansNumericValue =
    normalizedAggregation ===
      "count" &&
    metric?.column &&
    isNumericLikeColumn({
      column:
        metric.column,

      rows,
    });

  const groupedAggregation =
    [
      "sum",
      "average",
      "avg",
      "mean",
    ].includes(
      normalizedAggregation
    ) ||
    (
      normalizedAggregation ===
        "count" &&
      !countActuallyMeansNumericValue
    );

  const effectiveAggregation =
    countActuallyMeansNumericValue
      ? null
      : normalizedAggregation;

  const finalOperation =
    groupedAggregation
      ? "rank_groups"
      : "rank_rows";

  const finalLabelColumn =
    identityColumns[0];

  return {
    ...plan,

    dataset:
      selectedDatasetName,

    operation:
      finalOperation,

    column:
      metric.column.name,

    labelColumn:
      finalLabelColumn,

    groupBy:
      groupedAggregation
        ? finalLabelColumn
        : null,

    aggregation:
      groupedAggregation
        ? (
            effectiveAggregation ===
              "avg" ||
            effectiveAggregation ===
              "mean"
              ? "average"
              : effectiveAggregation
          )
        : null,

    direction,

    limit:
      detectRankingLimit(
        question
      ),

    selectColumns: [
      ...new Set(
        [
          finalLabelColumn,
          metric.column.name,
        ].filter(Boolean)
      ),
    ],

    outputRequested:
      true,

    showAll:
      false,
  };
}


/**
 * Normalize both Groq and local plans into the SAME execution shape.
 *
 * 1. Preserve every explicitly requested output column.
 * 2. Rebuild explicit multi-entity requests as OR-ed filter groups.
 * 3. Each entity group is a coherent AND-filter set from one real row.
 */

function detectGroupedComparisonOperation(
  question
) {
  const text =
    normalizeText(question);

  // Only repair explicit comparisons.
  if (
    !/\b(compare|comparison|versus|vs\.?)\b/.test(
      text
    )
  ) {
    return null;
  }

  if (
    /\b(average|avg|mean)\b/.test(
      text
    )
  ) {
    return "group_average";
  }

  if (
    /\b(total|sum|combined|overall|altogether)\b/.test(
      text
    )
  ) {
    return "group_sum";
  }

  if (
    /\b(minimum|min|lowest|smallest|least)\b/.test(
      text
    )
  ) {
    return "group_minimum";
  }

  if (
    /\b(maximum|max|highest|largest|greatest)\b/.test(
      text
    )
  ) {
    return "group_maximum";
  }

  if (
    /\b(count|how many|number of)\b/.test(
      text
    )
  ) {
    return "group_count";
  }

  return null;
}

function normalizePlannerPlan({
  datasets,
  schema,
  plan,
  question,
}) {
  if (
    !plan ||
    typeof plan !== "object" ||
    plan.route !== "dataset"
  ) {
    return plan;
  }

  const normalized = {
    ...plan,

    filters:
      Array.isArray(plan.filters)
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
        : [],

    selectColumns:
      Array.isArray(
        plan.selectColumns
      )
        ? [...plan.selectColumns]
        : [],
  };

  const explicitColumns =
    findExplicitSchemaColumns({
      schema,
      question,

      preferredDataset:
        normalized.dataset ||
        null,
    });

  const rankingDirection =
    detectRankingDirection(
      question
    );

  /**
   * ========================================================
   * QUESTION-LEVEL AGGREGATION REPAIR
   * ========================================================
   *
   * Groq can occasionally return a syntactically valid ranking plan
   * while omitting aggregation, for example:
   *
   *   operation: "rank_rows"
   *   column: "ACTUAL SALARY"
   *   labelColumn: "DIVISION"
   *   aggregation: null
   *
   * for:
   *
   *   "Which division has the highest average actual salary?"
   *
   * The word "average" is explicit in the user's question, so recover
   * that intent deterministically before deciding between rank_rows and
   * rank_groups.
   *
   * This is generic and schema/dataset agnostic.
   */
  const questionAggregation =
    detectQuestionAggregation(
      question
    );

  const normalizedOperationName =
    String(
      normalized.operation ||
      ""
    )
      .trim()
      .toLowerCase();

  const isRankingOperation =
    normalizedOperationName ===
      "rank_rows" ||
    normalizedOperationName ===
      "rank_groups";

  if (
    isRankingOperation &&
    !normalized.aggregation &&
    questionAggregation
  ) {
    normalized.aggregation =
      questionAggregation;
  }

  /**
   * ========================================================
   * RANKED AGGREGATE NORMALIZATION
   * ========================================================
   *
   * A planner may return:
   *
   *   operation: "rank_rows"
   *   aggregation: "average"
   *   labelColumn: "..."
   *
   * for a question such as:
   *
   *   "Which division has the highest average salary?"
   *
   * That is logically a GROUP ranking, not a row ranking.
   *
   * Normalize this deterministically before execution.
   * This is schema/dataset agnostic and works for any grouping field.
   */
  const normalizedAggregation =
    String(
      normalized.aggregation ||
      ""
    )
      .trim()
      .toLowerCase();

  const isGroupedRankingAggregation =
    [
      "sum",
      "average",
      "avg",
      "mean",
      "count",
    ].includes(
      normalizedAggregation
    );

  if (
    String(
      normalized.operation ||
      ""
    )
      .trim()
      .toLowerCase() ===
      "rank_rows" &&
    isGroupedRankingAggregation &&
    (
      normalized.groupBy ||
      normalized.labelColumn
    )
  ) {
    normalized.operation =
      "rank_groups";

    normalized.groupBy =
      normalized.groupBy ||
      normalized.labelColumn;

    normalized.labelColumn =
      normalized.labelColumn ||
      normalized.groupBy;

    /**
     * Keep selectColumns aligned with the grouping field + metric.
     */
    normalized.selectColumns = [
      ...new Set(
        [
          normalized.groupBy,
          normalized.column,
          ...(
            Array.isArray(
              normalized.selectColumns
            )
              ? normalized.selectColumns
              : []
          ),
        ].filter(Boolean)
      ),
    ];
  }

  /**
   * Multiple explicitly named output columns normally mean a
   * multi-field lookup. Do NOT apply that rule to ranking
   * questions, where one field is often the identity/label and
   * another is the numeric ranking metric.
   */
  if (
    explicitColumns.length >= 2 &&
    !rankingDirection
  ) {
    normalized.operation =
      "lookup";

    normalized.column =
      null;

    normalized.selectColumns =
      explicitColumns.map(
        (item) =>
          item.column
      );

    normalized.outputRequested =
      true;

    normalized.transform =
      null;

    normalized.showAll =
      true;
  }

  const rows =
    datasets?.[
      normalized.dataset
    ];

  const segments =
  splitExplicitEntitySegments(
    question
  );

if (
  Array.isArray(rows) &&
  rows.length &&
  segments.length >= 2
) {
  const groups =
    segments.map(
      (segment) =>
        inferCoherentFilters(
          rows,
          segment
        )
    );

  if (
    groups.every(
      (filters) =>
        filters.length > 0
    )
  ) {
    const groupedOperation =
      detectGroupedComparisonOperation(
        question
      );

    // ========================================================
    // ANALYTICAL COMPARISON
    // ========================================================
    if (groupedOperation) {
      const groupMaps =
        groups.map(
          (filters) =>
            new Map(
              filters.map(
                (filter) => [
                  normalizeText(
                    filter.column
                  ),
                  filter,
                ]
              )
            )
        );

      // Find columns common to BOTH entities.
      const commonColumns =
        [
          ...groupMaps[0].keys(),
        ].filter(
          (column) =>
            groupMaps.every(
              (map) =>
                map.has(column)
            )
        );

      const preferredGroup =
        normalizeText(
          normalized.groupBy ||
          ""
        );

      let selectedGroupKey =
        null;

      // Prefer the groupBy already chosen by Groq/local planner.
      if (
        preferredGroup &&
        commonColumns.includes(
          preferredGroup
        )
      ) {
        selectedGroupKey =
          preferredGroup;
      } else {
        selectedGroupKey =
          commonColumns[0] ||
          null;
      }

      if (selectedGroupKey) {
        const actualGroupColumn =
          groupMaps[0]
            .get(
              selectedGroupKey
            )
            ?.column;

        const groupValues = [
        ...new Set(
          groupMaps
            .map(
              (map) =>
                map.get(
                  selectedGroupKey
                )
                ?.value
            )
            .filter(
              (value) =>
                value !== null &&
                value !== undefined &&
                String(value).trim() !== ""
            )
        ),
      ];

        if (
          actualGroupColumn &&
          groupValues.length >= 2
        ) {
          // ========================================================
          // RESOLVE THE METRIC COLUMN
          // ========================================================

          const selectedMetricColumns =
            (
              Array.isArray(
                normalized.selectColumns
              )
                ? normalized.selectColumns
                : []
            ).filter(
              (column) =>
                normalizeText(
                  column
                ) !==
                normalizeText(
                  actualGroupColumn
                )
            );

          let metricColumn =
            normalized.column ||
            null;

          /**
           * If exactly one selected column is NOT the group column,
           * use that as the metric.
           *
           * Example:
           *
           * groupBy:
           *   DIVISION
           *
           * selectColumns:
           *   DIVISION
           *   ACTUAL SALARY
           *
           * metric:
           *   ACTUAL SALARY
           */
          if (
            selectedMetricColumns.length ===
            1
          ) {
            metricColumn =
              selectedMetricColumns[0];
          }

          normalized.operation =
            groupedOperation;

          normalized.groupBy =
            actualGroupColumn;

          // IMPORTANT:
          // overwrite the potentially wrong Groq metric.
          normalized.column =
            metricColumn;

          normalized.filters = [
            {
              column:
                actualGroupColumn,

              operator:
                "in",

              value:
                groupValues,
            },
          ];

          // Remove raw entity groups because
          // grouped calculation uses one shared IN filter.
          delete normalized.filterGroups;
          delete normalized.filterGroupLogic;

          normalized.selectColumns = [
            actualGroupColumn,
            ...(metricColumn
              ? [
                  metricColumn,
                ]
              : []),
          ];

          normalized.outputRequested =
            true;

          normalized.showAll =
            true;

          normalized.limit =
            100;
        }
      }
    }

    // ========================================================
    // NORMAL MULTI-ENTITY LOOKUP / COMPARISON
    // ========================================================
    else {
      normalized.filters =
        [];

      normalized.filterGroups =
        groups.map(
          (filters) => ({
            logic:
              "and",

            filters,
          })
        );

      normalized.filterGroupLogic =
        "or";

      normalized.operation =
        "lookup";

      normalized.showAll =
        true;
    }
  }
}

  if (
    Array.isArray(
      normalized.filterGroups
    )
  ) {
    normalized.filterGroups =
      normalized.filterGroups
        .map(
          (group) => ({
            logic:
              String(
                group?.logic ||
                "and"
              )
                .trim()
                .toLowerCase(),

            filters:
              Array.isArray(
                group?.filters
              )
                ? group.filters
                    .filter(Boolean)
                    .map(
                      (filter) => ({
                        ...filter,

                        operator:
                          String(
                            filter?.operator ||
                            "equals"
                          )
                            .trim()
                            .toLowerCase(),

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
        .filter(
          (group) =>
            group.filters.length
        );
  }

  return repairRankingIdentityPlan({
    datasets,
    schema,
    plan:
      normalized,
    question,
  });
}

/**
 * Detect a REAL schema column explicitly named by the user.
 *
 * This is intentionally deterministic and dataset-agnostic.
 *
 * Example:
 * schema column: "RainfedTotal Area Planted"
 * question:      "What is the total of Rainfed Total Area Planted?"
 *
 * The compact forms match:
 * "rainfedtotalareaplanted"
 *
 * This prevents a planner/fallback parser from replacing an
 * explicitly requested real field with a similar field.
 */
function findExplicitSchemaColumn({
  schema,
  question,
  preferredDataset = null,
}) {
  const normalizedQuestion =
    normalizeExplicitColumnText(question);

  const compactQuestion =
    compactExplicitColumnText(question);

  if (
    !normalizedQuestion ||
    !compactQuestion
  ) {
    return null;
  }

  const candidates = [];

  for (const dataset of schema || []) {
    if (
      preferredDataset &&
      String(dataset?.name || "") !==
        String(preferredDataset)
    ) {
      continue;
    }

    for (const column of dataset?.columns || []) {
      const name =
        column?.name;

      if (!name) {
        continue;
      }

      const normalizedColumn =
        normalizeExplicitColumnText(name);

      const compactColumn =
        compactExplicitColumnText(name);

      if (
        !normalizedColumn ||
        !compactColumn
      ) {
        continue;
      }

      let score = 0;

      if (
        normalizedQuestion ===
        normalizedColumn
      ) {
        score = 100;
      } else if (
        compactQuestion ===
        compactColumn
      ) {
        score = 99;
      } else if (
        normalizedQuestion.includes(
          normalizedColumn
        )
      ) {
        score =
          95 +
          normalizedColumn.length / 10000;
      } else if (
        compactQuestion.includes(
          compactColumn
        )
      ) {
        score =
          94 +
          compactColumn.length / 10000;
      }

      if (score > 0) {
        candidates.push({
          dataset:
            dataset.name,

          column:
            name,

          score,

          length:
            compactColumn.length,
        });
      }
    }
  }

  if (
    !candidates.length &&
    preferredDataset
  ) {
    return findExplicitSchemaColumn({
      schema,
      question,
      preferredDataset: null,
    });
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.length - a.length
  );

  return candidates[0] || null;
}

function operationUsesMetricColumn(
  operation
) {
  return new Set([
    "sum",
    "average",
    "median",
    "minimum",
    "maximum",
    "non_empty_count",
    "distinct_count",
    "list",
    "rank_rows",
    "rank_groups",
    "group_sum",
    "group_average",
    "group_minimum",
    "group_maximum",
  ]).has(
    String(operation || "")
      .trim()
      .toLowerCase()
  );
}

/**
 * Last planner-independent safeguard.
 *
 * If the user explicitly names a real schema column, preserve
 * that exact column even when Groq or the local fallback chose
 * a similar one.
 */
function enforceExplicitQuestionColumn({
  plan,
  schema,
  question,
}) {
  if (
    !plan ||
    plan.route !== "dataset" ||
    !operationUsesMetricColumn(
      plan.operation
    )
  ) {
    return plan;
  }

  const normalizedOperation =
    String(plan.operation || "")
      .trim()
      .toLowerCase();

  /**
   * Ranking and grouped calculation plans already have
   * their metric and grouping columns resolved.
   *
   * Do not let the single-column safeguard overwrite them.
   */
  if (
    normalizedOperation === "rank_rows" ||
    normalizedOperation === "rank_groups" ||
    normalizedOperation === "group_sum" ||
    normalizedOperation === "group_average" ||
    normalizedOperation === "group_minimum" ||
    normalizedOperation === "group_maximum" ||
    normalizedOperation === "group_count"
  ) {
    return plan;
  }

  const match =
    findExplicitSchemaColumn({
      schema,
      question,

      preferredDataset:
        plan.dataset || null,
    });

  if (!match) {
    return plan;
  }

  const resolved = {
    ...plan,

    column:
      match.column,

    dataset:
      match.dataset ||
      plan.dataset,
  };

  if (
    String(plan.operation || "")
      .trim()
      .toLowerCase() === "list"
  ) {
    resolved.selectColumns = [
      match.column,
    ];
  }

  return resolved;
}

/**
 * ==========================================================
 * APPLY CONVERSATION CONTEXT
 * ==========================================================
 *
 * Allows follow-up questions such as:
 *
 * "What is the salary of Roberto?"
 * "What is his position?"
 *
 * or:
 *
 * "What is Roberto's position?"
 * "What about Vener?"
 */
function getSchemaColumns(
  schema,
  preferredDataset = null
) {
  const results = [];

  for (const dataset of schema || []) {
    if (
      preferredDataset &&
      String(dataset?.name || "") !==
        String(preferredDataset)
    ) {
      continue;
    }

    for (const column of dataset?.columns || []) {
      if (!column?.name) continue;

      results.push({
        dataset:
          dataset.name,

        column:
          column.name,
      });
    }
  }

  return results;
}

function inferRequestedColumnFromQuestion({
  schema,
  question,
  preferredDataset = null,
  excludedColumns = [],
}) {
  const normalizedQuestion =
    normalizeText(question);

  if (!normalizedQuestion) {
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

  const preferred =
    getSchemaColumns(
      schema,
      preferredDataset
    );

  const fallback =
    preferred.length
      ? preferred
      : getSchemaColumns(
          schema,
          null
        );

  let best = null;

  for (const candidate of fallback) {
    const normalizedColumn =
      normalizeText(
        candidate.column
      );

    if (
      !normalizedColumn ||
      excluded.has(
        normalizedColumn
      )
    ) {
      continue;
    }

    let score =
      similarity(
        normalizedQuestion,
        normalizedColumn
      );

    /**
     * Strong exact phrase signal.
     *
     * Example:
     * "how about actual salary"
     * contains the real column label
     * "ACTUAL SALARY".
     */
    if (
      normalizedQuestion.includes(
        normalizedColumn
      )
    ) {
      score =
        Math.max(
          score,
          1
        );
    } else {
      /**
       * Also compare shorter question phrases against
       * the column name so wording such as:
       *
       * "how about the actual salary"
       *
       * still resolves dynamically.
       */
      const words =
        normalizedQuestion
          .split(/\s+/)
          .filter(Boolean);

      const columnWords =
        normalizedColumn
          .split(/\s+/)
          .filter(Boolean);

      const maxSize =
        Math.min(
          Math.max(
            columnWords.length,
            1
          ),
          words.length
        );

      for (
        let size = 1;
        size <= maxSize;
        size += 1
      ) {
        for (
          let i = 0;
          i <= words.length - size;
          i += 1
        ) {
          const phrase =
            words
              .slice(
                i,
                i + size
              )
              .join(" ");

          score =
            Math.max(
              score,
              similarity(
                phrase,
                normalizedColumn
              )
            );
        }
      }
    }

    if (
      !best ||
      score > best.score
    ) {
      best = {
        dataset:
          candidate.dataset,

        column:
          candidate.column,

        score,
      };
    }
  }

  /**
   * Be conservative.
   *
   * Exact/near-exact column wording should pass.
   * Weak guesses should not silently change context.
   */
  if (
    !best ||
    best.score < 0.72
  ) {
    return null;
  }

  return best;
}

/**
 * ==========================================================
 * APPLY CONVERSATION CONTEXT
 * ==========================================================
 *
 * Dynamic follow-up resolution.
 *
 * No employee name, field name, worksheet name, division,
 * province, municipality, or other dataset value is hardcoded.
 *
 * Supports:
 *
 * 1. Same entity + new field
 *    "authorized salary of [person]"
 *    "how about actual salary"
 *
 * 2. New entity + same field
 *    "position of [person A]"
 *    "what about [person B]"
 *
 * 3. Pronoun follow-ups
 *    "what is his position title?"
 */


function inferRememberedSubjectColumn({
  schema,
  datasetName,
  previousQuestion,
  context,
}) {
  /**
   * Prefer an already verified remembered subject.
   */
  if (
    context?.lastSubjectColumn
  ) {
    return context.lastSubjectColumn;
  }

  const previousPlan =
    context?.lastPlan;

  if (
    previousPlan?.column
  ) {
    return previousPlan.column;
  }

  if (
    Array.isArray(
      previousPlan?.selectColumns
    ) &&
    previousPlan.selectColumns.length ===
      1 &&
    previousPlan.selectColumns[0]
  ) {
    return previousPlan.selectColumns[0];
  }

  const datasetSchema =
    (schema || []).find(
      (item) =>
        String(
          item?.name || ""
        ) ===
        String(
          datasetName || ""
        )
    );

  if (
    !datasetSchema ||
    !Array.isArray(
      datasetSchema.columns
    ) ||
    !datasetSchema.columns.length
  ) {
    return null;
  }

  const text =
    normalizeText(
      previousQuestion || ""
    );

  if (!text) {
    return null;
  }

  /**
   * Extract the noun phrase that was counted/listed in the previous
   * question.
   *
   * Examples:
   *   "How many associations are in La Union?"
   *       -> associations
   *   "How many employees are in ORED?"
   *       -> employees
   *   "Count completed projects"
   *       -> completed projects
   */
  let target = "";

  const patterns = [
    /\bhow many\s+(.+?)(?:\s+(?:are|is|were|was|in|from|within|for)\b|$)/i,
    /\bnumber of\s+(.+?)(?:\s+(?:are|is|were|was|in|from|within|for)\b|$)/i,
    /\bcount(?: of)?\s+(.+?)(?:\s+(?:are|is|were|was|in|from|within|for)\b|$)/i,
    /\blist\s+(.+?)(?:\s+(?:in|from|within|for)\b|$)/i,
    /\bshow\s+(.+?)(?:\s+(?:in|from|within|for)\b|$)/i,
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      text.match(
        pattern
      );

    if (match?.[1]) {
      target =
        normalizeText(
          match[1]
        )
          .replace(
            /\b(?:the|all|total|unique|distinct|different)\b/g,
            " "
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      break;
    }
  }

  if (!target) {
    return null;
  }

  const singularizeLoose = (
    value
  ) => {
    const token =
      String(
        value || ""
      );

    if (
      token.endsWith(
        "ies"
      ) &&
      token.length > 3
    ) {
      return (
        token.slice(
          0,
          -3
        ) +
        "y"
      );
    }

    if (
      token.endsWith(
        "ses"
      ) &&
      token.length > 3
    ) {
      return token.slice(
        0,
        -2
      );
    }

    if (
      token.endsWith(
        "s"
      ) &&
      !token.endsWith(
        "ss"
      ) &&
      token.length > 2
    ) {
      return token.slice(
        0,
        -1
      );
    }

    return token;
  };

  const targetTokens =
    target
      .split(
        /\s+/
      )
      .filter(Boolean)
      .map(
        singularizeLoose
      );

  const candidates =
    datasetSchema.columns
      .filter(
        (column) =>
          column?.name
      )
      .map(
        (column) => {
          const name =
            normalizeText(
              column.name
            );

          const nameTokens =
            name
              .split(
                /\s+/
              )
              .filter(Boolean)
              .map(
                singularizeLoose
              );

          let score =
            scoreTargetToColumn(
              target,
              column.name
            );

          const overlap =
            targetTokens.filter(
              (token) =>
                nameTokens.includes(
                  token
                )
            ).length;

          if (
            targetTokens.length
          ) {
            score +=
              overlap /
              targetTokens.length;
          }

          /**
           * Generic identity/display-field bonus.
           *
           * If the target noun occurs in a text field with "name",
           * that field is usually the natural value to list.
           *
           * association -> Name of Association
           * employee    -> Employee Name
           * project     -> Project Name
           */
          if (
            column.type !==
              "number" &&
            /\bname\b/.test(
              name
            ) &&
            overlap > 0
          ) {
            score += 1.25;
          }

          /**
           * Avoid choosing a numeric measure when a text identity field
           * has comparable evidence.
           */
          if (
            column.type ===
              "number"
          ) {
            score -= 0.4;
          }

          return {
            name:
              column.name,
            score,
          };
        }
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  return (
    candidates[0]?.score >=
      0.75
      ? candidates[0].name
      : null
  );
}




function tokenizeSchemaPhrase(
  value
) {
  return normalizeText(
    value
  )
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /[^\p{L}\p{N}\s]/gu,
      " "
    )
    .split(
      /\s+/
    )
    .map(
      (token) =>
        token.trim()
    )
    .filter(Boolean)
    .map(
      (token) => {
        if (
          token.endsWith(
            "ies"
          ) &&
          token.length > 3
        ) {
          return (
            token.slice(
              0,
              -3
            ) +
            "y"
          );
        }

        if (
          token.endsWith(
            "s"
          ) &&
          !token.endsWith(
            "ss"
          ) &&
          token.length > 3
        ) {
          return token.slice(
            0,
            -1
          );
        }

        return token;
      }
    );
}


function scoreNaturalFieldPhrase(
  requestedPhrase,
  columnName
) {
  const requestedTokens =
    tokenizeSchemaPhrase(
      requestedPhrase
    );

  const columnTokens =
    tokenizeSchemaPhrase(
      columnName
    );

  if (
    !requestedTokens.length ||
    !columnTokens.length
  ) {
    return 0;
  }

  const requestedSet =
    new Set(
      requestedTokens
    );

  const columnSet =
    new Set(
      columnTokens
    );

  const overlap =
    requestedTokens.filter(
      (token) =>
        columnSet.has(
          token
        )
    ).length;

  const coverage =
    overlap /
    requestedTokens.length;

  const reverseCoverage =
    overlap /
    columnTokens.length;

  const compactRequested =
    requestedTokens.join(
      " "
    );

  const compactColumn =
    columnTokens.join(
      " "
    );

  let score =
    coverage *
      1.5 +
    reverseCoverage *
      0.5;

  if (
    compactRequested ===
      compactColumn
  ) {
    score += 1.5;
  } else if (
    compactColumn.includes(
      compactRequested
    ) ||
    compactRequested.includes(
      compactColumn
    )
  ) {
    score += 0.75;
  }

  return score;
}


function inferApproximateEntityFilterFromText({
  rows,
  identifierText,
}) {
  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return [];
  }

  const target =
    normalizeText(
      identifierText
    );

  if (!target) {
    return [];
  }

  const candidates = [];

  const columns =
    Object.keys(
      rows[0] || {}
    );

  for (const column of columns) {
    const seen =
      new Set();

    for (const row of rows) {
      const raw =
        row?.[column];

      if (
        raw === null ||
        raw === undefined
      ) {
        continue;
      }

      const value =
        String(raw).trim();

      if (
        !value ||
        value.length > 120 ||
        /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(
          value
        )
      ) {
        continue;
      }

      const normalizedValue =
        normalizeText(value);

      if (
        !normalizedValue ||
        seen.has(normalizedValue)
      ) {
        continue;
      }

      seen.add(
        normalizedValue
      );

      let score =
        Math.max(
          similarity(
            target,
            normalizedValue
          ),

          normalizedEditSimilarity(
            target,
            normalizedValue
          )
        );

      if (
        target ===
          normalizedValue
      ) {
        score = 1;
      } else if (
        target.includes(
          normalizedValue
        ) ||
        normalizedValue.includes(
          target
        )
      ) {
        score =
          Math.max(
            score,
            0.94
          );
      }

      /**
       * Conservative but typo-tolerant entity matching.
       *
       * The follow-up resolver already uses edit similarity because real
       * report values and user spelling can differ slightly. Standalone
       * direct questions should use the same evidence.
       */
      if (score >= 0.72) {
        candidates.push({
          column,
          value,
          score,
        });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score
  );

  if (!candidates.length) {
    return [];
  }

  if (
    candidates.length > 1 &&
    candidates[0].column !==
      candidates[1].column &&
    Math.abs(
      candidates[0].score -
      candidates[1].score
    ) < 0.025
  ) {
    return [];
  }

  return [
    {
      column:
        candidates[0].column,

      operator:
        "equals",

      value:
        candidates[0].value,
    },
  ];
}


/**
 * Resolve standalone filtered numeric aggregate questions before Groq.
 *
 * Examples of the shape handled:
 *   "what is the total <metric> in <entity>"
 *   "what is the average <metric> for <entity>"
 *
 * Both the metric column and entity filter are discovered dynamically
 * from the live schema/data. Minor wording typos are tolerated through
 * existing schema similarity plus a conservative entity-value fallback.
 */
function resolveDirectFilteredAggregatePlan({
  question,
  schema,
  datasets,
}) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return null;
  }

  const aggregation =
    detectQuestionAggregation(
      question
    );

  /**
   * Do NOT collapse ranking/trend questions into a simple filtered
   * aggregate merely because they contain words such as "average".
   *
   * Examples of structures that must continue to the analytical
   * planner instead:
   *   - "which X had the largest increase in average Y?"
   *   - "which X decreased the most?"
   *   - "highest growth in Z"
   *
   * This is generic and does not depend on any worksheet/field name.
   */
  const hasTrendOrRankingIntent =
    /\b(?:increase|increased|increasing|decrease|decreased|decreasing|change|changed|growth|grew|rise|rose|drop|fell|decline|difference|largest|smallest|highest|lowest|most|least|top|bottom)\b/.test(
      text
    );

  if (
    hasTrendOrRankingIntent
  ) {
    return null;
  }

  if (
    !aggregation ||
    ![
      "sum",
      "average",
      "count",
    ].includes(
      aggregation
    )
  ) {
    return null;
  }

  const match =
    text.match(
      /^(?:what|which|show|give|tell me|get|find|calculate|compute)\s+(?:(?:is|are|was|were)\s+)?(?:the\s+)?(.+?)\s+(?:in|at|within|inside|under|for|from)\s+(.+?)\??$/
    );

  if (
    !match?.[1] ||
    !match?.[2]
  ) {
    return null;
  }

  const requestedPhrase =
    match[1]
      .replace(
        /\b(?:total|sum|combined|overall|altogether|average|avg|mean|count|number of|how many)\b/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const identifierText =
    match[2]
      .replace(
        /[?.!]+$/g,
        ""
      )
      .trim();

  if (
    !requestedPhrase ||
    !identifierText
  ) {
    return null;
  }

  const candidates = [];

  for (
    const datasetSchema
    of schema || []
  ) {
    const datasetName =
      datasetSchema?.name;

    const rows =
      datasets?.[
        datasetName
      ];

    if (
      !datasetName ||
      !Array.isArray(rows) ||
      !rows.length
    ) {
      continue;
    }

    let filters =
      inferCoherentFilters(
        rows,
        identifierText
      );

    if (
      !Array.isArray(filters) ||
      !filters.length
    ) {
      filters =
        inferApproximateEntityFilterFromText({
          rows,
          identifierText,
        });
    }

    if (
      !Array.isArray(filters) ||
      !filters.length
    ) {
      continue;
    }

    const excludedColumns =
      new Set(
        filters
          .map(
            (filter) =>
              normalizeText(
                filter?.column
              )
          )
          .filter(Boolean)
      );

    const metricCandidates =
      (datasetSchema.columns || [])
        .filter(
          (column) =>
            column?.name &&
            !excludedColumns.has(
              normalizeText(
                column.name
              )
            )
        )
        .filter(
          (column) =>
            aggregation ===
              "count" ||
            isNumericLikeColumn({
              column,
              rows,
            })
        )
        .map(
          (column) => {
            const naturalScore =
              scoreNaturalFieldPhrase(
                requestedPhrase,
                column.name
              );

            const fuzzyScore =
              similarity(
                normalizeText(
                  requestedPhrase
                ),
                normalizeText(
                  column.name
                )
              );

            /**
             * scoreNaturalFieldPhrase rewards shared schema words while
             * similarity tolerates small typing errors such as
             * "land are" -> "land area".
             */
            const score =
              Math.max(
                naturalScore,
                fuzzyScore * 2.5
              );

            return {
              column,
              score,
            };
          }
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    const metric =
      metricCandidates[0] ||
      null;

    if (
      !metric ||
      metric.score < 1.15
    ) {
      continue;
    }

    /**
     * If two different metrics are effectively tied, do not guess.
     */
    if (
      metricCandidates.length >
        1 &&
      Math.abs(
        metricCandidates[0]
          .score -
        metricCandidates[1]
          .score
      ) < 0.08
    ) {
      continue;
    }

    candidates.push({
      dataset:
        datasetName,

      column:
        metric.column.name,

      score:
        metric.score,

      filters,
    });
  }

  if (!candidates.length) {
    /**
     * Final generic fallback:
     * resolve the requested output column across the live schema first,
     * then independently recover the entity filter from that dataset.
     *
     * This prevents a strong field phrase such as
     * "climate related risks" from being lost merely because the first
     * combined pass was too conservative.
     */
    const explicitField =
      inferRequestedColumnFromQuestion({
        schema,
        question:
          requestedPhrase,
      });

    if (explicitField) {
      const rows =
        datasets?.[
          explicitField.dataset
        ];

      const explicitDatasetSchema =
        (schema || []).find(
          (item) =>
            String(
              item?.name || ""
            ) ===
            String(
              explicitField.dataset || ""
            )
        );

      const explicitColumnSchema =
        explicitDatasetSchema
          ?.columns
          ?.find(
            (column) =>
              String(
                column?.name || ""
              ) ===
              String(
                explicitField.column || ""
              )
          ) ||
        null;

      /**
       * SUM/AVERAGE must never target a non-numeric field just because
       * the field name was the strongest fuzzy text match.
       */
      const metricTypeIsValid =
        aggregation === "count" ||
        isNumericLikeColumn({
          column:
            explicitColumnSchema,
          rows:
            Array.isArray(rows)
              ? rows
              : [],
        });

      if (
        Array.isArray(rows) &&
        rows.length &&
        metricTypeIsValid
      ) {
        let filters =
          inferCoherentFilters(
            rows,
            identifierText
          );

        if (
          !Array.isArray(filters) ||
          !filters.length
        ) {
          filters =
            inferApproximateEntityFilterFromText({
              rows,
              identifierText,
            });
        }

        if (
          Array.isArray(filters) &&
          filters.length
        ) {
          candidates.push({
            dataset:
              explicitField.dataset,

            column:
              explicitField.column,

            fieldScore:
              explicitField.score ||
              0.95,

            filters,
          });
        }
      }
    }
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score
  );

  if (
    candidates.length > 1 &&
    candidates[0].dataset !==
      candidates[1].dataset &&
    Math.abs(
      candidates[0].score -
      candidates[1].score
    ) < 0.03
  ) {
    return null;
  }

  const best =
    candidates[0];

  const operation =
    aggregation === "count"
      ? "non_empty_count"
      : aggregation;

  return {
    route:
      "dataset",

    dataset:
      best.dataset,

    operation,

    column:
      best.column,

    labelColumn:
      null,

    groupBy:
      null,

    aggregation:
      aggregation === "count"
        ? "count"
        : aggregation,

    direction:
      null,

    filters:
      best.filters.map(
        (filter) => ({
          ...filter,

          value:
            Array.isArray(
              filter?.value
            )
              ? [...filter.value]
              : filter?.value,
        })
      ),

    selectColumns: [
      best.column,
    ],

    outputRequested:
      true,

    transform:
      null,

    limit:
      10,

    showAll:
      false,

    directFilteredAggregate:
      true,
  };
}


function resolveDirectFilteredFieldPlan({
  question,
  schema,
  datasets,
}) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return null;
  }

  /**
   * Direct field + entity/location/value questions.
   *
   * Examples:
   *   "What are the climate related risks in Solsona?"
   *   "What are the commodities in Dingras?"
   *   "Which projects are in San Fernando?"
   *   "What is the enterprise in Barangay X?"
   *
   * The field and filter value are both resolved from live schema/data.
   */
  const match =
    text.match(
      /^(?:what|which|who|show|give|list|display|tell me|get|find)\s+(?:(?:is|are|was|were)\s+)?(?:the\s+)?(.+?)\s+(?:in|at|within|inside|under|for|from|of)\s+(.+?)\??$/
    );

  if (
    !match?.[1] ||
    !match?.[2]
  ) {
    return null;
  }

  const requestedPhrase =
    match[1]
      .trim();

  const identifierText =
    match[2]
      .replace(
        /[?.!]+$/g,
        ""
      )
      .trim();

  if (
    !requestedPhrase ||
    !identifierText
  ) {
    return null;
  }

  const candidates = [];

  for (
    const datasetSchema
    of schema || []
  ) {
    const rows =
      datasets?.[
        datasetSchema?.name
      ];

    if (
      !Array.isArray(
        rows
      ) ||
      !rows.length
    ) {
      continue;
    }

    let filters =
      inferCoherentFilters(
        rows,
        identifierText
      );

    /**
     * The typed entity can differ slightly from the stored value
     * (for example a small spelling typo). Use the same conservative,
     * data-driven fuzzy entity recovery used by numeric aggregates.
     */
    if (
      !Array.isArray(
        filters
      ) ||
      !filters.length
    ) {
      filters =
        inferApproximateEntityFilterFromText({
          rows,
          identifierText,
        });
    }

    if (
      !Array.isArray(
        filters
      ) ||
      !filters.length
    ) {
      continue;
    }

    const columns =
      Array.isArray(
        datasetSchema.columns
      )
        ? datasetSchema.columns
        : [];

    const bestColumn =
      columns
        .map(
          (column) => {
            const naturalScore =
              scoreNaturalFieldPhrase(
                requestedPhrase,
                column?.name
              );

            const fuzzyScore =
              Math.max(
                similarity(
                  normalizeText(
                    requestedPhrase
                  ),
                  normalizeText(
                    column?.name
                  )
                ),

                normalizedEditSimilarity(
                  normalizeText(
                    requestedPhrase
                  ),
                  normalizeText(
                    column?.name
                  )
                )
              );

            return {
              column,

              score:
                Math.max(
                  naturalScore,
                  fuzzyScore * 2
                ),
            };
          }
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )[0] ||
      null;

    if (
      !bestColumn ||
      bestColumn.score <
        0.95
    ) {
      continue;
    }

    candidates.push({
      dataset:
        datasetSchema.name,

      column:
        bestColumn.column.name,

      fieldScore:
        bestColumn.score,

      filters,
    });
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      b.fieldScore -
      a.fieldScore
  );

  const best =
    candidates[0];

  /**
   * Avoid auto-picking when two worksheets are genuinely tied.
   */
  if (
    candidates.length > 1 &&
    Math.abs(
      candidates[0].fieldScore -
      candidates[1].fieldScore
    ) <
      0.05 &&
    candidates[0].column !==
      candidates[1].column
  ) {
    return null;
  }

  const asksForList =
    /^(?:what|which)\s+are\b/.test(
      text
    ) ||
    /^(?:show|give|list|display)\b/.test(
      text
    );

  return {
    route:
      "dataset",

    dataset:
      best.dataset,

    operation:
      asksForList
        ? "list"
        : "lookup",

    column:
      best.column,

    labelColumn:
      asksForList
        ? best.column
        : null,

    groupBy:
      null,

    aggregation:
      null,

    direction:
      null,

    filters:
      best.filters.map(
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
      ),

    selectColumns: [
      best.column,
    ],

    outputRequested:
      true,

    transform:
      null,

    showAll:
      asksForList,

    limit:
      asksForList
        ? 100
        : 10,

    directFilteredField:
      true,
  };
}



function normalizeFollowUpPhrase(
  value
) {
  return normalizeText(
    value
  )
    .replace(
      /\bwhat\s+abut\b/g,
      "what about"
    )
    .replace(
      /\bhow\s+abut\b/g,
      "how about"
    );
}



function extractFollowUpTargetPhrase(
  question
) {
  const text =
    normalizeFollowUpPhrase(
      question
    );

  const match =
    text.match(
      /^(?:what|how)\s+about\s+(.+?)(?:[?.!]+)?$|^and\s+(.+?)(?:[?.!]+)?$|^for\s+(.+?)(?:[?.!]+)?$/
    );

  return normalizeText(
    match?.[1] ||
    match?.[2] ||
    match?.[3] ||
    ""
  );
}



function normalizedEditSimilarity(
  left,
  right
) {
  const a =
    normalizeText(
      left
    );

  const b =
    normalizeText(
      right
    );

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const previous =
    Array.from(
      {
        length:
          b.length + 1,
      },
      (_, index) =>
        index
    );

  for (
    let i = 1;
    i <= a.length;
    i += 1
  ) {
    const current = [
      i,
    ];

    for (
      let j = 1;
      j <= b.length;
      j += 1
    ) {
      const substitutionCost =
        a[
          i - 1
        ] ===
        b[
          j - 1
        ]
          ? 0
          : 1;

      current[j] =
        Math.min(
          current[
            j - 1
          ] + 1,
          previous[j] + 1,
          previous[
            j - 1
          ] +
            substitutionCost
        );
    }

    for (
      let j = 0;
      j < current.length;
      j += 1
    ) {
      previous[j] =
        current[j];
    }
  }

  const distance =
    previous[
      b.length
    ];

  return Math.max(
    0,
    1 -
      distance /
        Math.max(
          a.length,
          b.length
        )
  );
}


function filterRowsBySimpleFilters(
  rows,
  filters
) {
  if (
    !Array.isArray(
      rows
    )
  ) {
    return [];
  }

  if (
    !Array.isArray(
      filters
    ) ||
    !filters.length
  ) {
    return [
      ...rows,
    ];
  }

  return rows.filter(
    (row) =>
      filters.every(
        (filter) => {
          const actual =
            row?.[
              filter?.column
            ];

          const operator =
            String(
              filter?.operator ||
              "equals"
            )
              .trim()
              .toLowerCase();

          const expected =
            filter?.value;

          const normalizeValue = (
            value
          ) =>
            normalizeText(
              value
            );

          if (
            operator === "in"
          ) {
            const expectedValues =
              Array.isArray(
                expected
              )
                ? expected
                : [
                    expected,
                  ];

            return expectedValues.some(
              (value) =>
                normalizeValue(
                  actual
                ) ===
                normalizeValue(
                  value
                )
            );
          }

          if (
            operator ===
              "contains"
          ) {
            return normalizeValue(
              actual
            ).includes(
              normalizeValue(
                expected
              )
            );
          }

          return normalizeValue(
            actual
          ) ===
            normalizeValue(
              expected
            );
        }
      )
  );
}


function chooseDistinguishingColumn({
  rows,
  excludeColumns = [],
}) {
  if (
    !Array.isArray(
      rows
    ) ||
    rows.length < 2
  ) {
    return null;
  }

  const excluded =
    new Set(
      excludeColumns.filter(
        Boolean
      )
    );

  const columns =
    Object.keys(
      rows[0] || {}
    );

  const candidates = [];

  for (
    const column
    of columns
  ) {
    if (
      excluded.has(
        column
      )
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
            String(
              value
            ).trim() !== ""
        )
        .map(
          (value) =>
            String(
              value
            ).trim()
        );

    if (
      values.length <
        rows.length
    ) {
      continue;
    }

    const unique =
      [
        ...new Set(
          values.map(
            (value) =>
              normalizeText(
                value
              )
          )
        ),
      ];

    if (
      unique.length < 2
    ) {
      continue;
    }

    const numericLike =
      values.every(
        (value) =>
          /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(
            value
          )
      );

    if (numericLike) {
      continue;
    }

    const averageLength =
      values.reduce(
        (sum, value) =>
          sum + value.length,
        0
      ) /
      values.length;

    /**
     * Prefer compact categorical identifiers over long descriptions.
     * This naturally favors fields like barangay/status/division over
     * long narrative text, without naming any field explicitly.
     */
    const distinctRatio =
      unique.length /
      rows.length;

    const score =
      distinctRatio *
        2 -
      Math.min(
        averageLength,
        120
      ) /
        120;

    candidates.push({
      column,
      score,
    });
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  return (
    candidates[0]?.column ||
    null
  );
}



function isLikelyIdentityOutputColumn(
  columnName
) {
  const text =
    normalizeExplicitColumnText(
      columnName
    );

  if (!text) {
    return false;
  }

  /**
   * Generic identity/display semantics only.
   *
   * Examples:
   *   Name of Association
   *   Employee Name
   *   Project Title
   *   Registration Number
   *   Farm ID
   *
   * These are already meaningful labels by themselves, so a one-to-many
   * formatter should not prepend an unrelated discriminator such as a date.
   *
   * This is schema-semantic, not dataset-specific.
   */
  return /\b(?:name|title|identifier|id|code|number|no)\b/.test(
    text
  );
}


function buildOneToManyListAnswer({
  rows,
  subjectColumn,
  filters = [],
}) {
  if (
    !Array.isArray(
      rows
    ) ||
    !rows.length ||
    !subjectColumn
  ) {
    return null;
  }

  const subjectValues =
    rows
      .map(
        (row) =>
          row?.[
            subjectColumn
          ]
      )
      .filter(
        (value) =>
          value !== null &&
          value !== undefined &&
          String(
            value
          ).trim() !== ""
      )
      .map(
        (value) =>
          String(
            value
          ).trim()
      );

  const uniqueSubjects =
    [
      ...new Map(
        subjectValues.map(
          (value) => [
            normalizeText(
              value
            ),
            value,
          ]
        )
      ).values(),
    ];

  if (!uniqueSubjects.length) {
    return null;
  }

  /**
   * Preserve row-level context whenever MORE THAN ONE row matches.
   * Even when all requested values are identical, keep each distinct
   * matching record visible. Only a true single-row match may collapse
   * to the requested value itself.
   */
  if (
    rows.length === 1 &&
    uniqueSubjects.length ===
      1
  ) {
    return uniqueSubjects[0];
  }

  /**
   * If the requested output column is itself an identity/display field,
   * list those values directly.
   *
   * Example:
   *   subjectColumn = "Name of Association"
   *
   * Correct:
   *   1. Association A
   *   2. Association B
   *
   * Wrong:
   *   14-Oct-15 — Association A
   *   03-Aug-18 — Association B
   *
   * A discriminator is useful only when the requested values are
   * descriptive/non-identity outputs that need row context.
   */
  if (
    isLikelyIdentityOutputColumn(
      subjectColumn
    )
  ) {
    return uniqueSubjects
      .map(
        (value, index) =>
          `${index + 1}. ${value}`
      )
      .join(
        "\n"
      );
  }

  const discriminator =
    chooseDistinguishingColumn({
      rows,

      excludeColumns: [
        subjectColumn,

        ...filters.map(
          (filter) =>
            filter?.column
        ),
      ],
    });

  if (!discriminator) {
    return uniqueSubjects
      .map(
        (value, index) =>
          `${index + 1}. ${value}`
      )
      .join(
        "\n"
      );
  }

  const lines = [];

  const seen =
    new Set();

  for (
    const row
    of rows
  ) {
    const label =
      row?.[
        discriminator
      ];

    const value =
      row?.[
        subjectColumn
      ];

    if (
      label === null ||
      label === undefined ||
      value === null ||
      value === undefined
    ) {
      continue;
    }

    const cleanLabel =
      String(
        label
      ).trim();

    const cleanValue =
      String(
        value
      ).trim();

    if (
      !cleanLabel ||
      !cleanValue
    ) {
      continue;
    }

    const key =
      `${normalizeText(
        cleanLabel
      )}::${normalizeText(
        cleanValue
      )}`;

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    lines.push(
      `${cleanLabel} — ${cleanValue}`
    );
  }

  return lines.length
    ? lines.join(
        "\n"
      )
    : uniqueSubjects
        .map(
          (value, index) =>
            `${index + 1}. ${value}`
        )
        .join(
          "\n"
        );
}


function inferApproximateFollowUpFilter({
  rows,
  question,
  preferredColumns = [],
}) {
  if (
    !Array.isArray(
      rows
    ) ||
    !rows.length
  ) {
    return [];
  }

  const target =
    extractFollowUpTargetPhrase(
      question
    );

  if (!target) {
    return [];
  }

  /**
   * Do not reinterpret analytical follow-ups as row filters.
   */
  if (
    /\b(?:average|avg|mean|total|sum|highest|lowest|maximum|minimum|top|bottom|difference|ratio|median|range|spread|count|number)\b/.test(
      target
    )
  ) {
    return [];
  }

  const allColumns =
    Object.keys(
      rows[0] || {}
    );

  const preferred =
    Array.isArray(
      preferredColumns
    )
      ? preferredColumns.filter(
          (column) =>
            allColumns.includes(
              column
            )
        )
      : [];

  const preferredSet =
    new Set(
      preferred
    );

  const columns = [
    ...preferred,

    ...allColumns.filter(
      (column) =>
        !preferredSet.has(
          column
        )
    ),
  ];

  const candidates = [];

  for (
    const column
    of columns
  ) {
    const seen =
      new Set();

    const values = [];

    for (
      const row
      of rows
    ) {
      const raw =
        row?.[column];

      if (
        raw === null ||
        raw === undefined
      ) {
        continue;
      }

      const value =
        String(
          raw
        ).trim();

      if (
        !value ||
        value.length > 120
      ) {
        continue;
      }

      /**
       * Avoid numeric measure columns for entity/location switching.
       */
      if (
        /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(
          value
        )
      ) {
        continue;
      }

      const normalized =
        normalizeText(
          value
        );

      if (
        !normalized ||
        seen.has(
          normalized
        )
      ) {
        continue;
      }

      seen.add(
        normalized
      );

      values.push({
        raw:
          value,

        normalized,
      });

      if (
        values.length >= 500
      ) {
        break;
      }
    }

    for (
      const value
      of values
    ) {
      let score =
        Math.max(
          similarity(
            target,
            value.normalized
          ),

          normalizedEditSimilarity(
            target,
            value.normalized
          )
        );

      if (
        target ===
          value.normalized
      ) {
        score = 1;
      } else if (
        target.includes(
          value.normalized
        ) ||
        value.normalized.includes(
          target
        )
      ) {
        score =
          Math.max(
            score,
            0.94
          );
      }

      const preferredColumn =
        preferredSet.has(
          column
        );

      /**
       * Strong conversational continuity:
       * if the previous verified scope was Municipality, Division,
       * Province, Status, etc., search that SAME column first.
       *
       * This lets:
       *   Municipality = Solsona
       *   "What about San Emilio?"
       * resolve against Municipality values before scanning unrelated
       * columns.
       */
      const effectiveScore =
        preferredColumn
          ? Math.min(
              1,
              score + 0.08
            )
          : score;

      const threshold =
        preferredColumn
          ? 0.72
          : 0.82;

      if (
        effectiveScore >=
          threshold
      ) {
        candidates.push({
          column,

          value:
            value.raw,

          score:
            effectiveScore,

          preferredColumn,
        });
      }
    }
  }

  if (!candidates.length) {
    return [];
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const best =
    candidates[0];

  const second =
    candidates[1];

  /**
   * Require a confident match and avoid ambiguous near-ties across
   * different values.
   */
  const minimumScore =
    best.preferredColumn
      ? 0.78
      : 0.86;

  if (
    best.score <
      minimumScore
  ) {
    return [];
  }

  if (
    second &&
    second.value !==
      best.value &&
    Math.abs(
      best.score -
      second.score
    ) <
      (
        best.preferredColumn
          ? 0.02
          : 0.03
      )
  ) {
    return [];
  }

  return [
    {
      column:
        best.column,

      operator:
        "equals",

      value:
        best.value,

      approximateMatch:
        true,

      matchScore:
        best.score,
    },
  ];
}


function findPreviousScopeFilterColumns({
  context,
}) {
  const previousQuestion =
    normalizeFollowUpPhrase(
      context?.lastQuestion ||
      context?.lastSubjectQuestion ||
      ""
    );

  const previousFilters =
    Array.isArray(
      context?.lastFilters
    )
      ? context.lastFilters
      : [];

  if (
    !previousQuestion ||
    !previousFilters.length
  ) {
    return new Set();
  }

  const scopeMatch =
    previousQuestion.match(
      /\b(?:in|at|within|inside|under|for|from|of|by)\s+(.+?)(?:[?.!]+)?$/
    );

  const aboutMatch =
    previousQuestion.match(
      /^(?:what|how)\s+about\s+(.+?)(?:[?.!]+)?$|^and\s+(.+?)(?:[?.!]+)?$/
    );

  const scopeText =
    normalizeText(
      scopeMatch?.[1] ||
      aboutMatch?.[1] ||
      aboutMatch?.[2] ||
      ""
    );

  if (!scopeText) {
    return new Set();
  }

  if (!scopeText) {
    return new Set();
  }

  const columns =
    new Set();

  for (
    const filter
    of previousFilters
  ) {
    const rawValues =
      Array.isArray(
        filter?.value
      )
        ? filter.value
        : [
            filter?.value,
          ];

    const matched =
      rawValues.some(
        (value) => {
          const normalized =
            normalizeText(
              value
            );

          return (
            normalized &&
            (
              scopeText.includes(
                normalized
              ) ||
              normalized.includes(
                scopeText
              )
            )
          );
        }
      );

    if (
      matched &&
      filter?.column
    ) {
      columns.add(
        filter.column
      );
    }
  }

  return columns;
}


function buildVerifiedListAnswer({
  result,
  subjectColumn = null,
}) {
  const items =
    Array.isArray(
      result?.results
    )
      ? result.results
          .map(
            (item) => {
              if (
                item === null ||
                item === undefined
              ) {
                return "";
              }

              if (
                typeof item !==
                  "object"
              ) {
                return String(
                  item
                ).trim();
              }

              if (
                subjectColumn &&
                item?.[
                  subjectColumn
                ] !== null &&
                item?.[
                  subjectColumn
                ] !== undefined &&
                String(
                  item[
                    subjectColumn
                  ]
                ).trim() !== ""
              ) {
                return String(
                  item[
                    subjectColumn
                  ]
                ).trim();
              }

              if (
                item.label !== null &&
                item.label !==
                  undefined &&
                String(
                  item.label
                ).trim() !== ""
              ) {
                if (
                  item.value !== null &&
                  item.value !==
                    undefined &&
                  String(
                    item.value
                  ).trim() !== ""
                ) {
                  return `${String(
                    item.label
                  ).trim()} — ${String(
                    item.value
                  ).trim()}`;
                }

                return String(
                  item.label
                ).trim();
              }

              if (
                item.value !== null &&
                item.value !==
                  undefined &&
                String(
                  item.value
                ).trim() !== ""
              ) {
                return String(
                  item.value
                ).trim();
              }

              const values =
                Object.values(
                  item
                )
                  .filter(
                    (value) =>
                      value !== null &&
                      value !==
                        undefined &&
                      String(
                        value
                      ).trim() !==
                        ""
                  )
                  .map(
                    (value) =>
                      String(
                        value
                      ).trim()
                  );

              return values.join(
                " — "
              );
            }
          )
          .filter(Boolean)
      : [];

  if (!items.length) {
    return (
      result?.answer ||
      "No matching results were found."
    );
  }

  return items
    .map(
      (value, index) =>
        `${index + 1}. ${value}`
    )
    .join(
      "\n"
    );
}


function repairConversationalListPlan({
  plan,
  context,
  question,
  schema,
}) {
  if (
    !plan ||
    typeof plan !== "object" ||
    !context ||
    context.isFollowUp !== true
  ) {
    return plan;
  }

  const operation =
    String(
      plan.operation || ""
    )
      .trim()
      .toLowerCase();

  if (
    plan.route !== "dataset" ||
    operation !== "list"
  ) {
    return plan;
  }

  if (
    !plan.dataset &&
    context.lastDataset
  ) {
    plan = {
      ...plan,
      dataset:
        context.lastDataset,
    };
  }

  const currentColumns =
    Array.isArray(
      plan.selectColumns
    )
      ? plan.selectColumns.filter(Boolean)
      : [];

  if (
    currentColumns.length > 0 ||
    plan.column
  ) {
    return plan;
  }

  const text =
    normalizeText(
      question
    );

  const isReferentialList =
    /\b(those|these|them|they|ones)\b/.test(
      text
    );

  if (!isReferentialList) {
    return plan;
  }

  const rememberedSubject =
    inferRememberedSubjectColumn({
      schema,

      datasetName:
        plan.dataset ||
        context.lastDataset ||
        null,

      previousQuestion:
        context.lastSubjectQuestion ||
        context.lastQuestion,

      context,
    }) ||
    (
      Array.isArray(
        context.lastMetric
      )
        ? (
            context.lastMetric.length === 1
              ? context.lastMetric[0]
              : null
          )
        : context.lastMetric
    ) ||
    null;

  if (!rememberedSubject) {
    return plan;
  }

  return {
    ...plan,

    dataset:
      plan.dataset ||
      context.lastDataset ||
      null,

    column:
      rememberedSubject,

    labelColumn:
      rememberedSubject,

    filters:
      Array.isArray(
        context.lastFilters
      ) &&
      context.lastFilters.length
        ? context.lastFilters.map(
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
        : (
            Array.isArray(
              plan.filters
            )
              ? plan.filters
              : []
          ),

    selectColumns: [
      rememberedSubject,
    ],

    outputRequested:
      true,

    showAll:
      true,

    limit:
      Math.max(
        Number(
          plan.limit
        ) || 10,
        100
      ),
  };
}


function applyConversationContext(
  plan,
  context,
  {
    schema = [],
    question = "",
  } = {}
) {
  if (
    !plan ||
    typeof plan !== "object" ||
    !context ||
    context.isFollowUp !== true
  ) {
    return plan;
  }

  const resolvedPlan = {
    ...plan,

    filters:
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
                  ? [
                      ...filter.value,
                    ]
                  : filter?.value,
            })
          )
        : [],

    selectColumns:
      Array.isArray(
        plan.selectColumns
      )
        ? [
            ...plan.selectColumns,
          ]
        : [],
  };

  const lastEntity =
    context.lastEntity || null;

  const lastDataset =
    context.lastDataset || null;

  const lastEntityColumn =
    lastEntity?.column || null;

  /**
   * Determine whether the CURRENT follow-up explicitly asks
   * for a new output field.
   *
   * First trust Groq if it already supplied one.
   * Otherwise infer the field dynamically from the live schema
   * and the current question.
   */
  let requestedColumns =
    resolvedPlan.selectColumns
      .filter(Boolean);

  if (
    requestedColumns.length === 0 &&
    resolvedPlan.route === "schema" &&
    resolvedPlan.column
  ) {
    requestedColumns = [
      resolvedPlan.column,
    ];
  }

  const inferredRequested =
    inferRequestedColumnFromQuestion({
      schema,

      question,

      preferredDataset:
        resolvedPlan.dataset ||
        lastDataset,

      excludedColumns:
        [
          lastEntityColumn,
        ],
    });

  if (
    requestedColumns.length === 0 &&
    inferredRequested?.column
  ) {
    requestedColumns = [
      inferredRequested.column,
    ];
  }

  // ========================================================
  // 1. RECOVER DATASET LOOKUP FOR FIELD-ONLY FOLLOW-UPS
  // ========================================================
  //
  // A short follow-up such as:
  //
  // "how about actual salary"
  //
  // can sometimes be classified by Groq as schema/general
  // because no entity is written in the current sentence.
  //
  // If conversation memory has a real previous entity and
  // the current question dynamically identifies a real schema
  // field, convert it back to a dataset lookup.
  //
  if (
    lastEntity &&
    lastDataset &&
    requestedColumns.length > 0 &&
    resolvedPlan.route !== "dataset"
  ) {
    resolvedPlan.route =
      "dataset";

    resolvedPlan.dataset =
      lastDataset;

    resolvedPlan.operation =
      "lookup";

    resolvedPlan.column =
      requestedColumns.length === 1
        ? requestedColumns[0]
        : null;

    resolvedPlan.groupBy =
      null;

    resolvedPlan.aggregation =
      null;

    resolvedPlan.direction =
      null;

    resolvedPlan.selectColumns = [
      ...requestedColumns,
    ];

    resolvedPlan.outputRequested =
      true;

    resolvedPlan.transform =
      null;

    resolvedPlan.showAll =
      false;

    resolvedPlan.limit =
      Number.isInteger(
        Number(
          resolvedPlan.limit
        )
      ) &&
      Number(
        resolvedPlan.limit
      ) > 0
        ? Number(
            resolvedPlan.limit
          )
        : 10;

    resolvedPlan.filters = [];
  }

  // ========================================================
  // 2. INHERIT LAST ENTITY
  // ========================================================
  //
  // Same entity, new field:
  //
  // "authorized salary of [person]"
  // "how about actual salary"
  //
  if (
    resolvedPlan.route ===
      "dataset" &&
    lastEntity
  ) {
    const alreadyHasEntity =
      resolvedPlan.filters.some(
        (filter) =>
          normalizeText(
            filter?.column
          ) ===
          normalizeText(
            lastEntity.column
          )
      );

    if (!alreadyHasEntity) {
      resolvedPlan.filters.push({
        column:
          lastEntity.column,

        operator:
          lastEntity.operator ||
          "equals",

        value:
          Array.isArray(
            lastEntity.value
          )
            ? [
                ...lastEntity.value,
              ]
            : lastEntity.value,
      });
    }
  }

  // ========================================================
  // 3. PRESERVE THE CURRENTLY REQUESTED FIELD
  // ========================================================
  //
  // If this follow-up explicitly names a new field, it must
  // take priority over the previous metric.
  //
  if (
    resolvedPlan.route ===
      "dataset" &&
    resolvedPlan.operation ===
      "lookup" &&
    requestedColumns.length > 0
  ) {
    resolvedPlan.selectColumns = [
      ...requestedColumns,
    ];

    resolvedPlan.column =
      requestedColumns.length === 1
        ? requestedColumns[0]
        : resolvedPlan.column;

    resolvedPlan.outputRequested =
      true;
  }

  // ========================================================
  // 4. INHERIT PREVIOUS OUTPUT FIELD ONLY WHEN NO NEW FIELD
  //    WAS REQUESTED
  // ========================================================
  //
  // New entity, same metric:
  //
  // "What is [person A]'s position?"
  // "What about [person B]?"
  //
  if (
    resolvedPlan.route ===
      "dataset" &&
    resolvedPlan.operation ===
      "lookup" &&
    resolvedPlan.selectColumns
      .length === 0 &&
    !inferredRequested &&
    context.lastMetric
  ) {
    if (
      Array.isArray(
        context.lastMetric
      )
    ) {
      resolvedPlan.selectColumns = [
        ...context.lastMetric,
      ];
    } else {
      resolvedPlan.selectColumns = [
        context.lastMetric,
      ];
    }

    resolvedPlan.outputRequested =
      true;
  }


  // ========================================================
  // 4B. GENERIC "WHAT ARE THOSE?" / "SHOW THEM" REPAIR
  // ========================================================
  //
  // Example:
  //
  //   "How many associations are in La Union?"
  //   -> count subject = <real schema column>
  //   -> filter = Province = La Union
  //
  //   "What are those?"
  //   -> operation = list
  //   -> list the SAME remembered subject field
  //   -> preserve the SAME filters
  //
  // Works for associations, employees, projects, farmers, etc.
  // No business-specific field names are hardcoded.
  //
  const normalizedFollowUpQuestion =
    normalizeText(
      question
    );

  const isPronounListFollowUp =
    resolvedPlan.route ===
      "dataset" &&
    resolvedPlan.operation ===
      "list" &&
    (
      /\b(?:what|which)\s+(?:are|were)\s+(?:those|these|they|them)\b/.test(
        normalizedFollowUpQuestion
      ) ||
      /\b(?:show|list|give|display|name)\s+(?:me\s+)?(?:those|these|them|they)\b/.test(
        normalizedFollowUpQuestion
      ) ||
      /\bwho\s+(?:are|were)\s+(?:those|these|they|them)\b/.test(
        normalizedFollowUpQuestion
      )
    );

  if (
    isPronounListFollowUp &&
    resolvedPlan.selectColumns.length ===
      0
  ) {
    const rememberedSubject =
      inferRememberedSubjectColumn({
        schema,

        datasetName:
          resolvedPlan.dataset ||
          context.lastDataset ||
          null,

        previousQuestion:
          context.lastQuestion,

        context,
      }) ||
      (
        Array.isArray(
          context.lastMetric
        )
          ? (
              context.lastMetric.length === 1
                ? context.lastMetric[0]
                : null
            )
          : context.lastMetric
      ) ||
      null;

    if (rememberedSubject) {
      resolvedPlan.column =
        rememberedSubject;

      resolvedPlan.labelColumn =
        rememberedSubject;

      resolvedPlan.selectColumns = [
        rememberedSubject,
      ];

      resolvedPlan.outputRequested =
        true;

      resolvedPlan.showAll =
        true;

      resolvedPlan.limit =
        Math.max(
          Number(
            resolvedPlan.limit
          ) || 10,
          100
        );

      /**
       * Restore all verified previous filters, not just the primary
       * entity filter. This makes multi-filter count -> list chains
       * deterministic.
       */
      if (
        Array.isArray(
          context.lastFilters
        ) &&
        context.lastFilters.length
      ) {
        resolvedPlan.filters =
          context.lastFilters.map(
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
          );
      }
    }
  }


  // ========================================================
  // 5. INHERIT PREVIOUS DATASET WHEN THE CURRENT DATASET IS
  //    MISSING
  // ========================================================

  if (
    resolvedPlan.route ===
      "dataset" &&
    !resolvedPlan.dataset &&
    lastDataset
  ) {
    resolvedPlan.dataset =
      lastDataset;
  }

  // ========================================================
  // 6. INHERIT PREVIOUS OPERATION ONLY WHEN NEEDED
  // ========================================================

  if (
    resolvedPlan.route ===
      "dataset" &&
    (
      !resolvedPlan.operation ||
      resolvedPlan.operation ===
        "lookup"
    ) &&
    context.lastIntent &&
    context.lastIntent !==
      "general"
  ) {
    /**
     * For analytical follow-ups, inherit the previous operation
     * even when the current question explicitly names a new metric.
     *
     * Example:
     * total Irrigated -> "How about Rainfed?"
     * keeps operation = sum and changes only the metric column.
     */
    if (
      context.lastIntent !== "lookup"
    ) {
      resolvedPlan.operation =
        context.lastIntent;

      if (
        requestedColumns.length > 0
      ) {
        resolvedPlan.column =
          requestedColumns[0];

        resolvedPlan.selectColumns = [];
        resolvedPlan.outputRequested =
          false;
      }
    } else if (
      resolvedPlan.selectColumns.length === 0
    ) {
      resolvedPlan.operation =
        context.lastIntent;
    }
  }

  return resolvedPlan;
}


/**
 * ==========================================================
 * REPAIR MULTI-ENTITY FILTERS
 * ==========================================================
 *
 * This is fully dynamic.
 *
 * It does NOT hardcode:
 * - names
 * - divisions
 * - provinces
 * - municipalities
 * - worksheet names
 * - column names
 *
 * It scans the current selected worksheet for actual values
 * mentioned in the user's question.
 *
 * Example runtime behavior:
 *
 * Planner:
 *   LAST NAME = PERALES
 *
 * Question also contains another real LAST NAME value.
 *
 * JavaScript may safely upgrade this to:
 *
 *   LAST NAME IN [value1, value2]
 *
 * The actual column and values are discovered from the live
 * worksheet, not written into this code.
 */
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

  const groupBy =
    operation === "rank_rows"
      ? null
      : (
          previous.groupBy ||
          previous.labelColumn ||
          null
        );

  const excludedValues =
    detectAnalyticalExclusions({
      datasets,
      context,
      question,
    });

  const labelColumn =
    previous.labelColumn ||
    groupBy ||
    null;

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

function splitCompoundQuestions(
  question
) {
  const original =
    String(
      question || ""
    )
      .replace(/\s+/g, " ")
      .trim();

  if (
    !original
  ) {
    return [];
  }

  let pieces =
    original
      .split(
        /\?\s*(?=[A-Za-z0-9])/g
      )
      .map(
        (part) =>
          String(
            part || ""
          )
            .trim()
            .replace(
              /^[,;:\-\s]+/,
              ""
            )
      )
      .filter(Boolean);

  if (
    pieces.length === 1
  ) {
    pieces =
      original
        .split(
          /\s*(?:,|;)?\s+\b(?:and|also|plus)\b\s+(?=(?:what|which|who|where|when|how\s+many|how\s+much|how|calculate|compute|find|give|show|tell)\b|(?:the\s+)?(?:total|sum|average|avg|mean|median|minimum|maximum|max|min|count|number\s+of)\b)/i
        )
        .map(
          (part) =>
            String(
              part || ""
            )
              .trim()
              .replace(
                /^[,;:\-\s]+/,
                ""
              )
        )
        .filter(Boolean);
  }

  if (
    pieces.length === 1 &&
    original.includes(";")
  ) {
    const semicolonParts =
      original
        .split(/\s*;\s*/)
        .map(
          (part) =>
            part.trim()
        )
        .filter(Boolean);

    const analyticalCue =
      /\b(?:what|which|who|where|when|how|calculate|compute|find|give|show|tell|total|sum|average|avg|mean|median|minimum|maximum|max|min|count|number)\b/i;

    if (
      semicolonParts.length > 1 &&
      semicolonParts.every(
        (part) =>
          analyticalCue.test(
            part
          )
      )
    ) {
      pieces =
        semicolonParts;
    }
  }

  if (
    pieces.length < 2
  ) {
    return [
      original,
    ];
  }

  const meaningful =
    pieces.filter(
      (part) =>
        normalizeText(
          part
        )
          .split(/\s+/)
          .filter(Boolean)
          .length >= 2
    );

  return (
    meaningful.length >= 2
      ? meaningful
      : [
          original,
        ]
  );
}


function buildCompoundAnswer(
  subResults
) {
  const answers =
    subResults
      .map(
        (item) =>
          String(
            item?.result?.answer ||
            ""
          ).trim()
      )
      .filter(Boolean);

  if (
    !answers.length
  ) {
    return (
      "I couldn't complete the requested questions."
    );
  }

  return answers
    .map(
      (answer, index) =>
        subResults.length > 1
          ? `${index + 1}. ${answer}`
          : answer
    )
    .join("\n");
}




/**
 * ==========================================================
 * USER-FACING ANSWER FORMATTER
 * ==========================================================
 * Presentation only. Dataset calculations are unchanged.
 */
function formatUserFacingAnswer(answer) {
  let output = String(answer || "").trim();
  if (!output) return output;

  // I-DAMAG monetary values are presented in Philippine pesos.
  output = output.replace(/\$(?=\s*[\d,.])/g, "₱");

  // Avoid raw Markdown markers in the chatbot bubble.
  output = output.replace(/\*\*/g, "");

  return output;
}

function improveCompoundAnswerWording(subResults) {
  const answers = subResults
    .map((item) =>
      formatUserFacingAnswer(item?.result?.answer)
    )
    .filter(Boolean);

  if (!answers.length) {
    return "I couldn't complete the requested questions.";
  }

  if (answers.length === 1) {
    return answers[0];
  }

  const cleaned = answers.map((answer) =>
    String(answer).replace(/[.!?]+$/, "").trim()
  );

  if (cleaned.length === 2) {
    return `${cleaned[0]}. ${cleaned[1]}.`;
  }

  return cleaned
    .map((answer, index) => `${index + 1}. ${answer}.`)
    .join("\n");
}



/**
 * ==========================================================
 * LINKED MULTI-FIELD REQUEST DETECTOR
 * ==========================================================
 *
 * Handles related requests such as:
 *
 *   "What are the <field A> in <scope> and give me <field B>"
 *   "Show <field A> for <scope> and include <field B>"
 *
 * These are NOT two independent questions. They are one
 * row-aware lookup with shared filters and multiple outputs.
 *
 * No worksheet names, field names, values, or business terms
 * are hardcoded.
 */

function splitLinkedMultiFieldRequest(
  question
) {
  const original =
    String(
      question || ""
    )
      .replace(/\s+/g, " ")
      .trim();

  if (!original) {
    return null;
  }

  const match =
    original.match(
      /^(.+?)\s+(?:,?\s*)\band\b\s+(?:(?:also\s+)?(?:give|show|tell)\s+(?:me\s+)?|include\s+)(.+)$/i
    );

  if (
    !match?.[1] ||
    !match?.[2]
  ) {
    return null;
  }

  const firstClause =
    match[1].trim();

  const secondClause =
    match[2].trim();

  /**
   * If the second clause explicitly asks for its own analytical
   * operation, it is a true compound calculation and should
   * continue through the compound-question path.
   */
  const secondIsIndependentCalculation =
    /\b(?:how\s+many|how\s+much|total|sum|average|avg|mean|median|minimum|maximum|max|min|count|number\s+of|difference|ratio|percentage|percent)\b/i.test(
      secondClause
    );

  if (
    secondIsIndependentCalculation
  ) {
    return null;
  }

  return {
    firstClause,
    secondClause,
  };
}


function filterClearlyMentionedLiveFilters(
  filters,
  question
) {
  const normalizedQuestion =
    ` ${normalizeText(
      question
    )} `;

  return (
    Array.isArray(filters)
      ? filters
      : []
  ).filter(
    (filter) => {
      const rawValues =
        Array.isArray(
          filter?.value
        )
          ? filter.value
          : [
              filter?.value,
            ];

      if (
        !rawValues.length
      ) {
        return false;
      }

      return rawValues.every(
        (rawValue) => {
          const normalizedValue =
            normalizeText(
              rawValue
            );

          if (
            !normalizedValue
          ) {
            return false;
          }

          /**
           * Require the inferred value to appear as a complete
           * normalized phrase in the user's scope clause.
           *
           * This blocks accidental substring matches such as
           * a short value being inferred from inside a longer word.
           */
          return normalizedQuestion.includes(
            ` ${normalizedValue} `
          );
        }
      );
    }
  );
}


function buildLinkedMultiFieldPlan({
  datasets,
  schema,
  question,
}) {
  const linked =
    splitLinkedMultiFieldRequest(
      question
    );

  if (!linked) {
    return null;
  }

  const firstField =
    inferRequestedColumnFromQuestion({
      schema,
      question:
        linked.firstClause,
      preferredDataset:
        null,
    });

  if (!firstField) {
    return null;
  }

  const datasetName =
    firstField.dataset;

  const rows =
    datasets?.[
      datasetName
    ];

  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return null;
  }

  /**
   * Collect 2+ requested output fields from the live schema.
   * This allows:
   *   "what are X in Y and give me Z"
   *   "what are X in Y and give me Z and W"
   *   "show X in Y and include Z, W, and Q"
   */
  const requestedColumns = [];

  const addColumn =
    (columnName) => {
      const value =
        String(
          columnName || ""
        ).trim();

      if (
        !value ||
        requestedColumns.some(
          (existing) =>
            normalizeText(existing) ===
            normalizeText(value)
        )
      ) {
        return;
      }

      requestedColumns.push(value);
    };

  addColumn(firstField.column);

  const explicitFields =
    findExplicitSchemaColumns({
      schema,
      question,
      preferredDataset:
        datasetName,
    });

  for (
    const item of
    explicitFields
  ) {
    if (
      String(item.dataset) ===
      String(datasetName)
    ) {
      addColumn(item.column);
    }
  }

  /**
   * Fuzzy/abbreviation fallback for misspelled requested fields.
   */
  const inferredSecondField =
    inferRequestedColumnFromQuestion({
      schema,
      question:
        linked.secondClause,
      preferredDataset:
        datasetName,
      excludedColumns:
        requestedColumns,
    });

  if (
    inferredSecondField &&
    String(
      inferredSecondField.dataset
    ) ===
      String(datasetName)
  ) {
    addColumn(
      inferredSecondField.column
    );
  }

  if (
    requestedColumns.length < 2
  ) {
    return null;
  }

  /**
   * Infer scope ONLY from the first clause.
   */
  const rawFilters =
    inferValueFilters(
      rows,
      linked.firstClause,
      requestedColumns
    );

  const filters =
    filterClearlyMentionedLiveFilters(
      rawFilters,
      linked.firstClause
    );

  if (!filters.length) {
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
      null,
    labelColumn:
      firstField.column,
    groupBy:
      null,
    aggregation:
      null,
    direction:
      null,
    filters,
    selectColumns:
      requestedColumns,
    outputRequested:
      true,
    transform:
      null,
    showAll:
      true,
    limit:
      100,
    linkedMultiField:
      true,
  };
}



/**
 * ==========================================================
 * CONVERSATION SCOPE SAFEGUARDS
 * ==========================================================
 *
 * Two distinct behaviors are needed:
 *
 * 1. A fully self-contained analytical question starts a NEW
 *    scope and must not silently inherit an old entity filter.
 *
 * 2. A short "what about <field>?" question may be a metric
 *    switch, not an entity/value switch.
 *
 * Both behaviors are derived only from the live schema and the
 * user's wording. No report, worksheet, column, or entity value
 * is hardcoded.
 */

function hasReferentialScopeLanguage(
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
    /^(?:what|how)\s+about\b/.test(
      text
    ) ||
    /^(?:and|also|then|for)\b/.test(
      text
    ) ||
    /\b(?:there|those|these|them|they|that|this|same|previous|above|earlier)\b/.test(
      text
    ) ||
    /\b(?:of|for|among|within)\s+(?:those|these|them|that|this|the same)\b/.test(
      text
    )
  );
}


function isSelfContainedAnalyticalQuestion({
  schema,
  question,
}) {
  const text =
    normalizeText(
      question
    );

  if (!text) {
    return false;
  }

  /**
   * Require an explicit analytical instruction.
   * This includes the main scalar operations and rankings.
   */
  const hasAnalyticalInstruction =
    /\b(?:total|sum|average|avg|mean|median|minimum|maximum|min|max|highest|lowest|largest|smallest|count|how many|number of|difference|ratio|percentage|percent)\b/.test(
      text
    );

  if (
    !hasAnalyticalInstruction
  ) {
    return false;
  }

  /**
   * Require the user to explicitly name at least one REAL field
   * from the current live schema. This keeps vague follow-ups such
   * as "what about the total?" connected to prior context.
   */
  const explicitColumns =
    findExplicitSchemaColumns({
      schema,
      question,
      preferredDataset:
        null,
    });

  if (
    !Array.isArray(
      explicitColumns
    ) ||
    !explicitColumns.length
  ) {
    return false;
  }

  /**
   * Referential wording means the user is intentionally continuing
   * the previous scope, so do not reset it.
   *
   * Examples that KEEP context:
   *   "What is the total quantity there?"
   *   "What about the average?"
   *   "And total project cost?"
   */
  if (
    hasReferentialScopeLanguage(
      question
    )
  ) {
    return false;
  }

  return true;
}


function findFollowUpMetricColumn({
  schema,
  question,
  preferredDataset = null,
}) {
  const target =
    extractFollowUpTargetPhrase(
      question
    );

  if (!target) {
    return null;
  }

  /**
   * Prefer an explicit real schema-column match.
   */
  const exact =
    findExplicitSchemaColumn({
      schema,
      question:
        target,
      preferredDataset,
    });

  if (exact) {
    return exact;
  }

  /**
   * Then allow the existing conservative schema-aware fuzzy
   * resolver for abbreviations/minor misspellings.
   */
  return (
    inferRequestedColumnFromQuestion({
      schema,
      question:
        target,
      preferredDataset,
      excludedColumns:
        [],
    }) ||
    null
  );
}



/**
 * ==========================================================
 * MAIN CHATBOT ENTRY POINT
 * ==========================================================
 *
 * GROQ-FIRST, DATA-SAFE ARCHITECTURE
 *
 * 1. Normalize question.
 * 2. Load current datasets.
 * 3. Retrieve conversation context.
 * 4. Handle analytical comparison follow-ups.
 * 5. Groq interprets natural language.
 * 6. JavaScript applies conversation context.
 * 7. Query Validator validates the plan.
 * 8. Entity Resolver resolves real dataset values.
 * 9. JavaScript executes the plan.
 * 10. Result Validator verifies the result.
 * 11. Verified result is saved to conversation memory.
 * 12. Natural Response Generator improves wording.
 *
 * Groq never performs dataset calculations.
 */
async function answerQuestion(
  input,
  question,
  sessionId = "default",
  internalOptions = {}
) {
  const originalQuestion =
    String(
      question || ""
    ).trim();

  const cleanQuestion =
    normalizeQuestion(
      originalQuestion
    );

  if (!cleanQuestion) {
    return {
      success: false,
      source: "system",
      answer:
        "Please enter a question.",
    };
  }

  // ========================================================
  // NORMALIZE ALL CURRENT DATASETS
  // ========================================================

  const datasets =
    normalizeDatasets(
      input
    );

  if (
    !Object.keys(
      datasets
    ).length
  ) {
    return {
      success: false,
      source: "system",
      answer:
        "No usable worksheet data is currently available.",
    };
  }


  // ========================================================
  // COMPOUND / MULTI-QUESTION REQUEST
  // ========================================================
  //
  // Split only clearly independent questions/calculations.
  // Each part is processed again by this same chatbot engine,
  // so all existing operations and validation remain reusable.
  //
  if (
    internalOptions
      ?.disableCompound !== true
  ) {
    const linkedMultiFieldCandidate =
      splitLinkedMultiFieldRequest(
        cleanQuestion
      );

    const compoundQuestions =
      linkedMultiFieldCandidate
        ? [
            cleanQuestion,
          ]
        : splitCompoundQuestions(
            cleanQuestion
          );

    if (
      compoundQuestions.length > 1
    ) {
      const subResults = [];

      for (
        let index = 0;
        index <
        compoundQuestions.length;
        index += 1
      ) {
        const subQuestion =
          compoundQuestions[
            index
          ];

        const compoundSessionId =
          `${sessionId}::compound::${Date.now()}::${index}`;

        let subResult;

        try {
          subResult =
            await answerQuestion(
              input,
              subQuestion,
              compoundSessionId,
              {
                disableCompound:
                  true,
              }
            );
        } catch (error) {
          subResult = {
            success:
              false,
            source:
              "system",
            operation:
              "error",
            answer:
              error?.message ||
              "This part of the question could not be processed.",
          };
        }

        subResults.push({
          question:
            subQuestion,
          result:
            subResult,
        });
      }

      return {
        success:
          subResults.every(
            (item) =>
              item?.result
                ?.success !==
              false
          ),
        source:
          "dataset",
        operation:
          "compound",
        questionCount:
          subResults.length,
        questions:
          subResults.map(
            (item) =>
              item.question
          ),
        results:
          subResults.map(
            (item) => ({
              question:
                item.question,
              success:
                item.result
                  ?.success,
              dataset:
                item.result
                  ?.dataset ||
                null,
              operation:
                item.result
                  ?.operation ||
                null,
              value:
                item.result
                  ?.value,
              categories:
                item.result
                  ?.categories,
              answer:
                item.result
                  ?.answer,
              plannerSource:
                item.result
                  ?.plannerSource,
              debugPlan:
                item.result
                  ?.debugPlan,
            })
          ),
        answer:
          improveCompoundAnswerWording(
            subResults
          ),
        responseStyle:
          "natural",
        plannerSource:
          "compound",
        debugPlan: {
          route:
            "compound",
          operation:
            "compound",
          questions:
            compoundQuestions,
        },
      };
    }
  }


  // ========================================================
  // STEP 2 — RETRIEVE RELEVANT REAL DATA
  // ========================================================
  //
  // Searches the ACTUAL currently loaded datasets using
  // dataRetriever.js.
  //
  // IMPORTANT:
  // This does NOT change planning or answers yet.
  // Step 3 will pass this retrievalContext into Groq.
  //

  const retrieval =
    retrieveRelevantData({
      datasets,

      question:
        cleanQuestion,
    });

  const retrievalContext =
    buildRetrievalContext(
      retrieval
    );

  if (
    process.env.NODE_ENV !==
      "production"
  ) {
    console.log(
      "Chatbot retrieval context:",
      JSON.stringify(
        retrievalContext,
        null,
        2
      )
    );
  }

  // ========================================================
  // BUILD LIVE SCHEMA
  // ========================================================

  const schema =
    buildSchema(
      datasets
    );

  // ========================================================
  // LOAD CONVERSATION CONTEXT
  // ========================================================

  const conversationContext =
    getRelevantContext(
      sessionId,
      cleanQuestion
    );

  /**
   * ========================================================
   * NEW SELF-CONTAINED QUESTION = NEW SCOPE
   * ========================================================
   *
   * A complete analytical question that names its own metric
   * should not inherit an older province/municipality/status/etc.
   *
   * Example structure:
   *   previous: "... in <some place>"
   *   current:  "What is the total <real metric>?"
   *
   * The current question is complete by itself, so clear only the
   * conversational carry-over. The user's actual session/history is
   * NOT deleted; this affects only planning for this turn.
   */
  const startsFreshAnalyticalScope =
    isSelfContainedAnalyticalQuestion({
      schema,
      question:
        cleanQuestion,
    });

  if (
    startsFreshAnalyticalScope &&
    conversationContext &&
    typeof conversationContext ===
      "object"
  ) {
    conversationContext.isFollowUp =
      false;

    conversationContext.lastDataset =
      null;

    conversationContext.lastPlan =
      null;

    conversationContext.lastResult =
      null;

    conversationContext.lastFilters =
      [];

    conversationContext.lastEntity =
      null;

    conversationContext.lastSubjectColumn =
      null;

    conversationContext.lastSubjectQuestion =
      null;

    conversationContext.lastIntent =
      null;

    conversationContext.analyticalContext =
      null;
  }

  if (
    process.env.NODE_ENV !==
      "production"
  ) {
    console.log(
      "Chatbot conversation context:",
      JSON.stringify(
        conversationContext,
        null,
        2
      )
    );
  }


  // ========================================================
  // STEP 10 — ANALYTICAL COMPARISON FOLLOW-UPS
  // ========================================================
  //
  // These questions should NOT be sent through the normal
  // dataset planner because they refer to already verified
  // previous results.
  //
  // Example:
  //
  // User:
  // "What is Roberto's salary?"
  //
  // User:
  // "What is Vener's salary?"
  //
  // User:
  // "Who has the higher salary?"
  //
  // We compare the previous VERIFIED JavaScript results.
  //

  const comparisonMode =
    detectComparisonRequest(
      cleanQuestion
    );

  if (comparisonMode) {
    /**
     * ======================================================
     * PERSISTENT COMPARISON CONTEXT
     * ======================================================
     *
     * Some conversational comparison questions such as:
     *
     *   "What is the ratio?"
     *   "How many times higher is it?"
     *
     * may not be classified by conversationManager as a normal
     * follow-up. In that case getRelevantContext() intentionally
     * hides lastPlan/lastResult, even though the verified analytical
     * comparison is still safely stored in recentResults.
     *
     * Recover the latest VERIFIED result here instead of requiring
     * the user to repeat the original comparison.
     *
     * No dataset, metric, group, or entity is hardcoded.
     */
    const recentResults =
      getRecentResults(
        sessionId
      );

    const latestVerifiedEntry =
      recentResults.length
        ? recentResults[
            recentResults.length -
              1
          ]
        : null;

    const comparisonContext = {
      ...conversationContext,

      lastPlan:
        conversationContext
          ?.lastPlan ||
        latestVerifiedEntry
          ?.plan ||
        null,

      lastResult:
        conversationContext
          ?.lastResult ||
        latestVerifiedEntry
          ?.result ||
        null,
    };

    /**
     * First, check whether the most recent VERIFIED analytical result
     * itself contains exactly two grouped/ranked values.
     *
     * This supports a full chain such as:
     *
     *   "Compare average X of A and B"
     *   -> "What is the difference?"
     *   -> "What is the ratio?"
     *   -> "What percentage higher?"
     *
     * Derived answers do NOT replace the original verified operands.
     */
    const analyticalPairComparison =
      compareVerifiedAnalyticalPair({
        context:
          comparisonContext,

        mode:
          comparisonMode,

        question:
          cleanQuestion,

        schema,
      });

    if (
      analyticalPairComparison
    ) {
      return {
        ...analyticalPairComparison,

        plannerSource:
          "conversation-analytics",
      };
    }

    if (
      process.env.NODE_ENV !==
        "production"
    ) {
      console.log(
        "Chatbot comparison history:",
        JSON.stringify(
          recentResults,
          null,
          2
        )
      );
    }

    // ======================================================
    // REQUIRE TWO VERIFIED RESULTS
    // ======================================================

    if (
      recentResults.length <
      2
    ) {
      return {
        success: false,
        source:
          "comparison",
        operation:
          "clarify",
        answer:
          "I need two previous results before I can compare them.",
      };
    }

    /**
     * Compare the two most recent verified results.
     */
    const left =
      recentResults[
        recentResults.length -
          2
      ];

    const right =
      recentResults[
        recentResults.length -
          1
      ];

    const comparisonResult =
      compareVerifiedResults({
        left,
        right,
        mode:
          comparisonMode,
      });

    if (
      process.env.NODE_ENV !==
        "production"
    ) {
      console.log(
        "Chatbot comparison result:",
        JSON.stringify(
          comparisonResult,
          null,
          2
        )
      );
    }

    /**
     * Comparison Engine performs all arithmetic.
     *
     * Do NOT ask Groq to recalculate this result.
     */
    return comparisonResult;
  }

  // ========================================================
  // EXECUTE STRUCTURED MULTI-ENTITY FILTER GROUPS
  // ========================================================
  //
  // Each group is executed independently so:
  //
  //   (FIRST NAME = ROBERTO AND LAST NAME = PERALES)
  //   OR
  //   (FIRST NAME = DORIS JOY AND LAST NAME = GARCIA)
  //
  // never becomes invalid cross-combinations.
  //
  const executeFilterGroupPlan =
    async (plan) => {
      const groups =
        Array.isArray(
          plan?.filterGroups
        )
          ? plan.filterGroups
          : [];

      const groupResults = [];
      const combinedResults = [];
      const allChanges = [];

      for (
        let index = 0;
        index < groups.length;
        index += 1
      ) {
        const group =
          groups[index];

        let childPlan = {
          ...plan,

          operation:
            "lookup",

          filters:
            Array.isArray(
              group?.filters
            )
              ? group.filters
              : [],

          filterGroups:
            undefined,

          filterGroupLogic:
            undefined,
        };

        const validation =
          validateQueryPlan({
            datasets,
            schema,
            plan:
              childPlan,
          });

        if (
          !validation.valid
        ) {
          throw new Error(
            validation.message
          );
        }

        childPlan =
          validation.plan;

        const entityResolution =
          resolvePlanEntities({
            datasets,
            plan:
              childPlan,
          });

        childPlan =
          entityResolution.plan;

        if (
          Array.isArray(
            entityResolution
              .changes
          )
        ) {
          allChanges.push(
            ...entityResolution
              .changes
          );
        }

        const rawResult =
          await executePlan({
            datasets,
            schema,
            plan:
              childPlan,

            question:
              cleanQuestion,
          });

        const resultValidation =
          validateResult({
            plan:
              childPlan,
            result:
              rawResult,
          });

        if (
          !resultValidation.valid
        ) {
          throw new Error(
            resultValidation.message
          );
        }

        const verified =
          resultValidation.result;

        const rows =
          Array.isArray(
            verified?.results
          )
            ? verified.results
            : [];

        combinedResults.push(
          ...rows
        );

        groupResults.push({
          index:
            index + 1,

          filters:
            childPlan.filters,

          count:
            Number(
              verified?.count ||
              rows.length ||
              0
            ),

          results:
            rows,
        });
      }

      const result = {
        success:
          true,

        source:
          "dataset",

        dataset:
          plan.dataset,

        operation:
          "lookup",

        count:
          combinedResults.length,

        results:
          combinedResults,

        filters:
          [],

        filterGroups:
          groupResults,

        filterGroupLogic:
          "or",
      };

      updateConversation(
        sessionId,
        {
          question:
            cleanQuestion,

          plan,

          result,
        }
      );

      const naturalAnswer =
        await generateNaturalResponse({
          question:
            cleanQuestion,

          plan,

          result,
        });

      return {
        ...result,

        answer:
          naturalAnswer,

        responseStyle:
          "natural",

        debugPlan:
          plan,

        debugEntityChanges:
          allChanges,
      };
    };

  // ========================================================
  // EXECUTE A RESOLVED QUERY PLAN
  // ========================================================

  const executeResolvedPlan =
    async (plan) => {
      if (
        !plan ||
        typeof plan !==
          "object"
      ) {
        throw new Error(
          "The query planner returned an invalid plan."
        );
      }

      if (
        plan.route ===
          "dataset" &&
        Array.isArray(
          plan.filterGroups
        ) &&
        plan.filterGroups.length
      ) {
        return executeFilterGroupPlan(
          plan
        );
      }

      // ====================================================
      // QUERY VALIDATOR
      // ====================================================

      const validation =
        validateQueryPlan({
          datasets,
          schema,
          plan,
        });

      if (
        !validation.valid
      ) {
        throw new Error(
          validation.message
        );
      }

      plan =
        validation.plan;

      // ====================================================
      // STEP 9 — RESOLVE REAL DATASET VALUES
      // ====================================================

      const entityResolution =
        resolvePlanEntities({
          datasets,
          plan,
        });

      plan =
        entityResolution.plan;

      if (
        process.env.NODE_ENV !==
          "production" &&
        entityResolution
          .changes?.length
      ) {
        console.log(
          "Chatbot entity corrections:",
          JSON.stringify(
            entityResolution.changes,
            null,
            2
          )
        );
      }

      let result;

      // ====================================================
      // SCHEMA QUESTION
      // ====================================================

      if (
        plan.route ===
        "schema"
      ) {
        result =
          await answerSchemaQuestion({
            datasets,
            schema,
            plan,

            question:
              cleanQuestion,
          });
      }

      // ====================================================
      // DATASET QUESTION
      // ====================================================

      else if (
        plan.route ===
        "dataset"
      ) {
        result =
          await executePlan({
            datasets,
            schema,
            plan,

            question:
              cleanQuestion,
          });
      }

      // ====================================================
      // GENERAL QUESTION
      // ====================================================

      else if (
        plan.route ===
        "general"
      ) {
        result =
          await answerGeneralQuestion({
            question:
              cleanQuestion,

            schema,
          });
      }

      // ====================================================
      // CLARIFICATION
      // ====================================================

      else if (
        plan.route ===
        "clarify"
      ) {
        result = {
          success: false,

          source:
            "router",

          operation:
            "clarify",

          answer:
            plan.question ||
            "Please clarify which worksheet, field, or calculation you want.",
        };
      }

      // ====================================================
      // UNKNOWN ROUTE
      // ====================================================

      else {
        throw new Error(
          `Unsupported query route: ${String(
            plan.route ||
              "unknown"
          )}`
        );
      }

      // ====================================================
      // STEP 6 — RESULT VALIDATOR
      // ====================================================

      const resultValidation =
        validateResult({
          plan,
          result,
        });

      if (
        !resultValidation.valid
      ) {
        console.error(
          "Chatbot result validation failed:",
          {
            code:
              resultValidation.code,

            message:
              resultValidation.message,

            details:
              resultValidation.details,

            plan,
            result,
          }
        );

        throw new Error(
          resultValidation.message
        );
      }

      result =
        resultValidation.result;

      // ====================================================
      // CONVERSATIONAL ANALYTICS ORDINAL SELECTION
      // ====================================================
      //
      // Example:
      //   "What is the second highest?"
      //
      // The calculation engine ranks enough rows/groups to reach the
      // requested position. Keep only that verified ranked item before
      // saving conversation state and before generating prose.
      //
      if (
        Number.isInteger(
          plan?.analyticalRankIndex
        ) &&
        plan.analyticalRankIndex >=
          0 &&
        Array.isArray(
          result?.results
        )
      ) {
        const selectedRankedResult =
          result.results[
            plan.analyticalRankIndex
          ];

        if (
          selectedRankedResult
        ) {
          result = {
            ...result,

            results: [
              selectedRankedResult,
            ],

            count:
              1,

            rankPosition:
              plan.analyticalRankIndex +
              1,
          };

          /**
           * IMPORTANT:
           *
           * At this point result.results intentionally contains only the
           * requested ordinal item. A general LLM response rewriter can
           * misread that single-item array as "only one result exists"
           * and incorrectly say the second/third result is unavailable.
           *
           * Build the ordinal wording deterministically from the verified
           * result instead.
           */
          const ordinalAnswer =
            buildOrdinalAnalyticalAnswer({
              result,
              plan,
            });

          if (
            ordinalAnswer
          ) {
            result.answer =
              ordinalAnswer;
          }
        } else {
          result = {
            success: false,
            source:
              "conversation-analytics",
            operation:
              "clarify",
            answer:
              `There are not enough ranked results to return position ${
                plan.analyticalRankIndex +
                1
              }.`,
          };
        }
      }

      // ====================================================
      // SAVE VERIFIED CONVERSATION STATE
      // ====================================================
      //
      // IMPORTANT:
      //
      // Save BEFORE natural-response rewriting.
      //
      // This ensures Step 10 stores and compares the
      // verified JavaScript result instead of Groq prose.
      //

      if (
        result &&
        plan.route !==
          "clarify"
      ) {
        updateConversation(
          sessionId,
          {
            question:
              cleanQuestion,

            plan,

            result,
          }
        );
      }

      // ====================================================
      // STEP 7 — NATURAL RESPONSE GENERATOR
      // ====================================================

      if (
        result &&
        result.success !==
          false &&
        plan.route !==
          "clarify"
      ) {
        const isOrdinalAnalyticalResult =
          Number.isInteger(
            plan?.analyticalRankIndex
          ) &&
          plan.analyticalRankIndex >=
            0 &&
          Number.isInteger(
            result?.rankPosition
          );

        /**
         * Generic verified-list formatter.
         *
         * calculationEngine can legitimately return:
         *   results: ["Risk A", "Risk B", ...]
         *
         * Some prose formatters expect object rows and can turn these
         * into blank numbered items. When the verified result is a list
         * of primitive values, format it deterministically here.
         */
        const isPrimitiveListResult =
          String(
            plan?.operation ||
            result?.operation ||
            ""
          )
            .trim()
            .toLowerCase() ===
            "list" &&
          Array.isArray(
            result?.results
          ) &&
          result.results.length > 0 &&
          result.results.every(
            (item) =>
              item === null ||
              item === undefined ||
              typeof item !==
                "object"
          );

        const primitiveListAnswer =
          isPrimitiveListResult
            ? result.results
                .filter(
                  (item) =>
                    item !== null &&
                    item !==
                      undefined &&
                    String(
                      item
                    ).trim() !==
                      ""
                )
                .map(
                  (item, index) =>
                    `${index + 1}. ${String(
                      item
                    ).trim()}`
                )
                .join(
                  "\n"
                )
            : null;

        const naturalAnswer =
          isOrdinalAnalyticalResult &&
          result?.answer
            ? result.answer
            : (
                primitiveListAnswer ||
                await generateNaturalResponse({
                  question:
                    cleanQuestion,

                  plan,

                  result,
                })
              );

        return {
          ...result,

          /**
           * Only presentation is changed.
           *
           * Numeric and structured result properties
           * remain untouched.
           */
          answer:
            naturalAnswer,

          responseStyle:
            "natural",

          /**
           * TEMPORARY DEBUG OUTPUT
           *
           * Remove these after the multi-entity issue is fixed.
           */
          debugPlan:
            plan,

          debugEntityChanges:
            entityResolution.changes || [],
        };
      }

      return {
        ...result,

        /**
         * TEMPORARY DEBUG OUTPUT
         *
         * Remove these after the multi-entity issue is fixed.
         */
        debugPlan:
          plan,

        debugEntityChanges:
          entityResolution.changes || [],
      };
    };





  // ========================================================
  // DETERMINISTIC LINKED MULTI-FIELD LOOKUP
  // ========================================================
  //
  // Example structure:
  //
  //   "What are the <A> in <scope> and give me <B>"
  //
  // This is handled as ONE lookup so the scope/filter from the
  // first clause remains attached to every requested output.
  //
  const linkedMultiFieldPlan =
    buildLinkedMultiFieldPlan({
      datasets,
      schema,
      question:
        cleanQuestion,
    });

  if (
    linkedMultiFieldPlan
  ) {
    const linkedResult =
      await executeResolvedPlan(
        linkedMultiFieldPlan
      );

    /**
     * Preserve the calculation engine's row-aware rendering so
     * all requested output fields remain attached to each row.
     */
    const linkedAnswer =
      linkedResult?.answer;

    updateConversation(
      sessionId,
      {
        question:
          cleanQuestion,
        plan:
          linkedMultiFieldPlan,
        result:
          linkedResult,
      }
    );

    return {
      ...linkedResult,

      answer:
        formatUserFacingAnswer(
          linkedAnswer ||
          linkedResult?.answer
        ),

      responseStyle:
        "natural",

      debugPlan:
        linkedMultiFieldPlan,

      debugEntityChanges:
        [],

      plannerSource:
        "deterministic-linked-multifield",
    };
  }




  // ========================================================
  // DIRECT FILTERED NUMERIC AGGREGATE — PLANNER INDEPENDENT
  // ========================================================
  //
  // Resolve standalone questions such as:
  //   "what is the total <metric> in <entity>?"
  // before Groq can unnecessarily ask which metric column to use.
  //
  // Numeric aggregate answers remain scalar; they are intentionally NOT
  // rendered using the one-to-many "label — value" formatter.
  //
  const directFilteredAggregatePlan =
    resolveDirectFilteredAggregatePlan({
      question:
        cleanQuestion,

      schema,

      datasets,
    });

  if (
    directFilteredAggregatePlan
  ) {
    if (
      process.env.NODE_ENV !==
        "production"
    ) {
      console.log(
        "Chatbot direct filtered-aggregate plan:",
        JSON.stringify(
          directFilteredAggregatePlan,
          null,
          2
        )
      );
    }

    const directFilteredAggregateResult =
      await executeResolvedPlan(
        directFilteredAggregatePlan
      );

    return {
      ...directFilteredAggregateResult,

      plannerSource:
        "conversation-local",
    };
  }


  // ========================================================
  // DIRECT FILTERED FIELD LOOKUP — PLANNER INDEPENDENT
  // ========================================================
  //
  // Resolve field + value questions from live schema/data BEFORE
  // Groq/local planning. This prevents unnecessary worksheet
  // clarification when the requested field itself identifies the
  // correct worksheet.
  //
  const directFilteredFieldPlan =
    resolveDirectFilteredFieldPlan({
      question:
        cleanQuestion,

      schema,

      datasets,
    });

  if (
    directFilteredFieldPlan
  ) {
    if (
      process.env.NODE_ENV !==
        "production"
    ) {
      console.log(
        "Chatbot direct filtered-field plan:",
        JSON.stringify(
          directFilteredFieldPlan,
          null,
          2
        )
      );
    }

    const directFilteredFieldResult =
      await executeResolvedPlan(
        directFilteredFieldPlan
      );

    return {
      ...directFilteredFieldResult,

      answer:
        directFilteredFieldPlan
          .operation ===
          "list"
          ? buildVerifiedListAnswer({
              result:
                directFilteredFieldResult,

              subjectColumn:
                directFilteredFieldPlan
                  .column,
            })
          : directFilteredFieldResult
              .answer,

      plannerSource:
        "conversation-local",
    };
  }


  // ========================================================
  // SAME QUERY — NEW FILTER VALUE FOLLOW-UP
  // ========================================================
  //
  // Examples:
  //
  //   "How many associations are in Pangasinan?"
  //   "What are those?"
  //   "What about La Union?"
  //
  //   "How many employees are in ORED?"
  //   "Who are they?"
  //   "What about PMED?"
  //
  // Reuse:
  //   - verified dataset
  //   - verified operation
  //   - verified subject/output field
  //
  // Replace only the filter column(s) explicitly identified by the
  // new follow-up question.
  //
  const sameQueryFilterText =
    normalizeFollowUpPhrase(
      cleanQuestion
    );

  /**
   * Before interpreting "what about X?" as a NEW ENTITY/FILTER,
   * check whether X is actually a real schema metric/field.
   *
   * Example structure:
   *   previous: "total <metric A>"
   *   follow-up: "what about <metric B>"
   *
   * If <metric B> is a real field, the analytical follow-up
   * handler later in the pipeline should switch the metric while
   * preserving the previous operation.
   */
  const sameQueryMetricColumn =
    findFollowUpMetricColumn({
      schema,
      question:
        cleanQuestion,
      preferredDataset:
        conversationContext
          ?.lastDataset ||
        null,
    });

  const looksLikeSameQueryNewFilter =
    conversationContext
      .isFollowUp === true &&
    /^(?:what|how)\s+about\b|^and\b|^for\b/.test(
      sameQueryFilterText
    ) &&
    conversationContext
      .lastDataset &&
    !sameQueryMetricColumn;

  if (
    looksLikeSameQueryNewFilter
  ) {
    const previousDataset =
      conversationContext
        .lastDataset;

    const previousRows =
      Array.isArray(
        datasets?.[
          previousDataset
        ]
      )
        ? datasets[
            previousDataset
          ]
        : [];

    if (
      previousRows.length
    ) {
      /**
       * Discover only values explicitly present in the follow-up.
       * inferCoherentFilters is schema/data driven and therefore works
       * for provinces, divisions, municipalities, statuses, categories,
       * phases, etc. without hardcoding their names.
       */
      let newlyMentionedFilters =
        inferCoherentFilters(
          previousRows,
          cleanQuestion
        );

      if (
        !Array.isArray(
          newlyMentionedFilters
        ) ||
        !newlyMentionedFilters.length
      ) {
        /**
         * Same-column continuity first.
         *
         * Use the previous verified scope column(s) as preferred columns.
         * Example:
         *   Municipality = Solsona
         *   "What about San Emilio?"
         * -> fuzzy-match Municipality values first.
         */
        const preferredScopeColumns =
          [
            ...findPreviousScopeFilterColumns({
              context:
                conversationContext,
            }),
          ];

        newlyMentionedFilters =
          inferApproximateFollowUpFilter({
            rows:
              previousRows,

            question:
              cleanQuestion,

            preferredColumns:
              preferredScopeColumns,
          });
      }

      if (
        Array.isArray(
          newlyMentionedFilters
        ) &&
        newlyMentionedFilters.length
      ) {
        const previousPlan =
          conversationContext
            .lastPlan ||
          {};

        const rememberedSubject =
          inferRememberedSubjectColumn({
            schema,

            datasetName:
              previousDataset,

            previousQuestion:
              conversationContext
                .lastSubjectQuestion ||
              conversationContext
                .lastQuestion,

            context:
              conversationContext,
          }) ||
          previousPlan.column ||
          (
            Array.isArray(
              previousPlan
                .selectColumns
            ) &&
            previousPlan
              .selectColumns
              .length === 1
              ? previousPlan
                  .selectColumns[0]
              : null
          ) ||
          null;

        /**
         * Start with the previous verified filters.
         * A newly mentioned value replaces the previous filter on the
         * same column, while unrelated filters are preserved.
         */
        const replacementColumns =
          new Set(
            newlyMentionedFilters
              .map(
                (filter) =>
                  filter?.column
              )
              .filter(Boolean)
          );

        const previousScopeColumns =
          findPreviousScopeFilterColumns({
            context:
              conversationContext,
          });

        const inheritedFilters =
          Array.isArray(
            conversationContext
              .lastFilters
          )
            ? conversationContext
                .lastFilters
                .filter(
                  (filter) =>
                    !replacementColumns.has(
                      filter?.column
                    ) &&
                    !previousScopeColumns.has(
                      filter?.column
                    )
                )
                .map(
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

        const finalFilters = [
          ...inheritedFilters,

          ...newlyMentionedFilters.map(
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
          ),
        ];

        const previousOperation =
          String(
            previousPlan
              .operation ||
            conversationContext
              .lastIntent ||
            ""
          )
            .trim()
            .toLowerCase();

        /**
         * Preserve the last meaningful operation.
         * The immediately previous turn may have been a conversational
         * entity list, so "what about X?" should continue listing the
         * same kind of entity.
         */
        const operation =
          previousOperation ||
          (
            rememberedSubject
              ? "list"
              : "lookup"
          );

        const sameQueryPlan = {
          ...previousPlan,

          route:
            "dataset",

          dataset:
            previousDataset,

          operation,

          filters:
            finalFilters,

          filterGroups:
            [],

          filterGroupLogic:
            null,

          outputRequested:
            true,

          conversationalFilterSwitch:
            true,
        };

        if (
          operation === "list"
        ) {
          if (
            rememberedSubject
          ) {
            sameQueryPlan.column =
              rememberedSubject;

            sameQueryPlan.labelColumn =
              rememberedSubject;

            sameQueryPlan.selectColumns = [
              rememberedSubject,
            ];
          }

          sameQueryPlan.showAll =
            true;

          sameQueryPlan.limit =
            Math.max(
              Number(
                previousPlan.limit
              ) || 10,
              100
            );
        }

        if (
          process.env.NODE_ENV !==
            "production"
        ) {
          console.log(
            "Chatbot same-query filter-switch plan:",
            JSON.stringify(
              sameQueryPlan,
              null,
              2
            )
          );
        }

        const sameQueryResult =
          await executeResolvedPlan(
            sameQueryPlan
          );

        let sameQueryAnswer =
          sameQueryResult
            .answer;

        if (
          operation === "list"
        ) {
          const matchingRows =
            filterRowsBySimpleFilters(
              previousRows,
              finalFilters
            );

          const oneToManyAnswer =
            buildOneToManyListAnswer({
              rows:
                matchingRows,

              subjectColumn:
                rememberedSubject,

              filters:
                finalFilters,
            });

          sameQueryAnswer =
            oneToManyAnswer ||
            buildVerifiedListAnswer({
              result:
                sameQueryResult,

              subjectColumn:
                rememberedSubject,
            });
        }

        return {
          ...sameQueryResult,

          answer:
            sameQueryAnswer,

          oneToManyResolved:
            operation === "list"
              ? true
              : undefined,

          plannerSource:
            "conversation",
        };
      }
    }
  }



  // ========================================================
  // UNRESOLVED ENTITY/FILTER SWITCH GUARD
  // ========================================================
  //
  // If "what about X?" is clearly trying to change a row-level scope
  // but X cannot be matched to live values, do not fall through into a
  // stale analytical context from an older question.
  //
  const unresolvedSwitchTarget =
    extractFollowUpTargetPhrase(
      cleanQuestion
    );

  const unresolvedSwitchLooksAnalytical =
    /\b(?:average|avg|mean|total|sum|highest|lowest|maximum|minimum|top|bottom|difference|ratio|median|range|spread|count|number)\b/.test(
      unresolvedSwitchTarget
    );

  if (
    looksLikeSameQueryNewFilter &&
    unresolvedSwitchTarget &&
    !unresolvedSwitchLooksAnalytical
  ) {
    /**
     * Reaching this point means the same-query handler found no exact
     * or confident approximate live value.
     */
    return {
      success: false,

      source:
        "conversation",

      operation:
        "clarify",

      answer:
        `I couldn't confidently match "${unresolvedSwitchTarget}" to a value in ${conversationContext.lastDataset}. Please check the spelling or be a little more specific.`,

      plannerSource:
        "conversation",
    };
  }


  // ========================================================
  // GENERIC REFERENTIAL LIST FOLLOW-UP
  // ========================================================
  //
  // Resolve these BEFORE Groq/local planning:
  //
  //   "What are those?"
  //   "Which are those?"
  //   "Show them."
  //   "List those."
  //   "Who are those?"
  //
  // The previous verified dataset + filters are reused, while the
  // subject/output column is inferred from verified memory and the
  // live schema.
  //
  const referentialListText =
    normalizeText(
      cleanQuestion
    );

  const isDirectReferentialList =
    conversationContext
      .isFollowUp === true &&
    (
      /\b(?:what|which)\s+(?:are|were)\s+(?:those|these|they|them|the ones)\b/.test(
        referentialListText
      ) ||
      /\b(?:show|list|display|give|name)\s+(?:me\s+)?(?:those|these|them|the ones)\b/.test(
        referentialListText
      ) ||
      /\bwho\s+(?:are|were)\s+(?:those|these|they|them)\b/.test(
        referentialListText
      )
    );

  if (
    isDirectReferentialList &&
    conversationContext
      .lastDataset
  ) {
    const rememberedSubject =
      inferRememberedSubjectColumn({
        schema,

        datasetName:
          conversationContext
            .lastDataset,

        previousQuestion:
          conversationContext
            .lastSubjectQuestion ||
          conversationContext
            .lastQuestion,

        context:
          conversationContext,
      });

    if (rememberedSubject) {
      const referentialListPlan = {
        route:
          "dataset",

        dataset:
          conversationContext
            .lastDataset,

        operation:
          "list",

        column:
          rememberedSubject,

        labelColumn:
          rememberedSubject,

        groupBy:
          null,

        aggregation:
          null,

        direction:
          null,

        filters:
          Array.isArray(
            conversationContext
              .lastFilters
          )
            ? conversationContext
                .lastFilters
                .map(
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

        selectColumns: [
          rememberedSubject,
        ],

        outputRequested:
          true,

        transform:
          null,

        showAll:
          true,

        limit:
          100,

        conversationalEntityList:
          true,
      };

      if (
        process.env.NODE_ENV !==
          "production"
      ) {
        console.log(
          "Chatbot referential list plan:",
          JSON.stringify(
            referentialListPlan,
            null,
            2
          )
        );
      }

      const referentialListResult =
        await executeResolvedPlan(
          referentialListPlan
        );

      /**
       * calculationEngine may return a list as primitive strings:
       *
       *   results: [
       *     "Association A",
       *     "Association B"
       *   ]
       *
       * Some natural-response formatters expect object-shaped rows and
       * therefore produce:
       *
       *   "1. "
       *   "2. "
       *
       * Build the conversational list answer directly from the VERIFIED
       * execution result so primitive-string lists and object lists both
       * render correctly.
       */
      return {
        ...referentialListResult,

        answer:
          buildVerifiedListAnswer({
            result:
              referentialListResult,

            subjectColumn:
              rememberedSubject,
          }),

        plannerSource:
          "conversation",
      };
    }
  }



  // ========================================================
  // GENERIC MULTI-RESULT CONVERSATIONAL ANALYSIS
  // ========================================================
  //
  // Handles analytical follow-ups over 3+ verified values without
  // forcing the user to choose exactly two results.
  //
  const multiResultRecentResults =
    getRecentResults(
      sessionId
    );

  const latestMultiResultEntry =
    multiResultRecentResults.length
      ? multiResultRecentResults[
          multiResultRecentResults.length -
            1
        ]
      : null;

  const multiResultContext = {
    ...conversationContext,

    lastPlan:
      conversationContext
        ?.lastPlan ||
      latestMultiResultEntry
        ?.plan ||
      null,

    lastResult:
      conversationContext
        ?.lastResult ||
      latestMultiResultEntry
        ?.result ||
      null,
  };

  const verifiedMultiResultSet =
    getVerifiedAnalyticalSet(
      multiResultContext
    );

  const looksLikeMultiResultAnalysis =
    verifiedMultiResultSet
      ?.count >= 3 &&
    (
      /\b(?:explain|summarize|summary|interpret|describe|difference|range|spread|gap|closest|average|mean|median|highest|lowest|above average|below average|outlier|outliers|stand out|trend|pattern|distribution|compare|ratio|percent|percentage|top\s+\d+|bottom\s+\d+)\b/i.test(
        cleanQuestion
      )
    );

  if (
    looksLikeMultiResultAnalysis
  ) {
    const multiResultAnalysis =
      analyzeVerifiedAnalyticalSet({
        context:
          multiResultContext,

        question:
          cleanQuestion,

        mode:
          detectComparisonRequest(
            cleanQuestion
          ),
      });

    if (
      multiResultAnalysis
    ) {
      return {
        ...multiResultAnalysis,

        plannerSource:
          "conversation-analytics",
      };
    }
  }


  // ========================================================
  // MULTI-STEP ANALYTICS — COMPARE CURRENT RESULT WITH
  // THE OPPOSITE EXTREME
  // ========================================================
  //
  // Example:
  //   "Which group has the highest average X?"
  //   "Compare it with the lowest."
  //
  const extremeComparisonDirection =
    detectAnalyticalExtremeComparison(
      cleanQuestion
    );

  /**
   * "Compare it with the lowest/highest" may be detected here even when
   * conversationManager does not classify the wording as a normal
   * follow-up. In that case getRelevantContext() can intentionally hide
   * analyticalContext.
   *
   * Recover the latest VERIFIED analytical plan from recentResults so
   * the request never falls through to Groq/local planning just because
   * the follow-up wording was short.
   */
  const multiStepRecentResults =
    extremeComparisonDirection
      ? getRecentResults(
          sessionId
        )
      : [];

  const latestVerifiedAnalyticalEntry =
    multiStepRecentResults.length
      ? multiStepRecentResults[
          multiStepRecentResults.length -
            1
        ]
      : null;

  const latestVerifiedAnalyticalPlan =
    latestVerifiedAnalyticalEntry
      ?.plan ||
    null;

  const latestVerifiedAnalyticalResult =
    latestVerifiedAnalyticalEntry
      ?.result ||
    null;

  const recoveredAnalyticalContext =
    (
      latestVerifiedAnalyticalPlan &&
      [
        "rank_groups",
        "rank_rows",
        "group_sum",
        "group_average",
        "group_minimum",
        "group_maximum",
        "group_count",
      ].includes(
        String(
          latestVerifiedAnalyticalPlan
            ?.operation ||
          latestVerifiedAnalyticalResult
            ?.operation ||
          ""
        )
          .trim()
          .toLowerCase()
      )
    )
      ? {
          dataset:
            latestVerifiedAnalyticalPlan
              ?.dataset ||
            latestVerifiedAnalyticalResult
              ?.dataset ||
            null,

          operation:
            latestVerifiedAnalyticalPlan
              ?.operation ||
            latestVerifiedAnalyticalResult
              ?.operation ||
            null,

          column:
            latestVerifiedAnalyticalPlan
              ?.column ||
            latestVerifiedAnalyticalResult
              ?.column ||
            null,

          labelColumn:
            latestVerifiedAnalyticalPlan
              ?.labelColumn ||
            latestVerifiedAnalyticalResult
              ?.labelColumn ||
            null,

          groupBy:
            latestVerifiedAnalyticalPlan
              ?.groupBy ||
            latestVerifiedAnalyticalResult
              ?.groupBy ||
            null,

          aggregation:
            latestVerifiedAnalyticalPlan
              ?.aggregation ||
            latestVerifiedAnalyticalResult
              ?.aggregation ||
            null,

          direction:
            latestVerifiedAnalyticalPlan
              ?.direction ||
            latestVerifiedAnalyticalResult
              ?.direction ||
            null,

          filters:
            Array.isArray(
              latestVerifiedAnalyticalPlan
                ?.filters
            )
              ? latestVerifiedAnalyticalPlan
                  .filters
              : [],

          filterGroups:
            Array.isArray(
              latestVerifiedAnalyticalPlan
                ?.filterGroups
            )
              ? latestVerifiedAnalyticalPlan
                  .filterGroups
              : [],

          filterGroupLogic:
            latestVerifiedAnalyticalPlan
              ?.filterGroupLogic ||
            null,
        }
      : null;

  const multiStepAnalyticalContext =
    conversationContext
      .analyticalContext ||
    recoveredAnalyticalContext;

  if (
    extremeComparisonDirection &&
    multiStepAnalyticalContext
  ) {
    const base =
      multiStepAnalyticalContext;

    const groupBy =
      base.groupBy ||
      base.labelColumn ||
      null;

    const extremePlan = {
      route:
        "dataset",

      dataset:
        base.dataset,

      operation:
        groupBy
          ? "rank_groups"
          : "rank_rows",

      column:
        base.column,

      labelColumn:
        base.labelColumn ||
        groupBy ||
        null,

      groupBy,

      aggregation:
        base.aggregation ||
        null,

      direction:
        extremeComparisonDirection,

      filters:
        Array.isArray(
          base.filters
        )
          ? base.filters.map(
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

      filterGroups:
        Array.isArray(
          base.filterGroups
        )
          ? base.filterGroups.map(
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
        base.filterGroupLogic ||
        null,

      selectColumns: [
        ...new Set(
          [
            groupBy,
            base.column,
          ].filter(Boolean)
        ),
      ],

      outputRequested:
        true,

      transform:
        null,

      limit:
        1,

      showAll:
        false,

      conversationalAnalytics:
        true,
    };

    await executeResolvedPlan(
      extremePlan
    );

    const latestComparisonResults =
      getRecentResults(
        sessionId
      );

    if (
      latestComparisonResults.length >=
        2
    ) {
      const comparisonResult =
        compareVerifiedResults({
          left:
            latestComparisonResults[
              latestComparisonResults.length -
                2
            ],

          right:
            latestComparisonResults[
              latestComparisonResults.length -
                1
            ],

          mode:
            "higher",
        });

      if (comparisonResult) {
        return {
          ...comparisonResult,

          plannerSource:
            "conversation-analytics",
        };
      }
    }

    /**
     * The opposite extreme was successfully calculated, but if the
     * generic two-result comparison helper cannot represent the pair,
     * return the verified extreme result instead of falling through to
     * Groq/local planning and asking an unrelated clarification.
     */
    const latestAfterExtreme =
      getRecentResults(
        sessionId
      );

    const extremeEntry =
      latestAfterExtreme.length
        ? latestAfterExtreme[
            latestAfterExtreme.length -
              1
          ]
        : null;

    if (
      extremeEntry?.result
    ) {
      return {
        ...extremeEntry.result,

        plannerSource:
          "conversation-analytics",
      };
    }
  }


  // ========================================================
  // CONVERSATIONAL ANALYTICS FOLLOW-UP
  // ========================================================
  //
  // Uses the previous VERIFIED analytical plan/result as the base.
  // This runs before Groq planning so simple analytical follow-ups
  // do not spend model tokens and do not lose context.
  //
  if (
    conversationContext
      .isFollowUp === true &&
    conversationContext
      .analyticalContext
  ) {
    const analyticalFollowUpPlan =
      buildAnalyticalFollowUpPlan({
        schema,

        datasets,

        context:
          conversationContext,

        question:
          cleanQuestion,

        schema,
      });

    if (analyticalFollowUpPlan) {
      if (
        process.env.NODE_ENV !==
          "production"
      ) {
        console.log(
          "Chatbot conversational analytics plan:",
          JSON.stringify(
            analyticalFollowUpPlan,
            null,
            2
          )
        );
      }

      const analyticalFollowUpResult =
        await executeResolvedPlan(
          analyticalFollowUpPlan
        );

      return {
        ...analyticalFollowUpResult,

        plannerSource:
          "conversation-analytics",
      };
    }
  }

  // ========================================================
  // CHAINED MULTI-ROW FIELD FOLLOW-UP
  // ========================================================
  //
  // Example:
  // "Who are those persons?"
  // "What are their position titles?"
  // "What are their stations?"
  //
  // Reuse the exact same verified row-selection filter groups.
  //
  if (
    conversationContext
      .isFollowUp === true
  ) {
    const multiRowFollowUpPlan =
      buildMultiRowFieldFollowUpPlan({
        schema,

        context:
          conversationContext,

        question:
          cleanQuestion,
      });

    if (multiRowFollowUpPlan) {
      if (
        process.env.NODE_ENV !==
        "production"
      ) {
        console.log(
          "Chatbot chained multi-row follow-up plan:",
          JSON.stringify(
            multiRowFollowUpPlan,
            null,
            2
          )
        );
      }

      const multiRowFollowUpResult =
        await executeResolvedPlan(
          multiRowFollowUpPlan
        );

      return {
        ...multiRowFollowUpResult,

        plannerSource:
          "conversation",
      };
    }
  }

  // ========================================================
  // PREVIOUS VERIFIED GROUP-RESULT FOLLOW-UP
  // ========================================================
  //
  // Example:
  // "Compare the highest actual salary of A and B"
  // "Who are those persons?"
  //
  // This is resolved from the previous VERIFIED JavaScript result
  // before Groq planning.
  //
  if (
    conversationContext
      .isFollowUp === true &&
    detectPreviousResultIdentityRequest(
      cleanQuestion
    )
  ) {
    const previousIdentityPlan =
      buildPreviousResultIdentityPlan({
        datasets,
        schema,
        context:
          conversationContext,
        question:
          cleanQuestion,
      });

    if (previousIdentityPlan) {
      if (
        process.env.NODE_ENV !==
        "production"
      ) {
        console.log(
          "Chatbot previous-result identity plan:",
          JSON.stringify(
            previousIdentityPlan,
            null,
            2
          )
        );
      }

      const previousIdentityResult =
        await executeResolvedPlan(
          previousIdentityPlan
        );

      return {
        ...previousIdentityResult,
        plannerSource:
          "conversation",
      };
    }
  }


  /**
   * ========================================================
   * GENERIC REFERENTIAL SCOPE CONTINUITY
   * ========================================================
   *
   * A follow-up can request a NEW output field while referring back to
   * the previously verified row scope:
   *
   *   "What are the <new field> there?"
   *   "What is the <new field> in the same place?"
   *   "How about the <new field> for the same one?"
   *
   * The planner is allowed to resolve the new output field, but it must
   * not silently discard the previous verified filters merely because
   * the user used a referential phrase instead of repeating the entity.
   *
   * This is schema/data agnostic: it copies whatever verified filters
   * conversationContext already contains. No worksheet, field name,
   * municipality, barangay, commodity, person, office, etc. is named.
   */
  const repairReferentialScopePlan =
    (candidatePlan) => {
      if (!candidatePlan) {
        return candidatePlan;
      }

      const referentialText =
        normalizeFollowUpPhrase(
          cleanQuestion
        );

      /**
       * Generic conversational references only.
       * No dataset field/value is named here.
       */
      const refersToPreviousScope =
        /\b(?:there|therein|same\s+(?:place|location|area|one|ones|entity|entities|group|scope)|that\s+(?:place|location|area|one|group)|those\s+(?:places|locations|areas|ones|groups))\b/i.test(
          referentialText
        );

      if (!refersToPreviousScope) {
        return candidatePlan;
      }

      /**
       * A planner may return "clarify" simply because the user did not
       * repeat a location/entity in a chained follow-up:
       *
       *   "... there?"
       *
       * Before accepting that clarification, check whether:
       *   1. a verified previous scope exists, and
       *   2. the current question explicitly names a real schema column.
       *
       * If both are true, the clarification is unnecessary. Rebuild a
       * normal dataset/list plan around the explicit requested column and
       * the verified previous scope.
       *
       * This is generic: no schema field, location type, worksheet, or
       * value is hardcoded.
       */
      const originalRoute =
        String(
          candidatePlan.route ||
          ""
        )
          .trim()
          .toLowerCase();

      /**
       * First use the normal conversation context.
       *
       * Some short referential questions such as "... there?" are not
       * always classified as isFollowUp by conversationManager, which can
       * cause lastFilters to be hidden. Recover the latest VERIFIED plan
       * from recent results as a fallback.
       */
      const recentEntries =
        getRecentResults(
          sessionId
        );

      const latestEntry =
        Array.isArray(
          recentEntries
        ) &&
        recentEntries.length
          ? recentEntries[
              recentEntries.length - 1
            ]
          : null;

      const latestPlan =
        latestEntry?.plan ||
        latestEntry?.result
          ?.debugPlan ||
        null;

      const rememberedFilters =
        (
          Array.isArray(
            conversationContext
              .lastFilters
          ) &&
          conversationContext
            .lastFilters.length
        )
          ? conversationContext
              .lastFilters
          : (
              Array.isArray(
                latestPlan?.filters
              )
                ? latestPlan.filters
                : []
            );

      if (!rememberedFilters.length) {
        return candidatePlan;
      }

      const rememberedDataset =
        conversationContext
          .lastDataset ||
        latestPlan?.dataset ||
        candidatePlan.dataset;

      /**
       * Recover an unnecessary clarification into a dataset lookup when
       * the requested output column is explicitly present in the schema.
       */
      if (
        originalRoute === "clarify"
      ) {
        const explicitMatch =
          findExplicitSchemaColumn({
            schema,
            question:
              cleanQuestion,
            preferredDataset:
              rememberedDataset ||
              null,
          });

        if (!explicitMatch) {
          return candidatePlan;
        }

        candidatePlan = {
          route:
            "dataset",

          dataset:
            explicitMatch.dataset ||
            rememberedDataset,

          operation:
            "list",

          column:
            explicitMatch.column,

          labelColumn:
            null,

          groupBy:
            null,

          aggregation:
            null,

          direction:
            null,

          filters:
            [],

          selectColumns: [
            explicitMatch.column,
          ],

          outputRequested:
            true,

          transform:
            null,

          limit:
            10,

          showAll:
            true,

          referentialClarifyRecovered:
            true,
        };
      } else if (
        originalRoute !== "dataset"
      ) {
        return candidatePlan;
      }

      const currentFilters =
        Array.isArray(
          candidatePlan.filters
        )
          ? candidatePlan.filters
          : [];

      /**
       * Never overwrite a dataset plan that already contains explicit
       * filters. A newly stated scope remains authoritative.
       */
      if (currentFilters.length) {
        return candidatePlan;
      }

      /**
       * Avoid importing a verified filter from a different worksheet when
       * the new planner explicitly chose another dataset.
       */
      if (
        candidatePlan.dataset &&
        rememberedDataset &&
        String(
          candidatePlan.dataset
        ) !==
          String(
            rememberedDataset
          )
      ) {
        return candidatePlan;
      }

      return {
        ...candidatePlan,

        dataset:
          rememberedDataset,

        filters:
          rememberedFilters.map(
            (filter) => ({
              ...filter,

              value:
                Array.isArray(
                  filter?.value
                )
                  ? [...filter.value]
                  : filter?.value,
            })
          ),

        referentialScopeInherited:
          true,
      };
    };



  // ========================================================
  // DETERMINISTIC MULTI-CATEGORY COUNT
  // ========================================================
  //
  // Keep working single-category row_count behavior untouched.
  // Intervene only when TWO OR MORE real category values are
  // explicitly mentioned in the same count question.
  //
  const multiCategoryCount =
    buildMultiCategoryCountResolution({
      datasets,
      question:
        cleanQuestion,
      preferredDataset:
        conversationContext
          ?.lastDataset ||
        null,
    });

  if (
    multiCategoryCount
  ) {
    updateConversation(
      sessionId,
      {
        question:
          cleanQuestion,
        plan:
          multiCategoryCount
            .plan,
        result:
          multiCategoryCount
            .result,
      }
    );

    return {
      ...multiCategoryCount
        .result,

      answer:
        formatUserFacingAnswer(
          multiCategoryCount
            .result
            ?.answer
        ),

      plannerSource:
        "deterministic-multi-category",
    };
  }



  // ========================================================
  // 1. GROQ FIRST
  // ========================================================

  let groqPlan = null;
  let groqPlanningError = null;

  /**
   * IMPORTANT:
   * Only GROQ PLANNING is inside this try/catch.
   *
   * If Groq successfully returns a plan, execution errors must
   * not silently cause a second planner to choose another field.
   */
  try {
    groqPlan =
      await createSchemaAwarePlan({
        question:
          cleanQuestion,

        schema,

        context:
          conversationContext,

        retrievalContext,
      });
  } catch (error) {
    groqPlanningError =
      error;

    console.error(
      "Groq planning failed; local fallback will be used:",
      error
    );
  }

  if (groqPlan) {
    groqPlan =
      applyConversationContext(
        groqPlan,
        conversationContext,
        {
          schema,

          question:
            cleanQuestion,
        }
      );

    groqPlan =
      repairConversationalListPlan({
        plan:
          groqPlan,

        context:
          conversationContext,

        question:
          cleanQuestion,

        schema,
      });

    groqPlan =
      normalizePlannerPlan({
        datasets,
        schema,

        plan:
          groqPlan,

        question:
          cleanQuestion,
      });

    groqPlan =
      repairMultiEntityFilters({
        datasets,

        plan:
          groqPlan,

        question:
          cleanQuestion,
      });

    /**
     * Planner-independent exact-column safeguard.
     */
    groqPlan =
      enforceExplicitQuestionColumn({
        plan:
          groqPlan,

        schema,

        question:
          cleanQuestion,
      });

    groqPlan =
      repairReferentialScopePlan(
        groqPlan
      );

    if (
      process.env.NODE_ENV !==
        "production"
    ) {
      console.log(
        "Chatbot Groq plan:",
        JSON.stringify(
          groqPlan,
          null,
          2
        )
      );
    }

    try {
      const result =
        await executeResolvedPlan(
          groqPlan
        );

      let finalAnswer =
        result.answer;

      let oneToManyResolved =
        undefined;

      /**
       * ======================================================
       * GENERIC ONE-TO-MANY LIST RENDERING FOR GROQ PLANS
       * ======================================================
       *
       * calculationEngine may correctly deduplicate a list result:
       *
       *   results: ["shared value"]
       *
       * even though the verified filters matched several source rows.
       *
       * For conversational field lookups, preserve those row identities
       * in the final answer by formatting the FILTERED SOURCE ROWS rather
       * than only the deduplicated result array.
       *
       * No worksheet, field name, filter column, or data value is
       * hardcoded here.
       */
      if (
        String(
          groqPlan.operation ||
          ""
        )
          .trim()
          .toLowerCase() ===
          "list" &&
        groqPlan.column &&
        Array.isArray(
          groqPlan.filters
        ) &&
        groqPlan.filters.length
      ) {
        const sourceRows =
          Array.isArray(
            datasets?.[
              groqPlan.dataset
            ]
          )
            ? datasets[
                groqPlan.dataset
              ]
            : [];

        const matchingRows =
          filterRowsBySimpleFilters(
            sourceRows,
            groqPlan.filters
          );

        if (matchingRows.length) {
          const rowAwareAnswer =
            buildOneToManyListAnswer({
              rows:
                matchingRows,

              subjectColumn:
                groqPlan.column,

              filters:
                groqPlan.filters,
            });

          if (rowAwareAnswer) {
            finalAnswer =
              rowAwareAnswer;

            oneToManyResolved =
              matchingRows.length > 1;
          }
        }
      }

      return {
        ...result,

        answer:
          formatUserFacingAnswer(
            finalAnswer
          ),

        oneToManyResolved,

        plannerSource:
          "groq",
      };
    } catch (groqExecutionError) {
      console.error(
        "Groq plan was created successfully, but execution failed. Local parser was NOT used:",
        groqExecutionError
      );

      return {
        success: false,

        source:
          "system",

        operation:
          "error",

        plannerSource:
          "groq",

        answer:
          groqExecutionError.message ||
          "The Groq plan could not be executed.",

        debugPlan:
          groqPlan,
      };
    }
  }

  // ========================================================
  // 2. LOCAL PARSER FALLBACK
  // ========================================================
  //
  // Used ONLY when Groq could not create a plan.
  //

  try {
    let localPlan =
      await createPlan({
        question:
          cleanQuestion,

        schema,

        datasets,

        context:
          conversationContext,
      });

    localPlan =
      applyConversationContext(
        localPlan,
        conversationContext,
        {
          schema,

          question:
            cleanQuestion,
        }
      );

    localPlan =
      repairConversationalListPlan({
        plan:
          localPlan,

        context:
          conversationContext,

        question:
          cleanQuestion,

        schema,
      });

    localPlan =
      normalizePlannerPlan({
        datasets,
        schema,

        plan:
          localPlan,

        question:
          cleanQuestion,
      });

    localPlan =
      repairMultiEntityFilters({
        datasets,

        plan:
          localPlan,

        question:
          cleanQuestion,
      });

    /**
     * Critical fallback safeguard:
     * even if the local parser chooses a similar field, an
     * explicitly named REAL schema column wins.
     */
    localPlan =
      enforceExplicitQuestionColumn({
        plan:
          localPlan,

        schema,

        question:
          cleanQuestion,
      });

    localPlan =
      repairReferentialScopePlan(
        localPlan
      );

    if (
      process.env.NODE_ENV !==
        "production"
    ) {
      console.log(
        "Chatbot local fallback plan:",
        JSON.stringify(
          localPlan,
          null,
          2
        )
      );
    }

    const result =
      await executeResolvedPlan(
        localPlan
      );

    let finalAnswer =
      result.answer;

    let oneToManyResolved =
      undefined;

    /**
     * Apply the same row-aware list rendering to local-fallback plans so
     * Groq availability does not change conversational output semantics.
     */
    if (
      String(
        localPlan.operation ||
        ""
      )
        .trim()
        .toLowerCase() ===
        "list" &&
      localPlan.column &&
      Array.isArray(
        localPlan.filters
      ) &&
      localPlan.filters.length
    ) {
      const sourceRows =
        Array.isArray(
          datasets?.[
            localPlan.dataset
          ]
        )
          ? datasets[
              localPlan.dataset
            ]
          : [];

      const matchingRows =
        filterRowsBySimpleFilters(
          sourceRows,
          localPlan.filters
        );

      if (matchingRows.length) {
        const rowAwareAnswer =
          buildOneToManyListAnswer({
            rows:
              matchingRows,

            subjectColumn:
              localPlan.column,

            filters:
              localPlan.filters,
          });

        if (rowAwareAnswer) {
          finalAnswer =
            rowAwareAnswer;

          oneToManyResolved =
            matchingRows.length > 1;
        }
      }
    }

    return {
      ...result,

      answer:
        formatUserFacingAnswer(
          finalAnswer
        ),

      oneToManyResolved,

      plannerSource:
        "local-fallback",

      /**
       * Temporary debugging only.
       * This tells us WHY Groq was unavailable without changing
       * the dataset answer.
       */
      groqPlanningError:
        groqPlanningError?.message ||
        null,
    };
  } catch (localError) {
    console.error(
      "Local chatbot fallback failed:",
      localError
    );

    return {
      success: false,

      source:
        "system",

      operation:
        "error",

      plannerSource:
        "local-fallback",

      groqPlanningError:
        groqPlanningError?.message ||
        null,

      answer:
        localError.message ||
        "The chatbot could not process the question.",
    };
  }

}

module.exports = {
  answerQuestion,
};
