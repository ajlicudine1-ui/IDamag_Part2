function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s._%()/+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return null;
  }

  let text = String(value).trim();
  const negative =
    text.startsWith("(") && text.endsWith(")");

  text = text
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/[^\d.+-]/g, "")
    .trim();

  if (!text || ["-", "+", "."].includes(text)) {
    return null;
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  return negative ? -Math.abs(number) : number;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeRows(value) {
  if (Array.isArray(value)) {
    return value.filter(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row)
    );
  }

  if (
    value &&
    typeof value === "object" &&
    Array.isArray(value.rows)
  ) {
    return value.rows.filter(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row)
    );
  }

  return [];
}

const DATASET_CONTAINER_KEYS = new Set([
  "datasets",
  "worksheets",
  "sheets",
  "tables",
]);

const DATASET_NAME_KEYS = [
  "name",
  "sheetName",
  "worksheetName",
  "datasetName",
  "tableName",
  "title",
];

const DATASET_ROW_KEYS = [
  "rows",
  "records",
  "items",
  "data",
  "values",
];

function getDatasetDescriptorName(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  for (const key of DATASET_NAME_KEYS) {
    const name = String(value?.[key] ?? "").trim();
    if (name) return name;
  }

  return null;
}

function getDatasetDescriptorRows(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  for (const key of DATASET_ROW_KEYS) {
    const rows = normalizeRows(value?.[key]);
    if (rows.length) return rows;
  }

  return [];
}

function normalizeDatasetContainer(container, result) {
  if (!container) return;

  if (Array.isArray(container)) {
    for (const item of container) {
      const name = getDatasetDescriptorName(item);
      const rows = getDatasetDescriptorRows(item);

      if (name && rows.length) {
        result[name] = rows;
      }
    }
    return;
  }

  if (typeof container !== "object") return;

  for (const [name, value] of Object.entries(container)) {
    // Wrapper keys hold dataset descriptors/maps, not rows belonging to a
    // worksheet literally named "worksheets"/"datasets"/etc.
    if (DATASET_CONTAINER_KEYS.has(String(name))) {
      continue;
    }

    const directRows = normalizeRows(value);
    if (directRows.length) {
      result[String(name)] = directRows;
      continue;
    }

    const descriptorName = getDatasetDescriptorName(value);
    const descriptorRows = getDatasetDescriptorRows(value);
    if (descriptorName && descriptorRows.length) {
      result[descriptorName] = descriptorRows;
    }
  }
}

function normalizeDatasets(input) {
  if (Array.isArray(input)) {
    const descriptorResult = {};
    normalizeDatasetContainer(input, descriptorResult);

    if (Object.keys(descriptorResult).length) {
      return descriptorResult;
    }

    return {
      Dataset: normalizeRows(input),
    };
  }

  if (!input || typeof input !== "object") {
    return {};
  }

  const result = {};

  // Preserve the historical direct object-map shape first:
  //   { overview: [...], contract: [...] }
  //
  // Then also accept common backend wrapper shapes such as:
  //   { datasets: { overview: [...], contract: [...] } }
  //   { worksheets: [{ name: "overview", rows: [...] }, ...] }
  //
  // This is intentionally structural. It does not depend on any worksheet
  // name, report, dashboard, or semantic-contract field.
  normalizeDatasetContainer(input, result);

  for (const [key, value] of Object.entries(input)) {
    if (!DATASET_CONTAINER_KEYS.has(String(key))) continue;
    normalizeDatasetContainer(value, result);
  }

  return result;
}

function getColumns(rows) {
  const columns = new Set();

  for (const row of rows) {
    for (const column of Object.keys(row || {})) {
      if (String(column).trim()) {
        columns.add(column);
      }
    }
  }

  return [...columns];
}

function singularizeToken(token) {
  const word = String(token || "").toLowerCase();

  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }

  if (
    word.endsWith("ches") ||
    word.endsWith("shes") ||
    word.endsWith("xes") ||
    word.endsWith("zes")
  ) {
    return word.slice(0, -2);
  }

  if (word.endsWith("ses") && word.length > 4) {
    return word.slice(0, -2);
  }

  if (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    word.length > 3
  ) {
    return word.slice(0, -1);
  }

  return word;
}

function normalizeMatchTokens(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(singularizeToken);
}

function similarity(left, right) {
  const aTokens = normalizeMatchTokens(left);
  const bTokens = normalizeMatchTokens(right);

  if (!aTokens.length || !bTokens.length) {
    return 0;
  }

  const a = aTokens.join(" ");
  const b = bTokens.join(" ");

  if (a === b) {
    return 1;
  }

  if (a.includes(b) || b.includes(a)) {
    return (
      Math.min(a.length, b.length) /
      Math.max(a.length, b.length)
    );
  }

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let matched = 0;

  for (const token of aSet) {
    if (bSet.has(token)) {
      matched += 1;
    }
  }

  const union = new Set([...aSet, ...bSet]).size;

  return union ? matched / union : 0;
}

function findBestMatch(
  requested,
  available,
  minimum = 0.4
) {
  if (!requested) return null;

  const ranked = available
    .map((item) => ({
      item,
      score: similarity(requested, item),
    }))
    .sort((a, b) => b.score - a.score);

  return ranked[0] && ranked[0].score >= minimum
    ? ranked[0].item
    : null;
}

module.exports = {
  normalizeText,
  parseNumber,
  formatNumber,
  normalizeRows,
  normalizeDatasets,
  getColumns,
  similarity,
  singularizeToken,
  normalizeMatchTokens,
  findBestMatch,
};


