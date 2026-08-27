const conversations = new Map();

const MAX_HISTORY = 10;
const MAX_RECENT_RESULTS = 5;

/**
 * Create a fresh conversation state.
 */
function createEmptyContext() {
  return {
    lastEntity: null,
    lastDataset: null,
    lastIntent: null,
    lastMetric: null,

    /**
     * Generic entity/output field remembered from the previous
     * successful dataset question.
     *
     * Example:
     *   "How many associations are in La Union?"
     *   -> subject column = "Name of Association"
     *
     * Then:
     *   "What are those?"
     *   -> list that same subject column using the same filters.
     *
     * This is schema-driven; no dataset or column name is hardcoded.
     */
    lastSubjectColumn: null,

    lastFilters: [],
    lastPlan: null,
    lastResult: null,

    /**
     * Last VERIFIED analytical state.
     *
     * This is intentionally structured rather than prose so later
     * questions can transform only one part of the prior analysis:
     *
     * average -> total
     * top 1   -> top 5
     * highest -> lowest
     * metric A -> metric B
     */
    analyticalContext: null,

    // Used for comparison follow-ups.
    recentResults: [],

    history: [],
  };
}

/**
 * Get conversation state.
 */
function getConversation(
  sessionId = "default"
) {
  if (
    !conversations.has(
      sessionId
    )
  ) {
    conversations.set(
      sessionId,
      createEmptyContext()
    );
  }

  return conversations.get(
    sessionId
  );
}

/**
 * Determine whether a question depends on
 * something previously discussed.
 */
