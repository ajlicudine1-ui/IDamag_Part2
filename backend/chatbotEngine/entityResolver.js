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

  if (
    !requested ||
    !actual
  ) {
    return 0;
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
            actualValue
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
        let adjustedScore =
          match.score;

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
  getColumnValues,
  scoreValueMatch,
  findEntityCandidates,
  resolveEntityAcrossDatasets,
  resolvePlanEntities,
};