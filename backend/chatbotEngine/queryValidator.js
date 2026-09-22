const {
  findDatasetName,
  findColumn,
  questionExplicitlyNamesColumn,
} = require("./columnMatcher");

const { compare } = require("./filterEngine");
const { getColumns, normalizeText } = require("./utils");

function makeError(code, message, details = {}) {
  return {
    valid: false,
    code,
    message,
    details,
  };
}

function validateRoute(plan) {
  const allowedRoutes = new Set([
    "dataset",
    "schema",
    "general",
    "clarify",
  ]);

  if (!allowedRoutes.has(plan?.route)) {
    return makeError(
      "INVALID_ROUTE",
      `Unsupported query route: ${String(
        plan?.route || "unknown"
      )}`
    );
  }

  return null;
}

function validateDatasetOperation(plan) {
  const allowedOperations = new Set([
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
    "group_list",
  ]);

  if (!allowedOperations.has(plan?.operation)) {
    return makeError(
      "INVALID_OPERATION",
      `Unsupported dataset operation: ${String(
        plan?.operation || "unknown"
      )}`
    );
  }

  return null;
}

function validateDatasetExists(datasets, plan) {
  const datasetName =
    findDatasetName(
      datasets,
      plan.dataset
    );

  if (!datasetName) {
    return makeError(
      "DATASET_NOT_FOUND",
      `The worksheet "${plan.dataset || ""}" was not found.`,
      {
        availableDatasets:
          Object.keys(datasets),
      }
    );
  }

  return {
    valid: true,
    datasetName,
  };
}

function validateColumnExists(
  rows,
  requestedColumn,
  label
) {
  if (!requestedColumn) {
    return {
      valid: true,
      column: null,
    };
  }

  const column =
    findColumn(
      rows,
      requestedColumn
    );

  if (!column) {
    return makeError(
      "COLUMN_NOT_FOUND",
      `${label} "${requestedColumn}" was not found.`
    );
  }

  return {
    valid: true,
    column,
  };
}

function validateFilters(
  rows,
  filters
) {
  if (!Array.isArray(filters)) {
    return makeError(
      "INVALID_FILTERS",
      "Filters must be an array."
    );
  }

  const allowedOperators =
    new Set([
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
      "empty",
      "not_empty",
    ]);

  const normalized = [];

  for (const filter of filters) {
    if (
      !filter ||
      typeof filter !== "object"
    ) {
      return makeError(
        "INVALID_FILTER",
        "A filter is malformed."
      );
    }

    const column =
      findColumn(
        rows,
        filter.column
      );

    if (!column) {
      return makeError(
        "FILTER_COLUMN_NOT_FOUND",
        `Filter column "${filter.column || ""}" was not found.`
      );
    }

    const operator =
      String(
        filter.operator ||
        "equals"
      )
        .trim()
        .toLowerCase();

    if (
      !allowedOperators.has(
        operator
      )
    ) {
      return makeError(
        "INVALID_FILTER_OPERATOR",
        `Unsupported filter operator "${operator}".`
      );
    }

    const isMultiValue =
      operator === "in" ||
      operator === "not_in";

    if (isMultiValue) {
      if (
        !Array.isArray(filter.value) ||
        filter.value.length === 0 ||
        filter.value.every(
          (value) =>
            value === undefined ||
            value === null ||
            String(value).trim() === ""
        )
      ) {
        return makeError(
          "EMPTY_FILTER_VALUE",
          `Filter "${column}" has no usable values.`
        );
      }
    } else if (
      filter.value === undefined ||
      filter.value === null ||
      String(filter.value).trim() === ""
    ) {
      return makeError(
        "EMPTY_FILTER_VALUE",
        `Filter "${column}" has no value.`
      );
    }

    normalized.push({
      column,
      operator,
      value: filter.value,
    });
  }

  return {
    valid: true,
    filters: normalized,
  };
}


function validateRelationship(datasets, relationship) {
  if (!relationship) return { valid: true, relationship: null };
  const sourceDataset = relationship.sourceDataset || relationship.leftDataset;
  const targetDataset = relationship.targetDataset || relationship.rightDataset;
  const sourceColumn = relationship.sourceColumn || relationship.leftColumn;
  const targetColumn = relationship.targetColumn || relationship.rightColumn;

  if (!datasets?.[sourceDataset] || !datasets?.[targetDataset]) {
    return makeError("RELATIONSHIP_DATASET_NOT_FOUND", "A worksheet required by the cross-worksheet relationship was not found.");
  }
  if (!findColumn(datasets[sourceDataset], sourceColumn) || !findColumn(datasets[targetDataset], targetColumn)) {
    return makeError("RELATIONSHIP_COLUMN_NOT_FOUND", "A relationship key column was not found in the connected worksheets.");
  }
  if (relationship.confidence !== undefined && Number(relationship.confidence) < 0.6) {
    return makeError("RELATIONSHIP_AMBIGUOUS", "The worksheets do not have a strong enough shared key to answer this safely.", { relationship });
  }
  return { valid: true, relationship };
}

