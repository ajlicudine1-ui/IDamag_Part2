const {
  normalizeText,
  similarity,
} = require("./utils");

const {
  inferValueFilters,
  inferCoherentFilters,
} = require("./filterEngine");

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


/**
 * Resolve explicit ranking fields from the CURRENT question.
 *
 * Priority rule:
 *   current-question schema fields > current-question inference > memory.
 *
 * No field names are hardcoded. Numeric/text roles come from the live
 * schema and live rows.
 */
function resolveExplicitRankingColumns({
  datasets,
  schema,
  question,
  preferredDataset = null,
}) {
  const explicit =
    findExplicitSchemaColumns({
      schema,
      question,
      preferredDataset,
    });

  if (!explicit.length) {
    return null;
  }

  const byDataset = new Map();

  for (const item of explicit) {
    if (!byDataset.has(item.dataset)) {
      byDataset.set(item.dataset, []);
    }
    byDataset.get(item.dataset).push(item);
  }

  const candidates = [];

  for (const [datasetName, items] of byDataset) {
    const datasetSchema =
      (schema || []).find(
        (entry) =>
          String(entry?.name || "") ===
          String(datasetName || "")
      );

    const rows = datasets?.[datasetName];

    if (!datasetSchema || !Array.isArray(rows)) {
      continue;
    }

    const numeric = [];
    const labels = [];

    for (const item of items) {
      const columnSchema =
        (datasetSchema.columns || []).find(
          (column) =>
            String(column?.name || "") ===
            String(item.column || "")
        );

      if (!columnSchema) continue;

      if (
        isNumericLikeColumn({
          column: columnSchema,
          rows,
        })
      ) {
        numeric.push(item.column);
      } else {
        labels.push(item.column);
      }
    }

    if (numeric.length || labels.length) {
      candidates.push({
        dataset: datasetName,
        numeric,
        labels,
        score:
          numeric.length * 3 +
          labels.length * 2 +
          (datasetName === preferredDataset ? 0.25 : 0),
      });
    }
  }

  candidates.sort(
    (a, b) => b.score - a.score
  );

  const best = candidates[0] || null;

  if (!best) {
    return null;
  }

  return {
    dataset: best.dataset,
    metricColumn:
      best.numeric[0] || null,
    groupColumn:
      best.labels[0] || null,
    explicitColumns: explicit,
  };
}

/**
 * True when the current wording explicitly names a grouping field that
 * differs from the grouping represented by a previous analytical set.
 */
function currentQuestionOverridesAnalyticalGroup({
  datasets,
  schema,
  question,
  previousGroupBy,
  preferredDataset = null,
}) {
  const resolved =
    resolveExplicitRankingColumns({
      datasets,
      schema,
      question,
      preferredDataset,
    });

  if (!resolved?.groupColumn) {
    return false;
  }

  return (
    normalizeText(resolved.groupColumn) !==
    normalizeText(previousGroupBy || "")
  );
}

/**
 * Semantic filter guard.
 *
 * Protects aggregate/ranking plans from weak substring filters created
 * from descriptive/report-context wording. Exact values and explicitly
 * narrowed filters remain intact.
 */
