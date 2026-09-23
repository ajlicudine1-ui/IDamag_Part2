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


function editDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");

  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);

  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const old = previous[j];
      const substitution = diagonal + (left[i - 1] === right[j - 1] ? 0 : 1);
      const insertion = previous[j - 1] + 1;
      const deletion = old + 1;

      previous[j] = Math.min(substitution, insertion, deletion);
      diagonal = old;
    }
  }

  return previous[right.length];
}

function fuzzyTokenMatch(token, target) {
  const a = normalizeText(token);
  const b = normalizeText(target);
  if (!a || !b) return false;
  if (a === b) return true;

  const distance = editDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  if (maxLength <= 4) return distance <= 1;
  if (maxLength <= 8) return distance <= 2;
  return distance / maxLength <= 0.24;
}

function questionHasFuzzyKeyword(question, keywords) {
  const tokens = normalizeText(question).split(/\s+/).filter(Boolean);
  return tokens.some((token) => keywords.some((keyword) => fuzzyTokenMatch(token, keyword)));
}

function detectStandardAggregateOperation(question) {
  const text = normalizeText(question);

  // Explicit mathematical operators take precedence over the phrase
  // "number of" when it is part of a metric name, e.g.
  // "average number of members by phase".
  if (/\b(?:total|sum|combined|altogether|in all)\b/.test(text)) return "sum";
  if (/\b(?:average|avg|mean)\b/.test(text)) return "average";
  if (/\bmedian\b/.test(text)) return "median";
  if (/\b(?:minimum|min|lowest|smallest|least)\b/.test(text)) return "minimum";
  if (/\b(?:maximum|max|highest|largest|greatest|most)\b/.test(text)) return "maximum";
  if (/\b(?:how many|number of|count(?: of)?)\b/.test(text)) return "row_count";

  // Local fallback must tolerate ordinary typing mistakes without needing Groq.
  if (questionHasFuzzyKeyword(question, ["total", "sum"])) return "sum";
  if (questionHasFuzzyKeyword(question, ["average", "mean"])) return "average";
  if (questionHasFuzzyKeyword(question, ["median"])) return "median";
  if (questionHasFuzzyKeyword(question, ["minimum", "lowest", "smallest"])) return "minimum";
  if (questionHasFuzzyKeyword(question, ["maximum", "highest", "largest"])) return "maximum";

  return null;
}

