const {
  formatNumber,
  similarity,
} = require("./utils");

function answerSchemaQuestion({
  schema,
  plan,
  question,
}) {
  const intent = plan.intent || "describe";

  if (intent === "datasets") {
    return {
      success: true,
      source: "schema",
      operation: intent,
      results: schema,
      answer:
        "Available worksheets:\n" +
        schema
          .map(
            (dataset, index) =>
              `${index + 1}. ${dataset.name} ` +
              `(${formatNumber(dataset.rowCount)} rows)`
          )
          .join("\n"),
    };
  }

  if (intent === "row_counts") {
    return {
      success: true,
      source: "schema",
      operation: intent,
      answer:
        "Worksheet row counts:\n" +
        schema
          .map(
            (dataset, index) =>
              `${index + 1}. ${dataset.name}: ` +
              `${formatNumber(dataset.rowCount)}`
          )
          .join("\n"),
    };
  }

  if (intent === "find_column") {
    const requested = plan.column || question;

    const matches = schema
      .map((dataset) => ({
        dataset: dataset.name,
        columns: dataset.columns
          .filter(
            (column) =>
              similarity(column.name, requested) >= 0.4
          )
          .map((column) => column.name),
      }))
      .filter((item) => item.columns.length);

    return {
      success: matches.length > 0,
      source: "schema",
      operation: intent,
      results: matches,
      answer: matches.length
        ? "Matching column locations:\n" +
          matches
            .map(
              (item, index) =>
                `${index + 1}. ${item.dataset}: ` +
                item.columns.join(", ")
            )
            .join("\n")
        : `No matching column was found for "${requested}".`,
    };
  }

  if (intent === "columns") {
    const selected = plan.dataset
      ? schema.filter(
          (dataset) =>
            similarity(
              dataset.name,
              plan.dataset
            ) >= 0.45
        )
      : schema;

    return {
      success: selected.length > 0,
      source: "schema",
      operation: intent,
      answer: selected
        .map(
          (dataset) =>
            `${dataset.name} ` +
            `(${formatNumber(dataset.rowCount)} rows):\n` +
            dataset.columns
              .map(
                (column, index) =>
                  `${index + 1}. ${column.name} [${column.type}]`
              )
              .join("\n")
        )
        .join("\n\n"),
    };
  }

  return {
    success: true,
    source: "schema",
    operation: "describe",
    answer: schema
      .map(
        (dataset) =>
          `${dataset.name} has ` +
          `${formatNumber(dataset.rowCount)} rows and ` +
          `${formatNumber(dataset.columns.length)} columns. ` +
          `Columns: ${dataset.columns
            .map((column) => column.name)
            .join(", ")}.`
      )
      .join("\n\n"),
  };
}

module.exports = {
  answerSchemaQuestion,
};
