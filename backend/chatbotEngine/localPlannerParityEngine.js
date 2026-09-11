const {
  normalizeText,
  parseNumber,
} = require("./utils");

const {
  inferValueFilters,
  mergeFilters,
} = require("./filterEngine");

const {
  findExplicitSchemaColumns,
  detectQuestionAggregation,
  detectRankingDirection,
  detectRankingLimit,
  resolveExplicitRankingColumns,
  parseRankingTargets,
  scoreTargetToColumn,
  inferRequestedColumnFromQuestion,
  isNumericLikeColumn,
} = require("./plannerNormalizer");


const DATASET_OPERATIONS = new Set([
  "sum",
  "average",
  "median",
  "minimum",
  "maximum",
  "row_count",
  "non_empty_count",
  "distinct_count",
  "list",
  "lookup",
  "group_count",
  "group_sum",
  "group_average",
  "group_minimum",
  "group_maximum",
  "rank_rows",
  "rank_groups",
]);

const FILTER_OPERATORS = new Set([
  "equals",
  "not_equals",
  "contains",
  "starts_with",
  "ends_with",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "in",
  "not_in",
]);

function cloneFilters(filters) {
  return Array.isArray(filters)
    ? filters.map((filter) => ({
        ...filter,
        value: Array.isArray(filter?.value)
          ? [...filter.value]
          : filter?.value,
      }))
    : [];
}

function getDatasetSchema(schema, datasetName) {
  return (schema || []).find(
    (dataset) =>
      String(dataset?.name || "") ===
      String(datasetName || "")
  ) || null;
}

function getColumnNames(datasetSchema) {
  return (datasetSchema?.columns || [])
    .map((column) =>
      typeof column === "string"
        ? column
        : column?.name
    )
    .filter(Boolean);
}

function getColumnSchema(datasetSchema, columnName) {
  return (datasetSchema?.columns || []).find(
    (column) =>
      String(
        typeof column === "string"
          ? column
          : column?.name || ""
      ) ===
      String(columnName || "")
  ) || null;
}

function isNumericColumn(datasetSchema, rows, columnName) {
  if (!columnName) return false;

  const rawColumn =
    getColumnSchema(
      datasetSchema,
      columnName
    );

  const column =
    typeof rawColumn === "string"
      ? {
          name:
            rawColumn,
          type:
            null,
          examples:
            [],
        }
      : rawColumn;

  if (!column) return false;

  return isNumericLikeColumn({
    column,
    rows:
      Array.isArray(rows)
        ? rows
        : [],
  });
}

function explicitDatasetMention(question, schema) {
  const text =
    normalizeText(question);

  const matches =
    (schema || [])
      .filter(
        (dataset) => {
          const name =
            normalizeText(
              dataset?.name
            );

          return (
            name &&
            text.includes(name)
          );
        }
      )
      .sort(
        (a, b) =>
          normalizeText(b?.name).length -
          normalizeText(a?.name).length
      );

  return matches[0]?.name || null;
}

function detectSchemaIntent(question) {
  const text =
    normalizeText(question);

  if (
    /\b(?:what|which|show|list)\b.*\b(?:worksheet|worksheets|sheet|sheets|dataset|datasets)\b/.test(text) ||
    /\b(?:worksheet|worksheets|sheet|sheets|dataset|datasets)\b.*\b(?:available|loaded|exist|have)\b/.test(text)
  ) {
    return "datasets";
  }

  if (
    /\b(?:what|which|show|list)\b.*\b(?:column|columns|field|fields|header|headers)\b/.test(text) ||
    /\b(?:column|columns|field|fields|header|headers)\b.*\b(?:available|loaded|exist|have)\b/.test(text)
  ) {
    return "columns";
  }

  if (
    /\b(?:row count|rows per|records per|entries per)\b/.test(text) ||
    /\bhow many rows\b.*\b(?:each|worksheet|sheet|dataset)\b/.test(text)
  ) {
    return "row_counts";
  }

  if (
    /\bwhere\b.*\b(?:column|field)\b/.test(text) ||
    /\b(?:which|what)\b.*\b(?:worksheet|sheet|dataset)\b.*\b(?:contain|contains|has|have)\b/.test(text)
  ) {
    return "find_column";
  }

  if (
    /\b(?:describe|schema|structure)\b/.test(text) &&
    /\b(?:dataset|worksheet|sheet|column|field)\b/.test(text)
  ) {
    return "describe";
  }

  return null;
}

