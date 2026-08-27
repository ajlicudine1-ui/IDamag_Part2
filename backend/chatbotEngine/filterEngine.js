const {
  normalizeText,
  parseNumber,
  getColumns,
} = require("./utils");

const {
  findColumn,
} = require("./columnMatcher");

const {
  inferType,
} = require("./schemaBuilder");

/**
 * ==========================================================
 * NORMALIZE FILTER VALUE
 * ==========================================================
 */

function normalizeFilterValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        normalizeText(item)
      )
      .filter(Boolean)
      .sort()
      .join("|");
  }

  return normalizeText(value);
}

/**
 * ==========================================================
 * COMPARE ONE VALUE
 * ==========================================================
 *
 * Supports:
 *
 * equals
 * not_equals
 * contains
 * starts_with
 * ends_with
 * greater_than
 * greater_or_equal
 * less_than
 * less_or_equal
 * in
 * not_in
 */
function compare(
  actual,
  expected,
  operator = "equals"
) {
  const normalizedOperator =
    String(
      operator || "equals"
    )
      .trim()
      .toLowerCase();

  const leftText =
    normalizeText(actual);

  /**
   * ========================================================
   * MULTI-VALUE OPERATORS
   * ========================================================
   *
   * Example:
   *
   * NAME IN [
   *   "ROBERTO PERALES",
   *   "VENER DLLIG"
   * ]
   */

  if (
    normalizedOperator === "in" ||
    normalizedOperator === "not_in"
  ) {
    const expectedValues =
      Array.isArray(expected)
        ? expected
        : [expected];

    const matches =
      expectedValues.some(
        (value) =>
          leftText ===
          normalizeText(value)
      );

    return normalizedOperator ===
      "in"
      ? matches
      : !matches;
  }

  const rightText =
    normalizeText(expected);

  const leftNumber =
    parseNumber(actual);

  const rightNumber =
    parseNumber(expected);

  switch (
    normalizedOperator
  ) {
    case "not_equals":
      return (
        leftText !==
        rightText
      );

    case "contains":
      return leftText.includes(
        rightText
      );

    case "starts_with":
      return leftText.startsWith(
        rightText
      );

    case "ends_with":
      return leftText.endsWith(
        rightText
      );

    case "greater_than":
      return (
        leftNumber !== null &&
        rightNumber !== null &&
        leftNumber >
          rightNumber
      );

    case "greater_or_equal":
      return (
        leftNumber !== null &&
        rightNumber !== null &&
        leftNumber >=
          rightNumber
      );

    case "less_than":
      return (
        leftNumber !== null &&
        rightNumber !== null &&
        leftNumber <
          rightNumber
      );

    case "less_or_equal":
      return (
        leftNumber !== null &&
        rightNumber !== null &&
        leftNumber <=
          rightNumber
      );

    case "equals":
    default:
      return (
        leftText ===
        rightText
      );
  }
}

/**
 * ==========================================================
 * RESOLVE PLANNER FILTERS
 * ==========================================================
 *
 * Converts planner column wording into
 * actual worksheet column names.
 *
 * Supports scalar and array values.
 */
function resolveFilters(
  rows,
  filters = []
) {
  return (
    Array.isArray(filters)
      ? filters
      : []
  )
    .map((filter) => {
      const column =
        findColumn(
          rows,
          filter?.column
        );

      if (!column) {
        return null;
      }

      const operator =
        String(
          filter?.operator ||
            "equals"
        )
          .trim()
          .toLowerCase();

      /**
       * IN / NOT_IN must use arrays.
       */
      let value =
        filter?.value;

      if (
        [
          "in",
          "not_in",
        ].includes(
          operator
        )
      ) {
        value =
          Array.isArray(
            filter?.value
          )
            ? filter.value
            : [
                filter?.value,
              ];

        value =
          value
            .filter(
              (item) =>
                item !==
                  null &&
                item !==
                  undefined &&
                String(item)
                  .trim() !==
                  ""
            );
      }

      return {
        column,
        operator,
        value,
      };
    })
    .filter(Boolean);
}

/**
 * ==========================================================
 * REMOVE CONTROL NUMBERS
 * ==========================================================
 *
 * Prevent numbers in questions such as:
 *
 * "top 5"
 * "first 10"
 *
 * from becoming accidental data filters.
 */
