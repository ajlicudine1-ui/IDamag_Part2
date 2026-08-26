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
    lastFilters: [],
    lastPlan: null,
    lastResult: null,

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