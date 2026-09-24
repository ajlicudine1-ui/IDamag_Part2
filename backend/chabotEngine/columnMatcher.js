const {
  getColumns,
  findBestMatch,
  similarity,
  normalizeText,
  normalizeMatchTokens,
} = require("./utils");

const {
  getAliasesForColumn,
  normalizeSemanticText,
} = require("./semanticDictionary");

const QUESTION_WORDS = new Set([
  "a","an","are","available","can","could","display","do","does","for","from",
  "give","how","i","in","is","list","me","of","on","please","show","tell","the",
  "there","to","value","values","what","which","who","with","you",
]);

function cleanTargetText(value) {
  return normalizeMatchTokens(value)
    .filter((token) => !QUESTION_WORDS.has(token))
    .join(" ")
    .trim();
}

function compactMatchText(value) {
  return cleanTargetText(value)
    .replace(/\s+/g, "")
    .trim();
}

function scoreSemanticAlias(target, column) {
  const normalizedTarget = normalizeSemanticText(cleanTargetText(target));
  if (!normalizedTarget) return 0;

  const aliases = getAliasesForColumn(column);
  if (!aliases.length) return 0;

  let bestScore = 0;

  for (const alias of aliases) {
    const normalizedAlias = normalizeSemanticText(alias);
    if (!normalizedAlias) continue;

    if (normalizedTarget === normalizedAlias) {
      bestScore = Math.max(bestScore, 3);
      continue;
    }

    if (normalizedTarget.includes(normalizedAlias)) {
      bestScore = Math.max(bestScore, 2.6);
    }

    const aliasSimilarity = similarity(normalizedTarget, normalizedAlias);
    if (aliasSimilarity >= 0.8) {
      bestScore = Math.max(bestScore, 1.8 + aliasSimilarity);
    }
  }

  return bestScore;
}

function scoreColumnTarget(target, column) {
  const cleanTarget = cleanTargetText(target);
  const cleanColumn = cleanTargetText(column);

  if (!cleanTarget || !cleanColumn) return 0;

  if (cleanTarget === cleanColumn) return 5;

  const compactTarget = compactMatchText(target);
  const compactColumn = compactMatchText(column);

  if (compactTarget && compactColumn && compactTarget === compactColumn) {
    return 4.9;
  }

  if (cleanTarget.includes(cleanColumn)) {
    return 4.7;
  }

  if (
    compactTarget &&
    compactColumn &&
    compactTarget.includes(compactColumn)
  ) {
    return 4.6;
  }

  const semanticScore = scoreSemanticAlias(target, column);

  const targetTokens = new Set(cleanTarget.split(/\s+/).filter(Boolean));
  const columnTokens = new Set(cleanColumn.split(/\s+/).filter(Boolean));

  let exactMatches = 0;
  for (const token of columnTokens) {
    if (targetTokens.has(token)) exactMatches += 1;
  }

  const coverage =
    columnTokens.size > 0 ? exactMatches / columnTokens.size : 0;

  const directSimilarity = similarity(cleanTarget, cleanColumn);

  let phraseBonus = 0;
  if (
    cleanTarget.includes(cleanColumn) ||
    cleanColumn.includes(cleanTarget)
  ) {
    phraseBonus = 0.75;
  }

  let compactBonus = 0;
  if (
    compactTarget &&
    compactColumn &&
    (
      compactTarget.includes(compactColumn) ||
      compactColumn.includes(compactTarget)
    )
  ) {
    compactBonus = 1;
  }

  const normalScore =
    directSimilarity + coverage + phraseBonus + compactBonus;

  return Math.max(normalScore, semanticScore);
}

function findDatasetName(datasets, requestedName) {
  const names = Object.keys(datasets);

  if (names.length === 1 && !requestedName) {
    return names[0];
  }

  return findBestMatch(requestedName, names, 0.45);
}

function findColumn(rows, requestedColumn) {
  const ranked = rankColumns(rows, requestedColumn);

  return ranked[0] && ranked[0].score >= 0.75
    ? ranked[0].column
    : null;
}

