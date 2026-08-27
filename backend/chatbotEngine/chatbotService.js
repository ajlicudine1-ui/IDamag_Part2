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

  const datasetSchema =
    (schema || []).find(
      (item) =>
        String(
          item?.name || ""
        ) ===
        String(
          plan.dataset || ""
        )
    );

  const rows =
    datasets?.[
      plan.dataset
    ];

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

  const groupedAggregation =
    [
      "sum",
      "average",
      "avg",
      "mean",
      "count",
    ].includes(
      normalizedAggregation
    );

  const finalOperation =
    groupedAggregation
      ? "rank_groups"
      : "rank_rows";

  const finalLabelColumn =
    identityColumns[0];

  return {
    ...plan,

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
            normalizedAggregation ===
              "avg" ||
            normalizedAggregation ===
              "mean"
              ? "average"
              : normalizedAggregation
          )
        : (
            plan?.aggregation ||
            null
          ),

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
   * Rank operations express highest/lowest through direction.
   * Words like "highest" should not accidentally replace an existing
   * aggregate such as average with maximum.
   */
  if (
    wasRanking &&
    !/\b(?:average|avg|mean|total|sum|combined|count|how many|number of)\b/.test(
      normalizeText(
        question
      )
    )
  ) {
    aggregation =
      previous.aggregation ||
      aggregation;
  }

  let operation =
    previousOperation;

  if (wasRanking) {
    operation =
      hasGrouping
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
      "rank_groups";
  }

  const groupBy =
    previous.groupBy ||
    previous.labelColumn ||
    null;

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


function compareVerifiedAnalyticalPair({
  context,
  mode,
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
    return {
      success: false,
      source:
        "conversation-analytics",
      operation:
        "clarify",
      answer:
        `The previous result contains ${pair.count} values. Please name the two results you want me to compare.`,
    };
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
  sessionId = "default"
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

        const naturalAnswer =
          isOrdinalAnalyticalResult &&
          result?.answer
            ? result.answer
            : await generateNaturalResponse({
                question:
                  cleanQuestion,

                plan,

                result,
              });

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

      return {
        ...result,

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

    return {
      ...result,

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
