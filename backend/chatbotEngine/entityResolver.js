const {
  similarity,
  normalizeText,
} = require("./utils");

const {
  getColumns,
} = require("./utils");

/**
 * ENTITY / VALUE RESOLVER
 * -----------------------
 *
 * Resolves user-provided values against ACTUAL
 * values found in the currently loaded datasets.
 *
 * Example:
 *
 * "Roberto Peralez"
 * -> "ROBERTO PERALES"
 *
 * "vener dilig"
 * -> "VENER DLLIG"
 *
 * "pmed"
 * -> "PMED"
 *
 * It searches across MULTIPLE datasets.
 */

function normalizeValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Determine whether a column is likely to contain a PERSON name.
 *
 * This is intentionally conservative so fields such as
 * "Project Name" or "Office Name" are NOT treated as person names.
 */
function isLikelyPersonColumn(column) {
  const normalized =
    normalizeValue(column);

  if (!normalized) {
    return false;
  }

  if (
    normalized === "name" ||
    normalized === "full name" ||
    normalized === "fullname" ||
    normalized === "first name" ||
    normalized === "given name" ||
    normalized === "middle name" ||
    normalized === "last name" ||
    normalized === "surname"
  ) {
    return true;
  }

  return /^(employee|personnel|staff|respondent|beneficiary|farmer|fisherfolk|client|recipient|owner|proponent)( full)? name$/.test(
    normalized
  );
}

/**
 * Greedily match requested name tokens to distinct actual-name tokens.
 *
 * This keeps name order flexible:
 * "Doris Joy Garcia" can match "GARCIA, DORIS JOY".
 *
 * It also tolerates small spelling differences:
 * "Roberto Peralez" can match "PERALES, ROBERTO TAN".
 */
function getPersonTokenMatch(
  requestedValue,
  actualValue
) {
  const requestedTokens =
    normalizeValue(requestedValue)
      .split(/\s+/)
      .filter(Boolean);

  const actualTokens =
    normalizeValue(actualValue)
      .split(/\s+/)
      .filter(Boolean);

  if (
    !requestedTokens.length ||
    !actualTokens.length
  ) {
    return {
      requestedTokens,
      actualTokens,
      matchedScores: [],
      strongMatches: 0,
      exactMatches: 0,
      averageScore: 0,
    };
  }

  const unusedActualIndexes =
    new Set(
      actualTokens.map(
        (_, index) => index
      )
    );

  const matchedScores = [];
  let exactMatches = 0;

  for (
    const requestedToken of
    requestedTokens
  ) {
    let bestIndex = null;
    let bestScore = 0;

    for (
      const index of
      unusedActualIndexes
    ) {
      const actualToken =
        actualTokens[index];

      const score =
        requestedToken === actualToken
          ? 1
          : similarity(
              requestedToken,
              actualToken
            );

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex !== null) {
      unusedActualIndexes.delete(
        bestIndex
      );

      matchedScores.push(
        bestScore
      );

      if (bestScore === 1) {
        exactMatches += 1;
      }
    } else {
      matchedScores.push(0);
    }
  }

  const strongMatches =
    matchedScores.filter(
      (score) => score >= 0.82
    ).length;

  const averageScore =
    matchedScores.reduce(
      (total, score) =>
        total + score,
      0
    ) /
    Math.max(
      1,
      requestedTokens.length
    );

  return {
    requestedTokens,
    actualTokens,
    matchedScores,
    strongMatches,
    exactMatches,
    averageScore,
  };
}

/**
 * Strict person-name score.
 *
 * Most importantly, a multi-word requested person cannot resolve
 * from only ONE shared token. This prevents:
 *
 * "Doris Joy Garcia"
 * from accidentally resolving to another person containing "Joy".
 */
