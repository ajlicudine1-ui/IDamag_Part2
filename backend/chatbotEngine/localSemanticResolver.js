const {
  normalizeText,
  similarity,
  singularizeToken,
  parseNumber,
} = require("./utils");

const {
  inferValueFilters,
} = require("./filterEngine");

const STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","been","being","by","can","could",
  "did","do","does","for","from","had","has","have","how","in","into",
  "is","it","may","might","must","of","on","or","per","please","show",
  "tell","that","the","their","them","these","they","this","those","to",
  "was","were","what","when","where","which","who","will","with","would",
  "me","all","any",
]);

const GENERIC_COLUMN_WORDS = new Set([
  "name","title","id","identifier","code","number","no","field","value","values",
]);

const GENERIC_ACTION_WORDS = new Set([
  "receive","received","receives","receiving","get","gets","got","getting",
  "have","has","had","having","use","uses","used","using","provide","provides",
  "provided","providing","submit","submits","submitted","submitting","attend",
  "attends","attended","attending","join","joins","joined","joining","manage",
  "manages","managed","managing","produce","produces","produced","producing",
  "grow","grows","grew","grown","growing","face","faces","faced","facing",
  "implement","implements","implemented","implementing","conduct","conducts",
  "conducted","conducting","handle","handles","handled","handling","cover",
  "covers","covered","covering","fund","funds","funded","funding","serve",
  "serves","served","serving",
]);

function normalizeToken(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return singularizeToken(text);
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function meaningfulTokens(value) {
  return tokenize(value).filter((token) => !STOP_WORDS.has(token));
}

function columnTokens(columnName) {
  return meaningfulTokens(columnName)
    .filter((token) => !GENERIC_COLUMN_WORDS.has(token));
}

function questionEntityTokens(question) {
  const tokens = meaningfulTokens(question);
  return tokens.filter(
    (token) =>
      !GENERIC_ACTION_WORDS.has(token) &&
      !/^(?:list|count|number|total|average|avg|mean|highest|lowest|top|bottom|maximum|minimum|max|min)$/.test(token)
  );
}

function scoreColumnAgainstQuestion(columnName, question) {
  const cTokens = columnTokens(columnName);
  const qTokens = questionEntityTokens(question);

  if (!cTokens.length || !qTokens.length) return 0;

  let exact = 0;
  for (const token of cTokens) {
    if (qTokens.includes(token)) exact += 1;
  }

  const overlap = exact / Math.max(1, cTokens.length);
  const cleanColumn = cTokens.join(" ");

  let bestSimilarity = 0;
  for (let start = 0; start < qTokens.length; start += 1) {
    for (let size = 1; size <= Math.min(4, qTokens.length - start); size += 1) {
      const phrase = qTokens.slice(start, start + size).join(" ");
      bestSimilarity = Math.max(
        bestSimilarity,
        similarity(cleanColumn, phrase)
      );
    }
  }

  return Math.min(1, overlap * 0.72 + bestSimilarity * 0.28);
}

function scoreDatasetName(datasetName, question) {
  const dTokens = meaningfulTokens(datasetName);
  const qTokens = questionEntityTokens(question);

  if (!dTokens.length || !qTokens.length) return 0;

  let exact = 0;
  for (const token of dTokens) {
    if (qTokens.includes(token)) exact += 1;
  }

  const overlap = exact / Math.max(1, dTokens.length);
  const lexical = similarity(dTokens.join(" "), qTokens.join(" "));

  return Math.min(1, overlap * 0.7 + lexical * 0.3);
}

function populatedValues(rows, column) {
  return (rows || [])
    .map((row) => row?.[column])
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
    );
}

function structuralDatasetScore(rows, entityColumn) {
  if (!Array.isArray(rows) || !rows.length || !entityColumn) {
    return {
      score: 0,
      repeatedEntityRatio: 0,
      descriptiveColumns: 0,
      numericColumns: 0,
    };
  }

  const entityValues = populatedValues(rows, entityColumn);
  const uniqueEntities = new Set(
    entityValues.map((value) => normalizeText(value))
  );

  const uniquenessRatio =
    entityValues.length
      ? uniqueEntities.size / entityValues.length
      : 1;

  const repeatedEntityRatio = Math.max(0, 1 - uniquenessRatio);

  const columns = Object.keys(rows[0] || {});
  let descriptiveColumns = 0;
  let numericColumns = 0;

  for (const column of columns) {
    if (normalizeText(column) === normalizeText(entityColumn)) continue;

    const values = populatedValues(rows, column);
    if (!values.length) continue;

    const numericCount = values.filter(
      (value) => parseNumber(value) !== null
    ).length;

    if (numericCount / values.length >= 0.7) {
      numericColumns += 1;
      continue;
    }

    const distinct = new Set(
      values.map((value) => normalizeText(value))
    ).size;

    if (distinct >= Math.min(3, values.length)) {
      descriptiveColumns += 1;
    }
  }

  const score = Math.min(
    1,
    repeatedEntityRatio * 0.55 +
      Math.min(1, descriptiveColumns / 2) * 0.3 +
      Math.min(1, numericColumns / 2) * 0.15
  );

  return {
    score,
    repeatedEntityRatio,
    descriptiveColumns,
    numericColumns,
  };
}

