const {
  buildSchema,
} = require("./schemaBuilder");

const {
  createPlan,
} = require("./intentParser");

const {
  executePlan,
  buildDataQualitySummary,
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
  applyConversationCorrection,
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

const {
  detectColumnAmbiguity,
} = require("./columnMatcher");

const {
  inferMetricSemantics,
  inferUnitFromColumn,
} = require("./semanticDictionary");

const {
  discoverWorksheetRelationships,
} = require("./relationshipEngine");

const {
  hardenLocalPlan,
  reconcileExplicitDatasetMention,
} = require("./localPlannerHardener");

const {
  buildCrossWorksheetGroupedRankingResolution,
  executeCrossWorksheetGroupedPlan,
  buildDistributedWorksheetResolution,
  buildDistributedWorksheetFollowUpResolution,
  executeDistributedWorksheetPlan,
} = require("./multiWorksheetEngine");

const {
  refineStoredMetricOperation,
  enrichPlanMetricMeaning,
} = require("./metricMeaningEngine");

const {
  attachLocalConfidence,
} = require("./planConfidenceEngine");

const {
  buildSemanticVerifiedAnswer,
} = require("./responseNarrativeEngine");

const {
  finalizeUserFacingGrammar,
} = require("./responseGrammarEngine");

const {
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
} = require("./plannerNormalizer");

const {
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
} = require("./analyticalConversationEngine");

const {
  resolveDirectFilteredAggregatePlan,
  resolveDirectFilteredFieldPlan,
  normalizedEditSimilarity,
} = require("./directQueryResolver");

const {
  currentQuestionRequiresReplan,
} = require("./currentQuestionOverrideEngine");

const {
  resolveStrongLocalSemanticPlan,
} = require("./localSemanticResolver");




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

  /**
   * A list answer represents distinct values unless the user explicitly asks
   * for row-by-row records. Preserve first-seen display casing while removing
   * duplicate values case-insensitively.
   */
  const distinctItems =
    [
      ...new Map(
        items.map(
          (value) => [
            normalizeText(
              value
            ),
            value,
          ]
        )
      ).values(),
    ];

  return distinctItems
    .map(
      (value, index) =>
        `${index + 1}. ${value}`
    )
    .join(
      "\n"
    );
}


function normalizeDirectSingleFieldResult({
  plan,
  result,
}) {
  if (
    !plan ||
    !result ||
    !plan.column ||
    !Array.isArray(
      result.results
    )
  ) {
    return result;
  }

  const selectedColumns =
    Array.isArray(
      plan.selectColumns
    )
      ? plan.selectColumns
          .filter(Boolean)
      : [];

  const isSingleField =
    selectedColumns.length <=
      1 &&
    (
      !selectedColumns.length ||
      normalizeText(
        selectedColumns[0]
      ) ===
        normalizeText(
          plan.column
        )
    );

  if (
    !isSingleField
  ) {
    return result;
  }

  const distinctMap =
    new Map();

  for (
    const item of
    result.results
  ) {
    const value =
      typeof item ===
        "object" &&
      item !== null
        ? item[
            plan.column
          ]
        : item;

    if (
      value === null ||
      value === undefined ||
      String(
        value
      ).trim() ===
        ""
    ) {
      continue;
    }

    const displayValue =
      String(
        value
      ).trim();

    const key =
      normalizeText(
        displayValue
      );

    if (
      !distinctMap.has(
        key
      )
    ) {
      distinctMap.set(
        key,
        typeof item ===
          "object" &&
        item !== null
          ? {
              ...item,
              [
                plan.column
              ]:
                displayValue,
            }
          : displayValue
      );
    }
  }

  const distinctResults =
    [
      ...distinctMap.values(),
    ];

  if (
    distinctResults.length ===
      result.results.length
  ) {
    return result;
  }

  return {
    ...result,
    results:
      distinctResults,
    count:
      distinctResults.length,
    distinctResultCount:
      distinctResults.length,
    duplicateRowsRemoved:
      result.results.length -
      distinctResults.length,
  };
}


/**
 * Format a VERIFIED conversational list as:
 *
 *   <previous conversational subject> - <current answer>
 *
 * The label is derived from verified context, never from a hardcoded
 * dataset/field. For the first referential list after a filtered count,
 * the single verified scope value is used (for example a province value).
 * Later chained field questions use the immediately previous subject field.
 */
function buildContextAwareContinuousListAnswer({
  result,
  subjectColumn = null,
  pairColumn = null,
  context = null,
  preferScopeValue = false,
}) {
  const resultRows = Array.isArray(result?.results) ? result.results : [];

  /**
   * For chained field questions, preserve the ACTUAL row relationship:
   *
   *   <value from previous field> - <value from current requested field>
   *
   * Example shape only (never hardcoded):
   *   <association value> - <municipality value>
   *   <municipality value> - <commodity value>
   *
   * This uses values returned by the calculation engine, not schema labels.
   */
  if (
    pairColumn &&
    subjectColumn &&
    normalizeText(pairColumn) !== normalizeText(subjectColumn) &&
    resultRows.some((item) => item && typeof item === "object")
  ) {
    const pairs = [];

    for (const item of resultRows) {
      if (!item || typeof item !== "object") continue;

      const leftRaw =
        item?.[pairColumn] ??
        item?.label ??
        null;

      const rightRaw =
        item?.[subjectColumn] ??
        item?.value ??
        null;

      const left = String(leftRaw ?? "").trim();
      const right = String(rightRaw ?? "").trim();

      if (!left || !right) continue;

      // Explicit delimiters always indicate multiple values. For comma-delimited
      // cells, split only when the text looks like a compact category list.
      let rightValues = [right];
      if (/[;|]/.test(right)) {
        rightValues = right.split(/[;|]/);
      } else if (right.includes(",")) {
        const parts = right.split(",").map((v) => v.trim()).filter(Boolean);
        const compactCategoryList =
          parts.length >= 2 &&
          parts.every((v) => v.split(/\s+/).filter(Boolean).length <= 5);
        if (compactCategoryList) rightValues = parts;
      }

      for (const value of rightValues) {
        const cleaned = String(value).trim();
        if (cleaned) pairs.push({ left, right: cleaned });
      }
    }

    const uniquePairs = [];
    const seenPairs = new Set();
    for (const pair of pairs) {
      const key = `${normalizeText(pair.left)}\u0000${normalizeText(pair.right)}`;
      if (!pair.left || !pair.right || seenPairs.has(key)) continue;
      seenPairs.add(key);
      uniquePairs.push(pair);
    }

    if (uniquePairs.length) {
      return uniquePairs.map((pair) => `${pair.left} - ${pair.right}`).join("\n");
    }
  }

  const rawItems =
    resultRows
      .map((item) => {
        if (item === null || item === undefined) return "";
        if (typeof item !== "object") return String(item).trim();
        if (subjectColumn && item?.[subjectColumn] !== null && item?.[subjectColumn] !== undefined) {
          return String(item[subjectColumn]).trim();
        }
        if (item.value !== null && item.value !== undefined) return String(item.value).trim();
        if (item.label !== null && item.label !== undefined) return String(item.label).trim();
        return "";
      })
      .filter(Boolean);

  if (!rawItems.length) {
    return result?.answer || "No matching results were found.";
  }

  // Generic multi-value-cell normalization.
  let items = [...rawItems];
  const explicitMulti = rawItems.some((v) => /[;|]/.test(v));
  const commaRows = rawItems.filter((v) => v.includes(","));
  let sharedCommaToken = false;
  if (commaRows.length >= 2) {
    const tokenSets = commaRows.map((v) => new Set(v.split(",").map((x) => normalizeText(x)).filter(Boolean)));
    const tokenSeen = new Set();
    for (const set of tokenSets) {
      for (const token of set) {
        if (tokenSeen.has(token)) sharedCommaToken = true;
        tokenSeen.add(token);
      }
    }
  }
  if (explicitMulti || sharedCommaToken) {
    items = rawItems
      .flatMap((v) => v.split(explicitMulti ? /[;|]/ : /,/))
      .map((v) => v.trim())
      .filter(Boolean);
  }

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = normalizeText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  const filters = Array.isArray(context?.lastFilters) ? context.lastFilters : [];
  const singleScopeValue =
    filters.length === 1 && !Array.isArray(filters[0]?.value)
      ? String(filters[0]?.value ?? "").trim()
      : "";

  const previousSubject = String(context?.lastSubjectColumn || "").trim();
  const prefix =
    preferScopeValue && singleScopeValue
      ? singleScopeValue
      : previousSubject || singleScopeValue;

  if (!prefix) return unique.join("\n");
  return unique.map((value) => `${prefix} - ${value}`).join("\n");
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

  return finalizeUserFacingGrammar(
    output
  );
}


