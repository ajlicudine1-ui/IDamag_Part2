const { normalizeText } = require("./utils");

/**
 * ============================================================
 * COMPLEX QUESTION PARITY ENGINE
 * ============================================================
 *
 * Shared BEFORE Groq/local planning so both planner paths receive
 * the same decomposition behavior.
 *
 * Goals:
 * - split clearly independent analytical requests;
 * - keep linked multi-field requests intact;
 * - never split ordinary AND/OR filters or entity names;
 * - preserve dependent follow-up clauses so they can inherit the
 *   verified scope/result of the preceding clause.
 *
 * No worksheet, column, entity, or business vocabulary is hardcoded.
 */

const QUESTION_START =
  /^(?:what|which|who|where|when|why|how(?:\s+many|\s+much)?|calculate|compute|find|give|show|tell|list|count|compare|rank)\b/i;

const ANALYTICAL_START =
  /^(?:(?:the\s+)?(?:total|sum|average|avg|mean|median|minimum|maximum|max|min|count|number\s+of|percentage|percent|ratio|difference|top|bottom|highest|lowest|largest|smallest)\b)/i;

const ANALYTICAL_ANYWHERE =
  /\b(?:total|sum|average|avg|mean|median|minimum|maximum|max|min|count|number\s+of|how\s+many|how\s+much|percentage|percent|ratio|difference|top|bottom|highest|lowest|largest|smallest|compare|rank)\b/i;

function cleanClause(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:\-\s]+/, "")
    .replace(/[?!.]+$/, "")
    .replace(/[,;:\-\s]+$/, "")
    .trim();
}

function hasAnalyticalCue(value) {
  const clause = cleanClause(value);
  if (!clause) return false;
  return (
    QUESTION_START.test(clause) ||
    ANALYTICAL_START.test(clause) ||
    ANALYTICAL_ANYWHERE.test(clause)
  );
}

function looksLikeIndependentClause(value) {
  const clause = cleanClause(value);
  if (!clause) return false;

  // Explicit interrogative/instruction starts are strong evidence.
  if (QUESTION_START.test(clause)) {
    return true;
  }

  // Operation-first fragments are common after conjunctions:
  // "... and average the amount" / "... then total cost".
  if (ANALYTICAL_START.test(clause)) {
    return true;
  }

  return false;
}

function isDependentComplexClause(value) {
  const text = normalizeText(value);
  if (!text) return false;

  return (
    /\b(?:they|them|their|those|these|it|its|that|this|same|there|such|above|previous|earlier|former|latter)\b/.test(text) ||
    /^(?:and\s+)?(?:then\s+)?(?:what|how)\s+about\b/.test(text) ||
    /^(?:and\s+)?(?:then\s+)?(?:for|among|within)\s+(?:them|those|these|that|this|the\s+same)\b/.test(text)
  );
}

function splitQuestionMarkClauses(original) {
  return original
    .split(/\?\s*(?=[A-Za-z0-9])/g)
    .map(cleanClause)
    .filter(Boolean);
}

function splitSemicolonClauses(original) {
  if (!original.includes(";")) return [original];

  const parts = original
    .split(/\s*;\s*/)
    .map(cleanClause)
    .filter(Boolean);

  if (
    parts.length > 1 &&
    parts.every(hasAnalyticalCue)
  ) {
    return parts;
  }

  return [original];
}

function splitConjoinedClauses(original) {
  // Split only when the text AFTER the conjunction clearly starts a
  // new question/analytical instruction. This intentionally does not
  // split ordinary conditions such as "Province A and Province B".
  const splitter =
    /\s*(?:,|;)?\s+\b(?:and\s+then|then|and|also|plus)\b\s+(?=(?:what|which|who|where|when|why|how(?:\s+many|\s+much)?|calculate|compute|find|give|show|tell|list|count|compare|rank)\b|(?:the\s+)?(?:total|sum|average|avg|mean|median|minimum|maximum|max|min|number\s+of|percentage|percent|ratio|difference|top|bottom|highest|lowest|largest|smallest)\b)/i;

  return original
    .split(splitter)
    .map(cleanClause)
    .filter(Boolean);
}

function decomposeComplexQuestion(question) {
  const original = cleanClause(question);
  if (!original) {
    return {
      isComplex: false,
      clauses: [],
      dependentClauseIndexes: [],
    };
  }

  let clauses = splitQuestionMarkClauses(original);

  if (clauses.length === 1) {
    clauses = splitSemicolonClauses(original);
  }

  if (clauses.length === 1) {
    clauses = splitConjoinedClauses(original);
  }

  const meaningful = clauses.filter((clause) => {
    const words = normalizeText(clause)
      .split(/\s+/)
      .filter(Boolean);

    return words.length >= 2;
  });

  if (meaningful.length < 2) {
    return {
      isComplex: false,
      clauses: [original],
      dependentClauseIndexes: [],
    };
  }

  // Defensive check: every clause after the first must itself look like
  // an analytical request. If not, keep the whole sentence intact.
  if (!meaningful.slice(1).every(looksLikeIndependentClause)) {
    return {
      isComplex: false,
      clauses: [original],
      dependentClauseIndexes: [],
    };
  }

  const dependentClauseIndexes = [];
  meaningful.forEach((clause, index) => {
    if (index > 0 && isDependentComplexClause(clause)) {
      dependentClauseIndexes.push(index);
    }
  });

  return {
    isComplex: true,
    clauses: meaningful,
    dependentClauseIndexes,
  };
}

module.exports = {
  hasAnalyticalCue,
  looksLikeIndependentClause,
  isDependentComplexClause,
  decomposeComplexQuestion,
};
