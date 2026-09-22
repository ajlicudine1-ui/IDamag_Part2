const {
  normalizeText,
  similarity,
} = require("./utils");

const {
  inferCoherentFilters,
} = require("./filterEngine");

const {
  detectQuestionAggregation,
  detectRankingDirection,
  isNumericLikeColumn,
  inferRequestedColumnFromQuestion,
} = require("./plannerNormalizer");

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
   * IMPORTANT: this shortcut is only for plain field lookups/lists.
   * Analytical questions (ranking, totals, averages, counts, etc.) must
   * continue through the normal planner/repair pipeline so the requested
   * metric is not discarded.
   *
   * Example that MUST NOT be intercepted here:
   *   "Which association in Pangasinan has the largest total land area?"
   *
   * Without this guard the direct lookup parser can incorrectly reduce the
   * request to: Name of Association + Province=Pangasinan, losing the
   * "largest Total Land Area (ha)" ranking instruction.
   */
  if (
    detectRankingDirection(text) ||
    detectQuestionAggregation(text) ||
    /\b(?:median|minimum|maximum|min|max|difference|ratio|percentage|percent)\b/.test(text)
  ) {
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




module.exports = {
  tokenizeSchemaPhrase,
  scoreNaturalFieldPhrase,
  inferApproximateEntityFilterFromText,
  resolveDirectFilteredAggregatePlan,
  resolveDirectFilteredFieldPlan,
  normalizedEditSimilarity,
};
