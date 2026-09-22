const {
  normalizeText,
  similarity,
  singularizeToken,
  parseNumber,
} = require("./utils");

const {
  inferValueFilters,
} = require("./filterEngine");

const RELATION_VERBS = new Set([
  "receive","received","receives","receiving",
  "get","gets","got","getting",
  "attend","attends","attended","attending",
  "submit","submits","submitted","submitting",
  "use","uses","used","using",
  "provide","provides","provided","providing",
  "manage","manages","managed","managing",
  "produce","produces","produced","producing",
  "grow","grows","grew","grown","growing",
  "face","faces","faced","facing",
  "experience","experiences","experienced","experiencing",
  "implement","implements","implemented","implementing",
  "conduct","conducts","conducted","conducting",
  "handle","handles","handled","handling",
  "fund","funds","funded","funding",
  "serve","serves","served","serving",
  "join","joins","joined","joining",
  "belong","belongs","belonged","belonging",
  "represent","represents","represented","representing",
]);

const ACTION_HINTS = {
  receive: ["item","intervention","detail","support","assistance","benefit","grant","fund","funding","equipment","material","distribution","allocation","package","service"],
  get: ["item","intervention","detail","support","assistance","benefit","grant","fund","funding","equipment","material","distribution"],
  attend: ["training","activity","event","session","program","course","attendance","workshop","seminar"],
  join: ["training","activity","event","session","program","course","membership","group"],
  submit: ["report","document","form","submission","requirement","record"],
  use: ["system","tool","equipment","technology","method","platform","application","software"],
  provide: ["service","assistance","support","intervention","item","program"],
  manage: ["project","program","task","system","activity","portfolio"],
  produce: ["commodity","product","crop","produce","output"],
  grow: ["commodity","product","crop","produce","plant"],
  face: ["risk","hazard","issue","problem","challenge","threat"],
  experience: ["risk","hazard","issue","problem","challenge","event"],
  implement: ["project","program","activity","intervention","initiative"],
  conduct: ["activity","training","event","session","program","inspection"],
  handle: ["item","case","request","transaction","activity","project"],
  fund: ["fund","funding","amount","budget","grant","project","program"],
  serve: ["client","beneficiary","customer","area","municipality","barangay"],
  belong: ["municipality","province","region","office","division","category","group","organization"],
  represent: ["barangay","municipality","province","region","office","group"],
};

const AUX = new Set([
  "do","does","did","has","have","had","is","are","was","were",
  "be","been","being","can","could","will","would","shall","should",
  "may","might","must",
]);

const QUESTION = new Set([
  "which","what","who","show","list","give","tell","name",
  "how","many","number","of","the","a","an","all",
]);

function normalizeToken(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return singularizeToken(text);
}