function sanitizeSemanticPlanFilters({
  datasets,
  plan,
  question,
  reportContext = null,
}) {
  if (
    !plan ||
    plan.route !== "dataset" ||
    !Array.isArray(plan.filters) ||
    !plan.filters.length ||
    !plan.dataset
  ) {
    return plan;
  }

  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) {
    return plan;
  }

  const questionText = normalizeText(question);
  const reportText = normalizeText(
    typeof reportContext === "string"
      ? reportContext
      : reportContext?.title ||
        reportContext?.name ||
        ""
  );

  const analyticalOperation =
    new Set([
      "sum",
      "average",
      "median",
      "minimum",
      "maximum",
      "count",
      "non_empty_count",
      "distinct_count",
      "rank_rows",
      "rank_groups",
      "group_sum",
      "group_average",
      "group_minimum",
      "group_maximum",
      "group_count",
    ]).has(
      String(plan.operation || "")
        .trim()
        .toLowerCase()
    );

  if (!analyticalOperation) {
    return plan;
  }

  const hasExplicitNarrowingCue = (valueText) => {
    if (!valueText) return false;

    const escaped = valueText.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    return new RegExp(
      `\\b(?:in|from|at|within|where|with|only|named|called|equals?|equal\\s+to|filter(?:ed)?(?:\\s+by)?|containing|contains)\\b[^.?!]{0,80}\\b${escaped}\\b|\\b${escaped}\\b[^.?!]{0,40}\\b(?:only|specifically)\\b`,
      "u"
    ).test(questionText);
  };

  const cleaned = [];
  const removed = [];

  for (const filter of plan.filters) {
    const operator =
      String(filter?.operator || "equals")
        .trim()
        .toLowerCase();

    const values =
      Array.isArray(filter?.value)
        ? filter.value
        : [filter?.value];

    // Multi-value/in/equality filters are strong enough to preserve here.
    if (operator !== "contains" || values.length !== 1) {
      cleaned.push(filter);
      continue;
    }

    const rawValue = values[0];
    const valueText = normalizeText(rawValue);
    const columnName = filter?.column;

    if (!valueText || !columnName) {
      cleaned.push(filter);
      continue;
    }

    const distinctValues = [
      ...new Set(
        rows
          .map((row) => row?.[columnName])
          .filter(
            (value) =>
              value !== null &&
              value !== undefined &&
              String(value).trim() !== ""
          )
          .map((value) => String(value).trim())
      ),
    ];

    const exactExists = distinctValues.some(
      (value) => normalizeText(value) === valueText
    );

    const partialMatches = distinctValues.filter(
      (value) =>
        normalizeText(value).includes(valueText)
    );

    const explicitNarrowing =
      hasExplicitNarrowingCue(valueText);

    const valueTokens =
      valueText.split(/\s+/).filter(Boolean);

    const columnWords =
      normalizeText(columnName)
        .split(/\s+/)
        .filter(
          (token) =>
            token.length >= 4 &&
            !new Set([
              "name",
              "number",
              "total",
              "value",
              "code",
              "description",
            ]).has(token)
        );

    const contextNounPattern = columnWords.length
      ? new RegExp(
          `\\b${valueText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s+(?:${columnWords
            .map((word) => `${word}s?`)
            .join("|")})\\b`,
          "u"
        )
      : null;

    const looksLikeDescriptiveContext =
      Boolean(
        contextNounPattern &&
        contextNounPattern.test(questionText)
      );

    const representedByReportContext =
      Boolean(
        reportText &&
        reportText.includes(valueText)
      );

    const weakContains =
      partialMatches.length > 0 &&
      valueTokens.length <= 3 &&
      !explicitNarrowing &&
      (
        representedByReportContext ||
        (
          !exactExists &&
          looksLikeDescriptiveContext
        )
      );

    if (weakContains) {
      removed.push({
        ...filter,
        reason:
          representedByReportContext
            ? "report-context-suppression"
            : "weak-contains-filter",
        matchedDistinctValues:
          partialMatches.length,
      });
      continue;
    }

    cleaned.push(filter);
  }

  if (cleaned.length === plan.filters.length) {
    return plan;
  }

  return {
    ...plan,
    filters: cleaned,
    semanticGuardChanges: [
      ...(Array.isArray(plan.semanticGuardChanges)
        ? plan.semanticGuardChanges
        : []),
      ...removed,
    ],
  };
}

/**
 * Deterministically honor explicit aggregate wording when the selected
 * metric is a real numeric field. The planner still chooses the dataset
 * and metric; JavaScript only aligns the operation with the user's words.
 */
