const {
  normalizeText,
  singularizeToken,
} = require("./utils");

const {
  compare,
  inferValueFilters,
} = require("./filterEngine");


const NON_GROUNDING_PHRASES = new Set([
  "all",
  "total",
  "average",
  "mean",
  "median",
  "minimum",
  "maximum",
  "highest",
  "lowest",
  "largest",
  "smallest",
  "most",
  "least",
  "records",
  "rows",
  "entries",
  "data",
  "dataset",
  "report",
]);

function normalizeTokens(value) {
  return normalizeText(
    value
  )
    .split(/\s+/)
    .map(
      (token) =>
        singularizeToken(
          token
        )
    )
    .filter(Boolean);
}

function columnPhraseGrounded(
  phrase,
  columns
) {
  const phraseTokens =
    normalizeTokens(
      phrase
    );

  if (
    !phraseTokens.length
  ) {
    return false;
  }

  return (
    columns || []
  ).some(
    (column) => {
      const columnTokens =
        normalizeTokens(
          column
        );

      if (
        !columnTokens.length
      ) {
        return false;
      }

      return phraseTokens.every(
        (token) =>
          columnTokens.includes(
            token
          )
      ) ||
      columnTokens.every(
        (token) =>
          phraseTokens.includes(
            token
          )
      );
    }
  );
}

function filterMatchesRows(
  rows,
  filter
) {
  if (
    !filter ||
    !filter.column
  ) {
    return false;
  }

  const operator =
    normalizeText(
      filter.operator ||
      "equals"
    );

  if (
    [
      "empty",
      "not_empty",
      "greater_than",
      "greater_or_equal",
      "less_than",
      "less_or_equal",
    ].includes(
      operator
    )
  ) {
    return true;
  }

  const values =
    operator ===
      "in" ||
    operator ===
      "not_in"
      ? (
          Array.isArray(
            filter.value
          )
            ? filter.value
            : [
                filter.value,
              ]
        )
      : [
          filter.value,
        ];

  if (
    operator ===
      "not_equals" ||
    operator ===
      "not_in"
  ) {
    // The excluded value still needs to be a real live value.
    return values.every(
      (value) =>
        rows.some(
          (row) =>
            compare(
              row?.[
                filter.column
              ],
              value,
              "equals"
            )
        )
    );
  }

  return values.every(
    (value) =>
      rows.some(
        (row) =>
          compare(
            row?.[
              filter.column
            ],
            value,
            operator ===
              "in"
              ? "equals"
              : operator
          )
      )
  );
}

function flattenPlanFilters(plan) {
  const filters = [];

  if (
    Array.isArray(
      plan?.filters
    )
  ) {
    filters.push(
      ...plan.filters
    );
  }

  if (
    Array.isArray(
      plan?.filterGroups
    )
  ) {
    for (
      const group of
      plan.filterGroups
    ) {
      if (
        Array.isArray(
          group?.filters
        )
      ) {
        filters.push(
          ...group.filters
        );
      }
    }
  }

  return filters;
}

function filterIdentity(filter) {
  return [
    normalizeText(
      filter?.column
    ),
    normalizeText(
      filter?.operator ||
      "equals"
    ),
    Array.isArray(
      filter?.value
    )
      ? filter.value
          .map(
            (value) =>
              normalizeText(
                value
              )
          )
          .sort()
          .join("|")
      : normalizeText(
          filter?.value
        ),
  ].join("::");
}

function planContainsGroundedFilter(
  plan,
  groundedFilter
) {
  const planFilters =
    flattenPlanFilters(
      plan
    );

  const targetColumn =
    normalizeText(
      groundedFilter?.column
    );

  const targetValue =
    normalizeText(
      groundedFilter?.value
    );

  return planFilters.some(
    (filter) => {
      if (
        normalizeText(
          filter?.column
        ) !==
        targetColumn
      ) {
        return false;
      }

      if (
        Array.isArray(
          filter?.value
        )
      ) {
        return filter.value.some(
          (value) =>
            normalizeText(
              value
            ) ===
            targetValue
        );
      }

      return (
        normalizeText(
          filter?.value
        ) ===
        targetValue
      );
    }
  );
}

function stripReferentialGroundingTail(phrase) {
  return String(phrase || "")
    .replace(
      /\s+\b(?:among|for|of|within|from)\s+(?:them|those|these|that|this|the same|the previous|the above)\b.*$/i,
      ""
    )
    .replace(
      /\s+\b(?:among|for|of|within)\s+(?:the|these|those)\s+(?:ones|records|rows|entries|results|associations|items)\b.*$/i,
      ""
    )
    .trim();
}