function normalizeSemanticReferentialQuestion(question) {
  const original =
    String(
      question || ""
    )
      .replace(/\s+/g, " ")
      .trim();

  if (!original) {
    return null;
  }

  const text =
    normalizeText(
      original
    );

  /**
   * Copular/prepositional relations are intentionally NOT rewritten.
   *
   * Examples:
   *   "What municipalities are they from?"
   *   "Which office are they under?"
   *   "What category are they in?"
   *
   * These are relationships, but "from", "under", and "in" are not action
   * verbs. Keeping them on the verified pair formatter avoids bad grammar
   * such as "They from ..." or "froms ...".
   */
  if (
    /\b(?:are|were|is|was)\s+(?:they|these|those|them|it|he|she)\s+(?:from|in|at|under|within|inside|on|of|for|with|without|near|around|through|across|over|below|above|between|among|into|onto|to)\b/i.test(
      original
    )
  ) {
    return null;
  }

  /**
   * 1. Standard auxiliary action.
   *
   * Covers:
   *   "What products do they sell?"
   *   "Which services do those groups provide?"
   *   "What projects did these teams manage?"
   *
   * The subject phrase may vary. We canonicalize only the grammatical shell;
   * the actual requested field, label field, filters, and result values still
   * come from the live verified plan/result.
   */
  let match =
    original.match(
      /\b(?:do|does|did)\s+(.+?)\s+([a-z][a-z-]*)\s*[?.!]*$/i
    );

  if (
    match?.[2]
  ) {
    const verb =
      normalizeText(
        match[2]
      );

    if (
      verb &&
      !/^(?:be|am|is|are|was|were|been|being|do|does|did)$/.test(
        verb
      )
    ) {
      return `What values do they ${verb}?`;
    }
  }

  /**
   * 2. Direct/pronoun action without "do".
   *
   * Covers paraphrases such as:
   *   "Tell me what they produce."
   *   "What are the products they sell?"
   *   "Show the activities they conduct."
   */
  match =
    original.match(
      /\b(?:they|these|those)\s+([a-z][a-z-]*)\b/i
    );

  if (
    match?.[1]
  ) {
    const verb =
      normalizeText(
        match[1]
      );

    const auxiliaries =
      /^(?:am|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|may|might|must|shall|should|will|would)$/;

    if (
      verb &&
      !auxiliaries.test(
        verb
      )
    ) {
      return `What values do they ${verb}?`;
    }
  }

  /**
   * 3. Progressive action.
   *
   * Keep the user's wording because responseNarrativeEngine already handles
   * action-progressive questions. This expands routing to paraphrases such as:
   *   "What products are they selling?"
   *   "Which systems are they using?"
   */
  if (
    /\b(?:am|is|are|was|were)\s+(?:they|these|those|them|it|he|she)\s+[a-z][a-z-]*ing\b/i.test(
      original
    )
  ) {
    return original;
  }

  /**
   * 4. Possessive field paraphrase.
   *
   * Examples:
   *   "Tell me their commodities."
   *   "Show me their activities."
   *   "What are their services?"
   *
   * At this stage the explicit referential-field resolver has already
   * identified the real live-schema field. We only normalize the grammatical
   * relation so the deterministic narrative can render a compact natural
   * answer instead of raw "<label> - <value>" pairs.
   */
  if (
    /\btheir\b/i.test(
      original
    )
  ) {
    return "What values do they have?";
  }

  /**
   * 4. Passive paraphrase.
   *
   * Examples:
   *   "What products are produced by them?"
   *   "Which services were provided by those groups?"
   *
   * The deterministic formatter may not safely recover every English base
   * verb from an arbitrary past participle. Instead of inventing a malformed
   * verb, route the verified relation through the neutral "have" wording.
   * This preserves correct data and natural grammar without domain hardcoding.
   */
  if (
    /\b(?:is|are|was|were|be|been|being)\s+[a-z][a-z-]*(?:ed|en)\s+by\s+(?:them|these|those)\b/i.test(
      original
    )
  ) {
    return "What values do they have?";
  }

  return null;
}

function shouldUseSemanticReferentialNarrative(question) {
  return Boolean(
    normalizeSemanticReferentialQuestion(
      question
    )
  );
}


