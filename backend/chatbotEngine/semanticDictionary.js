const SEMANTIC_ALIASES = {
  "POSITION TITLE": [
    "position title",
    "position",
    "job title",
    "job",
    "designation",
    "role",
    "official position",
  ],

  "ACTUAL SALARY": [
    "actual salary",
    "salary",
    "current salary",
    "actual pay",
    "pay",
    "current pay",
  ],

  "AUTHORIZED SALARY": [
    "authorized salary",
    "approved salary",
    "authorized pay",
  ],

  "DIVISION": [
    "division",
    "div",
    "office division",
  ],

  "OFFICE": [
    "office",
    "department",
  ],

  "UNIT/SECTION/STATION": [
    "unit",
    "section",
    "station",
    "unit section",
    "unit or section",
  ],

  "ASSIGNMENT": [
    "assignment",
    "assigned office",
    "assigned unit",
    "assigned section",
  ],

  "SG": [
    "salary grade",
    "sg",
    "grade",
  ],

  "SI": [
    "salary step",
    "step",
    "step increment",
    "si",
  ],

  "LEVEL OF POSITION": [
    "level of position",
    "position level",
    "level",
  ],

  "CATEGORY OF POSITION": [
    "category of position",
    "position category",
    "category",
  ],

  "ITEM": [
    "item",
    "item number",
    "position item",
    "plantilla item",
  ],
};

/**
 * Normalize text for matching.
 */
function normalizeSemanticText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Returns aliases for a known column.
 */
function getAliasesForColumn(columnName) {
  const normalizedColumn =
    String(columnName || "")
      .trim()
      .toUpperCase();

  return (
    SEMANTIC_ALIASES[
      normalizedColumn
    ] || []
  );
}

/**
 * Try to map natural-language wording
 * to a real schema column.
 */
function findSemanticColumn(
  requestedText,
  availableColumns = []
) {
  const normalizedRequest =
    normalizeSemanticText(
      requestedText
    );

  if (!normalizedRequest) {
    return null;
  }

  /**
   * Exact real-column match first.
   */
  for (const column of availableColumns) {
    if (
      normalizeSemanticText(
        column
      ) === normalizedRequest
    ) {
      return column;
    }
  }

  /**
   * Alias matching.
   */
  for (const column of availableColumns) {
    const aliases =
      getAliasesForColumn(
        column
      );

    for (const alias of aliases) {
      if (
        normalizeSemanticText(
          alias
        ) === normalizedRequest
      ) {
        return column;
      }
    }
  }

  return null;
}

/**
 * Returns semantic information that can
 * be supplied to Groq.
 */
function buildSemanticHints(schema = []) {
  const hints = [];

  for (const dataset of schema) {
    for (
      const column of
      dataset.columns || []
    ) {
      const aliases =
        getAliasesForColumn(
          column.name
        );

      if (!aliases.length) {
        continue;
      }

      hints.push({
        dataset:
          dataset.name,

        column:
          column.name,

        aliases,
      });
    }
  }

  return hints;
}

module.exports = {
  SEMANTIC_ALIASES,
  normalizeSemanticText,
  getAliasesForColumn,
  findSemanticColumn,
  buildSemanticHints,
};