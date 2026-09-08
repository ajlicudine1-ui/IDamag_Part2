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


/**
 * Generic metric families. These describe common analytical meanings rather
 * than any one dashboard's schema.
 */
const METRIC_SEMANTICS = {
  currency: ["cost", "amount", "value", "budget", "price", "expense", "revenue", "salary", "peso", "php"],
  count: ["count", "number", "members", "beneficiaries", "persons", "people", "employees", "farmers", "clients", "respondents"],
  area: ["area", "hectare", "hectares", "ha"],
  weight: ["weight", "kg", "kilogram", "kilograms", "mt", "metric ton", "metric tons", "ton", "tons"],
  percentage: ["percentage", "percent", "rate", "%"],
  quantity: ["quantity", "qty", "volume", "units"],
  time: ["duration", "hours", "hour", "minutes", "minute", "days", "day"],
};

function inferUnitFromColumn(columnName) {
  const raw = String(columnName || "").trim();
  const name = normalizeSemanticText(raw);
  if (!name) return null;

  if (/₱|\bphp\b|\bpeso(?:s)?\b/i.test(raw)) return "₱";
  if (/%|\bpercent(?:age)?\b/i.test(raw)) return "%";
  if (/\(\s*ha\s*\)|\bhectares?\b|\bha\b/i.test(raw)) return "ha";
  if (/\bkg\b|\bkilograms?\b/i.test(raw)) return "kg";
  if (/\bmt\b|\bmetric\s+tons?\b/i.test(raw)) return "MT";
  if (/\bhours?\b|\bhrs?\b/i.test(raw)) return "hours";
  if (/\bminutes?\b|\bmins?\b/i.test(raw)) return "minutes";
  if (/\bdays?\b/i.test(raw)) return "days";
  return null;
}

function inferMetricSemantics({ column, schema = [], dataset = null } = {}) {
  const columnName = String(column || "").trim();
  if (!columnName) return { type: null, unit: null, confidence: 0 };

  const text = normalizeSemanticText(columnName);
  const tokens = new Set(text.split(/\s+/).filter(Boolean));
  let bestType = null;
  let bestScore = 0;

  for (const [type, words] of Object.entries(METRIC_SEMANTICS)) {
    let score = 0;
    for (const word of words) {
      const normalizedWord = normalizeSemanticText(word);
      if (!normalizedWord) continue;
      if (text === normalizedWord) score += 2;
      else if (text.includes(normalizedWord)) score += normalizedWord.includes(" ") ? 1.4 : 1;
      else if (tokens.has(normalizedWord)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // Reuse schema metadata when available.
  const datasetSchema = (schema || []).find(
    (item) => !dataset || String(item?.name || "") === String(dataset)
  );
  const schemaColumn = datasetSchema?.columns?.find(
    (item) => String(item?.name || "") === columnName
  );

  if (schemaColumn?.semanticType) bestType = schemaColumn.semanticType;
  const unit = schemaColumn?.unit || inferUnitFromColumn(columnName);

  return {
    type: bestType,
    unit,
    confidence: bestScore > 0 ? Math.min(1, 0.45 + bestScore * 0.12) : 0,
  };
}

module.exports = {
  SEMANTIC_ALIASES,
  normalizeSemanticText,
  getAliasesForColumn,
  findSemanticColumn,
  buildSemanticHints,
  METRIC_SEMANTICS,
  inferMetricSemantics,
  inferUnitFromColumn,
};