function rankColumns(rows, target) {
  return getColumns(rows)
    .map((column) => ({
      column,
      score: scoreColumnTarget(target, column),
    }))
    .sort((a, b) => b.score - a.score);
}

function findDatasetsContainingColumn(datasets, requestedColumn) {
  const results = [];

  for (const [datasetName, rows] of Object.entries(datasets || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;

    const ranked = rankColumns(rows, requestedColumn);
    const best = ranked[0];

    if (best && best.score >= 0.75) {
      results.push({
        dataset: datasetName,
        column: best.column,
        score: best.score,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

function normalizedColumnMap(rows) {
  const map = new Map();

  for (const column of getColumns(rows)) {
    const key = normalizeText(column);

    if (key && !map.has(key)) {
      map.set(key, column);
    }
  }

  return map;
}

function findSharedColumns(leftRows, rightRows) {
  const left = normalizedColumnMap(leftRows);
  const right = normalizedColumnMap(rightRows);
  const shared = [];

  for (const [key, leftColumn] of left.entries()) {
    const rightColumn = right.get(key);
    if (!rightColumn) continue;

    shared.push({
      leftColumn,
      rightColumn,
      normalizedName: key,
    });
  }

  return shared;
}


/**
 * Conservative ambiguity guard. It only interrupts a dataset plan when the
 * chosen field is not explicitly named and two live columns are nearly tied.
 */
function singularizeToken(token) {
  const value = String(token || "").trim().toLowerCase();
  if (!value) return "";

  // Conservative English morphology used only for detecting an EXPLICIT
  // schema-field mention in the user's wording. This prevents questions such
  // as "what municipalities are they from?" from being treated as ambiguous
  // when the live field is "Municipality".
  if (value.length > 4 && value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }

  if (value.length > 4 && value.endsWith("ses")) {
    return value.slice(0, -2);
  }

  if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }

  return value;
}

function morphologyAwareFieldText(value) {
  return normalizeMatchTokens(value)
    .map(singularizeToken)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function questionExplicitlyNamesColumn(question, column) {
  const questionText = morphologyAwareFieldText(question);
  const columnText = morphologyAwareFieldText(column);

  if (!questionText || !columnText) return false;

  const escaped = columnText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const phrase = new RegExp(`(^|\\s)${escaped}(?=$|\\s)`, "u");

  return phrase.test(questionText);
}

function detectColumnAmbiguity({ plan, datasets, question, minScore = 0.9, maxGap = 0.08 }) {
  if (!plan || plan.route !== "dataset" || !plan.dataset || !plan.column) return plan;
  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

  // Explicit live-schema wording ALWAYS wins over fuzzy ambiguity scoring.
  // Examples:
  //   Municipality  <-> municipalities
  //   Commodity     <-> commodities
  //   Association   <-> associations
  // This is generic and based only on the selected worksheet's live columns.
  const explicitlyNamedLiveColumn = getColumns(rows).find((column) =>
    questionExplicitlyNamesColumn(question, column)
  );

  if (explicitlyNamedLiveColumn) {
    return plan;
  }

  const normalizedQuestion = normalizeText(question);
  const chosenText = normalizeText(plan.column);
  if (chosenText && normalizedQuestion.includes(chosenText)) return plan;

  const ranked = rankColumns(rows, question).slice(0, 2);
  if (ranked.length < 2) return plan;
  const [first, second] = ranked;

  if (
    first.score >= minScore &&
    second.score >= minScore &&
    Math.abs(first.score - second.score) <= maxGap &&
    normalizeText(first.column) !== normalizeText(second.column)
  ) {
    return {
      route: "clarify",
      question: `Did you mean "${first.column}" or "${second.column}"?`,
      ambiguity: {
        dataset: plan.dataset,
        candidates: ranked.map((item) => ({ column: item.column, score: Number(item.score.toFixed(4)) })),
      },
    };
  }

  return plan;
}

module.exports = {
  cleanTargetText,
  compactMatchText,
  scoreSemanticAlias,
  scoreColumnTarget,
  findDatasetName,
  findColumn,
  rankColumns,
  findDatasetsContainingColumn,
  findSharedColumns,
  questionExplicitlyNamesColumn,
  detectColumnAmbiguity,
};