function validateDatasetPlan({
  datasets,
  plan,
  question = "",
}) {
  const operationCheck =
    validateDatasetOperation(plan);

  const relationshipCheck = validateRelationship(
    datasets,
    plan.relationship || null
  );
  if (!relationshipCheck.valid) return relationshipCheck;

  if (operationCheck) {
    return operationCheck;
  }

  const datasetCheck =
    validateDatasetExists(
      datasets,
      plan
    );

  if (!datasetCheck.valid) {
    return datasetCheck;
  }

  const datasetName =
    datasetCheck.datasetName;

  const rows =
    datasets[datasetName];

  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return makeError(
      "EMPTY_DATASET",
      `Worksheet "${datasetName}" has no usable rows.`
    );
  }

  const filterCheck =
    validateFilters(
      rows,
      Array.isArray(plan.filters)
        ? plan.filters
        : []
    );

  if (!filterCheck.valid) {
    return filterCheck;
  }

  const normalizedPlan = {
    ...plan,
    dataset: datasetName,
    filters: filterCheck.filters,
  };

  const operation =
    String(
      plan.operation || ""
    )
      .trim()
      .toLowerCase();

  const columnRequired =
    new Set([
      "sum",
      "average",
      "median",
      "minimum",
      "maximum",
      "non_empty_count",
      "distinct_count",
      "list",
      "group_sum",
      "group_average",
      "group_minimum",
      "group_maximum",
      "rank_rows",
      "rank_groups",
      "group_list",
    ]);

  if (
    columnRequired.has(operation)
  ) {
    const columnCheck =
      validateColumnExists(
        rows,
        plan.column,
        "Column"
      );

    if (
      !columnCheck.valid &&
      ![
        "group_sum",
        "group_average",
        "group_minimum",
        "group_maximum",
        "rank_groups",
      ].includes(operation)
    ) {
      return columnCheck;
    }

    if (columnCheck.valid) {
      normalizedPlan.column =
        columnCheck.column;
    }
  }


  // Problem #2 safeguard: if the user explicitly names exactly one LIVE
  // numeric field and the operation consumes a numeric metric, that field
  // wins over a fuzzy planner choice. This uses only the current worksheet
  // schema and therefore works for Groq and local plans alike.
  const metricOperations = new Set([
    "sum", "average", "median", "minimum", "maximum",
    "group_sum", "group_average", "group_minimum",
    "group_maximum", "rank_rows", "rank_groups",
  ]);

  if (question && metricOperations.has(operation)) {
    const isStrictNumericColumn = (column) => {
      const values = rows
        .map((row) => row?.[column])
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
        .slice(0, 100);
      if (!values.length) return false;
      const numeric = values.filter((value) => {
        const text = String(value).trim().replace(/[₱$€£,%]/g, "").replace(/,/g, "").trim();
        return /^[-+]?\d+(?:\.\d+)?$/.test(text);
      }).length;
      return numeric / values.length >= 0.7;
    };

    const explicitNumericColumns = Object.keys(rows[0] || {}).filter(
      (column) =>
        isStrictNumericColumn(column) &&
        questionExplicitlyNamesColumn(question, column)
    );

    if (explicitNumericColumns.length === 1) {
      normalizedPlan.column = explicitNumericColumns[0];
      normalizedPlan.liveSchemaMetricGrounded = true;
    }
  }

  if (operation === "lookup") {
    const requested =
      Array.isArray(
        plan.selectColumns
      )
        ? plan.selectColumns
        : [];

    if (
      plan.outputRequested &&
      requested.length === 0
    ) {
      return makeError(
        "LOOKUP_OUTPUT_MISSING",
        "The lookup does not specify which field should be returned."
      );
    }

    for (const requestedColumn of requested) {
      let found = false;

      for (
        const rowsToCheck of
        Object.values(datasets)
      ) {
        if (
          Array.isArray(rowsToCheck) &&
          rowsToCheck.length &&
          findColumn(
            rowsToCheck,
            requestedColumn
          )
        ) {
          found = true;
          break;
        }
      }

      if (!found) {
        return makeError(
          "LOOKUP_COLUMN_NOT_FOUND",
          `Requested output column "${requestedColumn}" was not found in any worksheet.`
        );
      }
    }
  }

  if (
    [
      "group_count",
      "group_sum",
      "group_average",
      "group_minimum",
      "group_maximum",
      "group_list",
    ].includes(operation)
  ) {
    if (!plan.groupBy) {
      return makeError(
        "GROUP_COLUMN_MISSING",
        "The grouped query does not specify a grouping column."
      );
    }

    const groupCheck =
      validateColumnExists(
        rows,
        plan.groupBy,
        "Group column"
      );

    if (
      !groupCheck.valid &&
      operation === "group_count"
    ) {
      return groupCheck;
    }

    if (groupCheck.valid) {
      normalizedPlan.groupBy =
        groupCheck.column;
    }
  }

  if (
    [
      "rank_rows",
      "rank_groups",
    ].includes(operation)
  ) {
    const labelRequest =
      plan.labelColumn ||
      plan.groupBy;

    if (!labelRequest) {
      return makeError(
        "RANK_LABEL_MISSING",
        "The ranking query does not specify what should be ranked."
      );
    }
  }

  return {
    valid: true,
    plan: normalizedPlan,
  };
}

