const {
  normalizeText,
  getColumns,
  similarity,
} = require("./utils");

/**
 * ==========================================================
 * DATA RETRIEVER
 * ==========================================================
 *
 * Searches the ACTUAL currently loaded datasets.
 *
 * No employee names, provinces, divisions, worksheet names,
 * municipalities, etc. are hardcoded here.
 *
 * This layer does NOT calculate answers.
 * It only finds rows and values potentially relevant to the
 * user's question.
 */

const DEFAULT_OPTIONS = {
  maxRows: 50,
  maxMatchesPerColumn: 20,
  minimumFuzzyScore: 0.82,
  minimumValueLength: 2,
};

/**
 * Ignore empty values and values that are not useful
 * for entity retrieval.
 */
function isUsableValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  const text =
    String(value).trim();

  return text.length > 0;
}

/**
 * Get unique real values from a column.
 */
function getUniqueValues(
  rows,
  column
) {
  const values = [];
  const seen = new Set();

  for (const row of rows || []) {
    const raw =
      row?.[column];

    if (!isUsableValue(raw)) {
      continue;
    }

    const display =
      String(raw).trim();

    const normalized =
      normalizeText(display);

    if (
      !normalized ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    values.push(display);
  }

  return values;
}

/**
 * Build word groups from the question.
 *
 * Example:
 *
 * "salary of Roberto Perales and Vener Dllig"
 *
 * creates phrases such as:
 *
 * Roberto
 * Perales
 * Roberto Perales
 * Vener
 * Dllig
 * Vener Dllig
 */
function buildQuestionPhrases(
  question,
  maxWords = 5
) {
  const normalized =
    normalizeText(question);

  if (!normalized) {
    return [];
  }

  const tokens =
    normalized
      .split(/\s+/)
      .filter(Boolean);

  const phrases = [];

  for (
    let size = 1;
    size <=
    Math.min(
      maxWords,
      tokens.length
    );
    size += 1
  ) {
    for (
      let index = 0;
      index <=
      tokens.length - size;
      index += 1
    ) {
      phrases.push(
        tokens
          .slice(
            index,
            index + size
          )
          .join(" ")
      );
    }
  }

  return phrases;
}

/**
 * Determine how strongly an actual dataset value matches
 * something written in the question.
 */
function scoreValueAgainstQuestion(
  value,
  question,
  questionPhrases = null
) {
  const normalizedValue =
    normalizeText(value);

  const normalizedQuestion =
    normalizeText(question);

  if (
    !normalizedValue ||
    !normalizedQuestion
  ) {
    return 0;
  }

  /**
   * Strongest possible match:
   * actual dataset value appears directly in the question.
   */
  if (
    normalizedQuestion.includes(
      normalizedValue
    )
  ) {
    return 1;
  }

  const phrases =
    Array.isArray(
      questionPhrases
    )
      ? questionPhrases
      : buildQuestionPhrases(
          question
        );

  let bestScore = 0;

  for (const phrase of phrases) {
    if (!phrase) {
      continue;
    }

    /**
     * Prevent tiny words from producing strong fuzzy matches.
     */
    const shortest =
      Math.min(
        phrase.length,
        normalizedValue.length
      );

    const longest =
      Math.max(
        phrase.length,
        normalizedValue.length
      );

    if (
      shortest < 3 ||
      shortest /
        Math.max(
          longest,
          1
        ) <
        0.55
    ) {
      continue;
    }

    const score =
      similarity(
        phrase,
        normalizedValue
      );

    if (
      score >
      bestScore
    ) {
      bestScore =
        score;
    }
  }

  return bestScore;
}

/**
 * Search one column for actual values mentioned in the
 * question.
 */
function searchColumnValues({
  rows,
  column,
  question,
  options = {},
}) {
  const settings = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const questionPhrases =
    buildQuestionPhrases(
      question
    );

  const values =
    getUniqueValues(
      rows,
      column
    );

  const matches = [];

  for (const value of values) {
    const normalized =
      normalizeText(value);

    if (
      normalized.length <
      settings.minimumValueLength
    ) {
      continue;
    }

    const score =
      scoreValueAgainstQuestion(
        value,
        question,
        questionPhrases
      );

    if (
      score >=
      settings.minimumFuzzyScore
    ) {
      matches.push({
        column,
        value,
        score,
      });
    }
  }

  return matches
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(
      0,
      settings.maxMatchesPerColumn
    );
}

/**
 * Search every column of one worksheet.
 */
function searchDataset({
  datasetName,
  rows,
  question,
  options = {},
}) {
  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return {
      dataset:
        datasetName,

      matches: [],

      rows: [],
    };
  }

  const columns =
    getColumns(rows);

  const matches = [];

  for (const column of columns) {
    const columnMatches =
      searchColumnValues({
        rows,
        column,
        question,
        options,
      });

    matches.push(
      ...columnMatches
    );
  }

  matches.sort(
    (a, b) =>
      b.score - a.score
  );

  /**
   * Determine which actual rows contain any of the
   * discovered values.
   */
  const matchedRows = [];

  const seenRows =
    new Set();

  for (
    let rowIndex = 0;
    rowIndex < rows.length;
    rowIndex += 1
  ) {
    const row =
      rows[rowIndex];

    let matched = false;

    for (const match of matches) {
      if (
        normalizeText(
          row?.[
            match.column
          ]
        ) ===
        normalizeText(
          match.value
        )
      ) {
        matched = true;
        break;
      }
    }

    if (
      matched &&
      !seenRows.has(
        rowIndex
      )
    ) {
      seenRows.add(
        rowIndex
      );

      matchedRows.push({
        rowIndex,
        row,
      });
    }
  }

  const settings = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  return {
    dataset:
      datasetName,

    matches,

    rows:
      matchedRows.slice(
        0,
        settings.maxRows
      ),
  };
}

/**
 * ==========================================================
 * SEARCH ALL CURRENT DATASETS
 * ==========================================================
 */
function retrieveRelevantData({
  datasets,
  question,
  options = {},
}) {
  const results = [];

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

    const result =
      searchDataset({
        datasetName,
        rows,
        question,
        options,
      });

    if (
      result.matches.length
    ) {
      results.push(result);
    }
  }

  /**
   * Worksheets containing stronger matches appear first.
   */
  results.sort(
    (a, b) => {
      const aScore =
        a.matches[0]?.score ||
        0;

      const bScore =
        b.matches[0]?.score ||
        0;

      if (
        bScore !== aScore
      ) {
        return (
          bScore - aScore
        );
      }

      return (
        b.matches.length -
        a.matches.length
      );
    }
  );

  return {
    question,
    datasetCount:
      results.length,
    datasets:
      results,
  };
}

/**
 * Produce a smaller representation that is safe to give
 * to the language model.
 *
 * We send only relevant rows instead of every row from
 * every worksheet.
 */
function buildRetrievalContext(
  retrieval
) {
  if (
    !retrieval ||
    !Array.isArray(
      retrieval.datasets
    )
  ) {
    return [];
  }

  return retrieval.datasets.map(
    (dataset) => ({
      dataset:
        dataset.dataset,

      matchedValues:
        dataset.matches.map(
          (match) => ({
            column:
              match.column,

            value:
              match.value,

            score:
              Number(
                match.score.toFixed(
                  3
                )
              ),
          })
        ),

      rows:
        dataset.rows.map(
          (item) =>
            item.row
        ),
    })
  );
}

module.exports = {
  getUniqueValues,
  buildQuestionPhrases,
  scoreValueAgainstQuestion,
  searchColumnValues,
  searchDataset,
  retrieveRelevantData,
  buildRetrievalContext,
};