function isFollowUpQuestion(
  question
) {
  const text = String(
    question || ""
  )
    .toLowerCase()
    .trim();

  if (!text) {
    return false;
  }

  const patterns = [
    /^how about\b/i,
    /^what about\b/i,
    /^and\b/i,
    /^also\b/i,
    /^then\b/i,

    /\bhis\b/i,
    /\bher\b/i,
    /\btheir\b/i,
    /\bits\b/i,

    /\bhim\b/i,
    /\bthem\b/i,

    // Plural references to previously returned results.
    /\bthose\b/i,
    /\bthese\b/i,
    /\bthe two\b/i,

    /\bthose persons?\b/i,
    /\bthose employees?\b/i,
    /\bthose people\b/i,
    /\bthose records?\b/i,
    /\bthose rows?\b/i,
    /\bthose municipalities\b/i,
    /\bthose provinces\b/i,
    /\bthose projects?\b/i,
    /\bthose offices?\b/i,
    /\bthose divisions?\b/i,
    /\bthose associations?\b/i,
    /\bthose farmers?\b/i,

    /\bthat person\b/i,
    /\bthat farmer\b/i,
    /\bthat association\b/i,
    /\bthat municipality\b/i,
    /\bthat province\b/i,

    /\bthe same\b/i,
    /\bsame one\b/i,

    /^what(?:'s| is) the total\b/i,
    /^what(?:'s| is) the average\b/i,
    /^what(?:'s| is) the highest\b/i,
    /^what(?:'s| is) the lowest\b/i,

    /^what about the total\b/i,
    /^how about the total\b/i,
    /^what about the average\b/i,
    /^how about the average\b/i,
    /^what about the count\b/i,
    /^how about the count\b/i,

    /^(?:show|give|list)\s+(?:me\s+)?(?:the\s+)?(?:top|bottom)\s+\d{1,3}\b/i,
    /\bsecond\s+(?:highest|lowest)\b/i,
    /\b(?:top|bottom)\s+\d{1,3}\s+instead\b/i,
    /\bwhat percentage (?:higher|lower)\b/i,
    /\bwhat percent (?:higher|lower)\b/i,
    /\bpercentage difference\b/i,
    /\bpercent(?:age)? (?:higher|lower)\b/i,
    /\bhow many percent (?:higher|lower)\b/i,

    /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:highest|lowest|largest|smallest)\b/i,
    /\b\d{1,2}(?:st|nd|rd|th)\s+(?:highest|lowest|largest|smallest)\b/i,

    // ======================================================
    // COMPARISON FOLLOW-UPS
    // ======================================================

    /\bwhich (?:one )?is higher\b/i,
    /\bwhich (?:one )?is lower\b/i,

    /\bwho (?:has|have) (?:the )?higher\b/i,
    /\bwho (?:has|have) (?:the )?lower\b/i,

    /\bwhat(?:'s| is) the difference\b/i,

    /\bhow much (?:higher|lower|more|less)\b/i,

    /\bcompare (?:them|those|the two)\b/i,

    /\bbetween (?:them|those|the two)\b/i,
  ];

  return patterns.some(
    (pattern) =>
      pattern.test(text)
  );
}

/**
 * Extract the most useful entity/filter
 * from a query plan.
 *
 * Example:
 *
 * [
 *   {
 *     column: "Farmer",
 *     operator: "equals",
 *     value: "Aaron"
 *   }
 * ]
 */
function extractPrimaryEntity(
  filters
) {
  if (
    !Array.isArray(
      filters
    )
  ) {
    return null;
  }

  /**
   * Prefer equality filters because they
   * usually identify a specific entity.
   */
  const equalityFilter =
    filters.find(
      (filter) =>
        filter &&
        filter.column &&
        filter.value !==
          undefined &&
        filter.value !== null &&
        String(
          filter.operator ||
            "equals"
        ).toLowerCase() ===
          "equals"
    );

  if (equalityFilter) {
    return {
      column:
        equalityFilter.column,

      value:
        equalityFilter.value,

      operator:
        equalityFilter.operator ||
        "equals",
    };
  }

  /**
   * Otherwise use the first valid filter.
   */
  const firstFilter =
    filters.find(
      (filter) =>
        filter &&
        filter.column &&
        filter.value !==
          undefined &&
        filter.value !== null
    );

  if (!firstFilter) {
    return null;
  }

  return {
    column:
      firstFilter.column,

    value:
      firstFilter.value,

    operator:
      firstFilter.operator ||
      "equals",
  };
}

/**
 * Determine the metric/output field from
 * a structured query plan.
 */
function extractMetric(
  plan
) {
  if (!plan) {
    return null;
  }

  if (plan.column) {
    return plan.column;
  }

  if (
    Array.isArray(
      plan.selectColumns
    ) &&
    plan.selectColumns.length
  ) {
    return [
      ...plan.selectColumns,
    ];
  }

  if (plan.groupBy) {
    return plan.groupBy;
  }

  return null;
}


/**
 * Clone nested planner filter groups.
 *
 * Multi-row conversational follow-ups reuse these filters, so
 * conversation memory must not retain mutable references to a plan
 * that may later be normalized or entity-resolved in place.
 */
function cloneFilterGroups(
  filterGroups
) {
  return Array.isArray(
    filterGroups
  )
    ? filterGroups.map(
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
    : [];
}


/**
 * Save a compact VERIFIED result for
 * future comparison questions.
 *
 * Example:
 *
 * Roberto
 * ACTUAL SALARY
 * 167129
 *
 * Vener
 * ACTUAL SALARY
 * 148940
 *
 * Then:
 *
 * "Who has the higher salary?"
 */
function addRecentResult(
  context,
  {
    question,
    plan,
    result,
  }
) {
  if (
    !plan ||
    !result ||
    result.success === false
  ) {
    return;
  }

  /**
   * Only executed dataset questions should
   * be used for analytical comparisons.
   */
  if (
    plan.route !==
      "dataset"
  ) {
    return;
  }

  const entity =
    extractPrimaryEntity(
      plan.filters
    );

  const metric =
    extractMetric(plan);

  const entry = {
    question,

    dataset:
      plan.dataset || null,

    entity:
      entity
        ? {
            ...entity,
          }
        : null,

    metric:
      Array.isArray(metric)
        ? [...metric]
        : metric,

    plan: {
      ...plan,

      filters:
        Array.isArray(
          plan.filters
        )
          ? plan.filters.map(
              (filter) => ({
                ...filter,
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

      filterGroups:
        cloneFilterGroups(
          plan.filterGroups
        ),
    },

    /**
     * IMPORTANT:
     * This must be the VERIFIED JavaScript
     * result, not Groq-generated prose.
     */
    result,

    timestamp:
      Date.now(),
  };

  context.recentResults.push(
    entry
  );

  if (
    context.recentResults
      .length >
    MAX_RECENT_RESULTS
  ) {
    context.recentResults =
      context.recentResults.slice(
        -MAX_RECENT_RESULTS
      );
  }
}


/**
 * ==========================================================
 * VERIFIED ANALYTICAL CONTEXT
 * ==========================================================
 *
 * Keep only execution-relevant structured state.
 * No Groq prose is stored here.
 */

function cloneFilters(
  filters
) {
  return Array.isArray(filters)
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
}


function isAnalyticalOperation(
  operation
) {
  return new Set([
    "sum",
    "average",
    "median",
    "minimum",
    "maximum",

    "group_sum",
    "group_average",
    "group_minimum",
    "group_maximum",
    "group_count",

    "rank_rows",
    "rank_groups",
  ]).has(
    String(
      operation || ""
    )
      .trim()
      .toLowerCase()
  );
}


function buildAnalyticalContext({
  question,
  plan,
  result,
}) {
  if (
    !plan ||
    !result ||
    result.success === false ||
    plan.route !== "dataset" ||
    !isAnalyticalOperation(
      result.operation ||
      plan.operation
    )
  ) {
    return null;
  }

  const compactResults =
    Array.isArray(
      result.results
    )
      ? result.results
          .slice(0, 100)
          .map(
            (item) => {
              if (
                !item ||
                typeof item !==
                  "object"
              ) {
                return item;
              }

              return {
                label:
                  item.label ??
                  null,

                value:
                  item.value ??
                  null,

                recordsUsed:
                  item.recordsUsed ??
                  null,
              };
            }
          )
      : [];

  return {
    question:
      question || null,

    dataset:
      plan.dataset ||
      result.dataset ||
      null,

    operation:
      result.operation ||
      plan.operation ||
      null,

    column:
      result.column ||
      plan.column ||
      null,

    labelColumn:
      result.labelColumn ||
      plan.labelColumn ||
      null,

    groupBy:
      result.groupBy ||
      plan.groupBy ||
      null,

    aggregation:
      result.aggregation ||
      plan.aggregation ||
      null,

    direction:
      result.direction ||
      plan.direction ||
      null,

    filters:
      cloneFilters(
        plan.filters ||
        result.filters
      ),

    filterGroups:
      cloneFilterGroups(
        plan.filterGroups
      ),

    filterGroupLogic:
      plan.filterGroupLogic ||
      null,

    selectColumns:
      Array.isArray(
        plan.selectColumns
      )
        ? [
            ...plan.selectColumns,
          ]
        : [],

    limit:
      Number.isInteger(
        Number(plan.limit)
      )
        ? Number(plan.limit)
        : null,

    showAll:
      plan.showAll === true,

    results:
      compactResults,

    value:
      result.value ??
      null,

    recordsUsed:
      result.recordsUsed ??
      null,

    timestamp:
      Date.now(),
  };
}


/**
 * Update conversation after a successfully
 * planned/executed question.
 */
function updateConversation(
  sessionId = "default",
  {
    question = null,
    plan = null,
    result = null,
  } = {}
) {
  const context =
    getConversation(
      sessionId
    );

  if (plan) {
    if (plan.dataset) {
      context.lastDataset =
        plan.dataset;
    }

    if (plan.operation) {
      context.lastIntent =
        plan.operation;
    } else if (
      plan.intent
    ) {
      context.lastIntent =
        plan.intent;
    }

    const metric =
      extractMetric(plan);

    if (metric) {
      context.lastMetric =
        metric;
    }

    /**
     * Remember the concrete subject/output field independently from
     * the operation. This is especially important for:
     *
     *   count -> "what are those?"
     *   count -> "show them"
     *   distinct count -> "list those"
     *
     * Prefer the real plan.column. Otherwise use a single selected
     * output column. We intentionally do not guess a field here.
     */
    const operation =
      String(
        plan.operation ||
        plan.intent ||
        ""
      )
        .trim()
        .toLowerCase();

    const singleSelectedColumn =
      Array.isArray(
        plan.selectColumns
      ) &&
      plan.selectColumns.length === 1
        ? plan.selectColumns[0]
        : null;

    const subjectCandidate =
      plan.column ||
      singleSelectedColumn ||
      null;

    if (
      subjectCandidate &&
      [
        "list",
        "lookup",
        "non_empty_count",
        "distinct_count",
        "count",
        "group_count",
      ].includes(operation)
    ) {
      context.lastSubjectColumn =
        subjectCandidate;
    }

    /**
     * Groq filters are arrays.
     */
    if (
      Array.isArray(
        plan.filters
      )
    ) {
      context.lastFilters =
        plan.filters.map(
          (filter) => ({
            ...filter,
          })
        );

      const entity =
        extractPrimaryEntity(
          plan.filters
        );

      if (entity) {
        context.lastEntity =
          entity;
      }
    }

    context.lastPlan = {
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

      filterGroups:
        cloneFilterGroups(
          plan.filterGroups
        ),
    };
  }

  if (
    result !== undefined
  ) {
    context.lastResult =
      result;
  }

  /**
   * Save the latest VERIFIED analytical state independently from
   * ordinary lookups. A later lookup such as "who are those people?"
   * must not erase the last analytical calculation.
   */
  if (
    question &&
    plan &&
    result
  ) {
    const analyticalContext =
      buildAnalyticalContext({
        question,
        plan,
        result,
      });

    if (analyticalContext) {
      context.analyticalContext =
        analyticalContext;
    }
  }

  // ========================================================
  // SAVE VERIFIED RESULT FOR FUTURE COMPARISONS
  // ========================================================

  if (
    question &&
    plan &&
    result
  ) {
    addRecentResult(
      context,
      {
        question,
        plan,
        result,
      }
    );
  }

  // ========================================================
  // NORMAL CONVERSATION HISTORY
  // ========================================================

  if (question) {
    context.history.push({
      question,
      plan,
      result,

      timestamp:
        Date.now(),
    });

    if (
      context.history.length >
      MAX_HISTORY
    ) {
      context.history =
        context.history.slice(
          -MAX_HISTORY
        );
    }
  }

  return context;
}

/**
 * Get context that may be useful for
 * interpreting the next question.
 */
function getRelevantContext(
  sessionId = "default",
  question
) {
  const context =
    getConversation(
      sessionId
    );

  const isFollowUp =
    isFollowUpQuestion(
      question
    );

  return {
    isFollowUp,

    lastEntity:
      context.lastEntity,

    lastDataset:
      context.lastDataset,

    lastIntent:
      context.lastIntent,

    lastMetric:
      context.lastMetric,

    lastSubjectColumn:
      context.lastSubjectColumn,

    lastFilters:
      context.lastFilters,

    lastPlan:
      isFollowUp
        ? context.lastPlan
        : null,

    lastResult:
      isFollowUp
        ? context.lastResult
        : null,

    analyticalContext:
      isFollowUp
        ? context.analyticalContext
        : null,

    /**
     * Used by Step 10.
     *
     * Only expose recent results when the
     * current question looks conversational.
     */
    recentResults:
      isFollowUp
        ? context.recentResults.slice(
            -MAX_RECENT_RESULTS
          )
        : [],
  };
}

/**
 * Get all recent VERIFIED results.
 *
 * Useful for comparisonEngine.js.
 */
function getRecentResults(
  sessionId = "default"
) {
  const context =
    getConversation(
      sessionId
    );

  return [
    ...context.recentResults,
  ];
}

/**
 * Get recent conversation history.
 */
function getHistory(
  sessionId = "default"
) {
  const context =
    getConversation(
      sessionId
    );

  return [
    ...context.history,
  ];
}

/**
 * Clear one conversation.
 */
function clearConversation(
  sessionId = "default"
) {
  conversations.delete(
    sessionId
  );
}

/**
 * Clear every conversation.
 */
function clearAllConversations() {
  conversations.clear();
}

module.exports = {
  getConversation,
  updateConversation,
  getRelevantContext,
  getRecentResults,
  getHistory,
  isFollowUpQuestion,
  clearConversation,
  clearAllConversations,
};