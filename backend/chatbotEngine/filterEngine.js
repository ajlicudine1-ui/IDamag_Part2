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

const {
  splitMultiValueCell,
  valueMatchesToken,
} = require("./valueNormalizer");

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
          leftText === normalizeText(value) ||
          valueMatchesToken(actual, value)
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
    case "empty":
      return (
        actual === null ||
        actual === undefined ||
        String(actual).trim() === ""
      );

    case "not_empty":
      return !(
        actual === null ||
        actual === undefined ||
        String(actual).trim() === ""
      );

    case "not_equals":
      return !(
        leftText === rightText ||
        valueMatchesToken(actual, expected)
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
        leftText === rightText ||
        valueMatchesToken(actual, expected)
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
      `(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`,
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


/**
 * Remove a shorter live-value match when every occurrence of it is already
 * contained inside a longer live-value match from ANY column.
 *
 * This prevents a categorical value such as "Phase 3" from also creating
 * an unrelated numeric filter like CRAO-MIS Balance = 3 simply because the
 * digit 3 exists elsewhere in the worksheet. If the number appears again
 * independently (for example "Phase 3 with balance 3"), that independent
 * occurrence is preserved.
 *
 * This is schema/value driven and does not hardcode any worksheet field.
 */
function suppressCrossColumnContainedMatches(
  matches
) {
  const source = Array.isArray(matches)
    ? matches
    : [];

  return source.filter((candidate) => {
    const candidateSpans = Array.isArray(candidate?.spans)
      ? candidate.spans
      : [];

    if (!candidateSpans.length) {
      return true;
    }

    const candidateLength = Math.max(
      0,
      Number(candidate?.normalizedLength) || 0
    );

    const everyOccurrenceCovered = candidateSpans.every(
      (candidateSpan) =>
        source.some((other) => {
          if (other === candidate) {
            return false;
          }

          const otherLength = Math.max(
            0,
            Number(other?.normalizedLength) || 0
          );

          if (otherLength <= candidateLength) {
            return false;
          }

          const otherSpans = Array.isArray(other?.spans)
            ? other.spans
            : [];

          return otherSpans.some((otherSpan) =>
            spanContains(otherSpan, candidateSpan)
          );
        })
    );

    return !everyOccurrenceCovered;
  });
}


const ORDINAL_WORD_TO_NUMBER = new Map([
  ["first", 1],
  ["second", 2],
  ["third", 3],
  ["fourth", 4],
  ["fifth", 5],
  ["sixth", 6],
  ["seventh", 7],
  ["eighth", 8],
  ["ninth", 9],
  ["tenth", 10],
  ["eleventh", 11],
  ["twelfth", 12],
  ["thirteenth", 13],
  ["fourteenth", 14],
  ["fifteenth", 15],
  ["sixteenth", 16],
  ["seventeenth", 17],
  ["eighteenth", 18],
  ["nineteenth", 19],
  ["twentieth", 20],
]);

const CARDINAL_WORD_TO_NUMBER = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
]);