function removeControlNumbers(
  question
) {
  let text =
    normalizeText(
      question
    );

  text =
    text.replace(
      /\b(top|bottom|first|last)\s+\d{1,3}\b/g,
      "$1"
    );

  text =
    text.replace(
      /\b\d{1,3}\s+(?=[\p{L}][\p{L}\s._%()/+-]*\s+(?:with|having)\s+(?:the\s+)?(?:highest|lowest|largest|smallest|biggest|greatest|most|least)\b)/gu,
      ""
    );

  text =
    text.replace(
      /\b(?:show|list|give|display|return|get)\s+\d{1,3}\s+(?=[\p{L}])/g,
      (match) =>
        match.replace(
          /\d{1,3}/,
          ""
        )
    );

  return text
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

/**
 * ==========================================================
 * INFER FILTER VALUES FROM QUESTION
 * ==========================================================
 *
 * IMPORTANT CHANGE:
 *
 * Multiple matching values from the SAME column are
 * converted into one IN filter.
 *
 * Example:
 *
 * Question:
 * "salary of Roberto Perales and Vener Dllig"
 *
 * Instead of:
 *
 * NAME = Roberto
 * AND
 * NAME = Vener
 *
 * We generate:
 *
 * NAME IN [
 *   Roberto,
 *   Vener
 * ]
 */

function findTextOccurrences(
  text,
  phrase
) {
  const haystack =
    String(text || "");

  const needle =
    String(phrase || "");

  if (!haystack || !needle) {
    return [];
  }

  const escaped =
    needle.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const regex =
    new RegExp(
      `(^|[^\p{L}\p{N}])(${escaped})(?=$|[^\p{L}\p{N}])`,
      "gu"
    );

  const spans = [];
  let match;

  while (
    (match = regex.exec(haystack)) !== null
  ) {
    const prefixLength =
      match[1]?.length || 0;

    const start =
      match.index +
      prefixLength;

    spans.push({
      start,
      end:
        start +
        match[2].length,
    });

    if (
      regex.lastIndex ===
      match.index
    ) {
      regex.lastIndex += 1;
    }
  }

  return spans;
}

function spanContains(
  outer,
  inner
) {
  return (
    outer &&
    inner &&
    outer.start <= inner.start &&
    outer.end >= inner.end
  );
}

/**
 * Keep the most specific live values from the SAME column.
 *
 * A shorter value is removed only when every occurrence of it in
 * the question is already contained inside a longer accepted value.
 *
 * This means:
 *
 *   "Doris Joy Garcia"
 *
 * can safely produce:
 *   FIRST NAME = DORIS JOY
 *   LAST NAME  = GARCIA
 *
 * instead of:
 *   FIRST NAME IN [DORIS JOY, JOY]
 *
 * while a real multi-entity question such as:
 *
 *   "salary of Doris Joy and Joy Montero"
 *
 * can still preserve the second, independent JOY occurrence.
 *
 * This is dataset-agnostic and works the same way for names,
 * municipalities, project titles, commodities, offices, IDs,
 * and other live text values.
 */
function suppressContainedMatches(
  columnMatches
) {
  const ordered =
    [...columnMatches]
      .sort(
        (a, b) =>
          b.normalizedLength -
            a.normalizedLength ||
          b.score - a.score
      );

  const accepted = [];

  for (const candidate of ordered) {
    const spans =
      Array.isArray(candidate.spans)
        ? candidate.spans
        : [];

    if (!spans.length) {
      accepted.push(candidate);
      continue;
    }

    const fullyCovered =
      spans.every(
        (candidateSpan) =>
          accepted.some(
            (stronger) =>
              stronger.normalizedLength >
                candidate.normalizedLength &&
              Array.isArray(
                stronger.spans
              ) &&
              stronger.spans.some(
                (strongerSpan) =>
                  spanContains(
                    strongerSpan,
                    candidateSpan
                  )
              )
          )
      );

    if (!fullyCovered) {
      accepted.push(candidate);
    }
  }

  return accepted;
}

function inferValueFilters(
  rows,
  question,
  excludedColumns = []
) {
  const normalizedQuestion =
    removeControlNumbers(
      question
    );

  const excluded =
    new Set(
      excludedColumns
        .filter(Boolean)
    );

  const matches = [];

  for (
    const column of
    getColumns(rows)
  ) {
    if (
      excluded.has(column)
    ) {
      continue;
    }

    const type =
      inferType(
        rows,
        column
      );

    const seen =
      new Set();

    for (
      const row of
      rows
    ) {
      const raw =
        row?.[column];

      if (
        raw === null ||
        raw === undefined ||
        String(raw).trim() ===
          ""
      ) {
        continue;
      }

      const display =
        String(raw)
          .trim();

      const normalizedValue =
        normalizeText(
          display
        );

      if (
        !normalizedValue ||
        seen.has(
          normalizedValue
        )
      ) {
        continue;
      }

      seen.add(
        normalizedValue
      );

      /**
       * IMPORTANT:
       *
       * A column can be inferred as numeric even when some individual
       * cells contain short text codes such as:
       *
       *   M
       *   F
       *   P
       *   Y
       *   N
       *
       * Those values must NOT enter numeric matching.
       *
       * Previously, a one-letter value such as "M" could be treated as
       * numeric-column data and matched inside an ordinary word like:
       *
       *   "bottom"
       *
       * because the old numeric boundary used \D around the value.
       *
       * Only use numeric matching when THIS SPECIFIC CELL VALUE is
       * actually numeric-like.
       */
      const numericDisplay =
        String(display)
          .replace(
            /[,₱$€£¥%]/g,
            ""
          )
          .replace(
            /\s+/g,
            ""
          );

      const valueIsActuallyNumeric =
        numericDisplay !== "" &&
        Number.isFinite(
          Number(
            numericDisplay
          )
        );

      if (
        type === "number" &&
        valueIsActuallyNumeric
      ) {
        const escaped =
          normalizedValue
            .replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            );

        const boundaryPattern =
          new RegExp(
            `(^|\\D)${escaped}(\\D|$)`
          );

        if (
          boundaryPattern.test(
            normalizedQuestion
          )
        ) {
          matches.push({
            column,
            operator:
              "equals",
            value:
              display,

            score:
              1000 +
              normalizedValue
                .length,

            normalizedLength:
              normalizedValue
                .length,

            spans:
              findTextOccurrences(
                normalizedQuestion,
                normalizedValue
              ),
          });
        }
      } else if (
        normalizedValue
          .length >= 2
      ) {
        const spans =
          findTextOccurrences(
            normalizedQuestion,
            normalizedValue
          );

        if (!spans.length) {
          continue;
        }

        matches.push({
          column,
          operator:
            "equals",
          value:
            display,

          score:
            normalizedValue
              .length,

          normalizedLength:
            normalizedValue
              .length,

          spans,
        });
      }
    }
  }

  matches.sort(
    (a, b) =>
      b.score -
      a.score
  );

  /**
   * ========================================================
   * GROUP MATCHES BY COLUMN
   * ========================================================
   *
   * Previously only one value per column survived.
   *
   * Now:
   *
   * NAME:
   * - Roberto
   * - Vener
   *
   * becomes:
   *
   * NAME IN [Roberto, Vener]
   */

  const grouped =
    new Map();

  for (
    const match of
    matches
  ) {
    if (
      !grouped.has(
        match.column
      )
    ) {
      grouped.set(
        match.column,
        []
      );
    }

    const values =
      grouped.get(
        match.column
      );

    const alreadyExists =
      values.some(
        (item) =>
          normalizeText(
            item.value
          ) ===
          normalizeText(
            match.value
          )
      );

    if (
      !alreadyExists
    ) {
      values.push(
        match
      );
    }
  }

  const selected = [];

  for (
    const [
      column,
      columnMatches,
    ] of grouped.entries()
  ) {
    if (
      !columnMatches.length
    ) {
      continue;
    }

    const specificMatches =
      suppressContainedMatches(
        columnMatches
      );

    if (!specificMatches.length) {
      continue;
    }

    /**
     * One specific value survives after contained substring
     * matches are removed.
     */
    if (
      specificMatches.length ===
      1
    ) {
      selected.push({
        column,

        operator:
          specificMatches[0]
            .operator,

        value:
          specificMatches[0]
            .value,
      });

      continue;
    }

    /**
     * Multiple independent values from the SAME column use IN.
     * A shorter value only survives when it has an occurrence
     * outside a longer matched value in the user's question.
     */
    selected.push({
      column,

      operator:
        "in",

      value:
        specificMatches.map(
          (item) =>
            item.value
        ),
    });
  }

  return selected;
}