function detectGroupingPhrase(question) {
  const text = normalizeText(question);
  if (!text) return null;

  const match =
    text.match(/\b(?:grouped by|for each|per|by)\s+(.+?)(?=\s+(?:with|where|that|who|whose|having|in|from)\b|[?.!,]|$)/) ||
    text.match(/\beach\s+([a-z][a-z0-9 _/-]*?)(?=[?.!,]|$)/);

  if (!match?.[1]) return null;

  return match[1]
    .replace(/\b(?:total|sum|average|avg|mean|median|minimum|min|maximum|max|highest|lowest|largest|smallest|count|number)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function mapGroupedAggregateOperation(operation) {
  const map = {
    row_count: "group_count",
    sum: "group_sum",
    average: "group_average",
    minimum: "group_minimum",
    maximum: "group_maximum",
  };

  return map[operation] || null;
}

function scoreColumnAgainstPhrase(columnName, phrase) {
  if (!phrase) return 0;
  return scoreColumnAgainstQuestion(columnName, phrase);
}

function resolveBestGroupingColumn({
  datasetSchema,
  rows,
  phrase,
  excludedColumns = [],
} = {}) {
  if (!phrase) return null;

  const excluded = new Set(excludedColumns.map((value) => normalizeText(value)));
  const candidates = [];

  for (const rawColumn of datasetSchema?.columns || []) {
    const columnName = typeof rawColumn === "string" ? rawColumn : rawColumn?.name;
    if (!columnName || excluded.has(normalizeText(columnName))) continue;

    const values = populatedValues(rows, columnName);
    if (!values.length) continue;

    const numericRatio = numericRatioForColumn(rows, columnName);
    const phraseScore = scoreColumnAgainstPhrase(columnName, phrase);
    if (phraseScore < 0.42) continue;

    // Grouping dimensions are normally categorical; numeric group fields remain
    // possible but receive a penalty rather than being completely rejected.
    const categoricalBonus = numericRatio < 0.7 ? 0.18 : -0.08;
    const score = phraseScore + categoricalBonus;

    candidates.push({ column: columnName, score, phraseScore, numericRatio });
  }

  candidates.sort((a, b) => b.score - a.score || b.phraseScore - a.phraseScore);
  return candidates[0] || null;
}

function numericRatioForColumn(rows, columnName) {
  const values = populatedValues(rows, columnName);
  if (!values.length) return 0;

  const numeric = values.filter((value) => parseNumber(value) !== null).length;
  return numeric / values.length;
}

function resolveStandardLocalAggregatePlan({
  question,
  schema = [],
  datasets = {},
} = {}) {
  const operation = detectStandardAggregateOperation(question);
  if (!operation) return null;

  const groupingPhrase = detectGroupingPhrase(question);

  // Preserve the existing entity-count and quantity-aggregation resolvers for
  // ordinary ungrouped "how many/how much" questions. This resolver owns
  // row_count only when the user explicitly asks for a grouped calculation.
  if (operation === "row_count" && !groupingPhrase) return null;

  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName = datasetSchema?.name;
    const rows = datasets?.[datasetName];

    if (!datasetName || !Array.isArray(rows) || !rows.length) continue;

    const datasetNameScore = scoreDatasetName(datasetName, question);
    const datasetGrouping = resolveBestGroupingColumn({
      datasetSchema,
      rows,
      phrase: groupingPhrase,
    });

    if (operation === "row_count") {
      const filters = inferValueFilters(
        rows,
        question,
        [datasetGrouping?.column].filter(Boolean)
      );
      const grouping = datasetGrouping;

      const score = Math.min(
        1,
        0.58 +
          datasetNameScore * 0.10 +
          (Array.isArray(filters) && filters.length ? 0.16 : 0) +
          (grouping ? 0.16 : 0)
      );

      candidates.push({
        dataset: datasetName,
        column: null,
        filters: Array.isArray(filters) ? filters : [],
        grouping,
        columnScore: 1,
        numericRatio: 1,
        datasetNameScore,
        score,
      });
      continue;
    }

    for (const rawColumn of datasetSchema.columns || []) {
      const columnName = typeof rawColumn === "string" ? rawColumn : rawColumn?.name;
      if (!columnName) continue;

      if (
        groupingPhrase &&
        datasetGrouping?.column &&
        normalizeText(columnName) === normalizeText(datasetGrouping.column)
      ) {
        continue;
      }

      const numericRatio = numericRatioForColumn(rows, columnName);
      if (numericRatio < 0.7) continue;

      const columnScore = scoreColumnAgainstQuestion(columnName, question);
      if (columnScore < 0.30) continue;

      const grouping = datasetGrouping;

      const filters = inferValueFilters(
        rows,
        question,
        [columnName, grouping?.column].filter(Boolean)
      );

      const filterBonus = Array.isArray(filters) && filters.length ? 0.18 : 0;
      const groupingBonus = grouping ? 0.14 : 0;

      const score = Math.min(
        1,
        columnScore * 0.67 +
          numericRatio * 0.10 +
          datasetNameScore * 0.07 +
          filterBonus +
          groupingBonus
      );

      candidates.push({
        dataset: datasetName,
        column: columnName,
        filters: Array.isArray(filters) ? filters : [],
        grouping,
        columnScore,
        numericRatio,
        datasetNameScore,
        score,
      });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) =>
    b.score - a.score ||
    b.columnScore - a.columnScore ||
    b.numericRatio - a.numericRatio
  );

  const best = candidates[0];
  const second = candidates[1];

  if (operation !== "row_count") {
    // A bare aggregate word such as "what is the total?" must not
    // arbitrarily pick a numeric field just because its header contains
    // "total". Require real metric evidence in the current question.
    if (best.columnScore < 0.48) return null;

    if (
      second &&
      second.dataset !== best.dataset &&
      Math.abs(best.score - second.score) < 0.04 &&
      best.columnScore < 0.72
    ) {
      return null;
    }
  }

  const groupedOperation =
    best.grouping && groupingPhrase
      ? mapGroupedAggregateOperation(operation)
      : null;

  return {
    route: "dataset",
    dataset: best.dataset,
    operation: groupedOperation || operation,
    column: best.column,
    labelColumn: best.grouping?.column || null,
    groupBy: best.grouping?.column || null,
    aggregation: groupedOperation ? groupedOperation.replace(/^group_/, "") : null,
    direction: null,
    filters: best.filters,
    selectColumns: best.column ? [best.column] : [],
    outputRequested: true,
    transform: null,
    showAll: Boolean(groupedOperation),
    limit: groupedOperation ? 100 : 10,
    localSemanticResolved: true,
    localSemanticConfidence: best.score,
    localSemanticEvidence: {
      aggregateResolver: true,
      typoTolerantMathIntent: true,
      groupedCalculation: Boolean(groupedOperation),
      groupingPhrase: groupingPhrase || null,
      groupingColumn: best.grouping?.column || null,
      groupingColumnScore: best.grouping
        ? Number(best.grouping.phraseScore.toFixed(4))
        : null,
      metricColumnScore: Number(best.columnScore.toFixed(4)),
      numericRatio: Number(best.numericRatio.toFixed(4)),
      datasetNameScore: Number(best.datasetNameScore.toFixed(4)),
      groundedFilterCount: best.filters.length,
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
  const detectedMathOperation = detectStandardAggregateOperation(question);

  if (!detectedMathOperation && !isLikelyDataQuestion(question)) return null;

  const standardAggregatePlan =
    resolveStandardLocalAggregatePlan({
      question,
      schema,
      datasets,
    });

  if (standardAggregatePlan?.route === "dataset") {
    return standardAggregatePlan;
  }

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
  detectStandardAggregateOperation,
  resolveStandardLocalAggregatePlan,
  resolveStrongLocalSemanticPlan,
};