function scorePersonNameMatch(
  requestedValue,
  actualValue
) {
  const requested =
    normalizeValue(
      requestedValue
    );

  const actual =
    normalizeValue(
      actualValue
    );

  if (!requested || !actual) {
    return 0;
  }

  if (requested === actual) {
    return 6;
  }

  const match =
    getPersonTokenMatch(
      requestedValue,
      actualValue
    );

  const requestedCount =
    match.requestedTokens.length;

  /**
   * Single-token person searches still support a typo, but a
   * partial token does not receive the old containment bonus.
   */
  if (requestedCount === 1) {
    const best =
      match.matchedScores[0] || 0;

    if (best < 0.86) {
      return 0;
    }

    return 3.2 + best;
  }

  /**
   * A multi-word person must match at least two strong tokens and
   * at least two-thirds of the requested name tokens.
   */
  const minimumStrongMatches =
    Math.max(
      2,
      Math.ceil(
        requestedCount * 0.67
      )
    );

  if (
    match.strongMatches <
      minimumStrongMatches
  ) {
    return 0;
  }

  if (match.averageScore < 0.78) {
    return 0;
  }

  const allRequestedTokensStrong =
    match.strongMatches ===
    requestedCount;

  const exactCoverage =
    match.exactMatches /
    Math.max(1, requestedCount);

  if (allRequestedTokensStrong) {
    return (
      4.2 +
      match.averageScore +
      exactCoverage
    );
  }

  return (
    3.2 +
    match.averageScore +
    exactCoverage
  );
}

/**
 * Produce a compact unique list of actual values
 * from one column.
 */