/**
 * ==========================================================
 * INFER ONE COHERENT FILTER SET
 * ==========================================================
 *
 * Keep only values that can all belong to the SAME real row.
 * This prevents unrelated columns from being mixed into one entity.
 */
function inferCoherentFilters(
  rows,
  question,
  excludedColumns = []
) {
  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return [];
  }

  const inferred =
    inferValueFilters(
      rows,
      question,
      excludedColumns
    );

  const candidates = [];

  for (const filter of inferred) {
    const values =
      Array.isArray(filter?.value)
        ? filter.value
        : [filter?.value];

    for (const value of values) {
      if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
      ) {
        continue;
      }

      candidates.push({
        column:
          filter.column,
        operator:
          "equals",
        value,
        specificity:
          normalizeText(value).length,
      });
    }
  }

  if (!candidates.length) {
    return [];
  }

  let best = null;

  for (
    let rowIndex = 0;
    rowIndex < rows.length;
    rowIndex += 1
  ) {
    const row =
      rows[rowIndex];

    const matching =
      candidates.filter(
        (candidate) =>
          compare(
            row?.[candidate.column],
            candidate.value,
            "equals"
          )
      );

    if (!matching.length) {
      continue;
    }

    const byColumn =
      new Map();

    for (const candidate of matching) {
      const current =
        byColumn.get(candidate.column);

      if (
        !current ||
        candidate.specificity >
          current.specificity
      ) {
        byColumn.set(
          candidate.column,
          candidate
        );
      }
    }

    const coherent =
      [...byColumn.values()];

    const score =
      coherent.length * 10000 +
      coherent.reduce(
        (sum, item) =>
          sum + item.specificity,
        0
      );

    if (
      !best ||
      score > best.score
    ) {
      best = {
        score,
        filters:
          coherent,
      };
    }
  }

  if (!best) {
    return [];
  }

  return best.filters.map(
    ({ specificity, ...filter }) =>
      filter
  );
}