function detectTransform(question) {
  const text =
    normalizeText(question);

  if (/\bfirst name\b/.test(text)) {
    return "first_word";
  }

  if (/\blast name\b/.test(text)) {
    return "last_word";
  }

  return null;
}

function detectExplicitLimit(question) {
  const text =
    normalizeText(question);

  const match =
    text.match(
      /\b(?:top|bottom|first|last)\s+(\d{1,3})\b/
    ) ||
    text.match(
      /\b(\d{1,3})\s+(?:highest|lowest|largest|smallest|greatest)\b/
    ) ||
    text.match(
      /\b(?:limit|only)\s+(?:to\s+)?(\d{1,3})\b/
    );

  if (!match?.[1]) {
    return null;
  }

  const value =
    Number(match[1]);

  return Number.isInteger(value)
    ? Math.min(
        Math.max(value, 1),
        100
      )
    : null;
}

function detectsAllRowsList(question) {
  const text =
    normalizeText(question);

  return (
    /\b(?:list|show|display|give|name)\s+(?:me\s+)?(?:all\s+)?/.test(text) ||
    /\b(?:what|which)\s+are\b/.test(text) ||
    /\b(?:all|every|complete|full)\b/.test(text)
  );
}

function isRankingQuestion(question) {
  const text =
    normalizeText(question);

  return (
    /\b(?:top|bottom)\s+\d+\b/.test(text) ||
    /\b(?:which|what|who)\b.+\b(?:has|have|had|is|are|received|produced|got)\b.+\b(?:highest|lowest|largest|smallest|greatest|least|most|maximum|minimum)\b/.test(text)
  );
}

function detectBaseOperation(question, {
  hasColumn = false,
  metricIsNumeric = false,
} = {}) {
  const text =
    normalizeText(question);

  if (isRankingQuestion(question)) {
    return null;
  }

  if (/\b(?:median|middle value)\b/.test(text)) {
    return "median";
  }

  if (/\b(?:average|avg|mean)\b/.test(text)) {
    return "average";
  }

  if (
    /\b(?:sum|total|combined|altogether|in all)\b/.test(text)
  ) {
    return "sum";
  }

  if (
    /\b(?:maximum|max|highest|largest|greatest)\b/.test(text)
  ) {
    return "maximum";
  }

  if (
    /\b(?:minimum|min|lowest|smallest|least)\b/.test(text)
  ) {
    return "minimum";
  }

  if (
    /\b(?:how many rows|number of rows|row count|records|entries)\b/.test(text)
  ) {
    return "row_count";
  }

  if (
    /\b(?:how many unique|how many distinct|number of unique|number of distinct|count distinct|distinct count)\b/.test(text)
  ) {
    return "distinct_count";
  }

  if (
    /\b(?:how many|number of|count of|count)\b/.test(text)
  ) {
    if (!hasColumn) {
      return "row_count";
    }

    return metricIsNumeric
      ? "sum"
      : "non_empty_count";
  }

  if (
    /\b(?:unique|distinct|different)\b/.test(text) &&
    /\b(?:list|show|what|which|give|name)\b/.test(text)
  ) {
    return "list";
  }

  if (
    /\b(?:list|show all|display all|enumerate|what are|which are|give me all|name all)\b/.test(text)
  ) {
    return "list";
  }

  if (
    /\b(?:lookup|find|retrieve|get|show|tell|what is|what are|which|who)\b/.test(text)
  ) {
    return "lookup";
  }

  return null;
}

function mapGroupedOperation(baseOperation) {
  const map = {
    row_count: "group_count",
    non_empty_count: "group_count",
    distinct_count: "group_count",
    sum: "group_sum",
    average: "group_average",
    minimum: "group_minimum",
    maximum: "group_maximum",
  };

  return map[baseOperation] || null;
}

function detectGroupingCue(question) {
  return /\b(?:by|per|for each|grouped by|each)\b/.test(
    normalizeText(question)
  );
}

