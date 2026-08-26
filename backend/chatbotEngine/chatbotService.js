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

      const normalizedColumn =
        normalizeExplicitColumnText(
          name
        );

      if (!normalizedColumn) {
        continue;
      }

      const escaped =
        normalizedColumn.replace(
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
            normalizedQuestion
          )) !== null
      ) {
        const prefixLength =
          match[1]?.length || 0;

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

  return {
    ...plan,

    operation:
      "rank_rows",

    column:
      metric.column.name,

    labelColumn:
      identityColumns[0],

    groupBy:
      null,

    direction,

    limit:
      detectRankingLimit(
        question
      ),

    selectColumns,

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
          normalized.operation =
            groupedOperation;

          normalized.groupBy =
            actualGroupColumn;

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

          // Remove the raw entity groups.
          delete normalized.filterGroups;
          delete normalized.filterGroupLogic;

          normalized.selectColumns = [
            actualGroupColumn,
            ...(normalized.column
              ? [
                  normalized.column,
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

  /**
   * IMPORTANT RANKING SAFETY RULE
   * -----------------------------
   *
   * Ranking questions can explicitly mention BOTH:
   * a label/entity field and a numeric metric field.
   *
   * normalizePlannerPlan() already separates them into:
   *
   *   labelColumn = entity/label field
   *   column      = numeric ranking metric
   *
   * The single-column safeguard below must not run after that,
   * because it can overwrite the metric with the label field.
   *
   * This rule is dataset-agnostic.
   */
  const normalizedOperation =
    String(plan.operation || "")
      .trim()
      .toLowerCase();

  if (
    normalizedOperation === "rank_rows" ||
    normalizedOperation === "rank_groups"
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
    const recentResults =
      getRecentResults(
        sessionId
      );

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
        const naturalAnswer =
          await generateNaturalResponse({
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