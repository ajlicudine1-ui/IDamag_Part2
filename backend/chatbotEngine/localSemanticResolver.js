const {
  normalizeText,
  similarity,
  singularizeToken,
  parseNumber,
} = require("./utils");

const {
  inferValueFilters,
} = require("./filterEngine");

const {
  resolveLocalRelationPlan,
} = require("./localRelationResolver");

const {
  resolveLocalQuantityAggregationPlan,
  resolveLocalMathematicalPlan,
} = require("./localAggregationResolver");

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


function hasExplicitAbsenceIntent(question) {
  const text = normalizeText(question);
  if (!text) return false;

  return (
    /\b(?:with|have|has|having)\s+no\s+\w/.test(text) ||
    /\bwithout\s+\w/.test(text) ||
    /\b(?:with|have|has|having)\s+(?:missing|blank|empty)\s+\w/.test(text) ||
    /\bwhere\b.*\b(?:missing|blank|empty|no)\b/.test(text)
  );
}

function extractAbsenceParts(question) {
  const text = normalizeText(question);
  if (!text) return null;

  const patterns = [
    /^(.*?)(?:\bwith\s+no\s+)(.+)$/,
    /^(.*?)(?:\b(?:have|has|having)\s+no\s+)(.+)$/,
    /^(.*?)(?:\bwithout\s+)(.+)$/,
    /^(.*?)(?:\bwith\s+(?:missing|blank|empty)\s+)(.+)$/,
    /^(.*?)(?:\b(?:have|has|having)\s+(?:missing|blank|empty)\s+)(.+)$/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const subject = match[1]
      .replace(/^(?:are there any|is there any|which|what|show|list|find|give me|tell me|do any|does any)\s+/, "")
      .trim();

    const condition = match[2].trim();
    if (condition) return { subject, condition };
  }

  const whereMatch = text.match(/^(.*?)\bwhere\b(.+)$/);
  if (whereMatch && /\b(?:missing|blank|empty|no)\b/.test(whereMatch[2])) {
    const subject = whereMatch[1]
      .replace(/^(?:are there any|is there any|which|what|show|list|find|give me|tell me)\s+/, "")
      .trim();
    const condition = whereMatch[2]
      .replace(/^.*?\b(?:missing|blank|empty|no)\b\s*/, "")
      .trim();
    if (condition) return { subject, condition };
  }

  return null;
}

