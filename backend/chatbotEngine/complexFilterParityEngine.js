const {
  normalizeText,
} = require("./utils");

const {
  inferValueFilters,
  mergeFilters,
} = require("./filterEngine");


function cloneFilter(filter) {
  return {
    ...filter,
    value:
      Array.isArray(
        filter?.value
      )
        ? [
            ...filter.value,
          ]
        : filter?.value,
  };
}

function cloneFilters(filters) {
  return Array.isArray(filters)
    ? filters
        .filter(Boolean)
        .map(cloneFilter)
    : [];
}

function sameColumn(left, right) {
  return (
    normalizeText(
      left?.column
    ) ===
    normalizeText(
      right?.column
    )
  );
}

function filterValueKey(value) {
  if (
    Array.isArray(value)
  ) {
    return value
      .map(
        (item) =>
          normalizeText(item)
      )
      .filter(Boolean)
      .sort()
      .join("|");
  }

  return normalizeText(value);
}

function dedupeFilters(filters) {
  const seen =
    new Set();

  const output = [];

  for (const filter of cloneFilters(filters)) {
    const key = [
      normalizeText(
        filter?.column
      ),
      normalizeText(
        filter?.operator ||
        "equals"
      ),
      filterValueKey(
        filter?.value
      ),
    ].join("::");

    if (
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    output.push(filter);
  }

  return output;
}

function splitBooleanQuestion(question) {
  const source =
    String(question || "")
      .trim();

  if (!source) {
    return {
      clauses: [],
      connectors: [],
    };
  }

  const parts =
    source
      .split(
        /\b(and|or)\b/gi
      )
      .map(
        (part) =>
          part.trim()
      )
      .filter(Boolean);

  const clauses = [];
  const connectors = [];

  for (const part of parts) {
    const normalized =
      normalizeText(part);

    if (
      normalized === "and" ||
      normalized === "or"
    ) {
      connectors.push(
        normalized
      );
    } else {
      clauses.push(part);
    }
  }

  if (
    clauses.length <
      2 ||
    connectors.length !==
      clauses.length - 1
  ) {
    return {
      clauses: [],
      connectors: [],
    };
  }

  return {
    clauses,
    connectors,
  };
}

function inferClauseAtom(
  rows,
  clause
) {
  const filters =
    inferValueFilters(
      rows,
      clause,
      []
    );

  if (
    !Array.isArray(filters) ||
    filters.length !== 1
  ) {
    return null;
  }

  return cloneFilter(
    filters[0]
  );
}

function mergeSameColumnOrFilters(
  left,
  right
) {
  if (
    !left ||
    !right ||
    !sameColumn(
      left,
      right
    )
  ) {
    return null;
  }

  const leftOperator =
    normalizeText(
      left.operator ||
      "equals"
    );

  const rightOperator =
    normalizeText(
      right.operator ||
      "equals"
    );

  if (
    ![
      "equals",
      "in",
    ].includes(
      leftOperator
    ) ||
    ![
      "equals",
      "in",
    ].includes(
      rightOperator
    )
  ) {
    return null;
  }

  const values = [
    ...(
      Array.isArray(
        left.value
      )
        ? left.value
        : [left.value]
    ),
    ...(
      Array.isArray(
        right.value
      )
        ? right.value
        : [right.value]
    ),
  ];

  const unique = [];
  const seen =
    new Set();

  for (const value of values) {
    const key =
      normalizeText(
        value
      );

    if (
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    unique.push(value);
  }

  return {
    column:
      left.column,
    operator:
      unique.length >
        1
        ? "in"
        : "equals",
    value:
      unique.length >
        1
        ? unique
        : unique[0],
  };
}

function collapseSameColumnOr(
  atoms,
  connectors
) {
  const outAtoms =
    atoms.map(
      (atom) =>
        atom
          ? cloneFilter(atom)
          : null
    );

  const outConnectors = [
    ...connectors,
  ];

  let index = 0;

  while (
    index <
      outConnectors.length
  ) {
    if (
      outConnectors[index] ===
        "or"
    ) {
      const merged =
        mergeSameColumnOrFilters(
          outAtoms[index],
          outAtoms[
            index + 1
          ]
        );

      if (merged) {
        outAtoms.splice(
          index,
          2,
          merged
        );

        outConnectors.splice(
          index,
          1
        );

        if (
          index >
            0
        ) {
          index -= 1;
        }

        continue;
      }
    }

    index += 1;
  }

  return {
    atoms:
      outAtoms,
    connectors:
      outConnectors,
  };
}

function toOrOfAndGroups(
  atoms,
  connectors
) {
  const groups = [];
  let current = [];

  for (
    let index = 0;
    index < atoms.length;
    index += 1
  ) {
    const atom =
      atoms[index];

    if (atom) {
      current.push(
        cloneFilter(atom)
      );
    }

    const connector =
      connectors[index];

    if (
      connector ===
        "or" ||
      index ===
        atoms.length - 1
    ) {
      if (
        current.length
      ) {
        groups.push({
          logic:
            "and",
          filters:
            dedupeFilters(
              current
            ),
        });
      }

      current = [];
    }
  }

  return groups;
}

function resolveComplexFilterPlan({
  plan,
  question,
  rows,
} = {}) {
  if (
    !plan ||
    plan.route !==
      "dataset" ||
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return plan;
  }

  const normalized =
    normalizeText(
      question
    );

  if (
    !/\b(?:and|or)\b/.test(
      normalized
    )
  ) {
    return plan;
  }

  const {
    clauses,
    connectors,
  } =
    splitBooleanQuestion(
      question
    );

  if (
    clauses.length <
      2
  ) {
    return plan;
  }

  const atoms =
    clauses.map(
      (clause) =>
        inferClauseAtom(
          rows,
          clause
        )
    );

  const groundedCount =
    atoms.filter(Boolean)
      .length;

  /**
   * Only rewrite the plan when EVERY boolean clause is independently
   * grounded to exactly one live dataset filter. Partial boolean parsing is
   * unsafe because it silently drops part of the user's condition.
   */
  if (
    groundedCount !==
      clauses.length
  ) {
    return {
      ...plan,
      complexFilterGroundingFailed:
        true,
      complexFilterUngroundedClauses:
        clauses.filter(
          (_, index) =>
            !atoms[index]
        ),
    };
  }

  const collapsed =
    collapseSameColumnOr(
      atoms,
      connectors
    );

  const hasRemainingOr =
    collapsed.connectors
      .includes(
        "or"
      );

  if (
    !hasRemainingOr
  ) {
    const explicit =
      dedupeFilters(
        collapsed.atoms
      );

    const explicitColumns =
      new Set(
        explicit.map(
          (filter) =>
            normalizeText(
              filter.column
            )
        )
      );

    const inherited =
      cloneFilters(
        plan.filters
      )
        .filter(
          (filter) =>
            !explicitColumns.has(
              normalizeText(
                filter?.column
              )
            )
        );

    return {
      ...plan,
      filters:
        mergeFilters(
          inherited,
          explicit
        ),
      filterGroups:
        [],
      filterGroupLogic:
        null,
      complexFilterResolved:
        true,
    };
  }

  const groups =
    toOrOfAndGroups(
      collapsed.atoms,
      collapsed.connectors
    );

  if (
    groups.length <
      2
  ) {
    return plan;
  }

  return {
    ...plan,
    filters:
      [],
    filterGroups:
      groups,
    filterGroupLogic:
      "or",
    complexFilterResolved:
      true,
  };
}


module.exports = {
  splitBooleanQuestion,
  mergeSameColumnOrFilters,
  collapseSameColumnOr,
  toOrOfAndGroups,
  resolveComplexFilterPlan,
};