function ordinalSuffix(number) {
  const n =
    Number(number);

  if (
    n % 100 >= 11 &&
    n % 100 <= 13
  ) {
    return "th";
  }

  switch (
    n % 10
  ) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function numberWordFromMap(map, number) {
  for (const [word, value] of map.entries()) {
    if (
      value ===
      Number(number)
    ) {
      return word;
    }
  }

  return null;
}

function buildOrdinalValueAliases({
  column,
  displayValue,
} = {}) {
  const valueText =
    normalizeText(
      displayValue
    );

  const columnText =
    normalizeText(
      column
    );

  if (
    !valueText ||
    !columnText
  ) {
    return [];
  }

  /**
   * Only alias small ordinal/category numbers that are semantically anchored
   * to the column/value label itself. This avoids interpreting arbitrary IDs,
   * dates, contact numbers, or years as ordinal filters.
   *
   * Examples:
   *   Phase 2  <-> second phase / phase two / 2nd phase
   *   Level 3  <-> third level / level three / 3rd level
   *   Quarter 1 <-> first quarter / quarter one / 1st quarter
   */
  const match =
    valueText.match(
      /^(.*?)(?:\s+)(\d{1,2})$/
    );

  if (
    !match?.[1] ||
    !match?.[2]
  ) {
    return [];
  }

  const prefix =
    match[1]
      .trim();

  const number =
    Number(
      match[2]
    );

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 20
  ) {
    return [];
  }

  const prefixTokens =
    prefix
      .split(/\s+/)
      .filter(Boolean);

  const columnTokens =
    columnText
      .split(/\s+/)
      .filter(Boolean);

  const hasSemanticAnchor =
    prefixTokens.some(
      (token) =>
        columnTokens.includes(
          token
        )
    );

  if (
    !hasSemanticAnchor
  ) {
    return [];
  }

  const ordinalWord =
    numberWordFromMap(
      ORDINAL_WORD_TO_NUMBER,
      number
    );

  const cardinalWord =
    numberWordFromMap(
      CARDINAL_WORD_TO_NUMBER,
      number
    );

  const ordinalNumeric =
    `${number}${ordinalSuffix(number)}`;

  const aliases =
    [
      `${prefix} ${number}`,
      `${number} ${prefix}`,
      `${prefix} ${ordinalNumeric}`,
      `${ordinalNumeric} ${prefix}`,
      ordinalWord
        ? `${prefix} ${ordinalWord}`
        : null,
      ordinalWord
        ? `${ordinalWord} ${prefix}`
        : null,
      cardinalWord
        ? `${prefix} ${cardinalWord}`
        : null,
      cardinalWord
        ? `${cardinalWord} ${prefix}`
        : null,
    ]
      .filter(Boolean)
      .map(
        (value) =>
          normalizeText(value)
      );

  return [
    ...new Set(
      aliases
    ),
  ];
}

function findOrdinalAliasSpans({
  normalizedQuestion,
  column,
  displayValue,
} = {}) {
  const aliases =
    buildOrdinalValueAliases({
      column,
      displayValue,
    });

  const matches = [];

  for (const alias of aliases) {
    const spans =
      findTextOccurrences(
        normalizedQuestion,
        alias
      );

    if (
      spans.length
    ) {
      matches.push({
        alias,
        spans,
      });
    }
  }

  return matches;
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
        /**
         * Match both the complete cell and, when the cell is a real
         * delimited multi-value field, each individual live token.
         *
         * Example:
         *   Commodities = "rice, sugar cane, high value crops"
         *   Question    = "associations that produce sugar cane"
         *
         * The previous implementation only looked for the COMPLETE cell
         * text in the question, so the explicit live value "sugar cane"
         * could be silently omitted. Token matching is generic and uses the
         * same multi-value normalizer already used by filter execution.
         */
        const valueCandidates =
          splitMultiValueCell(
            display
          )
            .map((candidate) => ({
              display:
                String(candidate || "").trim(),
              normalized:
                normalizeText(candidate),
              tokenized:
                normalizeText(candidate) !== normalizedValue,
            }))
            .filter((candidate) =>
              candidate.normalized.length >= 2
            );

        let candidateMatched =
          false;

        for (
          const candidate of
          valueCandidates
        ) {
          let spans =
            findTextOccurrences(
              normalizedQuestion,
              candidate.normalized
            );

          let ordinalAliasMatch =
            false;

          if (
            !spans.length &&
            !candidate.tokenized
          ) {
            const aliasMatches =
              findOrdinalAliasSpans({
                normalizedQuestion,
                column,
                displayValue:
                  display,
              });

            if (
              aliasMatches.length
            ) {
              ordinalAliasMatch =
                true;

              spans =
                aliasMatches
                  .flatMap(
                    (item) =>
                      item.spans
                  );
            }
          }

          if (!spans.length) {
            continue;
          }

          candidateMatched =
            true;

          matches.push({
            column,
            operator:
              "equals",
            value:
              candidate.tokenized
                ? candidate.display
                : display,

            score:
              (
                ordinalAliasMatch
                  ? 900
                  : 0
              ) +
              candidate.normalized.length +
              (candidate.tokenized ? 25 : 0),

            normalizedLength:
              candidate.normalized.length,

            spans,

            ordinalAliasMatch,
            multiValueTokenMatch:
              candidate.tokenized,
          });
        }

        if (!candidateMatched) {
          continue;
        }
      }
    }
  }

  const nonOverlappingMatches =
    suppressCrossColumnContainedMatches(
      matches
    );

  nonOverlappingMatches.sort(
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
    nonOverlappingMatches
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
  buildOrdinalValueAliases,
  findOrdinalAliasSpans,
};