function extractExplicitGroundingPhrases(
  question
) {
  const source =
    String(question || "")
      .replace(
        /[?!]+$/g,
        ""
      )
      .trim();

  const phrases = [];

  const quoted =
    source.matchAll(
      /["']([^"']{2,80})["']/g
    );

  for (const match of quoted) {
    if (
      match?.[1]
    ) {
      phrases.push(
        match[1].trim()
      );
    }
  }

  const normalized =
    normalizeText(
      source
    );

  /**
   * "how many kilograms of fertilizer were released"
   * "total quantity of organic fertilizer"
   */
  const ofMatch =
    normalized.match(
      /\bof\s+(.+?)(?=\s+\b(?:was|were|is|are|has|have|had|released|distributed|provided|received|produced|given|issued|allocated|delivered|supplied|by|in|from|under|for)\b|$)/
    );

  if (
    ofMatch?.[1]
  ) {
    phrases.push(
      ofMatch[1].trim()
    );
  }

  /**
   * Explicit scoped value at the end of a request:
   *   "associations in Phase 2"
   *   "employees under Finance"
   *   "projects with status Completed" is normally caught as a live value
   * through inferValueFilters, so this rule focuses on prepositional tails.
   */
  const scopeMatch =
    normalized.match(
      /\b(?:in|under|within|from)\s+(.+)$/
    );

  if (
    scopeMatch?.[1]
  ) {
    phrases.push(
      scopeMatch[1]
        .replace(
          /[?.!]+$/g,
          ""
        )
        .trim()
    );
  }

  return [
    ...new Set(
      phrases
        .map(
          (phrase) =>
            stripReferentialGroundingTail(
              phrase
            )
        )
        .filter(
          (phrase) =>
            phrase.length >=
              2 &&
            !NON_GROUNDING_PHRASES.has(
              normalizeText(
                phrase
              )
            )
        )
    ),
  ];
}

function phraseGrounded({
  phrase,
  rows,
  columns,
}) {
  if (
    !phrase
  ) {
    return true;
  }

  if (
    columnPhraseGrounded(
      phrase,
      columns
    )
  ) {
    return true;
  }

  const inferred =
    inferValueFilters(
      rows,
      phrase,
      []
    );

  if (
    Array.isArray(
      inferred
    ) &&
    inferred.length
  ) {
    return true;
  }

  const phraseText =
    normalizeText(
      phrase
    );

  return rows.some(
    (row) =>
      columns.some(
        (column) => {
          const value =
            normalizeText(
              row?.[
                column
              ]
            );

          return (
            value &&
            (
              value ===
                phraseText ||
              value.includes(
                phraseText
              ) ||
              phraseText.includes(
                value
              )
            )
          );
        }
      )
  );
}

function enforceUniversalGrounding({
  plan,
  question,
  rows,
  columns,
} = {}) {
  if (
    !plan ||
    plan.route !==
      "dataset" ||
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return {
      valid:
        true,
      plan,
    };
  }

  const actualColumns =
    Array.isArray(columns)
      ? columns
      : Object.keys(
          rows[0] ||
          {}
        );

  const planFilters =
    flattenPlanFilters(
      plan
    );

  const invalidFilters =
    planFilters.filter(
      (filter) => {
        if (
          !actualColumns.some(
            (column) =>
              normalizeText(
                column
              ) ===
              normalizeText(
                filter?.column
              )
          )
        ) {
          return true;
        }

        return !filterMatchesRows(
          rows,
          filter
        );
      }
    );

  if (
    invalidFilters.length
  ) {
    return {
      valid:
        false,
      plan: {
        route:
          "clarify",
        question:
          "I could not ground one or more requested filter values in the live dataset. Please use a value that exists in the current report.",
        localGroundingFailed:
          true,
        universalGroundingFailed:
          true,
        ungroundedFilters:
          invalidFilters,
      },
      reason:
        "invalid_filter_value",
    };
  }

  /**
   * If the current question explicitly mentions a real live value, it must
   * appear in the executable plan. This prevents planners from silently
   * dropping a requested condition.
   */
  const groundedMentionFilters =
    inferValueFilters(
      rows,
      question,
      []
    );

  const omittedGroundedFilters =
    groundedMentionFilters
      .filter(
        (filter) =>
          !planContainsGroundedFilter(
            plan,
            filter
          )
      );

  if (
    omittedGroundedFilters.length &&
    !plan?.complexFilterResolved
  ) {
    return {
      valid:
        true,
      plan: {
        ...plan,
        filters: [
          ...(
            Array.isArray(
              plan.filters
            )
              ? plan.filters
              : []
          ),
          ...omittedGroundedFilters,
        ],
        universalGroundingRepaired:
          true,
      },
    };
  }

  /**
   * Catch explicit object/scope phrases that do not map to either a live
   * column concept or a live row value. This handles cases such as
   * "kilograms of fertilizer" when the dataset contains no fertilizer.
   */
  const explicitPhrases =
    extractExplicitGroundingPhrases(
      question
    );

  const ungroundedPhrases =
    explicitPhrases.filter(
      (phrase) =>
        !phraseGrounded({
          phrase,
          rows,
          columns:
            actualColumns,
        })
    );

  if (
    ungroundedPhrases.length
  ) {
    return {
      valid:
        false,
      plan: {
        route:
          "clarify",
        question:
          `I could not find a live dataset value or field matching "${ungroundedPhrases[0]}". Please specify a value available in the current report.`,
        localGroundingFailed:
          true,
        universalGroundingFailed:
          true,
        ungroundedPhrases,
      },
      reason:
        "ungrounded_explicit_phrase",
    };
  }

  return {
    valid:
      true,
    plan,
  };
}


module.exports = {
  stripReferentialGroundingTail,
  extractExplicitGroundingPhrases,
  phraseGrounded,
  filterMatchesRows,
  flattenPlanFilters,
  enforceUniversalGrounding,
};