function recoverLocalReferentialPlanFromConversation({
  plan,
  question,
  context,
  schema,
}) {
  if (
    !plan ||
    typeof plan !== "object" ||
    context?.isFollowUp !== true ||
    !normalizeSemanticReferentialQuestion(
      question
    )
  ) {
    return plan;
  }

  // A valid local dataset plan already has enough information.
  if (
    plan.route === "dataset" &&
    plan.dataset &&
    plan.column
  ) {
    return plan;
  }

  const datasetName =
    context.lastDataset ||
    context.semanticPlan?.dataset ||
    null;

  if (!datasetName) {
    return plan;
  }

  const datasetSchema =
    Array.isArray(schema)
      ? schema.find(
          (item) =>
            normalizeText(
              item?.name
            ) ===
            normalizeText(
              datasetName
            )
        )
      : null;

  const liveColumns =
    Array.isArray(
      datasetSchema?.columns
    )
      ? datasetSchema.columns
          .map(
            (item) =>
              typeof item === "string"
                ? item
                : item?.name
          )
          .filter(Boolean)
      : [];

  const findLiveColumn =
    (candidate) => {
      const normalized =
        normalizeText(
          candidate
        );

      if (!normalized) {
        return null;
      }

      return liveColumns.find(
        (column) =>
          normalizeText(
            column
          ) ===
          normalized
      ) || null;
    };

  // Prefer the immediately previous verified output/metric field.
  // This is conversation-derived, not domain hardcoding.
  const valueColumn =
    findLiveColumn(
      context.lastMetric
    ) ||
    findLiveColumn(
      context.lastSubjectColumn
    ) ||
    findLiveColumn(
      context.lastPlan?.column
    ) ||
    findLiveColumn(
      context.semanticPlan?.metricColumn
    ) ||
    findLiveColumn(
      context.semanticPlan?.column
    ) ||
    null;

  if (!valueColumn) {
    return plan;
  }

  const pairColumnCandidates = [
    context.lastPlan?.conversationalPairColumn,
    context.lastPlan?.labelColumn,
    context.semanticPlan?.labelColumn,
    context.semanticPlan?.groupBy,
  ];

  let pairColumn = null;

  for (
    const candidate
    of pairColumnCandidates
  ) {
    const live =
      findLiveColumn(
        candidate
      );

    if (
      live &&
      normalizeText(
        live
      ) !==
      normalizeText(
        valueColumn
      )
    ) {
      pairColumn =
        live;
      break;
    }
  }

  const filters =
    Array.isArray(
      context.lastFilters
    )
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
      : [];

  const selectColumns =
    [
      pairColumn,
      valueColumn,
    ]
      .filter(Boolean)
      .filter(
        (column, index, all) =>
          all.findIndex(
            (item) =>
              normalizeText(
                item
              ) ===
              normalizeText(
                column
              )
          ) === index
      );

  return {
    ...plan,
    route:
      "dataset",
    dataset:
      datasetName,
    operation:
      "lookup",
    column:
      valueColumn,
    labelColumn:
      pairColumn ||
      valueColumn,
    groupBy:
      null,
    aggregation:
      null,
    direction:
      null,
    filters,
    selectColumns,
    outputRequested:
      true,
    transform:
      null,
    showAll:
      true,
    limit:
      Math.max(
        Number(
          plan.limit
        ) || 10,
        100
      ),
    conversationalPairColumn:
      pairColumn ||
      null,
    localReferentialRecovery:
      true,
  };
}

