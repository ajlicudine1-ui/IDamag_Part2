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

function morphologyTokens(value) {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => singularizeToken(token))
    .filter((token) => token && !QUESTION_WORDS.has(token));
}

function scoreMorphologyOverlap(target, column) {
  const targetTokens = new Set(morphologyTokens(target));
  const columnTokens = new Set(morphologyTokens(column));

  if (!targetTokens.size || !columnTokens.size) return 0;

  let matched = 0;
  for (const token of columnTokens) {
    if (targetTokens.has(token)) matched += 1;
  }

  if (!matched) return 0;

  const coverage = matched / columnTokens.size;
  const precision = matched / targetTokens.size;

  // Morphology-aware overlap is deliberately a supporting signal. Exact
  // header/alias matches still outrank it, but plural/singular wording such as
  // "municipalities" -> "Municipality" or "members" -> "No. of members"
  // gets a useful boost without dataset-specific aliases.
  return (coverage * 1.35) + (precision * 0.45);
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

  const morphologyScore = scoreMorphologyOverlap(target, column);

  return Math.max(normalScore, semanticScore, morphologyScore);
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

function contextColumnCandidates(context) {
  if (!context || context.isFollowUp !== true) return [];

  const values = [
    ...(Array.isArray(context.lastMetric) ? context.lastMetric : [context.lastMetric]),
    context.lastSubjectColumn,
    context.lastPlan?.column,
    context.lastPlan?.labelColumn,
    context.lastPlan?.groupBy,
    ...(Array.isArray(context.lastPlan?.selectColumns) ? context.lastPlan.selectColumns : []),
    context.semanticPlan?.column,
    context.semanticPlan?.metricColumn,
    context.semanticPlan?.labelColumn,
    context.semanticPlan?.groupBy,
    ...(Array.isArray(context.semanticPlan?.selectColumns) ? context.semanticPlan.selectColumns : []),
  ];

  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resolveContextColumn(rows, context, candidates) {
  const liveColumns = getColumns(rows);
  const liveByNormalized = new Map(
    liveColumns.map((column) => [normalizeText(column), column])
  );

  const candidateSet = new Set(
    (candidates || []).map((item) => normalizeText(item.column))
  );

  for (const previous of contextColumnCandidates(context)) {
    const exact = liveByNormalized.get(normalizeText(previous));
    if (exact && candidateSet.has(normalizeText(exact))) return exact;

    // A previous verified field may have been stored using a harmless schema
    // spelling variant. Resolve it only when the live match is strong and is
    // one of the current ambiguity candidates.
    const ranked = rankColumns(rows, previous);
    const best = ranked[0];
    if (
      best &&
      best.score >= 1.25 &&
      candidateSet.has(normalizeText(best.column))
    ) {
      return best.column;
    }
  }

  return null;
}

function buildColumnClarification(plan, ranked) {
  const first = ranked?.[0]?.column;
  const second = ranked?.[1]?.column;
  if (!first || !second) return "Which field should I use?";

  const operation = normalizeText(plan?.operation || "");
  const operationLabel = {
    sum: "total",
    average: "average",
    median: "median",
    minimum: "minimum",
    maximum: "maximum",
    rank_rows: "ranking",
    rank_groups: "ranking",
    list: "list",
    lookup: "lookup",
    distinct_count: "count",
    non_empty_count: "count",
  }[operation] || "answer";

  return `For this ${operationLabel}, did you mean "${first}" or "${second}"?`;
}

/**
 * Conservative ambiguity guard shared by Groq and local plans.
 *
 * Rules:
 * 1. An explicitly named live field always wins.
 * 2. For a real follow-up, verified conversational context may break a
 *    near-tie between live fields.
 * 3. If the tie remains unresolved, ask a targeted clarification that names
 *    the two live fields instead of guessing.
 *
 * The logic is schema-driven and contains no dataset-specific field names.
 */
function detectColumnAmbiguity({
  plan,
  datasets,
  question,
  context = null,
  minScore = 0.8,
  maxGap = 0.18,
}) {
  if (!plan || plan.route !== "dataset" || !plan.dataset || !plan.column) return plan;
  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) return plan;

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

  const nearTie =
    first.score >= minScore &&
    second.score >= minScore &&
    Math.abs(first.score - second.score) <= maxGap &&
    normalizeText(first.column) !== normalizeText(second.column);

  if (!nearTie) return plan;

  const contextualColumn = resolveContextColumn(rows, context, ranked);
  if (contextualColumn) {
    const selectColumns = Array.isArray(plan.selectColumns)
      ? plan.selectColumns.map((column) =>
          normalizeText(column) === normalizeText(plan.column)
            ? contextualColumn
            : column
        )
      : plan.selectColumns;

    return {
      ...plan,
      column: contextualColumn,
      selectColumns,
      contextualAmbiguityResolved: true,
      ambiguityCandidates: ranked.map((item) => ({
        column: item.column,
        score: Number(item.score.toFixed(4)),
      })),
    };
  }

  return {
    route: "clarify",
    question: buildColumnClarification(plan, ranked),
    ambiguity: {
      dataset: plan.dataset,
      candidates: ranked.map((item) => ({
        column: item.column,
        score: Number(item.score.toFixed(4)),
      })),
      contextAttempted: Boolean(context?.isFollowUp),
    },
  };
}

module.exports = {
  cleanTargetText,
  compactMatchText,
  scoreSemanticAlias,
  scoreColumnTarget,
  scoreMorphologyOverlap,
  findDatasetName,
  findColumn,
  rankColumns,
  findDatasetsContainingColumn,
  findSharedColumns,
  questionExplicitlyNamesColumn,
  contextColumnCandidates,
  resolveContextColumn,
  buildColumnClarification,
  detectColumnAmbiguity,
};