function resolveLocalAbsencePlan({ question, schema = [], datasets = {} } = {}) {
  if (!hasExplicitAbsenceIntent(question)) return null;

  const parts = extractAbsenceParts(question);
  if (!parts?.condition) return null;

  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName = datasetSchema?.name;
    const rows = datasets?.[datasetName];
    if (!datasetName || !Array.isArray(rows) || !rows.length) continue;

    const columns = (datasetSchema.columns || [])
      .map((column) => typeof column === "string" ? column : column?.name)
      .filter(Boolean);

    const conditionCandidates = columns
      .map((column) => ({
        column,
        score: scoreColumnAgainstQuestion(column, parts.condition),
      }))
      .filter((item) => item.score >= 0.45)
      .sort((a, b) => b.score - a.score);

    if (!conditionCandidates.length) continue;

    const entityCandidates = columns
      .filter((column) => column !== conditionCandidates[0].column)
      .map((column) => ({
        column,
        score: scoreColumnAgainstQuestion(column, parts.subject || question),
      }))
      .filter((item) => item.score >= 0.45)
      .sort((a, b) => b.score - a.score);

    if (!entityCandidates.length) continue;

    const condition = conditionCandidates[0];
    const entity = entityCandidates[0];

    const combined =
      condition.score * 0.62 +
      entity.score * 0.38;

    candidates.push({
      dataset: datasetName,
      conditionColumn: condition.column,
      entityColumn: entity.column,
      conditionScore: condition.score,
      entityScore: entity.score,
      score: combined,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];

  if (
    second &&
    second.dataset !== best.dataset &&
    Math.abs(best.score - second.score) < 0.04
  ) {
    return {
      route: "clarify",
      question: `I found more than one possible field for the missing-value condition. Which worksheet or field should I use?`,
      confidence: 0.35,
      localAbsenceAmbiguous: true,
    };
  }

  return {
    route: "dataset",
    dataset: best.dataset,
    operation: "list",
    column: best.entityColumn,
    labelColumn: best.entityColumn,
    groupBy: null,
    aggregation: null,
    direction: null,
    filters: [
      {
        column: best.conditionColumn,
        operator: "empty_or_zero",
        value: null,
      },
    ],
    selectColumns: [best.entityColumn],
    outputRequested: true,
    transform: null,
    showAll: true,
    limit: 100,
    localAbsenceResolved: true,
    localSemanticConfidence: Math.max(0, Math.min(1, best.score)),
    localAbsenceEvidence: {
      entityColumn: best.entityColumn,
      conditionColumn: best.conditionColumn,
      entityScore: Number(best.entityScore.toFixed(4)),
      conditionScore: Number(best.conditionScore.toFixed(4)),
    },
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
    /^(?:which|what|who|show|list|name|give|tell|how many|number of|count of|are there any|is there any|do any|does any|find)\b/.test(text) ||
    /\b(?:received?|attended?|submitted?|used?|provided?|managed?|produced?|grew|grown|faced?|implemented?|conducted?|handled?|funded?|served?)\b/.test(text)
  );
}

function isReferentialQuestion(question) {
  const text = normalizeText(question);
  return /\b(?:they|them|their|those|these|it|that|same|ones)\b/.test(text);
}

function isEntityListQuestion(question) {
  const text = normalizeText(question);
  if (!text) return false;

  if (hasExplicitAbsenceIntent(question)) return false;

  // Mathematical/ranking requests belong to the mathematical planner.
  if (/\b(?:total|sum|average|avg|mean|median|highest|lowest|largest|smallest|maximum|minimum|max|min|top|bottom|how many|number of|count)\b/.test(text)) {
    return false;
  }

  return /^(?:what|which|who|list|show|name|give me|tell me|find)\b/.test(text);
}

function isMostlyNumericColumn(rows, column) {
  const values = populatedValues(rows, column);
  if (!values.length) return false;
  const numeric = values.filter((value) => parseNumber(value) !== null).length;
  return numeric / values.length >= 0.7;
}

function identityColumnFallbackScore(rows, column, question, filterColumns = new Set()) {
  if (!column || filterColumns.has(normalizeText(column))) return 0;
  if (isMostlyNumericColumn(rows, column)) return 0;

  const name = normalizeText(column);
  const semantic = scoreColumnAgainstQuestion(column, question);
  const values = populatedValues(rows, column);
  if (!values.length) return 0;

  const distinct = new Set(values.map((value) => normalizeText(value))).size;
  const uniqueness = distinct / Math.max(1, values.length);
  const avgLength = values.reduce((sum, value) => sum + String(value).trim().length, 0) / values.length;

  let identitySignal = 0;
  if (/\b(?:name|title)\b/.test(name)) identitySignal = 1;
  else if (/\b(?:id|identifier|code)\b/.test(name)) identitySignal = 0.55;

  const descriptiveSignal = Math.min(1, avgLength / 40);

  return Math.min(
    1,
    semantic * 0.45 +
      identitySignal * 0.30 +
      uniqueness * 0.15 +
      descriptiveSignal * 0.10
  );
}

function resolveLocalEntityListPlan({ question, schema = [], datasets = {} } = {}) {
  if (!isEntityListQuestion(question)) return null;

  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName = datasetSchema?.name;
    const rows = datasets?.[datasetName];
    if (!datasetName || !Array.isArray(rows) || !rows.length) continue;

    const columns = (datasetSchema.columns || [])
      .map((column) => typeof column === "string" ? column : column?.name)
      .filter(Boolean);

    // Resolve literal values such as Province=Pangasinan first. This also
    // helps us prefer the worksheet that actually contains the requested scope.
    const filters = inferValueFilters(rows, question, []);
    const filterColumns = new Set(
      (filters || []).map((filter) => normalizeText(filter?.column)).filter(Boolean)
    );

    const scored = columns
      .map((column) => ({
        column,
        semanticScore: scoreColumnAgainstQuestion(column, question),
        fallbackScore: identityColumnFallbackScore(rows, column, question, filterColumns),
      }))
      .filter((item) => item.semanticScore >= 0.30 || item.fallbackScore >= 0.30)
      .map((item) => ({
        ...item,
        score: Math.max(item.semanticScore, item.fallbackScore),
      }))
      .sort((a, b) => b.score - a.score);

    if (!scored.length) continue;

    const bestColumn = scored[0];
    const datasetNameScore = scoreDatasetName(datasetName, question);
    const filterEvidence = Array.isArray(filters) && filters.length ? 1 : 0;

    const score = Math.min(
      1,
      bestColumn.score * 0.72 +
        datasetNameScore * 0.10 +
        filterEvidence * 0.18
    );

    candidates.push({
      dataset: datasetName,
      column: bestColumn.column,
      filters: Array.isArray(filters) ? filters : [],
      score,
      columnScore: bestColumn.score,
      semanticScore: bestColumn.semanticScore,
      fallbackScore: bestColumn.fallbackScore,
    });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const second = candidates[1];

  // When there is no grounded filter and two worksheets are equally plausible,
  // do not guess an entity source.
  if (
    second &&
    Math.abs(best.score - second.score) < 0.035 &&
    !best.filters.length &&
    !second.filters.length
  ) {
    return null;
  }

  if (best.columnScore < 0.42 && best.score < 0.52) return null;

  return {
    route: "dataset",
    dataset: best.dataset,
    operation: "list",
    column: best.column,
    labelColumn: best.column,
    groupBy: null,
    aggregation: null,
    direction: null,
    filters: copyFilters(best.filters),
    selectColumns: [best.column],
    outputRequested: true,
    transform: null,
    showAll: true,
    limit: 100,
    localEntityListResolved: true,
    localSemanticConfidence: Math.max(0, Math.min(1, best.score)),
    localEntityListEvidence: {
      columnScore: Number(best.columnScore.toFixed(4)),
      semanticScore: Number(best.semanticScore.toFixed(4)),
      fallbackScore: Number(best.fallbackScore.toFixed(4)),
      filterCount: best.filters.length,
    },
  };
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
  const absencePlan =
    resolveLocalAbsencePlan({
      question,
      schema,
      datasets,
    });

  if (absencePlan) {
    return absencePlan;
  }

  // Preserve the specialized quantity/unit resolver first (for questions such
  // as "how many kilograms of fertilizer were distributed?").
  const aggregationPlan =
    resolveLocalQuantityAggregationPlan({
      question,
      schema,
      datasets,
    });

  if (
    aggregationPlan?.route ===
      "clarify"
  ) {
    return aggregationPlan;
  }

  if (
    aggregationPlan?.route ===
      "dataset"
  ) {
    return aggregationPlan;
  }

  const mathematicalPlan =
    resolveLocalMathematicalPlan({
      question,
      schema,
      datasets,
    });

  if (mathematicalPlan) {
    return mathematicalPlan;
  }

  if (!isLikelyDataQuestion(question)) return null;

  const relationPlan =
    resolveLocalRelationPlan({
      question,
      schema,
      datasets,
    });

  if (
    relationPlan?.route ===
      "clarify"
  ) {
    return relationPlan;
  }

  if (
    relationPlan?.route ===
      "dataset" &&
    Number(
      relationPlan.localSemanticConfidence ||
      0
    ) >=
      0.5
  ) {
    if (
      context?.isFollowUp ===
        true &&
      isReferentialQuestion(
        question
      ) &&
      (
        !Array.isArray(
          relationPlan.filters
        ) ||
        !relationPlan.filters.length
      )
    ) {
      const datasetSchema =
        schema.find(
          (item) =>
            normalizeText(item?.name) ===
            normalizeText(relationPlan.dataset)
        );

      const liveColumns =
        new Set(
          (datasetSchema?.columns || [])
            .map(
              (item) =>
                typeof item === "string"
                  ? item
                  : item?.name
            )
            .filter(Boolean)
            .map((name) => normalizeText(name))
        );

      relationPlan.filters =
        copyFilters(
          context.lastFilters
        ).filter(
          (filter) =>
            liveColumns.has(
              normalizeText(filter?.column)
            )
        );
    }

    return relationPlan;
  }

  const entityListPlan =
    resolveLocalEntityListPlan({
      question,
      schema,
      datasets,
    });

  if (entityListPlan) {
    return entityListPlan;
  }

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
    Math.abs(
      best.score -
      second.score
    ) < 0.045 &&
    best.columnScore <
      0.78
  ) {
    return {
      route: "clarify",
      question:
        `I found multiple possible matches: ${best.column} in ${best.dataset} or ${second.column} in ${second.dataset}. Which one should I use?`,
      confidence: 0.35,
      localSemanticResolved: false,
      localSemanticAmbiguous: true,
    };
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
  hasExplicitAbsenceIntent,
  resolveLocalAbsencePlan,
  isEntityListQuestion,
  resolveLocalEntityListPlan,
  resolveStrongLocalSemanticPlan,
};