function inferGroupingColumn({
  question,
  schema,
  datasetName,
  excludedColumns = [],
}) {
  const text =
    normalizeText(question);

  const match =
    text.match(
      /\b(?:by|per|for each|grouped by|each)\s+(.+?)(?:[?.]|$)/
    );

  if (!match?.[1]) {
    return null;
  }

  const inferred =
    inferRequestedColumnFromQuestion({
      schema,
      question:
        match[1],
      preferredDataset:
        datasetName,
      excludedColumns,
    });

  return inferred?.column || null;
}

function inferPrimaryColumn({
  question,
  schema,
  datasetName,
  excludedColumns = [],
}) {
  const explicit =
    findExplicitSchemaColumns({
      schema,
      question,
      preferredDataset:
        datasetName,
    });

  const usableExplicit =
    explicit
      .map((item) =>
        item?.column ||
        item?.name
      )
      .filter(Boolean)
      .filter(
        (column) =>
          !excludedColumns.some(
            (excluded) =>
              normalizeText(excluded) ===
              normalizeText(column)
          )
      );

  if (usableExplicit.length) {
    // Prefer a numeric explicit column for aggregate questions.
    return usableExplicit[
      usableExplicit.length - 1
    ];
  }

  const inferred =
    inferRequestedColumnFromQuestion({
      schema,
      question,
      preferredDataset:
        datasetName,
      excludedColumns,
    });

  return inferred?.column || null;
}

function detectComparatorOperator(question, columnName) {
  const text =
    normalizeText(question);

  const column =
    normalizeText(columnName);

  if (
    !text ||
    !column ||
    !text.includes(column)
  ) {
    return null;
  }

  const escaped =
    column.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const patterns = [
    {
      operator:
        "greater_or_equal",
      regex:
        new RegExp(
          `${escaped}.{0,40}\\b(?:at least|greater than or equal to|more than or equal to|>=)\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`
        ),
    },
    {
      operator:
        "less_or_equal",
      regex:
        new RegExp(
          `${escaped}.{0,40}\\b(?:at most|less than or equal to|no more than|<=)\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`
        ),
    },
    {
      operator:
        "greater_than",
      regex:
        new RegExp(
          `${escaped}.{0,40}\\b(?:greater than|more than|above|over|>)\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`
        ),
    },
    {
      operator:
        "less_than",
      regex:
        new RegExp(
          `${escaped}.{0,40}\\b(?:less than|below|under|<)\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`
        ),
    },
  ];

  for (const item of patterns) {
    const match =
      text.match(item.regex);

    if (match?.[1]) {
      return {
        column:
          columnName,
        operator:
          item.operator,
        value:
          parseNumber(
            match[1]
          ),
      };
    }
  }

  return null;
}