/**
 * ==========================================================
 * FIND FILTER VALUES ACROSS ALL DATASETS
 * ==========================================================
 */
function inferDatasetValueFilters(
  datasets,
  question,
  excluded = {}
) {
  const matches = [];

  for (
    const [
      datasetName,
      rows,
    ] of Object.entries(
      datasets || {}
    )
  ) {
    if (
      !Array.isArray(
        rows
      ) ||
      !rows.length
    ) {
      continue;
    }

    const excludedColumns =
      Array.isArray(
        excluded?.[
          datasetName
        ]
      )
        ? excluded[
            datasetName
          ]
        : [];

    const filters =
      inferValueFilters(
        rows,
        question,
        excludedColumns
      );

    for (
      const filter of
      filters
    ) {
      const valueLength =
        Array.isArray(
          filter.value
        )
          ? Math.max(
              0,
              ...filter.value.map(
                (value) =>
                  normalizeText(
                    value
                  ).length
              )
            )
          : normalizeText(
              filter.value
            ).length;

      matches.push({
        dataset:
          datasetName,

        ...filter,

        valueLength,
      });
    }
  }

  return matches.sort(
    (a, b) =>
      b.valueLength -
      a.valueLength
  );
}

/**
 * ==========================================================
 * MERGE FILTERS
 * ==========================================================
 *
 * Handles array values safely.
 */
function mergeFilters(
  ...groups
) {
  const result = [];
  const seen =
    new Set();

  for (
    const filters of
    groups
  ) {
    for (
      const filter of
      filters || []
    ) {
      if (!filter) {
        continue;
      }

      const key = [
        normalizeText(
          filter.column
        ),

        String(
          filter.operator ||
            "equals"
        )
          .trim()
          .toLowerCase(),

        normalizeFilterValue(
          filter.value
        ),
      ].join("|");

      if (
        !seen.has(key)
      ) {
        seen.add(key);

        result.push(
          filter
        );
      }
    }
  }

  return result;
}

/**
 * ==========================================================
 * APPLY FILTERS
 * ==========================================================
 *
 * Different filter objects still use AND.
 *
 * Example:
 *
 * DIVISION = PMED
 * AND
 * STATUS = ACTIVE
 *
 * But an IN filter uses OR internally:
 *
 * NAME IN [
 *   Roberto,
 *   Vener
 * ]
 *
 * means:
 *
 * Roberto OR Vener
 */
function applyFilters(
  rows,
  filters = []
) {
  if (
    !filters.length
  ) {
    return rows;
  }

  return rows.filter(
    (row) =>
      filters.every(
        (filter) =>
          compare(
            row?.[
              filter.column
            ],

            filter.value,

            filter.operator
          )
      )
  );
}

module.exports = {
  compare,
  removeControlNumbers,
  resolveFilters,
  inferValueFilters,
  inferCoherentFilters,
  inferDatasetValueFilters,
  mergeFilters,
  applyFilters,
};