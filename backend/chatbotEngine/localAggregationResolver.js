const {
  normalizeText,
  parseNumber,
} = require("./utils");

function isUnitLikeColumnName(columnName) {
  return /\b(?:unit|uom|unit of measurement|unit of measure|measurement unit)\b/i.test(
    String(columnName || "")
  );
}

function isIdentifierLikeNumericColumn(columnName) {
  const name = normalizeText(columnName);
  if (!name) return false;

  return (
    /\b(?:contact|phone|mobile|telephone|tel|gatepass|reference|ref|id|identifier|code|account|serial|tracking|invoice|receipt|birthdate|date|year)\b/.test(name) ||
    (
      /\b(?:number|no)\b/.test(name) &&
      !/\b(?:quantity|qty|amount|volume|weight|area|value|cost|price|total)\b/.test(name)
    )
  );
}

function measureNameScore(columnName) {
  const name = normalizeText(columnName);
  if (!name) return 0;

  if (/\b(?:quantity|qty)\b/.test(name)) return 1;
  if (/\b(?:amount|volume|weight|area|value|cost|price|total)\b/.test(name)) {
    return 0.82;
  }

  return 0;
}

function findBestAdditiveMeasureColumn(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const sample =
    rows.find(
      (row) =>
        row &&
        typeof row === "object"
    ) || {};

  const candidates = [];

  for (const column of Object.keys(sample)) {
    if (isIdentifierLikeNumericColumn(column)) continue;

    const nameScore =
      measureNameScore(column);

    if (nameScore <= 0) continue;

    const values =
      rows
        .map((row) => row?.[column])
        .filter(
          (value) =>
            value !== null &&
            value !== undefined &&
            String(value).trim() !== ""
        );

    if (!values.length) continue;

    const numericCount =
      values.filter(
        (value) =>
          parseNumber(value) !== null
      ).length;

    const numericRatio =
      numericCount / values.length;

    if (numericRatio < 0.7) continue;

    candidates.push({
      column,
      score:
        nameScore * 0.82 +
        numericRatio * 0.18,
    });
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  return candidates[0]?.column || null;
}

function extractObjectPhrase(question) {
  const text = normalizeText(question);
  if (!text) return null;

  const match =
    text.match(
      /\b(?:how many|how much)\b\s+.+?\s+\bof\b\s+(.+?)(?=\s+\b(?:was|were|is|are|has|have|had|been|being|distributed|released|provided|given|issued|allocated|delivered|received|supplied)\b|$)/
    );

  if (!match?.[1]) return null;

  return match[1]
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findExplicitUnitFilter(rows, question, columns) {
  const q = normalizeText(question);

  for (const column of columns) {
    if (!isUnitLikeColumnName(column)) continue;

    const values =
      [...new Set(
        rows
          .map(
            (row) =>
              String(
                row?.[column] ?? ""
              ).trim()
          )
          .filter(Boolean)
      )]
        .sort(
          (a, b) =>
            String(b).length -
            String(a).length
        );

    for (const value of values) {
      const normalizedValue =
        normalizeText(value);

      if (
        normalizedValue &&
        q.includes(normalizedValue)
      ) {
        return {
          column,
          operator: "equals",
          value,
        };
      }
    }
  }

  return null;
}

function findObjectContainsFilter({
  rows,
  columns,
  objectPhrase,
  excludeColumns = [],
}) {
  const phrase =
    normalizeText(objectPhrase);

  if (!phrase) return null;

  const excluded =
    new Set(
      excludeColumns.map(
        (column) =>
          normalizeText(column)
      )
    );

  const candidates = [];

  for (const column of columns) {
    if (
      excluded.has(
        normalizeText(column)
      ) ||
      isUnitLikeColumnName(column) ||
      isIdentifierLikeNumericColumn(column)
    ) {
      continue;
    }

    const values =
      rows
        .map(
          (row) =>
            row?.[column]
        )
        .filter(
          (value) =>
            value !== null &&
            value !== undefined &&
            String(value).trim() !== ""
        );

    if (!values.length) continue;

    const numericRatio =
      values.filter(
        (value) =>
          parseNumber(value) !== null
      ).length /
      values.length;

    if (numericRatio >= 0.7) continue;

    const matchCount =
      values.filter(
        (value) =>
          normalizeText(value).includes(
            phrase
          )
      ).length;

    if (!matchCount) continue;

    candidates.push({
      column,
      matchCount,
      matchRate:
        matchCount /
        values.length,
    });
  }

  candidates.sort(
    (a, b) =>
      b.matchCount -
        a.matchCount ||
      b.matchRate -
        a.matchRate
  );

  if (!candidates.length) {
    return null;
  }

  return {
    column:
      candidates[0].column,
    operator:
      "contains",
    value:
      objectPhrase,
  };
}

function resolveLocalQuantityAggregationPlan({
  question,
  schema = [],
  datasets = {},
} = {}) {
  const text =
    normalizeText(question);

  if (
    !/\b(?:how many|how much)\b/.test(text) ||
    !/\b(?:distributed?|released?|provided?|given|issued|allocated|delivered|received?|supplied)\b/.test(text)
  ) {
    return null;
  }

  const candidates = [];

  for (const datasetSchema of schema || []) {
    const datasetName =
      datasetSchema?.name;

    const rows =
      datasets?.[datasetName];

    if (
      !datasetName ||
      !Array.isArray(rows) ||
      !rows.length
    ) {
      continue;
    }

    const columns =
      (datasetSchema.columns || [])
        .map(
          (column) =>
            typeof column === "string"
              ? column
              : column?.name
        )
        .filter(Boolean);

    const unitFilter =
      findExplicitUnitFilter(
        rows,
        question,
        columns
      );

    if (!unitFilter) continue;

    const measureColumn =
      findBestAdditiveMeasureColumn(
        rows
      );

    if (!measureColumn) continue;

    const objectPhrase =
      extractObjectPhrase(question);

    const objectFilter =
      objectPhrase
        ? findObjectContainsFilter({
            rows,
            columns,
            objectPhrase,
            excludeColumns: [
              unitFilter.column,
              measureColumn,
            ],
          })
        : null;

    /**
     * Grounding rule:
     *
     * If the question explicitly names an object/category after "of"
     * (for example "kilograms of fertilizer"), that object must map to
     * a live categorical value in the selected worksheet.
     *
     * Never silently drop an ungrounded object and broaden the query to
     * "all kilogram rows" because that changes the user's meaning.
     */
    if (
      objectPhrase &&
      !objectFilter
    ) {
      candidates.push({
        route: "clarify",
        question:
          `I could not find a dataset value matching "${objectPhrase}" in ${datasetName}. Please specify an available intervention or category.`,
        confidence: 0.35,
        localSemanticResolved: false,
        localSemanticAmbiguous: false,
        localGroundingFailed: true,
        localGroundingFailure: {
          phrase:
            objectPhrase,
          dataset:
            datasetName,
          unitColumn:
            unitFilter.column,
          unitValue:
            unitFilter.value,
        },
      });

      continue;
    }

    const filters = [
      unitFilter,
      ...(objectFilter
        ? [objectFilter]
        : []),
    ];

    const matchedRows =
      rows.filter(
        (row) =>
          filters.every(
            (filter) => {
              const actual =
                normalizeText(
                  row?.[filter.column]
                );

              const expected =
                normalizeText(
                  filter.value
                );

              return filter.operator === "contains"
                ? actual.includes(expected)
                : actual === expected;
            }
          )
      );

    const numericValues =
      matchedRows
        .map(
          (row) =>
            parseNumber(
              row?.[measureColumn]
            )
        )
        .filter(
          (value) =>
            value !== null
        );

    if (!numericValues.length) continue;

    candidates.push({
      route: "dataset",
      dataset: datasetName,
      operation: "sum",
      column: measureColumn,
      labelColumn: measureColumn,
      groupBy: null,
      aggregation: "sum",
      direction: null,
      filters,
      selectColumns: [
        measureColumn,
      ],
      outputRequested: true,
      transform: null,
      showAll: false,
      limit: 10,
      localSemanticResolved: true,
      localAggregationResolved: true,
      localSemanticConfidence:
        Math.min(
          1,
          0.78 +
            (objectFilter
              ? 0.14
              : 0)
        ),
      localAggregationEvidence: {
        unitColumn:
          unitFilter.column,
        unitValue:
          unitFilter.value,
        objectPhrase:
          objectPhrase || null,
        objectColumn:
          objectFilter?.column || null,
        recordsMatched:
          numericValues.length,
      },
    });
  }

  if (!candidates.length) {
    return null;
  }

  const grounded =
    candidates.filter(
      (candidate) =>
        candidate?.route === "dataset"
    );

  if (!grounded.length) {
    return candidates[0];
  }

  grounded.sort(
    (a, b) =>
      Number(
        b.localSemanticConfidence ||
        0
      ) -
      Number(
        a.localSemanticConfidence ||
        0
      )
  );

  const best =
    grounded[0];

  const second =
    grounded[1];

  if (
    second &&
    Math.abs(
      Number(
        best.localSemanticConfidence ||
        0
      ) -
      Number(
        second.localSemanticConfidence ||
        0
      )
    ) < 0.04
  ) {
    return {
      route: "clarify",
      question:
        `I found more than one worksheet that could answer this quantity question: ${best.dataset} and ${second.dataset}. Which one should I use?`,
      confidence: 0.35,
      localSemanticResolved: false,
      localSemanticAmbiguous: true,
    };
  }

  return best;
}

module.exports = {
  isUnitLikeColumnName,
  isIdentifierLikeNumericColumn,
  measureNameScore,
  findBestAdditiveMeasureColumn,
  extractObjectPhrase,
  findExplicitUnitFilter,
  findObjectContainsFilter,
  resolveLocalQuantityAggregationPlan,
};