function detectStringOperatorFilter({
  question,
  schema,
  datasetName,
}) {
  const text =
    normalizeText(question);

  const patterns = [
    {
      operator:
        "starts_with",
      regex:
        /\b(.+?)\s+starts?\s+with\s+["']?([^"']+?)["']?(?:[?.]|$)/,
    },
    {
      operator:
        "ends_with",
      regex:
        /\b(.+?)\s+ends?\s+with\s+["']?([^"']+?)["']?(?:[?.]|$)/,
    },
    {
      operator:
        "contains",
      regex:
        /\b(.+?)\s+contains?\s+["']?([^"']+?)["']?(?:[?.]|$)/,
    },
    {
      operator:
        "not_equals",
      regex:
        /\b(.+?)\s+(?:is not|isnt|isn't|not equal to|does not equal)\s+["']?([^"']+?)["']?(?:[?.]|$)/,
    },
  ];

  for (const pattern of patterns) {
    const match =
      text.match(
        pattern.regex
      );

    if (
      !match?.[1] ||
      !match?.[2]
    ) {
      continue;
    }

    const fieldPhrase =
      match[1]
        .split(/\s+/)
        .slice(-5)
        .join(" ");

    const inferred =
      inferRequestedColumnFromQuestion({
        schema,
        question:
          fieldPhrase,
        preferredDataset:
          datasetName,
        excludedColumns: [],
      });

    if (!inferred?.column) {
      continue;
    }

    return {
      column:
        inferred.column,
      operator:
        pattern.operator,
      value:
        match[2].trim(),
    };
  }

  return null;
}

function normalizeValueFiltersForQuestion(filters, question) {
  const text =
    normalizeText(question);

  return (filters || []).map(
    (filter) => {
      if (
        filter?.operator !== "in" ||
        !Array.isArray(
          filter?.value
        )
      ) {
        return filter;
      }

      const negativeCue =
        /\b(?:except|excluding|exclude|without)\b/.test(
          text
        );

      return negativeCue
        ? {
            ...filter,
            operator:
              "not_in",
          }
        : filter;
    }
  );
}

function buildOperatorFilters({
  question,
  rows,
  datasetSchema,
  schema,
  datasetName,
  existingFilters = [],
}) {
  const columns =
    getColumnNames(
      datasetSchema
    );

  const additions = [];

  for (const column of columns) {
    if (
      !isNumericColumn(
        datasetSchema,
        rows,
        column
      )
    ) {
      continue;
    }

    const comparator =
      detectComparatorOperator(
        question,
        column
      );

    if (comparator) {
      additions.push(
        comparator
      );
    }
  }

  const stringFilter =
    detectStringOperatorFilter({
      question,
      schema,
      datasetName,
    });

  if (stringFilter) {
    additions.push(
      stringFilter
    );
  }

  return normalizeValueFiltersForQuestion(
    mergeFilters(
      cloneFilters(
        existingFilters
      ),
      additions
    ),
    question
  ).filter(
    (filter) =>
      FILTER_OPERATORS.has(
        String(
          filter?.operator ||
          "equals"
        )
          .trim()
          .toLowerCase()
      )
  );
}

function inferSelectColumns({
  question,
  schema,
  datasetName,
  current = [],
}) {
  const selected =
    new Set(
      (current || [])
        .filter(Boolean)
    );

  const explicit =
    findExplicitSchemaColumns({
      schema,
      question,
      preferredDataset:
        datasetName,
    });

  for (const item of explicit) {
    const column =
      item?.column ||
      item?.name;

    if (column) {
      selected.add(
        column
      );
    }
  }

  if (!selected.size) {
    const inferred =
      inferRequestedColumnFromQuestion({
        schema,
        question,
        preferredDataset:
          datasetName,
        excludedColumns: [],
      });

    if (inferred?.column) {
      selected.add(
        inferred.column
      );
    }
  }

  return [
    ...selected,
  ];
}

function repairRankingParity({
  plan,
  question,
  schema,
  datasets,
}) {
  if (!isRankingQuestion(question)) {
    return null;
  }

  const direction =
    detectRankingDirection(
      question
    );

  if (!direction) {
    return null;
  }

  const preferredDataset =
    explicitDatasetMention(
      question,
      schema
    ) ||
    plan?.dataset ||
    null;

  const resolved =
    resolveExplicitRankingColumns({
      datasets,
      schema,
      question,
      preferredDataset,
    });

  let datasetName =
    resolved?.dataset ||
    preferredDataset;

  let metric =
    resolved?.metricColumn ||
    null;

  let label =
    resolved?.groupColumn ||
    null;

  /**
   * findExplicitSchemaColumns() is deliberately conservative. When the
   * question uses normal grammar instead of typing a raw header verbatim,
   * parse the ranking target nouns and score them against the live schema.
   */
  if (
    !metric ||
    !label
  ) {
    const targets =
      parseRankingTargets(
        question
      );

    const datasetCandidates =
      (
        datasetName
          ? (schema || []).filter(
              (dataset) =>
                String(
                  dataset?.name || ""
                ) ===
                String(
                  datasetName
                )
            )
          : (schema || [])
      );

    let best = null;

    for (const datasetSchema of datasetCandidates) {
      const candidateRows =
        datasets?.[
          datasetSchema?.name
        ] || [];

      const columns =
        (datasetSchema?.columns || [])
          .map(
            (column) =>
              typeof column === "string"
                ? {
                    name:
                      column,
                    type:
                      null,
                    examples:
                      [],
                  }
                : column
          )
          .filter(
            (column) =>
              column?.name
          );

      const numericColumns =
        columns.filter(
          (column) =>
            isNumericLikeColumn({
              column,
              rows:
                candidateRows,
            })
        );

      const textColumns =
        columns.filter(
          (column) =>
            !isNumericLikeColumn({
              column,
              rows:
                candidateRows,
            })
        );

      const metricCandidate =
        numericColumns
          .map(
            (column) => ({
              name:
                column.name,
              score:
                scoreTargetToColumn(
                  targets?.metricTarget ||
                  question,
                  column.name
                ),
            })
          )
          .sort(
            (a, b) =>
              b.score -
              a.score
          )[0];

      const labelCandidate =
        textColumns
          .map(
            (column) => ({
              name:
                column.name,
              score:
                scoreTargetToColumn(
                  targets?.labelTarget ||
                  question,
                  column.name
                ),
            })
          )
          .sort(
            (a, b) =>
              b.score -
              a.score
          )[0];

      if (
        !metricCandidate ||
        !labelCandidate
      ) {
        continue;
      }

      const score =
        metricCandidate.score +
        labelCandidate.score;

      if (
        !best ||
        score >
          best.score
      ) {
        best = {
          dataset:
            datasetSchema.name,
          metric:
            metricCandidate.name,
          label:
            labelCandidate.name,
          score,
        };
      }
    }

    if (best) {
      datasetName =
        best.dataset;
      metric =
        best.metric;
      label =
        best.label;
    }
  }

  metric =
    metric ||
    plan?.column ||
    null;

  label =
    label ||
    plan?.labelColumn ||
    plan?.groupBy ||
    null;

  if (
    !datasetName ||
    !metric ||
    !label
  ) {
    return null;
  }

  const datasetSchema =
    getDatasetSchema(
      schema,
      datasetName
    );

  const rows =
    datasets?.[
      datasetName
    ] || [];

  if (
    !datasetSchema ||
    !isNumericColumn(
      datasetSchema,
      rows,
      metric
    )
  ) {
    return null;
  }

  const aggregation =
    detectQuestionAggregation(
      question,
      metric
    );

  const grouped =
    Boolean(
      aggregation &&
      ["sum", "average", "count"].includes(
        aggregation
      )
    );

  return {
    ...plan,
    route:
      "dataset",
    dataset:
      datasetName,
    operation:
      grouped
        ? "rank_groups"
        : "rank_rows",
    column:
      metric,
    labelColumn:
      label,
    groupBy:
      grouped
        ? label
        : null,
    aggregation:
      grouped
        ? aggregation
        : null,
    direction,
    limit:
      detectRankingLimit(
        question
      ) || 1,
    selectColumns: [
      ...new Set(
        [
          label,
          metric,
        ].filter(Boolean)
      ),
    ],
    outputRequested:
      true,
    showAll:
      false,
    localPlannerParityApplied:
      true,
  };
}

function ensureLocalPlannerParity({
  plan,
  question,
  schema = [],
  datasets = {},
  context = null,
} = {}) {
  const schemaIntent =
    detectSchemaIntent(
      question
    );

  if (schemaIntent) {
    const explicitDataset =
      explicitDatasetMention(
        question,
        schema
      );

    const explicitColumns =
      findExplicitSchemaColumns({
        schema,
        question,
        preferredDataset:
          explicitDataset,
      });

    return {
      route:
        "schema",
      intent:
        schemaIntent,
      dataset:
        explicitDataset,
      column:
        explicitColumns[0]?.column ||
        explicitColumns[0]?.name ||
        null,
      confidence:
        0.98,
      localPlannerParityApplied:
        true,
    };
  }

  if (
    !plan ||
    typeof plan !==
      "object" ||
    plan.route !==
      "dataset"
  ) {
    return plan;
  }

  const ranking =
    repairRankingParity({
      plan,
      question,
      schema,
      datasets,
    });

  if (ranking) {
    return ranking;
  }

  const explicitDataset =
    explicitDatasetMention(
      question,
      schema
    );

  const datasetName =
    explicitDataset ||
    plan.dataset ||
    context?.lastDataset ||
    null;

  if (!datasetName) {
    return plan;
  }

  const datasetSchema =
    getDatasetSchema(
      schema,
      datasetName
    );

  const rows =
    datasets?.[
      datasetName
    ] || [];

  if (!datasetSchema) {
    return plan;
  }

  let repaired = {
    ...plan,
    dataset:
      datasetName,
    filters:
      cloneFilters(
        plan.filters
      ),
    selectColumns:
      Array.isArray(
        plan.selectColumns
      )
        ? [
            ...plan.selectColumns,
          ]
        : [],
  };

  const groupingColumn =
    inferGroupingColumn({
      question,
      schema,
      datasetName,
      excludedColumns: [
        repaired.column,
      ].filter(Boolean),
    });

  const requestedColumn =
    inferPrimaryColumn({
      question,
      schema,
      datasetName,
      excludedColumns: [
        groupingColumn,
      ].filter(Boolean),
    }) ||
    repaired.column ||
    null;

  const metricIsNumeric =
    requestedColumn
      ? isNumericColumn(
          datasetSchema,
          rows,
          requestedColumn
        )
      : false;

  const baseOperation =
    detectBaseOperation(
      question,
      {
        hasColumn:
          Boolean(
            requestedColumn
          ),
        metricIsNumeric,
      }
    );

  if (baseOperation) {
    const grouped =
      Boolean(
        groupingColumn &&
        detectGroupingCue(
          question
        )
      );

    const groupedOperation =
      grouped
        ? mapGroupedOperation(
            baseOperation
          )
        : null;

    repaired.operation =
      groupedOperation ||
      baseOperation;

    if (
      repaired.operation ===
        "row_count"
    ) {
      repaired.column =
        null;
      repaired.labelColumn =
        null;
      repaired.groupBy =
        null;
      repaired.aggregation =
        null;
    } else if (
      repaired.operation ===
        "group_count"
    ) {
      repaired.column =
        requestedColumn ||
        groupingColumn;
      repaired.labelColumn =
        groupingColumn;
      repaired.groupBy =
        groupingColumn;
      repaired.aggregation =
        "count";
    } else if (
      /^group_/.test(
        repaired.operation
      )
    ) {
      repaired.column =
        requestedColumn;
      repaired.labelColumn =
        groupingColumn;
      repaired.groupBy =
        groupingColumn;
      repaired.aggregation =
        repaired.operation
          .replace(
            /^group_/,
            ""
          );
    } else {
      repaired.column =
        requestedColumn ||
        repaired.column ||
        null;
      repaired.groupBy =
        null;
      repaired.aggregation =
        null;
    }
  }

  repaired.filters =
    buildOperatorFilters({
      question,
      rows,
      datasetSchema,
      schema,
      datasetName,
      existingFilters:
        normalizeValueFiltersForQuestion(
          mergeFilters(
            repaired.filters,
            inferValueFilters(
              rows,
              question,
              [
                repaired.column,
                repaired.groupBy,
              ].filter(Boolean)
            )
          ),
          question
        ),
    });

  repaired.transform =
    detectTransform(
      question
    ) ||
    repaired.transform ||
    null;

  repaired.selectColumns =
    inferSelectColumns({
      question,
      schema,
      datasetName,
      current:
        repaired.selectColumns,
    });

  if (
    repaired.column &&
    !repaired.selectColumns.length &&
    ![
      "row_count",
      "group_count",
    ].includes(
      repaired.operation
    )
  ) {
    repaired.selectColumns = [
      repaired.column,
    ];
  }

  const explicitLimit =
    detectExplicitLimit(
      question
    );

  if (explicitLimit) {
    repaired.limit =
      explicitLimit;
  } else if (
    repaired.operation ===
      "list" &&
    detectsAllRowsList(
      question
    )
  ) {
    repaired.showAll =
      true;
    repaired.limit =
      Math.max(
        Number(
          repaired.limit
        ) || 10,
        100
      );
  }

  if (
    repaired.operation ===
      "lookup" &&
    repaired.selectColumns.length ===
      1
  ) {
    repaired.column =
      repaired.selectColumns[0];
  }

  repaired.outputRequested =
    true;

  repaired.localPlannerParityApplied =
    DATASET_OPERATIONS.has(
      String(
        repaired.operation ||
        ""
      )
        .trim()
        .toLowerCase()
    );

  return repaired;
}


module.exports = {
  DATASET_OPERATIONS,
  FILTER_OPERATORS,
  detectSchemaIntent,
  detectTransform,
  detectExplicitLimit,
  detectBaseOperation,
  mapGroupedOperation,
  detectComparatorOperator,
  detectStringOperatorFilter,
  buildOperatorFilters,
  inferSelectColumns,
  repairRankingParity,
  ensureLocalPlannerParity,
};