function tokens(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function cleanPhraseTokens(value) {
  return tokens(value).filter(
    (token) =>
      !QUESTION.has(token) &&
      !AUX.has(token)
  );
}

function canonicalVerb(value) {
  const token = normalizeToken(value);

  const irregular = {
    got: "get",
    grew: "grow",
    grown: "grow",
  };

  if (irregular[token]) return irregular[token];

  if (token.endsWith("ing") && token.length > 5) {
    const stem = token.slice(0, -3);
    if (RELATION_VERBS.has(stem)) return stem;
    if (RELATION_VERBS.has(`${stem}e`)) return `${stem}e`;
  }

  if (token.endsWith("ed") && token.length > 4) {
    const stem = token.slice(0, -2);
    if (RELATION_VERBS.has(stem)) return stem;
    if (RELATION_VERBS.has(`${stem}e`)) return `${stem}e`;
  }

  if (token.endsWith("s") && token.length > 3) {
    const stem = token.slice(0, -1);
    if (RELATION_VERBS.has(stem)) return stem;
  }

  return token;
}

function parseRelationFrame(question) {
  const original =
    String(question || "")
      .replace(/[?.!]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

  if (!original) return null;

  const normalized = normalizeText(original);

  let match =
    normalized.match(
      /^(?:which|what|who|how many|number of|count of)\s+(.+?)\s+([a-z][a-z-]*)\s+(.+)$/
    );

  if (match?.[1] && match?.[2]) {
    const verb = canonicalVerb(match[2]);
    if (RELATION_VERBS.has(verb)) {
      return {
        entityPhrase: match[1].trim(),
        verb,
        objectPhrase: match[3].trim(),
      };
    }
  }

  match =
    normalized.match(
      /^(?:show|list|give|tell|name)(?: me)?\s+(.+?)\s+(?:that|who|which)\s+([a-z][a-z-]*)\s+(.+)$/
    );

  if (match?.[1] && match?.[2]) {
    const verb = canonicalVerb(match[2]);
    if (RELATION_VERBS.has(verb)) {
      return {
        entityPhrase: match[1].trim(),
        verb,
        objectPhrase: match[3].trim(),
      };
    }
  }

  return null;
}

function phraseColumnScore(phrase, columnName) {
  const p = cleanPhraseTokens(phrase);
  const c = cleanPhraseTokens(columnName)
    .filter((token) => !["name","title","id","code","number","no"].includes(token));

  if (!p.length || !c.length) return 0;

  let overlap = 0;
  for (const token of c) {
    if (p.includes(token)) overlap += 1;
  }

  const overlapScore = overlap / Math.max(1, c.length);
  const cText = c.join(" ");

  let lexical = 0;
  for (let i = 0; i < p.length; i += 1) {
    for (let size = 1; size <= Math.min(4, p.length - i); size += 1) {
      lexical = Math.max(
        lexical,
        similarity(cText, p.slice(i, i + size).join(" "))
      );
    }
  }

  return Math.min(1, overlapScore * 0.75 + lexical * 0.25);
}

function evidenceColumnScore({ objectPhrase, verb, columnName }) {
  const lexical = phraseColumnScore(objectPhrase, columnName);
  const cTokens = cleanPhraseTokens(columnName);
  const hints = ACTION_HINTS[canonicalVerb(verb)] || [];

  let hits = 0;
  for (const token of cTokens) {
    if (hints.some((hint) => normalizeToken(hint) === token)) hits += 1;
  }

  const hintScore = cTokens.length ? hits / cTokens.length : 0;
  return Math.min(1, lexical * 0.68 + hintScore * 0.32);
}

function nonEmptyRate(rows, column) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let count = 0;

  for (const row of rows) {
    const value = row?.[column];
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ""
    ) {
      count += 1;
    }
  }

  return count / rows.length;
}

function repeatedEntityRatio(rows, entityColumn) {
  const values = (rows || [])
    .map((row) => row?.[entityColumn])
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
    );

  if (!values.length) return 0;

  const distinct = new Set(
    values.map((value) => normalizeText(value))
  ).size;

  return Math.max(0, 1 - distinct / values.length);
}

function numericCompanionRatio(rows, entityColumn) {
  if (!Array.isArray(rows) || !rows.length) return 0;

  const columns = Object.keys(rows[0] || {});
  let numeric = 0;
  let usable = 0;

  for (const column of columns) {
    if (normalizeText(column) === normalizeText(entityColumn)) continue;

    const values = rows
      .map((row) => row?.[column])
      .filter(
        (value) =>
          value !== null &&
          value !== undefined &&
          String(value).trim() !== ""
      );

    if (!values.length) continue;
    usable += 1;

    const numericCount = values.filter(
      (value) => parseNumber(value) !== null
    ).length;

    if (numericCount / values.length >= 0.7) numeric += 1;
  }

  return usable ? Math.min(1, numeric / Math.max(1, usable)) : 0;
}

function clarification(frame, candidates) {
  const options = candidates
    .slice(0, 3)
    .map((candidate) => `${candidate.column} in ${candidate.dataset}`);

  return {
    route: "clarify",
    question:
      options.length
        ? `I found more than one possible match for "${frame?.entityPhrase || "that entity"}": ${options.join(", ")}. Which one should I use?`
        : `I could not confidently resolve "${frame?.entityPhrase || "that entity"}" from the available worksheets. Could you be a little more specific?`,
    confidence: 0.35,
    localSemanticResolved: false,
    localSemanticAmbiguous: true,
  };
}

