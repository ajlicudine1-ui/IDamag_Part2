function humanizeLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatLookupAnswer({
  results = [],
  selectedColumns = [],
  count = 0,
  subject = null,
}) {
  if (!results.length) {
    return "I couldn't find a matching record.";
  }

  // One row, one returned field
  if (count === 1 && selectedColumns.length === 1) {
    const column = selectedColumns[0];
    const value = results[0]?.[column];

    if (subject) {
      return `${subject}'s ${humanizeLabel(column).toLowerCase()} is ${value}.`;
    }

    return `The ${humanizeLabel(column).toLowerCase()} is ${value}.`;
  }

  // One row, multiple returned fields
  if (count === 1 && selectedColumns.length > 1) {
    const parts = selectedColumns
      .map((column) => {
        const value = results[0]?.[column];

        if (
          value === null ||
          value === undefined ||
          String(value).trim() === ""
        ) {
          return null;
        }

        return `${humanizeLabel(column)} is ${value}`;
      })
      .filter(Boolean);

    if (subject) {
      return `${subject}: ${parts.join(", ")}.`;
    }

    return `${parts.join(", ")}.`;
  }

  // Multiple rows
  if (selectedColumns.length === 1) {
    const column = selectedColumns[0];

    return (
      `${humanizeLabel(column)}:\n` +
      results
        .map(
          (row, index) =>
            `${index + 1}. ${row?.[column] ?? ""}`
        )
        .join("\n")
    );
  }

  return results
    .map(
      (row, index) =>
        `${index + 1}. ` +
        selectedColumns
          .map(
            (column) =>
              `${humanizeLabel(column)}: ${row?.[column] ?? ""}`
          )
          .join(", ")
    )
    .join("\n");
}

function formatAggregateAnswer({
  operation,
  column,
  value,
  recordsUsed,
  dataset,
}) {
  const label = humanizeLabel(column);

  switch (operation) {
    case "sum":
      return `The total ${label.toLowerCase()} is ${value}.`;

    case "average":
      return `The average ${label.toLowerCase()} is ${value}.`;

    case "median":
      return `The median ${label.toLowerCase()} is ${value}.`;

    case "minimum":
      return `The lowest ${label.toLowerCase()} is ${value}.`;

    case "maximum":
      return `The highest ${label.toLowerCase()} is ${value}.`;

    default:
      return `${label}: ${value}.`;
  }
}

function formatCountAnswer({
  count,
  column = null,
}) {
  if (column) {
    return `There are ${count} ${humanizeLabel(column).toLowerCase()} record(s).`;
  }

  return `There are ${count} record(s).`;
}

module.exports = {
  humanizeLabel,
  formatLookupAnswer,
  formatAggregateAnswer,
  formatCountAnswer,
};