function repairSemanticAggregatePlan({
  datasets,
  schema,
  plan,
  question,
}) {
  if (!plan || plan.route !== "dataset") {
    return plan;
  }

  const requestedAggregation =
    detectQuestionAggregation(question);

  if (
    !requestedAggregation ||
    !["sum", "average"].includes(requestedAggregation)
  ) {
    return plan;
  }

  const datasetSchema =
    (schema || []).find(
      (entry) =>
        String(entry?.name || "") ===
        String(plan.dataset || "")
    );
  const rows = datasets?.[plan.dataset];

  if (!datasetSchema || !Array.isArray(rows)) {
    return plan;
  }

  let metricName = plan.column || null;

  const explicit =
    findExplicitSchemaColumns({
      schema,
      question,
      preferredDataset: plan.dataset || null,
    });

  const explicitNumeric = explicit.find((item) => {
    const column =
      (datasetSchema.columns || []).find(
        (candidate) =>
          String(candidate?.name || "") ===
          String(item.column || "")
      );
    return column && isNumericLikeColumn({ column, rows });
  });

  if (explicitNumeric?.column) {
    metricName = explicitNumeric.column;
  }

  const metricSchema =
    (datasetSchema.columns || []).find(
      (column) =>
        String(column?.name || "") ===
        String(metricName || "")
    );

  if (
    !metricSchema ||
    !isNumericLikeColumn({
      column: metricSchema,
      rows,
    })
  ) {
    return plan;
  }

  const ranking = Boolean(
    detectRankingDirection(question)
  );

  if (ranking) {
    return {
      ...plan,
      column: metricName,
      aggregation:
        plan.groupBy || plan.labelColumn
          ? requestedAggregation
          : plan.aggregation,
      selectColumns: [
        ...new Set([
          plan.groupBy,
          plan.labelColumn,
          metricName,
          ...(Array.isArray(plan.selectColumns)
            ? plan.selectColumns
            : []),
        ].filter(Boolean)),
      ],
    };
  }

  return {
    ...plan,
    operation: requestedAggregation,
    column: metricName,
    aggregation: null,
    groupBy: null,
    labelColumn: null,
    selectColumns: [metricName],
    outputRequested: true,
  };
}


/**
 * Recover ONLY high-confidence SUM/AVERAGE questions when a planner asks
 * an unnecessary clarification even though the live schema already has a
 * strongly matching numeric field.
 *
 * IMPORTANT REGRESSION GUARD:
 * - This does NOT recover COUNT / "how many" questions.
 * - It does NOT recover ranking questions.
 * - It does NOT replace an already valid dataset plan.
 *
 * This keeps existing working beneficiary/count behavior untouched while
 * allowing generic questions such as "total <numeric concept> ..." to be
 * answered from any worksheet whose live schema provides a confident match.
 */