function isExternalLanguageServiceError(error) {
  const message =
    String(
      error?.message ||
      error ||
      ""
    )
      .toLowerCase();

  if (!message) {
    return false;
  }

  return (
    message.includes(
      "rate limit"
    ) ||
    message.includes(
      "tokens per day"
    ) ||
    message.includes(
      "too many requests"
    ) ||
    message.includes(
      "quota"
    ) ||
    message.includes(
      "service unavailable"
    ) ||
    message.includes(
      "temporarily unavailable"
    ) ||
    /\b429\b/.test(
      message
    )
  );
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
    /\b(?:total|sum|average|avg|mean|median|minimum|maximum|min|max|highest|lowest|largest|smallest|top|bottom|count|how many|number of|difference|ratio|percentage|percent)\b/.test(
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
 * GENERIC CONTINUOUS-CONVERSATION RECOVERY
 * ==========================================================
 *
 * Some short follow-up questions are semantically obvious to a human but
 * may not be classified as follow-ups by conversationManager. Examples:
 *
 *   "What are they?"
 *   "Who are those?"
 *   "What about La Union?"
 *   "And the total cost?"
 *   "What are their commodities?"
 *   "How about the same municipality?"
 *
 * The verified previous turn is already stored by updateConversation().
 * When the current wording is referential, recover that VERIFIED turn from
 * getRecentResults() and hydrate only missing conversational fields.
 *
 * No worksheet, field name, business value, province, status, entity type,
 * or dashboard is hardcoded here.
 */
function looksLikeContinuousFollowUp(
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
    /\b(?:those|these|them|they|their|theirs|it|its|that|this|there|therein|same|previous|above|earlier|former|latter|ones?)\b/.test(
      text
    ) ||
    /^(?:what|how)\s+about\b/.test(
      text
    ) ||
    /^(?:and|also|then|next)\b/.test(
      text
    ) ||
    /\b(?:of|for|among|within)\s+(?:those|these|them|that|this|the same)\b/.test(
      text
    ) ||
    /\b(?:his|her|their|its)\s+[\p{L}\p{N}_-]+/u.test(
      text
    )
  );
}

function hydrateContinuousConversationContext({
  context,
  recentResults,
  question,
}) {
  if (
    !context ||
    typeof context !== "object" ||
    !looksLikeContinuousFollowUp(
      question
    ) ||
    !Array.isArray(
      recentResults
    ) ||
    !recentResults.length
  ) {
    return context;
  }

  /**
   * Use the most recent VERIFIED entry that contains a usable plan/result.
   * Clarifications/errors do not become conversational scope.
   */
  const latestVerifiedEntry =
    [...recentResults]
      .reverse()
      .find(
        (entry) =>
          entry?.plan &&
          entry?.result &&
          entry.result.success !== false &&
          String(
            entry.plan.route || ""
          )
            .trim()
            .toLowerCase() !== "clarify"
      ) ||
    null;

  if (!latestVerifiedEntry) {
    return context;
  }

  const previousPlan =
    latestVerifiedEntry.plan ||
    {};

  const previousResult =
    latestVerifiedEntry.result ||
    null;

  const previousSelectColumns =
    Array.isArray(
      previousPlan.selectColumns
    )
      ? previousPlan.selectColumns
          .filter(Boolean)
      : [];

  const previousMetric =
    previousPlan.column ||
    (
      previousSelectColumns.length === 1
        ? previousSelectColumns[0]
        : previousSelectColumns.length
          ? [...previousSelectColumns]
          : null
    );

  const previousSubject =
    previousPlan.labelColumn ||
    previousPlan.groupBy ||
    previousPlan.column ||
    (
      previousSelectColumns.length === 1
        ? previousSelectColumns[0]
        : null
    );

  const previousFilters =
    Array.isArray(
      previousPlan.filters
    )
      ? previousPlan.filters.map(
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

  const previousEntity =
    previousFilters.length === 1
      ? {
          ...previousFilters[0],
          value:
            Array.isArray(
              previousFilters[0]?.value
            )
              ? [
                  ...previousFilters[0]
                    .value,
                ]
              : previousFilters[0]
                  ?.value,
        }
      : null;

  /**
   * IMPORTANT: current context still wins when conversationManager already
   * provided a verified field. We only fill gaps and mark the turn as a
   * follow-up. This avoids stale context overriding explicit current intent.
   */
  context.isFollowUp = true;

  context.lastPlan =
    context.lastPlan ||
    previousPlan;

  context.lastResult =
    context.lastResult ||
    previousResult;

  context.lastDataset =
    context.lastDataset ||
    previousPlan.dataset ||
    previousResult?.dataset ||
    null;

  if (
    !Array.isArray(
      context.lastFilters
    ) ||
    !context.lastFilters.length
  ) {
    context.lastFilters =
      previousFilters;
  }

  context.lastEntity =
    context.lastEntity ||
    previousEntity;

  context.lastMetric =
    context.lastMetric ||
    previousMetric;

  context.lastSubjectColumn =
    context.lastSubjectColumn ||
    previousSubject;

  context.lastSubjectQuestion =
    context.lastSubjectQuestion ||
    latestVerifiedEntry.question ||
    null;

  context.lastQuestion =
    context.lastQuestion ||
    latestVerifiedEntry.question ||
    null;

  context.lastIntent =
    context.lastIntent ||
    previousPlan.operation ||
    previousResult?.operation ||
    null;

  return context;
}


/**
 * Resolve a NEW output field explicitly requested by a conversational
 * follow-up while preserving the last VERIFIED row scope.
 *
 * Examples of the shape handled:
 *   "what municipalities are they from?"
 *   "what barangays are those in?"
 *   "what commodities do they have?"
 *   "show their status"
 *
 * This is fully schema-driven. No worksheet, field, or business value is
 * hardcoded. It intentionally handles non-analytical field/list follow-ups
 * only; totals, averages, rankings, comparisons, etc. continue through the
 * richer analytical pipeline.
 */
function buildExplicitReferentialFieldPlan({
  schema,
  context,
  question,
}) {
  if (
    !context ||
    context.isFollowUp !== true ||
    !context.lastDataset ||
    !looksLikeContinuousFollowUp(question)
  ) {
    return null;
  }

  const text = normalizeText(question);

  if (!text) {
    return null;
  }

  // Do not steal analytical follow-ups from their dedicated handlers.
  if (
    detectQuestionAggregation(question) ||
    detectRankingDirection(question) ||
    /\b(?:compare|comparison|difference|ratio|percentage|percent|median|range|spread|trend|increase|decrease|growth)\b/.test(
      text
    )
  ) {
    return null;
  }

  // Require an actual conversational reference to the prior verified scope.
  if (
    !/\b(?:they|them|their|theirs|those|these|there|therein|same|ones?|it|its|that|this)\b/.test(
      text
    )
  ) {
    return null;
  }

  const requested =
    findExplicitSchemaColumn({
      schema,
      question,
      preferredDataset:
        context.lastDataset,
    }) ||
    inferRequestedColumnFromQuestion({
      schema,
      question,
      preferredDataset:
        context.lastDataset,
      excludedColumns: [],
    });

  if (
    !requested?.column ||
    String(requested.dataset || context.lastDataset) !==
      String(context.lastDataset)
  ) {
    return null;
  }

  const filters =
    Array.isArray(context.lastFilters)
      ? context.lastFilters.map(
          (filter) => ({
            ...filter,
            value:
              Array.isArray(filter?.value)
                ? [...filter.value]
                : filter?.value,
          })
        )
      : [];

  /**
   * Preserve the most recent VERIFIED relationship label when the user repeats
   * the same referential field question.
   *
   * Example conversation shape:
   *   previous plan: labelColumn = <location>, column = <multi-value field>
   *   repeated question asks for the same <multi-value field>
   *
   * conversationManager may now expose lastSubjectColumn as the requested
   * field itself. Without this recovery the plan degrades from:
   *
   *   lookup(label + value)
   *
   * to:
   *
   *   list(value only)
   *
   * and the response loses the row relationship. Prefer the immediately
   * previous verified pair/label column when it is different from the current
   * requested field. No dataset or field name is hardcoded.
   */
  const previousPairCandidates = [
    context.lastSubjectColumn,
    context.lastPlan?.conversationalPairColumn,
    context.lastPlan?.labelColumn,
    context.semanticPlan?.labelColumn,
    context.semanticPlan?.groupBy,
  ];

  const previousSubjectColumn =
    previousPairCandidates.find(
      (candidate) =>
        candidate &&
        normalizeText(candidate) !==
          normalizeText(requested.column)
    ) ||
    null;

  const selectColumns = [];
  if (previousSubjectColumn) selectColumns.push(previousSubjectColumn);
  selectColumns.push(requested.column);

  return {
    route: "dataset",
    dataset:
      context.lastDataset,
    operation:
      previousSubjectColumn ? "lookup" : "list",
    column:
      requested.column,
    labelColumn:
      previousSubjectColumn || requested.column,
    groupBy: null,
    aggregation: null,
    direction: null,
    filters,
    selectColumns,
    outputRequested: true,
    transform: null,
    showAll: true,
    limit: 100,
    explicitReferentialField: true,
    explicitReferentialFieldMatch: "morphology-aware",
    conversationalPairColumn:
      previousSubjectColumn,
  };
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

  const worksheetRelationships =
    discoverWorksheetRelationships({ datasets, schema });

  // ========================================================
  // LOAD CONVERSATION CONTEXT
  // ========================================================

  const conversationContext =
    getRelevantContext(
      sessionId,
      cleanQuestion
    );

  Object.assign(
    conversationContext,
    applyConversationCorrection({
      question: cleanQuestion,
      context: conversationContext,
      schema,
    })
  );

  conversationContext.worksheetRelationships =
    worksheetRelationships;

  /**
   * Recover short referential follow-ups from the latest VERIFIED turn even
   * when conversationManager did not classify the wording as isFollowUp.
   * This is what keeps multi-turn chains stable across:
   *
   *   count -> "what are they?" -> "what are their <field>?"
   *   lookup -> "what about <new value>?" -> "and <new field>?"
   *   ranking -> "what is the lowest?" -> "compare them"
   *
   * A complete self-contained analytical question is still allowed to reset
   * scope immediately below, so explicit new questions are not contaminated
   * by stale memory.
   */
  hydrateContinuousConversationContext({
    context:
      conversationContext,
    recentResults:
      getRecentResults(
        sessionId
      ),
    question:
      cleanQuestion,
  });

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

      /**
       * Synthetic multi-worksheet operations are produced by the
       * deterministic engine and can also be reconstructed by Groq/local
       * conversation follow-ups (for example, "what about the lowest?").
       * calculationEngine intentionally does not own these cross-worksheet
       * operations, so execute them here before ordinary dataset execution.
       */
      if (
        plan.route === "dataset" &&
        ["rank_worksheets", "multi_worksheet", "rank_across_worksheets"].includes(
          String(plan.operation || "").trim().toLowerCase()
        )
      ) {
        const operationName = String(plan.operation || "").trim().toLowerCase();
        const distributedResult = operationName === "rank_across_worksheets"
          ? executeCrossWorksheetGroupedPlan({
              datasets,
              schema,
              plan,
              question: cleanQuestion,
            })
          : executeDistributedWorksheetPlan({
              datasets,
              schema,
              plan,
              question: cleanQuestion,
            });

        if (distributedResult) {
          updateConversation(sessionId, {
            question: cleanQuestion,
            plan,
            result: distributedResult,
          });

          return distributedResult;
        }
      }

      // ====================================================
      // SEMANTIC PLAN GUARDS
      // ====================================================
      // 1) Align explicit aggregate wording with a verified numeric field.
      // 2) Suppress weak/report-context substring filters.
      // These run for Groq, local fallback, and conversational plans.
      plan =
        repairSemanticAggregatePlan({
          datasets,
          schema,
          plan,
          question: cleanQuestion,
        });

      // Protect real stored fields whose names also look like operations
      // (Average, Total, Count, Minimum, Maximum, etc.). Exact live-schema
      // field meaning outranks a keyword-only aggregation guess.
      plan = refineStoredMetricOperation({
        plan,
        question: cleanQuestion,
        schema,
      });

      plan =
        sanitizeSemanticPlanFilters({
          datasets,
          plan,
          question: cleanQuestion,
          reportContext:
            internalOptions?.report ||
            internalOptions?.reportTitle ||
            null,
        });

      plan = detectColumnAmbiguity({
        plan,
        datasets,
        question: cleanQuestion,
      });

      if (plan?.route === "dataset" && plan?.column) {
        const semantic = inferMetricSemantics({
          column: plan.column,
          dataset: plan.dataset,
          schema,
          datasets,
        });
        plan = {
          ...plan,
          metricSemantics: semantic.type,
          unit: semantic.unit || inferUnitFromColumn(plan.column),
        };

        plan = enrichPlanMetricMeaning({
          plan,
          question: cleanQuestion,
          datasets,
          schema,
          reportContext:
            internalOptions?.report ||
            internalOptions?.reportTitle ||
            null,
        });
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

      if (plan?.route === "dataset") {
        const dataQuality = buildDataQualitySummary({ datasets, plan });
        result = {
          ...result,
          unit: result?.unit || plan?.unit || null,
          displayUnit: result?.displayUnit || plan?.displayUnit || null,
          denominatorUnit: result?.denominatorUnit || plan?.denominatorUnit || null,
          metricMeaning: result?.metricMeaning || plan?.metricMeaning || null,
          metricSemantics: result?.metricSemantics || plan?.metricSemantics || null,
          metricSource: result?.metricSource || plan?.metricSource || null,
          dataQuality: result?.dataQuality || dataQuality || null,
        };
      }

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

    updateConversation(
      sessionId,
      {
        question:
          cleanQuestion,
        plan:
          directFilteredAggregatePlan,
        result:
          directFilteredAggregateResult,
      }
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

    const rawDirectFilteredFieldResult =
      await executeResolvedPlan(
        directFilteredFieldPlan
      );

    /**
     * Direct single-field lookups are value-set questions, not row dumps.
     * Collapse duplicate rows before storing the conversational result and
     * before formatting the answer.
     */
    const directFilteredFieldResult =
      normalizeDirectSingleFieldResult({
        plan:
          directFilteredFieldPlan,
        result:
          rawDirectFilteredFieldResult,
      });

    updateConversation(
      sessionId,
      {
        question:
          cleanQuestion,
        plan:
          directFilteredFieldPlan,
        result:
          directFilteredFieldResult,
      }
    );

    const directSingleFieldAnswer =
      buildVerifiedListAnswer({
        result:
          directFilteredFieldResult,
        subjectColumn:
          directFilteredFieldPlan
            .column,
      });

    return {
      ...directFilteredFieldResult,

      answer:
        directSingleFieldAnswer,

      plannerSource:
        "conversation-local",
    };
  }



  // ========================================================
  // EXPLICIT REFERENTIAL FIELD FOLLOW-UP — PLANNER INDEPENDENT
  // ========================================================
  //
  // Example:
  //   "How many associations are in Pangasinan?"
  //   "what municipalities are they from?"
  //
  // The current question's requested LIVE schema field wins, while the
  // previous VERIFIED filters remain the row scope. This prevents a planner
  // from returning an unrelated value column and merely using the requested
  // field as a label.
  //
  const explicitReferentialFieldPlan =
    buildExplicitReferentialFieldPlan({
      schema,
      context:
        conversationContext,
      question:
        cleanQuestion,
    });

  if (explicitReferentialFieldPlan) {
    if (
      process.env.NODE_ENV !==
        "production"
    ) {
      console.log(
        "Chatbot explicit referential-field plan:",
        JSON.stringify(
          explicitReferentialFieldPlan,
          null,
          2
        )
      );
    }

    const explicitReferentialFieldResult =
      await executeResolvedPlan(
        explicitReferentialFieldPlan
      );

    updateConversation(
      sessionId,
      {
        question:
          cleanQuestion,
        plan:
          explicitReferentialFieldPlan,
        result:
          explicitReferentialFieldResult,
      }
    );

    const semanticReferentialAnswer =
      (
        explicitReferentialFieldPlan.conversationalPairColumn &&
        shouldUseSemanticReferentialNarrative(
          cleanQuestion
        )
      )
        ? buildSemanticVerifiedAnswer({
            question:
              normalizeSemanticReferentialQuestion(
                cleanQuestion
              ) ||
              cleanQuestion,
            plan:
              explicitReferentialFieldPlan,
            result:
              explicitReferentialFieldResult,
          })
        : null;

    return {
      ...explicitReferentialFieldResult,
      answer:
        formatUserFacingAnswer(
          semanticReferentialAnswer ||
          buildContextAwareContinuousListAnswer({
            result:
              explicitReferentialFieldResult,
            subjectColumn:
              explicitReferentialFieldPlan.column,
            pairColumn:
              explicitReferentialFieldPlan.conversationalPairColumn ||
              null,
            context:
              conversationContext,
            preferScopeValue:
              false,
          })
        ),
      responseStyle:
        "natural",
      debugPlan:
        explicitReferentialFieldPlan,
      debugEntityChanges:
        [],
      plannerSource:
        "conversation",
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

  // ========================================================
  // EXPLICIT WORKSHEET SWITCH FOLLOW-UP
  // ========================================================
  //
  // A follow-up such as "what about <worksheet name>?" may be trying to
  // switch the active worksheet rather than match <worksheet name> as a
  // row value inside the PREVIOUS worksheet.
  //
  // Example shape (fully generic):
  //   previous dataset: "Sheet A"
  //   follow-up:        "what about Sheet B?"
  //
  // If Sheet B is an exact live worksheet name, preserve the previous
  // analytical/list intent and compatible filters, switch to Sheet B,
  // then infer any explicit filters from Sheet B's own live rows.
  //
  // No worksheet names or business values are hardcoded here.
  const explicitFollowUpWorksheet = (() => {
    if (!conversationContext?.isFollowUp) {
      return null;
    }

    const normalizedQuestion =
      normalizeText(cleanQuestion);

    if (!normalizedQuestion) {
      return null;
    }

    const candidates =
      (schema || [])
        .map((datasetSchema) =>
          datasetSchema?.name
        )
        .filter(Boolean)
        .map((name) => ({
          name,
          normalized:
            normalizeText(name),
        }))
        .filter((item) =>
          item.normalized &&
          (
            normalizedQuestion === item.normalized ||
            normalizedQuestion.includes(
              ` ${item.normalized} `
            ) ||
            normalizedQuestion.startsWith(
              `${item.normalized} `
            ) ||
            normalizedQuestion.endsWith(
              ` ${item.normalized}`
            ) ||
            normalizeFollowUpPhrase(cleanQuestion) ===
              item.normalized
          )
        )
        .sort(
          (a, b) =>
            b.normalized.length -
            a.normalized.length
        );

    return candidates[0]?.name || null;
  })();

  if (
    looksLikeSameQueryNewFilter &&
    explicitFollowUpWorksheet &&
    String(explicitFollowUpWorksheet) !==
      String(conversationContext.lastDataset || "")
  ) {
    const targetDataset =
      explicitFollowUpWorksheet;

    const targetRows =
      Array.isArray(datasets?.[targetDataset])
        ? datasets[targetDataset]
        : [];

    if (targetRows.length) {
      const previousPlan =
        conversationContext.lastPlan || {};

      // Keep only previous filters that can still match at least one row
      // in the newly selected worksheet. This automatically drops stale
      // worksheet-specific scope filters while preserving compatible
      // commodity/year/month/status/etc. filters.
      const compatibleInheritedFilters =
        Array.isArray(conversationContext.lastFilters)
          ? conversationContext.lastFilters
              .filter((filter) => {
                if (!filter?.column) {
                  return false;
                }

                return targetRows.some((row) =>
                  filterRowsBySimpleFilters(
                    [row],
                    [filter]
                  ).length > 0
                );
              })
              .map((filter) => ({
                ...filter,
                value:
                  Array.isArray(filter?.value)
                    ? [...filter.value]
                    : filter?.value,
              }))
          : [];

      const explicitlyMentionedFilters =
        inferCoherentFilters(
          targetRows,
          cleanQuestion
        );

      const replacementColumns =
        new Set(
          (Array.isArray(explicitlyMentionedFilters)
            ? explicitlyMentionedFilters
            : []
          )
            .map((filter) => filter?.column)
            .filter(Boolean)
        );

      const finalFilters = [
        ...compatibleInheritedFilters.filter(
          (filter) =>
            !replacementColumns.has(
              filter?.column
            )
        ),
        ...(Array.isArray(explicitlyMentionedFilters)
          ? explicitlyMentionedFilters
          : []
        ).map((filter) => ({
          ...filter,
          value:
            Array.isArray(filter?.value)
              ? [...filter.value]
              : filter?.value,
        })),
      ];

      const previousOperation =
        String(
          previousPlan.operation ||
          conversationContext.lastIntent ||
          ""
        )
          .trim()
          .toLowerCase();

      const rememberedSubject =
        inferRememberedSubjectColumn({
          schema,
          datasetName: targetDataset,
          previousQuestion:
            conversationContext.lastSubjectQuestion ||
            conversationContext.lastQuestion,
          context: conversationContext,
        }) ||
        previousPlan.column ||
        null;

      const operation =
        previousOperation ||
        (rememberedSubject
          ? "list"
          : "lookup");

      const worksheetSwitchPlan = {
        ...previousPlan,
        route: "dataset",
        dataset: targetDataset,
        operation,
        filters: finalFilters,
        filterGroups: [],
        filterGroupLogic: null,
        outputRequested: true,
        conversationalWorksheetSwitch: true,
      };

      if (
        operation === "list" &&
        rememberedSubject
      ) {
        worksheetSwitchPlan.column =
          rememberedSubject;
        worksheetSwitchPlan.labelColumn =
          rememberedSubject;
        worksheetSwitchPlan.selectColumns = [
          rememberedSubject,
        ];
        worksheetSwitchPlan.showAll = true;
        worksheetSwitchPlan.limit = Math.max(
          Number(previousPlan.limit) || 10,
          100
        );
      }

      const worksheetSwitchResult =
        await executeResolvedPlan(
          worksheetSwitchPlan
        );

      updateConversation(sessionId, {
        question: cleanQuestion,
        plan: worksheetSwitchPlan,
        result: worksheetSwitchResult,
      });

      return {
        ...worksheetSwitchResult,
        plannerSource: "conversation",
        conversationalWorksheetSwitch: true,
      };
    }
  }

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

        updateConversation(
          sessionId,
          {
            question:
              cleanQuestion,
            plan:
              sameQueryPlan,
            result:
              sameQueryResult,
          }
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

      updateConversation(
        sessionId,
        {
          question:
            cleanQuestion,
          plan:
            referentialListPlan,
          result:
            referentialListResult,
        }
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
          buildContextAwareContinuousListAnswer({
            result:
              referentialListResult,

            subjectColumn:
              rememberedSubject,

            context:
              conversationContext,

            preferScopeValue:
              true,
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

  const explicitCurrentColumns =
    findExplicitSchemaColumns({
      schema,
      question: cleanQuestion,
      preferredDataset:
        conversationContext?.lastDataset ||
        null,
    });

  const explicitCurrentGroupOverride =
    currentQuestionOverridesAnalyticalGroup({
      datasets,
      schema,
      question: cleanQuestion,
      previousGroupBy:
        verifiedMultiResultSet?.groupBy,
      preferredDataset:
        conversationContext?.lastDataset ||
        null,
    });

  const explicitSelfContainedAnalytics =
    explicitCurrentColumns.length > 0 &&
    isSelfContainedAnalyticalQuestion({
      schema,
      question: cleanQuestion,
    });

  // CURRENT question semantics always beat shortcuts over the previous
  // verified result array. If the user changes group, worksheet scope,
  // distributed scope, or any explicit filter/value, force normal planning
  // so compatible semantic memory can be merged safely instead of ranking
  // stale rows from the prior answer.
  const currentSemanticOverride =
    currentQuestionRequiresReplan({
      datasets,
      question: cleanQuestion,
      conversationContext: multiResultContext,
      explicitGroupOverride: explicitCurrentGroupOverride,
    });

  const looksLikeMultiResultAnalysis =
    verifiedMultiResultSet
      ?.count >= 3 &&
    !currentSemanticOverride.requiresReplan &&
    !explicitSelfContainedAnalytics &&
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
  // DISTRIBUTED MULTI-WORKSHEET ANALYTICAL FOLLOW-UP
  // ========================================================
  //
  // A previous cross-worksheet result may have dataset = null because it
  // represents ALL worksheets. Short continuations such as:
  //   "what about the lowest?"
  // must therefore inherit the verified distributed plan itself rather than
  // ask the user to choose one worksheet. This runs before Groq/local planning
  // so a planner failure cannot collapse the multi-worksheet context.
  //
  const distributedWorksheetFollowUp =
    buildDistributedWorksheetFollowUpResolution({
      datasets,
      schema,
      question: cleanQuestion,
      previousPlan:
        conversationContext?.lastPlan || null,
      previousSemanticPlan:
        conversationContext?.semanticPlan || null,
    });

  if (distributedWorksheetFollowUp) {
    updateConversation(sessionId, {
      question: cleanQuestion,
      plan: distributedWorksheetFollowUp.plan,
      result: distributedWorksheetFollowUp.result,
    });

    return {
      ...distributedWorksheetFollowUp.result,
      answer: formatUserFacingAnswer(
        buildSemanticVerifiedAnswer({
          question: cleanQuestion,
          plan: distributedWorksheetFollowUp.plan,
          result: distributedWorksheetFollowUp.result,
        }) || distributedWorksheetFollowUp.result?.answer
      ),
      debugPlan: distributedWorksheetFollowUp.plan,
      plannerSource: "conversation-multi-worksheet",
    };
  }


  // ========================================================
  // DETERMINISTIC CROSS-WORKSHEET GROUPED RANKING
  // ========================================================
  //
  // Handles questions that rank a shared row dimension ACROSS all same-schema
  // worksheets, e.g. "Which commodity had the highest average ...?". This is
  // different from ranking the worksheets themselves. A single explicitly
  // named worksheet still stays single-sheet.
  //
  const crossWorksheetGroupedRanking =
    buildCrossWorksheetGroupedRankingResolution({
      datasets,
      schema,
      question: cleanQuestion,
    });

  if (crossWorksheetGroupedRanking) {
    updateConversation(sessionId, {
      question: cleanQuestion,
      plan: crossWorksheetGroupedRanking.plan,
      result: crossWorksheetGroupedRanking.result,
    });

    return {
      ...crossWorksheetGroupedRanking.result,
      answer: formatUserFacingAnswer(
        buildSemanticVerifiedAnswer({
          question: cleanQuestion,
          plan: crossWorksheetGroupedRanking.plan,
          result: crossWorksheetGroupedRanking.result,
        }) || crossWorksheetGroupedRanking.result?.answer
      ),
      plannerSource: "deterministic-cross-worksheet-group-ranking",
    };
  }


  // ========================================================
  // DETERMINISTIC DISTRIBUTED MULTI-WORKSHEET QUERY
  // ========================================================
  //
  // Handles same-schema reports partitioned across worksheets when the user
  // explicitly asks for a result in EACH/EVERY/ALL partition (for example,
  // each province, every region, all branches, or each worksheet). The
  // partition field is discovered from the live schema/data; no worksheet or
  // business value is hardcoded. This runs before Groq/local planning so a
  // fallback cannot accidentally collapse a multi-worksheet request to one
  // arbitrary sheet.
  //
  const distributedWorksheetResolution =
    buildDistributedWorksheetResolution({
      datasets,
      schema,
      question: cleanQuestion,
    });

  if (distributedWorksheetResolution) {
    updateConversation(sessionId, {
      question: cleanQuestion,
      plan: distributedWorksheetResolution.plan,
      result: distributedWorksheetResolution.result,
    });

    return {
      ...distributedWorksheetResolution.result,
      answer: formatUserFacingAnswer(
        buildSemanticVerifiedAnswer({
          question: cleanQuestion,
          plan: distributedWorksheetResolution.plan,
          result: distributedWorksheetResolution.result,
        }) || distributedWorksheetResolution.result?.answer
      ),
      plannerSource: "deterministic-multi-worksheet",
    };
  }


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
  let groqReferentialRecovery = false;

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


  /**
   * ========================================================
   * REFERENTIAL PARAPHRASE SEMANTIC RECOVERY
   * ========================================================
   *
   * A follow-up may omit the actual schema field:
   *
   *   "Tell me what they produce."
   *   "Show what they provide."
   *   "Which things are they using?"
   *
   * The deterministic explicit-field resolver cannot select a column when the
   * field name itself is absent. If the normal Groq planner also fails to
   * return valid JSON, do ONE constrained semantic re-plan before falling back
   * to the generic local parser.
   *
   * This does not hardcode a worksheet, field, domain noun, or data value.
   * Groq still chooses only from the live schema, while conversation memory
   * supplies the verified referent/scope.
   */
  if (
    !groqPlan &&
    conversationContext?.isFollowUp === true &&
    normalizeSemanticReferentialQuestion(
      cleanQuestion
    )
  ) {
    try {
      const recoveryQuestion =
        [
          "This is a referential follow-up data question.",
          "Use the previous verified conversation subject and filters.",
          "Resolve the live schema field whose meaning best answers the user's action.",
          "Return a dataset lookup plan rather than a general explanation.",
          `User question: ${cleanQuestion}`,
        ].join(" ");

      groqPlan =
        await createSchemaAwarePlan({
          question:
            recoveryQuestion,
          schema,
          context:
            conversationContext,
          retrievalContext,
        });

      if (groqPlan) {
        groqReferentialRecovery =
          true;
      }
    } catch (recoveryError) {
      if (
        process.env.NODE_ENV !==
          "production"
      ) {
        console.warn(
          "Referential semantic recovery planner failed; continuing to local fallback:",
          recoveryError
        );
      }
    }
  }

  if (groqPlan) {
    groqPlan =
      recoverHighConfidenceAggregateClarification({
        datasets,
        schema,
        plan: groqPlan,
        question: cleanQuestion,
      });

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

    /**
     * Explicit worksheet names in the CURRENT question outrank a planner's
     * inherited/default worksheet choice. This is generic and is especially
     * important for reports whose worksheets share the same schema.
     */
    groqPlan =
      reconcileExplicitDatasetMention({
        plan: groqPlan,
        question: cleanQuestion,
        datasets,
        schema,
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
          groqReferentialRecovery
            ? "groq-referential-recovery"
            : "groq",
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
      recoverHighConfidenceAggregateClarification({
        datasets,
        schema,
        plan: localPlan,
        question: cleanQuestion,
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

    /**
     * V7.30 LOCAL FALLBACK HARDENING
     * Reconstruct high-confidence current-question meaning from live schema
     * and live row values when Groq planning is unavailable. This is generic:
     * no worksheet, province, metric, commodity, status, or business value is
     * hardcoded.
     */
    localPlan =
      hardenLocalPlan({
        plan: localPlan,
        question: cleanQuestion,
        datasets,
        schema,
        context: conversationContext,
      });

    /**
     * V7.33 STRONG LOCAL SEMANTIC RESOLVER
     *
     * When Groq is unavailable, independently scan every live worksheet and
     * score the CURRENT question against live schema names, worksheet names,
     * row structure, and explicit row-value filters.
     *
     * The current question wins. Previous conversation filters are inherited
     * only for genuinely referential wording and only when those filter
     * columns exist in the selected live worksheet.
     */
    const strongLocalSemanticPlan =
      resolveStrongLocalSemanticPlan({
        question:
          cleanQuestion,
        schema,
        datasets,
        context:
          conversationContext,
      });

    if (
      strongLocalSemanticPlan &&
      (
        localPlan?.route !==
          "dataset" ||
        !localPlan?.dataset ||
        !localPlan?.column ||
        Number(
          strongLocalSemanticPlan.localSemanticConfidence ||
          0
        ) >=
          Number(
            localPlan.localConfidence ||
            localPlan.confidence ||
            0
          )
      )
    ) {
      localPlan =
        strongLocalSemanticPlan;
    }

    /**
     * If Groq is unavailable and the current turn is an elliptical
     * referential follow-up, reuse the previous VERIFIED dataset/output field
     * when it is still valid in the live schema.
     *
     * Example pattern:
     *   explicit field turn -> "Tell me what they <action>."
     *
     * This allows the local fallback to remain useful during provider
     * rate limits instead of routing the question back to a general LLM call.
     */
    localPlan =
      recoverLocalReferentialPlanFromConversation({
        plan:
          localPlan,
        question:
          cleanQuestion,
        context:
          conversationContext,
        schema,
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

    // Local fallback must be deterministic AND self-aware. Attach component
    // confidence and refuse only critical unresolved plans rather than
    // confidently executing a guessed dataset/metric/group.
    const localConfidenceResolution = attachLocalConfidence({
      plan: localPlan,
      datasets,
      schema,
    });
    localPlan = localConfidenceResolution.plan;

    if (localConfidenceResolution.evaluation.critical &&
        localConfidenceResolution.evaluation.score < 0.55) {
      localPlan = {
        route: "clarify",
        question:
          "I could not confidently resolve the worksheet, metric, or grouping from that question. Could you be a little more specific?",
        confidence: localConfidenceResolution.evaluation.score,
        localConfidenceBreakdown: localConfidenceResolution.evaluation.breakdown,
        localConfidenceIssues: localConfidenceResolution.evaluation.issues,
      };
    }

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

    const semanticLocalListAnswer =
      String(
        localPlan.operation ||
        ""
      )
        .trim()
        .toLowerCase() ===
        "list"
        ? buildSemanticVerifiedAnswer({
            question:
              cleanQuestion,
            plan:
              localPlan,
            result,
          })
        : null;

    if (
      semanticLocalListAnswer
    ) {
      finalAnswer =
        semanticLocalListAnswer;
    }

    /**
     * Keep local-fallback response semantics consistent with the normal
     * conversational path. Paired lookups should use the deterministic
     * natural narrative rather than raw repeated "<label> - <value>" lines.
     * No external language-model call is required here.
     */
    if (
      String(
        localPlan.operation ||
        ""
      )
        .trim()
        .toLowerCase() ===
        "lookup" &&
      localPlan.column &&
      localPlan.labelColumn &&
      normalizeText(
        localPlan.column
      ) !==
      normalizeText(
        localPlan.labelColumn
      )
    ) {
      const semanticLocalAnswer =
        buildSemanticVerifiedAnswer({
          question:
            normalizeSemanticReferentialQuestion(
              cleanQuestion
            ) ||
            cleanQuestion,
          plan:
            localPlan,
          result,
        });

      if (
        semanticLocalAnswer
      ) {
        finalAnswer =
          semanticLocalAnswer;
      }
    }

    let oneToManyResolved =
      undefined;

    /**
     * Apply the same row-aware list rendering to local-fallback plans so
     * Groq availability does not change conversational output semantics.
     */
    if (
      !semanticLocalListAnswer &&
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
        isExternalLanguageServiceError(
          localError
        )
          ? (
              normalizeSemanticReferentialQuestion(
                cleanQuestion
              )
                ? "I couldn't resolve that follow-up locally from the available conversation context. Please mention the field you want, and I can answer it directly from the dataset."
                : "The language service is temporarily unavailable, and this question could not be completed locally. Please try again shortly."
            )
          : (
              localError.message ||
              "The chatbot could not process the question."
            ),
    };
  }

}

module.exports = {
  answerQuestion,
};
