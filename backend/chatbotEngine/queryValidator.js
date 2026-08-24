const {
  findDatasetName,
  findColumn,
} = require("./columnMatcher");

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

function validateDatasetPlan({
  datasets,
  plan,
}) {
  const operationCheck =
    validateDatasetOperation(plan);

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

function validateQueryPlan({
  datasets,
  schema,
  plan,
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
    });
  }

  return {
    valid: true,
    plan,
  };
}

module.exports = {
  validateQueryPlan,
};
