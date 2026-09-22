const {
  normalizeText,
} = require("./utils");

/**
 * Generic cell normalization helpers.
 * No worksheet or business-specific values are hardcoded here.
 */
function normalizeCellValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeComparableValue(value) {
  return normalizeText(normalizeCellValue(value));
}

/**
 * A conservative secondary key for lexical variants that differ only by
 * separators/spacing inside the same token or phrase.
 *
 * Examples:
 *   "sugar cane" <-> "sugarcane"
 *   "high-value" <-> "high value"
 *
 * Keep this separate from normal normalization so ordinary matching still
 * prefers exact live values. The minimum-length guard at call sites prevents
 * short codes/IDs from becoming overly fuzzy.
 */
function normalizeLooseToken(value) {
  return normalizeComparableValue(value)
    .replace(/[\s._%()/+\-]+/g, "");
}

function looksLikeDelimitedMultiValue(value) {
  const text = normalizeCellValue(value);
  if (!text || text.length > 240) return false;

  // Do not treat URLs or ordinary numeric thousands separators as lists.
  if (/https?:\/\//i.test(text)) return false;
  if (/^[+-]?[\d,.]+(?:\s*%)?$/.test(text)) return false;

  const parts = text
    .split(/\s*(?:;|\||,|\s\/\s)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length < 2 || parts.length > 20) return false;
  if (parts.some((item) => item.length > 70)) return false;

  return true;
}

function splitMultiValueCell(value) {
  const text = normalizeCellValue(value);
  if (!text) return [];

  if (!looksLikeDelimitedMultiValue(text)) {
    return [text];
  }

  const seen = new Set();
  const result = [];

  for (const item of text.split(/\s*(?:;|\||,|\s\/\s)\s*/)) {
    const display = item.trim();
    const key = normalizeComparableValue(display);
    if (!display || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(display);
  }

  return result;
}

function looksLikeMultiValueColumn({ rows, column, sampleSize = 80 }) {
  if (!Array.isArray(rows) || !rows.length || !column) return false;

  let usable = 0;
  let delimited = 0;

  for (const row of rows.slice(0, sampleSize)) {
    const value = row?.[column];
    if (value === null || value === undefined || String(value).trim() === "") {
      continue;
    }
    usable += 1;
    if (looksLikeDelimitedMultiValue(value)) delimited += 1;
  }

  return usable >= 2 && delimited / usable >= 0.15;
}

function valueMatchesToken(actual, expected) {
  const target = normalizeComparableValue(expected);
  if (!target) return false;

  const looseTarget = normalizeLooseToken(expected);

  return splitMultiValueCell(actual).some((item) => {
    const exact = normalizeComparableValue(item);
    if (exact === target) return true;

    // Only permit separator-insensitive equivalence for reasonably
    // descriptive values. This avoids fuzzy matching of tiny codes/IDs.
    const looseItem = normalizeLooseToken(item);
    return (
      looseTarget.length >= 6 &&
      looseItem.length >= 6 &&
      looseItem === looseTarget
    );
  });
}

module.exports = {
  normalizeCellValue,
  normalizeComparableValue,
  normalizeLooseToken,
  looksLikeDelimitedMultiValue,
  splitMultiValueCell,
  looksLikeMultiValueColumn,
  valueMatchesToken,
};
