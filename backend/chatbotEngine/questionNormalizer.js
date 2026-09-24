const COMMON_REPLACEMENTS = [
  [/\bwat\b/gi, "what"],
  [/\bwht\b/gi, "what"],
  [/\bwhats\b/gi, "what is"],
  [/\bwhat's\b/gi, "what is"],

  [/\bhw\b/gi, "how"],
  [/\bhwo\b/gi, "how"],

  [/\bpls\b/gi, "please"],
  [/\bplz\b/gi, "please"],

  [/\br\b/gi, "are"],
  [/\bu\b/gi, "you"],
  [/\bur\b/gi, "your"],

  [/\bdept\b/gi, "department"],
  [/\bdiv\b/gi, "division"],

  [/\bsalry\b/gi, "salary"],
  [/\bsalry\b/gi, "salary"],
  [/\bsalray\b/gi, "salary"],

  [/\bpositon\b/gi, "position"],
  [/\bpostion\b/gi, "position"],

  [/\bemp\b/gi, "employee"],
  [/\bemplyee\b/gi, "employee"],

  [/\bnum\b/gi, "number"],
  [/\bno\.\b/gi, "number"],

  [/\btotl\b/gi, "total"],
  [/\bavg\b/gi, "average"],

  [/\bmun\b/gi, "municipality"],

  [/\bprov\b/gi, "province"],
];

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePunctuation(value) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+([?.!,])/g, "$1")
    .replace(/([?.!,])([^\s])/g, "$1 $2");
}

function normalizeCommonTypos(value) {
  let text = String(value || "");

  for (const [pattern, replacement] of COMMON_REPLACEMENTS) {
    text = text.replace(
      pattern,
      replacement
    );
  }

  return text;
}

function normalizeQuestion(question) {
  let text =
    String(question || "");

  text =
    normalizePunctuation(text);

  text =
    normalizeCommonTypos(text);

  text =
    normalizeWhitespace(text);

  return text;
}

module.exports = {
  normalizeQuestion,
  normalizeWhitespace,
  normalizePunctuation,
  normalizeCommonTypos,
};