function getColumnValues(
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

    if (!display) {
      continue;
    }

    const key =
      normalizeValue(display);

    if (
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

/**
 * Score how closely a requested value matches
 * an actual dataset value.
 */
function scoreValueMatch(
  requestedValue,
  actualValue,
  {
    column = null,
  } = {}
) {
  const requested =
    normalizeValue(
      requestedValue
    );

  const actual =
    normalizeValue(
      actualValue
    );

  if (
    !requested ||
    !actual
  ) {
    return 0;
  }

  /**
   * Person-name columns use stricter token-aware matching.
   * This prevents a full name from resolving because of one
   * shared first/middle/last-name token.
   */
  if (
    isLikelyPersonColumn(column)
  ) {
    return scorePersonNameMatch(
      requestedValue,
      actualValue
    );
  }

  /**
   * Exact normalized match.
   */
  if (
    requested === actual
  ) {
    return 4;
  }

  /**
   * One phrase contains the other.
   *
   * Useful for:
   * "Roberto Perales"
   * vs
   * "PERALES, ROBERTO TAN"
   */
  let containmentBonus = 0;

  if (
    requested.includes(actual) ||
    actual.includes(requested)
  ) {
    containmentBonus = 1.3;
  }

  const requestedTokens =
    requested
      .split(/\s+/)
      .filter(Boolean);

  const actualTokens =
    actual
      .split(/\s+/)
      .filter(Boolean);

  const requestedSet =
    new Set(requestedTokens);

  const actualSet =
    new Set(actualTokens);

  let overlap = 0;

  for (
    const token of
    requestedSet
  ) {
    if (
      actualSet.has(token)
    ) {
      overlap += 1;
    }
  }

  const tokenCoverage =
    overlap /
    Math.max(
      1,
      Math.min(
        requestedSet.size,
        actualSet.size
      )
    );

  const textSimilarity =
    similarity(
      requested,
      actual
    );

  return (
    textSimilarity +
    tokenCoverage +
    containmentBonus
  );
}

/**
 * Determine whether a column is likely to
 * represent an entity/value rather than a
 * numeric metric.
 */
function isResolvableColumn(
  rows,
  column
) {
  let textCount = 0;
  let numericCount = 0;

  for (
    const row of
    (rows || []).slice(
      0,
      50
    )
  ) {
    const value =
      row?.[column];

    if (
      value === null ||
      value === undefined ||
      String(value).trim() ===
        ""
    ) {
      continue;
    }

    const text =
      String(value).trim();

    const numeric =
      Number(
        text.replace(
          /,/g,
          ""
        )
      );

    if (
      Number.isFinite(numeric) &&
      /^[-+]?\d[\d,.]*$/.test(
        text
      )
    ) {
      numericCount += 1;
    } else {
      textCount += 1;
    }
  }

  /**
   * IDs may be numeric, so do not reject columns
   * whose names suggest identifiers.
   */
  const normalizedColumn =
    normalizeText(column);

  const idLike =
    /\b(id|code|number|no|item|registration|control|reference)\b/i.test(
      normalizedColumn
    );

  return (
    idLike ||
    textCount >= numericCount
  );
}

/**
 * Search one specific column.
 */
function searchColumnValues({
  dataset,
  rows,
  column,
  requestedValue,
}) {
  const actualValues =
    getColumnValues(
      rows,
      column
    );

  const matches =
    actualValues
      .map((actualValue) => ({
        dataset,
        column,

        requestedValue,

        resolvedValue:
          actualValue,

        score:
          scoreValueMatch(
            requestedValue,
            actualValue,
            { column }
          ),

        personLike:
          isLikelyPersonColumn(
            column
          ),
      }))
      .filter(
        (item) =>
          item.score > 0
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  return matches;
}

/**
 * Search ALL datasets and ALL sensible columns.
 *
 * preferredDataset and preferredColumn are only
 * ranking hints.
 */
function findEntityCandidates({
  datasets,
  requestedValue,
  preferredDataset = null,
  preferredColumn = null,
  limit = 10,
}) {
  const candidates = [];

  for (
    const [
      datasetName,
      rows,
    ] of Object.entries(
      datasets || {}
    )
  ) {
    if (
      !Array.isArray(rows) ||
      !rows.length
    ) {
      continue;
    }

    const columns =
      getColumns(rows);

    for (
      const column of columns
    ) {
      if (
        !isResolvableColumn(
          rows,
          column
        )
      ) {
        continue;
      }

      const matches =
        searchColumnValues({
          dataset:
            datasetName,
          rows,
          column,
          requestedValue,
        });

      for (
        const match of
        matches.slice(0, 3)
      ) {
        const rawScore =
          match.score;

        let adjustedScore =
          rawScore;

        /**
         * Prefer the planner's selected dataset.
         */
        if (
          preferredDataset &&
          normalizeText(
            datasetName
          ) ===
            normalizeText(
              preferredDataset
            )
        ) {
          adjustedScore += 0.35;
        }

        /**
         * Prefer the planner's selected filter column.
         */
        if (
          preferredColumn &&
          normalizeText(
            column
          ) ===
            normalizeText(
              preferredColumn
            )
        ) {
          adjustedScore += 0.75;
        }

        candidates.push({
          ...match,

          rawScore,

          score:
            adjustedScore,
        });
      }
    }
  }

  return candidates
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(
      0,
      Math.max(
        1,
        limit
      )
    );
}

/**
 * Resolve one value safely.
 */
function resolveEntityAcrossDatasets({
  datasets,
  requestedValue,
  preferredDataset = null,
  preferredColumn = null,
}) {
  const candidates =
    findEntityCandidates({
      datasets,
      requestedValue,
      preferredDataset,
      preferredColumn,
      limit: 8,
    });

  if (!candidates.length) {
    return {
      resolved: false,
      reason:
        "NO_MATCH",
      requestedValue,
      candidates: [],
    };
  }

  const best =
    candidates[0];

  const second =
    candidates[1];

  // ========================================================
  // STRICT PERSON-NAME RESOLUTION
  // ========================================================
  //
  // Do not let dataset/column preference bonuses turn a weak
  // person-name match into a valid identity match. We evaluate
  // the raw name score first.
  //
  if (best.personLike) {
    const bestRawScore =
      Number(
        best.rawScore ??
        best.score ??
        0
      );

    const secondSamePersonColumn =
      second &&
      second.personLike &&
      normalizeText(
        second.dataset
      ) ===
        normalizeText(
          best.dataset
        ) &&
      normalizeText(
        second.column
      ) ===
        normalizeText(
          best.column
        );

    const secondRawScore =
      secondSamePersonColumn
        ? Number(
            second.rawScore ??
            second.score ??
            0
          )
        : 0;

    if (bestRawScore < 3.5) {
      return {
        resolved: false,
        reason:
          "LOW_CONFIDENCE_PERSON_MATCH",
        requestedValue,
        candidates:
          candidates.slice(
            0,
            5
          ),
      };
    }

    /**
     * If two different person values in the SAME person column
     * score almost equally, do not silently choose one.
     */
    if (
      secondSamePersonColumn &&
      normalizeValue(
        best.resolvedValue
      ) !==
        normalizeValue(
          second.resolvedValue
        ) &&
      secondRawScore >= 3.5 &&
      Math.abs(
        bestRawScore -
        secondRawScore
      ) < 0.35
    ) {
      return {
        resolved: false,
        ambiguous: true,
        reason:
          "AMBIGUOUS_PERSON_MATCH",
        requestedValue,
        candidates:
          candidates.slice(
            0,
            5
          ),
      };
    }

    return {
      resolved: true,
      ambiguous: false,
      ...best,
      candidates:
        candidates.slice(
          0,
          5
        ),
    };
  }

  /**
   * Exact/very strong match.
   */
  if (
    best.score >= 3.5
  ) {
    return {
      resolved: true,
      ambiguous: false,
      ...best,
      candidates:
        candidates.slice(
          0,
          5
        ),
    };
  }

  /**
   * Reject weak matches.
   */
  if (
    best.score < 1.25
  ) {
    return {
      resolved: false,
      reason:
        "LOW_CONFIDENCE",
      requestedValue,
      candidates:
        candidates.slice(
          0,
          5
        ),
    };
  }

  /**
   * Two very similar possibilities:
   * don't silently choose.
   */
  if (
    second &&
    second.score >= 1.25 &&
    Math.abs(
      best.score -
      second.score
    ) < 0.15 &&
    (
      normalizeText(
        best.dataset
      ) !==
        normalizeText(
          second.dataset
        ) ||
      normalizeText(
        best.column
      ) !==
        normalizeText(
          second.column
        ) ||
      normalizeValue(
        best.resolvedValue
      ) !==
        normalizeValue(
          second.resolvedValue
        )
    )
  ) {
    return {
      resolved: false,
      ambiguous: true,
      reason:
        "AMBIGUOUS_MATCH",
      requestedValue,
      candidates:
        candidates.slice(
          0,
          5
        ),
    };
  }

  return {
    resolved: true,
    ambiguous: false,
    ...best,
    candidates:
      candidates.slice(
        0,
        5
      ),
  };
}

/**
 * Resolve the filters in an already structured plan.
 *
 * Example:
 *
 * Groq:
 * NAME = "Roberto Peralez"
 *
 * Resolver:
 * NAME = "PERALES, ROBERTO TAN"
 */
function resolvePlanEntities({
  datasets,
  plan,
}) {
  if (
    !plan ||
    plan.route !== "dataset" ||
    !Array.isArray(
      plan.filters
    ) ||
    !plan.filters.length
  ) {
    return {
      resolved: true,
      plan,
      changes: [],
    };
  }

  const nextPlan = {
    ...plan,

    filters:
      plan.filters.map(
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
  };

  const changes = [];

  for (
    let i = 0;
    i <
    nextPlan.filters.length;
    i += 1
  ) {
    const filter =
      nextPlan.filters[i];

    const operator =
      String(
        filter.operator ||
        "equals"
      )
        .trim()
        .toLowerCase();

    // ========================================================
    // MULTI-ENTITY FILTERS
    // ========================================================
    //
    // Example:
    //
    // NAME IN [
    //   "Roberto Perales",
    //   "Vener Dllig"
    // ]
    //
    // Resolve every value individually while preserving
    // the IN / NOT_IN operator.
    //
    if (
      operator === "in" ||
      operator === "not_in"
    ) {
      const requestedValues =
        Array.isArray(
          filter.value
        )
          ? filter.value
          : [
              filter.value,
            ];

      const resolvedValues = [];

      for (
        const requestedRaw of
        requestedValues
      ) {
        const requestedValue =
          String(
            requestedRaw ?? ""
          ).trim();

        if (!requestedValue) {
          continue;
        }

        const resolution =
          resolveEntityAcrossDatasets({
            datasets,

            requestedValue,

            preferredDataset:
              plan.dataset,

            preferredColumn:
              filter.column,
          });

        /**
         * If no safe fuzzy resolution exists,
         * preserve the original user value.
         */
        if (
          !resolution.resolved
        ) {
          resolvedValues.push(
            requestedRaw
          );
          continue;
        }

        const sameColumn =
          normalizeText(
            resolution.column
          ) ===
          normalizeText(
            filter.column
          );

        if (!sameColumn) {
          resolvedValues.push(
            requestedRaw
          );
          continue;
        }

        resolvedValues.push(
          resolution.resolvedValue
        );

        if (
          String(requestedRaw) !==
          String(
            resolution.resolvedValue
          )
        ) {
          changes.push({
            dataset:
              resolution.dataset,

            column:
              resolution.column,

            from:
              requestedRaw,

            to:
              resolution.resolvedValue,

            score:
              resolution.score,
          });
        }
      }

      /**
       * Remove duplicate resolved values while
       * keeping the first occurrence/order.
       */
      const uniqueValues = [];
      const seenValues =
        new Set();

      for (
        const value of
        resolvedValues
      ) {
        const key =
          normalizeValue(value);

        if (
          !key ||
          seenValues.has(key)
        ) {
          continue;
        }

        seenValues.add(key);
        uniqueValues.push(value);
      }

      nextPlan.filters[i] = {
        ...filter,
        operator,

        value:
          uniqueValues,
      };

      continue;
    }

    // ========================================================
    // SINGLE-ENTITY EQUALITY FILTER
    // ========================================================
    //
    // Keep the existing equals behavior.
    //
    if (
      operator !==
      "equals"
    ) {
      continue;
    }

    const requestedValue =
      String(
        filter.value ?? ""
      ).trim();

    if (!requestedValue) {
      continue;
    }

    const resolution =
      resolveEntityAcrossDatasets({
        datasets,

        requestedValue,

        preferredDataset:
          plan.dataset,

        preferredColumn:
          filter.column,
      });

    if (
      !resolution.resolved
    ) {
      /**
       * Don't destroy a valid exact value merely
       * because the fuzzy resolver couldn't improve it.
       *
       * Leave the original filter untouched.
       */
      continue;
    }

    /**
     * Only accept the match if it came from the same
     * requested column where possible.
     */
    const sameColumn =
      normalizeText(
        resolution.column
      ) ===
      normalizeText(
        filter.column
      );

    if (!sameColumn) {
      continue;
    }

    const oldValue =
      filter.value;

    const newValue =
      resolution.resolvedValue;

    nextPlan.filters[i] = {
      ...filter,

      column:
        resolution.column,

      operator,

      value:
        newValue,
    };

    if (
      String(oldValue) !==
      String(newValue)
    ) {
      changes.push({
        dataset:
          resolution.dataset,

        column:
          resolution.column,

        from:
          oldValue,

        to:
          newValue,

        score:
          resolution.score,
      });
    }
  }

  return {
    resolved: true,

    plan:
      nextPlan,

    changes,
  };
}

module.exports = {
  normalizeValue,
  isLikelyPersonColumn,
  getPersonTokenMatch,
  scorePersonNameMatch,
  getColumnValues,
  scoreValueMatch,
  findEntityCandidates,
  resolveEntityAcrossDatasets,
  resolvePlanEntities,
};