function recoverHighConfidenceAggregateClarification({
  datasets,
  schema,
  plan,
  question,
}) {
  if (
    !plan ||
    String(plan.route || "").trim().toLowerCase() !== "clarify"
  ) {
    return plan;
  }

  const aggregation = detectQuestionAggregation(question);

  // Intentionally conservative: do not touch "how many" / count flows.
  if (!["sum", "average"].includes(aggregation)) {
    return plan;
  }

  // Ranking has separate, richer resolution logic.
  if (detectRankingDirection(question)) {
    return plan;
  }

  const normalizedQuestion = normalizeText(question);
  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName = datasetSchema?.name;
    const rows = datasets?.[datasetName];

    if (!datasetName || !Array.isArray(rows) || !rows.length) {
      continue;
    }

    for (const column of datasetSchema?.columns || []) {
      if (
        !column?.name ||
        !isNumericLikeColumn({ column, rows })
      ) {
        continue;
      }

      const normalizedColumn = normalizeText(column.name);
      if (!normalizedColumn) continue;

      let score = scoreTargetToColumn(
        normalizedQuestion,
        normalizedColumn
      );

      // Strong phrase overlap: useful when the live header contains a unit
      // suffix such as "(ha)", "%", "kg", etc. that the user omits.
      const columnTokens = normalizedColumn
        .split(/\s+/)
        .filter(Boolean);
      const questionTokens = new Set(
        normalizedQuestion.split(/\s+/).filter(Boolean)
      );
      const overlap = columnTokens.length
        ? columnTokens.filter((token) => questionTokens.has(token)).length /
          columnTokens.length
        : 0;

      score += overlap * 0.75;

      // Prefer fields with actual usable numeric observations.
      const nonEmptyNumeric = rows.reduce((count, row) => {
        return count + (looksNumericValue(row?.[column.name]) ? 1 : 0);
      }, 0);
      const coverage = rows.length
        ? nonEmptyNumeric / rows.length
        : 0;
      score += Math.min(coverage, 1) * 0.1;

      candidates.push({
        dataset: datasetName,
        column: column.name,
        score,
        overlap,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0] || null;
  const second = candidates[1] || null;

  if (!best) {
    return plan;
  }

  // Require a strong semantic match. If two different fields are too close,
  // keep the clarification instead of guessing.
  const strongEnough =
    best.score >= 1.15 ||
    (best.overlap >= 0.66 && best.score >= 0.95);

  const materiallyDifferentSecond =
    second &&
    (
      normalizeText(second.column) !== normalizeText(best.column) ||
      String(second.dataset) !== String(best.dataset)
    );

  const ambiguous =
    materiallyDifferentSecond &&
    second.score >= best.score - 0.12;

  if (!strongEnough || ambiguous) {
    return plan;
  }

  const rows = datasets?.[best.dataset] || [];

  // Preserve genuine user narrowing (province, municipality, category, etc.)
  // using the existing generic value-inference engine. The later semantic
  // filter guard will remove weak accidental substring matches.
  const inferredFilters = inferValueFilters(
    rows,
    question,
    [best.column]
  );

  return {
    route: "dataset",
    dataset: best.dataset,
    operation: aggregation,
    column: best.column,
    labelColumn: null,
    groupBy: null,
    aggregation: null,
    filters: Array.isArray(inferredFilters)
      ? inferredFilters
      : [],
    selectColumns: [best.column],
    outputRequested: true,
    showAll: false,
    limit: 1,
    recoveredFromClarification: true,
    recoveryConfidence: Number(best.score.toFixed(4)),
  };
}


/**
 * Repair LIST plans that already contain exactly one requested output field
 * in selectColumns but leave the primary column empty.
 *
 * Example planner shape:
 *   operation: "list"
 *   column: null
 *   selectColumns: ["<real live field>"]
 *
 * The calculation engine expects plan.column for list operations. Resolve it
 * only when the planner has supplied one unambiguous selected field and that
 * field actually exists in the selected worksheet's live schema.
 *
 * This is fully dataset/schema agnostic. No report, worksheet, field, or
 * business value is hardcoded.
 */
function repairListOutputColumn({
  schema,
  plan,
}) {
  if (
    !plan ||
    plan.route !== "dataset" ||
    String(plan.operation || "")
      .trim()
      .toLowerCase() !== "list" ||
    plan.column
  ) {
    return plan;
  }

  const selectColumns =
    Array.isArray(plan.selectColumns)
      ? [
          ...new Set(
            plan.selectColumns
              .filter(Boolean)
              .map((value) =>
                String(value).trim()
              )
              .filter(Boolean)
          ),
        ]
      : [];

  if (!selectColumns.length) {
    return plan;
  }

  const datasetSchema =
    (schema || []).find(
      (dataset) =>
        String(dataset?.name || "") ===
        String(plan.dataset || "")
    ) || null;

  if (!datasetSchema) {
    return plan;
  }

  const realColumns =
    selectColumns
      .map((candidate) =>
        (datasetSchema.columns || []).find(
          (column) =>
            String(column?.name || "") ===
            candidate
        )?.name || null
      )
      .filter(Boolean);

  // Never repair against invented/non-schema output fields.
  if (
    realColumns.length !==
    selectColumns.length
  ) {
    return plan;
  }

  // Existing one-field LIST repair.
  if (realColumns.length === 1) {
    const realColumn =
      realColumns[0];

    return {
      ...plan,
      column: realColumn,
      labelColumn:
        plan.labelColumn ||
        realColumn,
      selectColumns: [realColumn],
    };
  }

  /**
   * A planner may correctly preserve row identity plus a newly requested
   * follow-up field, but still emit a plain LIST with column = null:
   *
   *   selectColumns: ["<identity field>", "<requested field>"]
   *
   * A LIST is a single-column operation in calculationEngine. For 2+
   * requested fields the intended operation is a row-preserving LOOKUP.
   *
   * Choose the label generically from identity/display semantics already
   * used elsewhere in this service (name/title/id/code/number). If none is
   * identifiable, keep every requested field and let LOOKUP render the row.
   * The current requested value is the last non-label selected field, which
   * matches planner ordering for chained requests while remaining schema
   * agnostic. No worksheet, project, association, or metric is hardcoded.
   */
  const explicitLabel =
    plan.labelColumn &&
    realColumns.includes(
      plan.labelColumn
    )
      ? plan.labelColumn
      : null;

  const semanticLabel =
    realColumns.find(
      (column) =>
        isLikelyIdentityOutputColumn(
          column
        )
    ) || null;

  const labelColumn =
    explicitLabel ||
    semanticLabel ||
    null;

  const valueCandidates =
    realColumns.filter(
      (column) =>
        !labelColumn ||
        normalizeText(column) !==
          normalizeText(labelColumn)
    );

  const requestedColumn =
    valueCandidates[
      valueCandidates.length - 1
    ] ||
    realColumns[
      realColumns.length - 1
    ];

  return {
    ...plan,
    operation: "lookup",
    column: requestedColumn,
    labelColumn,
    selectColumns: realColumns,
    outputRequested: true,
  };
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
   * CURRENT QUESTION OVERRIDES REMEMBERED GROUPING.
   *
   * Example:
   *   previous: grouped by Year
   *   current:  "top 10 Item highest Total Cost"
   *
   * If Item and Total Cost are real live fields, the current wording wins
   * even when an older conversation plan used a different groupBy.
   */
  if (rankingDirection) {
    const explicitRanking =
      resolveExplicitRankingColumns({
        datasets,
        schema,
        question,
        preferredDataset:
          normalized.dataset || null,
      });

    if (
      explicitRanking?.dataset &&
      (
        explicitRanking.metricColumn ||
        explicitRanking.groupColumn
      )
    ) {
      normalized.dataset =
        explicitRanking.dataset;

      if (explicitRanking.metricColumn) {
        normalized.column =
          explicitRanking.metricColumn;
      }

      if (explicitRanking.groupColumn) {
        normalized.labelColumn =
          explicitRanking.groupColumn;

        const aggregate =
          detectQuestionAggregation(
            question
          );

        if (aggregate) {
          normalized.operation =
            "rank_groups";
          normalized.groupBy =
            explicitRanking.groupColumn;
          normalized.aggregation =
            aggregate;
        } else {
          normalized.operation =
            "rank_rows";
          normalized.groupBy = null;
        }
      }

      normalized.direction =
        rankingDirection;
      normalized.limit =
        detectRankingLimit(
          question
        );
      normalized.selectColumns = [
        ...new Set([
          normalized.labelColumn,
          normalized.groupBy,
          normalized.column,
        ].filter(Boolean)),
      ];
      normalized.outputRequested = true;
    }
  }

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

  const listOutputRepaired =
    repairListOutputColumn({
      schema,
      plan:
        normalized,
    });

  return repairRankingIdentityPlan({
    datasets,
    schema,
    plan:
      listOutputRepaired,
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
function singularizeSchemaToken(value) {
  const token = String(value || "").trim().toLowerCase();

  if (token.length <= 3) {
    return token;
  }

  // Generic English plural normalization for schema labels / user wording.
  // Examples: municipalities -> municipality, categories -> category,
  // statuses -> status, classes -> class, projects -> project.
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (
    token.length > 4 &&
    token.endsWith("es") &&
    /(?:s|x|z|ch|sh)es$/.test(token)
  ) {
    return token.slice(0, -2);
  }

  if (
    token.length > 4 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }

  return token;
}

function normalizeSchemaPhraseMorphology(value) {
  return normalizeExplicitColumnText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(singularizeSchemaToken)
    .join(" " )
    .trim();
}

function findExplicitSchemaColumn({
  schema,
  question,
  preferredDataset = null,
}) {
  const normalizedQuestion =
    normalizeExplicitColumnText(question);

  const compactQuestion =
    compactExplicitColumnText(question);

  const morphologicalQuestion =
    normalizeSchemaPhraseMorphology(question);

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

      const morphologicalColumn =
        normalizeSchemaPhraseMorphology(name);

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
      } else {
        /**
         * Explicit field matching must respect WORD / PHRASE boundaries.
         *
         * Without this guard a short schema field such as "IP" can be
         * found inside an unrelated word such as "municipalities":
         *
         *   municIPalities
         *
         * That previously caused a conversational question such as
         * "what municipalities are they from?" to select IP instead of
         * Municipality.
         *
         * This remains completely schema-driven: no field name is
         * hardcoded. Single-word schema labels require token boundaries;
         * compact matching is reserved for multi-word labels where it is
         * needed only to bridge spacing/punctuation differences.
         */
        const escapedNormalized =
          normalizedColumn.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

        const normalizedPhraseRegex =
          new RegExp(
            `(^|[^\\p{L}\\p{N}])${escapedNormalized}(?=$|[^\\p{L}\\p{N}])`,
            "u"
          );

        const normalizedWordCount =
          normalizedColumn
            .split(/\s+/)
            .filter(Boolean)
            .length;

        const escapedMorphological =
          morphologicalColumn
            ? morphologicalColumn.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              )
            : "";

        const morphologicalPhraseRegex =
          escapedMorphological
            ? new RegExp(
                `(^|[^\\p{L}\\p{N}])${escapedMorphological}(?=$|[^\\p{L}\\p{N}])`,
                "u"
              )
            : null;

        if (
          normalizedPhraseRegex.test(
            normalizedQuestion
          )
        ) {
          score =
            95 +
            normalizedColumn.length / 10000;
        } else if (
          normalizedWordCount >= 2 &&
          compactQuestion.includes(
            compactColumn
          )
        ) {
          score =
            94 +
            compactColumn.length / 10000;
        } else if (
          morphologicalQuestion &&
          morphologicalColumn &&
          (
            morphologicalQuestion === morphologicalColumn ||
            morphologicalPhraseRegex?.test(
              morphologicalQuestion
            )
          )
        ) {
          // Singular/plural normalization still works, but only as a real
          // phrase match, never as a substring hidden inside another word.
          score =
            93 +
            morphologicalColumn.length / 10000;
        }
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





module.exports = {
  normalizeExplicitColumnText,
  compactExplicitColumnText,
  expandExplicitColumnWords,
  buildExplicitColumnAliases,
  findExplicitSchemaColumns,
  splitExplicitEntitySegments,
  detectQuestionAggregation,
  detectRankingDirection,
  detectRankingLimit,
  looksNumericValue,
  isNumericLikeColumn,
  parseRankingTargets,
  scoreTargetToColumn,
  sanitizeRankingStructuralFilters,
  repairRankingIdentityPlan,
  detectGroupedComparisonOperation,
  resolveExplicitRankingColumns,
  currentQuestionOverridesAnalyticalGroup,
  sanitizeSemanticPlanFilters,
  repairSemanticAggregatePlan,
  recoverHighConfidenceAggregateClarification,
  repairListOutputColumn,
  normalizePlannerPlan,
  singularizeSchemaToken,
  normalizeSchemaPhraseMorphology,
  findExplicitSchemaColumn,
  operationUsesMetricColumn,
  enforceExplicitQuestionColumn,
  getSchemaColumns,
  inferRequestedColumnFromQuestion,
  inferRememberedSubjectColumn,
};