function resolveLocalRelationPlan({
  question,
  schema = [],
  datasets = {},
} = {}) {
  const frame = parseRelationFrame(question);
  if (!frame) return null;

  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName = datasetSchema?.name;
    const rows = datasets?.[datasetName];

    if (!datasetName || !Array.isArray(rows) || !rows.length) continue;

    const columns = (datasetSchema.columns || [])
      .map((column) => typeof column === "string" ? column : column?.name)
      .filter(Boolean);

    for (const entityColumn of columns) {
      const entityScore = phraseColumnScore(frame.entityPhrase, entityColumn);
      if (entityScore < 0.34) continue;

      let bestEvidenceColumn = null;
      let bestEvidenceScore = 0;
      let secondEvidenceScore = 0;

      for (const column of columns) {
        if (normalizeText(column) === normalizeText(entityColumn)) continue;

        const score = evidenceColumnScore({
          objectPhrase: frame.objectPhrase,
          verb: frame.verb,
          columnName: column,
        });

        if (score > bestEvidenceScore) {
          secondEvidenceScore = bestEvidenceScore;
          bestEvidenceScore = score;
          bestEvidenceColumn = column;
        } else if (score > secondEvidenceScore) {
          secondEvidenceScore = score;
        }
      }

      const repeatScore = repeatedEntityRatio(rows, entityColumn);
      const numericScore = numericCompanionRatio(rows, entityColumn);
      const structuralScore = Math.min(
        1,
        repeatScore * 0.72 + numericScore * 0.28
      );

      const datasetLexical = phraseColumnScore(
        `${frame.entityPhrase} ${frame.objectPhrase}`,
        datasetName
      );

      const score =
        entityScore * 0.55 +
        bestEvidenceScore * 0.23 +
        structuralScore * 0.17 +
        datasetLexical * 0.05;

      candidates.push({
        dataset: datasetName,
        column: entityColumn,
        score,
        entityScore,
        evidenceColumn: bestEvidenceColumn,
        evidenceScore: bestEvidenceScore,
        evidenceGap: bestEvidenceScore - secondEvidenceScore,
        structuralScore,
        repeatScore,
      });
    }
  }

  if (!candidates.length) return clarification(frame, []);

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const second = candidates[1];

  if (best.entityScore < 0.5 && best.score < 0.58) {
    return clarification(frame, candidates);
  }

  if (
    second &&
    (
      second.dataset !== best.dataset ||
      normalizeText(second.column) !== normalizeText(best.column)
    ) &&
    Math.abs(best.score - second.score) < 0.04 &&
    Math.abs(best.evidenceScore - second.evidenceScore) < 0.08
  ) {
    return clarification(frame, candidates);
  }

  if (
    best.evidenceScore >= 0.45 &&
    best.evidenceGap < 0.035
  ) {
    return clarification(frame, candidates);
  }

  const rows = datasets[best.dataset];

  let filters = inferValueFilters(
    rows,
    question,
    [best.column]
  );

  if (!Array.isArray(filters)) filters = [];

  if (
    best.evidenceColumn &&
    best.evidenceScore >= 0.42 &&
    !filters.some(
      (filter) =>
        normalizeText(filter?.column) ===
        normalizeText(best.evidenceColumn)
    ) &&
    nonEmptyRate(rows, best.evidenceColumn) < 0.9999
  ) {
    filters.push({
      column: best.evidenceColumn,
      operator: "not_empty",
      value: true,
    });
  }

  const isCount =
    /\b(?:how many|number of|count of)\b/.test(normalizeText(question));

  const confidence = Math.max(0, Math.min(1, best.score));

  return {
    route: "dataset",
    dataset: best.dataset,
    operation: isCount ? "distinct_count" : "list",
    column: best.column,
    labelColumn: best.column,
    groupBy: null,
    aggregation: null,
    direction: null,
    filters,
    selectColumns: [best.column],
    outputRequested: true,
    transform: null,
    showAll: !isCount,
    limit: isCount ? 10 : 100,
    localSemanticResolved: true,
    localRelationResolved: true,
    localSemanticConfidence: confidence,
    localRelationFrame: frame,
    localRelationEvidence: {
      entityColumn: best.column,
      entityScore: Number(best.entityScore.toFixed(4)),
      evidenceColumn: best.evidenceColumn,
      evidenceScore: Number(best.evidenceScore.toFixed(4)),
      structuralScore: Number(best.structuralScore.toFixed(4)),
      repeatedEntityRatio: Number(best.repeatScore.toFixed(4)),
    },
  };
}

module.exports = {
  parseRelationFrame,
  phraseColumnScore,
  evidenceColumnScore,
  resolveLocalRelationPlan,
};