function filterValues(filter) {
  const operator = String(filter?.operator || "equals").trim().toLowerCase();
  return ["in", "not_in"].includes(operator)
    ? (Array.isArray(filter?.value) ? filter.value : [filter?.value])
    : [filter?.value];
}

function columnSupportsFilterValues(rows, column, filter) {
  const values = filterValues(filter)
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "");

  if (!column || !values.length) return false;

  // Ground against equality semantics even for negative filters. We want to
  // know whether the referenced category actually exists in this live field.
  return values.every((value) =>
    rows.some((row) => compare(row?.[column], value, "equals"))
  );
}

function findBestSupportedFilterColumn({ rows, filter, question = "" }) {
  const columns = getColumns(rows);
  const candidates = columns.filter((column) =>
    columnSupportsFilterValues(rows, column, filter)
  );

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  // When the same live value exists in several fields, only arbitrate if the
  // question itself clearly names one of those fields. Otherwise ambiguity is
  // safer than silently moving a filter to the wrong column.
  const explicitlyNamed = candidates.filter((column) =>
    questionExplicitlyNamesColumn(question, column)
  );

  if (explicitlyNamed.length === 1) return explicitlyNamed[0];

  // A conservative lexical tiebreaker helps cases where the planner selected
  // a near-synonymous field name but the live value proves another field is
  // correct. It is intentionally weak and only used when there is one clear
  // best overlap with the original requested field name.
  const requestedTokens = new Set(
    normalizeText(filter?.column || "").split(/\s+/).filter(Boolean)
  );

  const scored = candidates
    .map((column) => {
      const tokens = normalizeText(column).split(/\s+/).filter(Boolean);
      const overlap = tokens.filter((token) => requestedTokens.has(token)).length;
      return { column, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap);

  if (scored.length && scored[0].overlap > 0 && scored[0].overlap > (scored[1]?.overlap || 0)) {
    return scored[0].column;
  }

  return null;
}

function validateResolvedFilterValues({ datasets, plan, question = "" }) {
  if (!plan || plan.route !== "dataset") return { valid: true, plan };
  const rows = datasets?.[plan.dataset];
  if (!Array.isArray(rows) || !rows.length) {
    return makeError("EMPTY_DATASET", "The selected worksheet has no usable rows.");
  }

  const filters = Array.isArray(plan.filters) ? plan.filters : [];
  let repaired = false;
  const groundedFilters = [];

  for (const filter of filters) {
    const operator = String(filter?.operator || "equals").trim().toLowerCase();
    if (["empty", "not_empty", "greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(operator)) {
      groundedFilters.push(filter);
      continue;
    }

    if (columnSupportsFilterValues(rows, filter.column, filter)) {
      groundedFilters.push(filter);
      continue;
    }

    const supportedColumn = findBestSupportedFilterColumn({
      rows,
      filter,
      question,
    });

    if (supportedColumn) {
      groundedFilters.push({
        ...filter,
        column: supportedColumn,
      });
      repaired = true;
      continue;
    }

    const firstValue = filterValues(filter)[0];
    return makeError(
      "FILTER_VALUE_NOT_GROUNDED",
      `Filter value "${String(firstValue)}" was not found in live field "${filter.column}" or in one unambiguous live field.`,
      { column: filter.column, value: firstValue }
    );
  }

  return {
    valid: true,
    plan: repaired
      ? {
          ...plan,
          filters: groundedFilters,
          liveFilterFieldGrounded: true,
        }
      : plan,
  };
}

function validateQueryPlan({
  datasets,
  schema,
  plan,
  question = "",
}) {
  if (
    !plan ||
    typeof plan !== "object"
  ) {
    return makeError(
      "INVALID_PLAN",
      "The query planner returned an invalid plan."
    );
  }

  const routeCheck =
    validateRoute(plan);

  if (routeCheck) {
    return routeCheck;
  }

  if (
    plan.route === "dataset"
  ) {
    return validateDatasetPlan({
      datasets,
      schema,
      plan,
      question,
    });
  }

  return {
    valid: true,
    plan,
  };
}

module.exports = {
  validateQueryPlan,
  validateResolvedFilterValues,
};
