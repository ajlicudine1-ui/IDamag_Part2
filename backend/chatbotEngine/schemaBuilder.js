const {
  getColumns,
  parseNumber,
  normalizeText,
} = require("./utils");

function uniqueExamples(rows, column, limit = 8) {
  const result = [];
  const seen = new Set();

  for (const row of rows) {
    const raw = row?.[column];

    if (
      raw === null ||
      raw === undefined ||
      String(raw).trim() === ""
    ) {
      continue;
    }

    const display = String(raw).trim();
    const key = normalizeText(display);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(display);
    }

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function inferType(rows, column) {
  const values = rows
    .map((row) => row?.[column])
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
    );

  if (!values.length) return "empty";

  const numeric = values.filter(
    (value) => parseNumber(value) !== null
  ).length;

  if (numeric / values.length >= 0.7) {
    return "number";
  }

  const dateLike = values.filter((value) => {
    const text = String(value).trim();

    if (!/[/-]/.test(text)) return false;

    return !Number.isNaN(Date.parse(text));
  }).length;

  if (dateLike / values.length >= 0.7) {
    return "date";
  }

  return "text";
}

function buildSchema(datasets) {
  return Object.entries(datasets).map(([name, rows]) => {
    const columns = getColumns(rows);

    return {
      name,
      rowCount: rows.length,
      columns: columns.map((column) => ({
        name: column,
        type: inferType(rows, column),
        examples: uniqueExamples(rows, column),
      })),
    };
  });
}

module.exports = {
  buildSchema,
  inferType,
};