function detectRequestedOperation(question) {
  const text = normalizeText(question);

  if (/\b(?:how many|number of|count(?: of)?)\b/.test(text)) {
    return "distinct_count";
  }

  return "list";
}

function isLikelyDataQuestion(question) {
  const text = normalizeText(question);
  if (!text) return false;

  return (
    /^(?:which|what|who|show|list|name|give|tell|how many|number of|count of)\b/.test(text) ||
    /\b(?:received?|attended?|submitted?|used?|provided?|managed?|produced?|grew|grown|faced?|implemented?|conducted?|handled?|funded?|served?)\b/.test(text)
  );
}

function isReferentialQuestion(question) {
  const text = normalizeText(question);
  return /\b(?:they|them|their|those|these|it|that|same|ones)\b/.test(text);
}

function copyFilters(filters) {
  return Array.isArray(filters)
    ? filters.map((filter) => ({
        ...filter,
        value: Array.isArray(filter?.value)
          ? [...filter.value]
          : filter?.value,
      }))
    : [];
}

function resolveStrongLocalSemanticPlan({
  question,
  schema = [],
  datasets = {},
  context = null,
} = {}) {
  if (!isLikelyDataQuestion(question)) return null;

  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName = datasetSchema?.name;
    const rows = datasets?.[datasetName];

    if (!datasetName || !Array.isArray(rows) || !rows.length) continue;

    for (const column of datasetSchema.columns || []) {
      const columnName =
        typeof column === "string"
          ? column
          : column?.name;

      if (!columnName) continue;

      const columnScore =
        scoreColumnAgainstQuestion(columnName, question);

      if (columnScore < 0.32) continue;

      const datasetNameScore =
        scoreDatasetName(datasetName, question);

      const structure =
        structuralDatasetScore(rows, columnName);

      const totalScore =
        columnScore * 0.62 +
        datasetNameScore * 0.18 +
        structure.score * 0.20;

      candidates.push({
        dataset: datasetName,
        column: columnName,
        score: totalScore,
        columnScore,
        datasetNameScore,
        structure,
      });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const second = candidates[1];

  if (best.columnScore < 0.48 && best.score < 0.58) {
    return null;
  }

  if (
    second &&
    second.dataset !== best.dataset &&
    Math.abs(best.score - second.score) < 0.045 &&
    best.columnScore < 0.78
  ) {
    return null;
  }

  const sourceRows = datasets[best.dataset];

  let filters =
    inferValueFilters(
      sourceRows,
      question,
      [best.column]
    );

  if (
    (!filters || !filters.length) &&
    context?.isFollowUp === true &&
    isReferentialQuestion(question)
  ) {
    const datasetSchema =
      schema.find(
        (item) =>
          normalizeText(item?.name) === normalizeText(best.dataset)
      );

    const columns = new Set(
      (datasetSchema?.columns || [])
        .map((item) =>
          typeof item === "string"
            ? item
            : item?.name
        )
        .filter(Boolean)
        .map((name) => normalizeText(name))
    );

    filters = copyFilters(context.lastFilters).filter(
      (filter) =>
        columns.has(normalizeText(filter?.column))
    );
  }

  const operation = detectRequestedOperation(question);
  const confidence = Math.max(0, Math.min(1, best.score));

  return {
    route: "dataset",
    dataset: best.dataset,
    operation,
    column: best.column,
    labelColumn: best.column,
    groupBy: null,
    aggregation: null,
    direction: null,
    filters: Array.isArray(filters) ? filters : [],
    selectColumns: [best.column],
    outputRequested: true,
    transform: null,
    showAll: operation === "list",
    limit: operation === "list" ? 100 : 10,
    localSemanticResolved: true,
    localSemanticConfidence: confidence,
    localSemanticEvidence: {
      entityColumnScore: Number(best.columnScore.toFixed(4)),
      datasetNameScore: Number(best.datasetNameScore.toFixed(4)),
      structuralScore: Number(best.structure.score.toFixed(4)),
      repeatedEntityRatio: Number(
        best.structure.repeatedEntityRatio.toFixed(4)
      ),
    },
  };
}

module.exports = {
  tokenize,
  meaningfulTokens,
  scoreColumnAgainstQuestion,
  structuralDatasetScore,
  detectRequestedOperation,
  isLikelyDataQuestion,
  isReferentialQuestion,
  resolveStrongLocalSemanticPlan,
};
