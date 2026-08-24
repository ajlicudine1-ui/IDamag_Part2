const {
  findSharedColumns,
} = require("./columnMatcher");

const {
  normalizeText,
} = require("./utils");

/**
 * Columns that are usually stronger join keys.
 * These are only hints.
 *
 * The engine still checks whether they actually
 * exist in both worksheets.
 */
const PREFERRED_JOIN_NAMES = [
  "id",
  "record id",
  "farm id",
  "employee id",
  "employee code",
  "emp code",
  "emp_code",
  "registration number",
  "registration no",
  "reference number",
  "reference no",
  "control number",
  "control no",
  "item number",
  "item no",
];

/**
 * Columns that are usually risky as joins.
 *
 * Example:
 * Province, Municipality, Status, Division
 * may repeat many times and should not be preferred
 * over unique IDs.
 */
const WEAK_JOIN_NAMES = [
  "province",
  "municipality",
  "city",
  "status",
  "division",
  "office",
  "category",
  "sex",
  "gender",
  "year",
  "month",
];

/**
 * Normalize join values.
 */
function normalizeJoinValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Count unique non-empty values.
 */
function getUniqueStats(
  rows,
  column
) {
  const values = [];
  const unique = new Set();

  for (const row of rows || []) {
    const value =
      normalizeJoinValue(
        row?.[column]
      );

    if (!value) {
      continue;
    }

    values.push(value);
    unique.add(value);
  }

  return {
    populated:
      values.length,

    unique:
      unique.size,

    uniquenessRatio:
      values.length > 0
        ? unique.size /
          values.length
        : 0,

    values:
      unique,
  };
}

/**
 * Determine how much two possible join
 * columns overlap.
 */
function calculateOverlap(
  leftStats,
  rightStats
) {
  if (
    !leftStats.unique ||
    !rightStats.unique
  ) {
    return {
      overlapCount: 0,
      overlapRatio: 0,
    };
  }

  let overlapCount = 0;

  for (
    const value of
    leftStats.values
  ) {
    if (
      rightStats.values.has(
        value
      )
    ) {
      overlapCount += 1;
    }
  }

  const overlapRatio =
    overlapCount /
    Math.max(
      1,
      Math.min(
        leftStats.unique,
        rightStats.unique
      )
    );

  return {
    overlapCount,
    overlapRatio,
  };
}

/**
 * Score the semantic quality of a
 * potential join column name.
 */
function getNameScore(
  leftColumn,
  rightColumn
) {
  const leftName =
    normalizeText(leftColumn);

  const rightName =
    normalizeText(rightColumn);

  if (
    !leftName ||
    !rightName
  ) {
    return 0;
  }

  let score = 0;

  /**
   * Same normalized column name.
   */
  if (
    leftName ===
    rightName
  ) {
    score += 2;
  }

  /**
   * Prefer common ID/key names.
   */
  if (
    PREFERRED_JOIN_NAMES.some(
      (name) =>
        leftName ===
          normalizeText(name) ||
        rightName ===
          normalizeText(name)
    )
  ) {
    score += 4;
  }

  /**
   * Penalize common descriptive fields.
   */
  if (
    WEAK_JOIN_NAMES.some(
      (name) =>
        leftName ===
          normalizeText(name) ||
        rightName ===
          normalizeText(name)
    )
  ) {
    score -= 2;
  }

  return score;
}

/**
 * Score one possible relationship.
 */
function scoreRelationship(
  leftRows,
  rightRows,
  shared
) {
  const leftStats =
    getUniqueStats(
      leftRows,
      shared.leftColumn
    );

  const rightStats =
    getUniqueStats(
      rightRows,
      shared.rightColumn
    );

  const {
    overlapCount,
    overlapRatio,
  } =
    calculateOverlap(
      leftStats,
      rightStats
    );

  if (
    overlapCount === 0
  ) {
    return {
      score: 0,
      overlapCount,
      overlapRatio,
      leftUniqueness:
        leftStats.uniquenessRatio,
      rightUniqueness:
        rightStats.uniquenessRatio,
    };
  }

  const nameScore =
    getNameScore(
      shared.leftColumn,
      shared.rightColumn
    );

  /**
   * Overlap is the strongest factor.
   *
   * Unique columns are also preferred
   * because IDs are safer than repeated
   * descriptive values.
   */
  const score =
    overlapRatio * 6 +
    leftStats.uniquenessRatio * 2 +
    rightStats.uniquenessRatio * 2 +
    nameScore;

  return {
    score,
    overlapCount,
    overlapRatio,

    leftUniqueness:
      leftStats.uniquenessRatio,

    rightUniqueness:
      rightStats.uniquenessRatio,
  };
}

/**
 * Find all possible relationships
 * between two worksheets.
 */
function findRelationshipCandidates(
  leftRows,
  rightRows
) {
  const shared =
    findSharedColumns(
      leftRows,
      rightRows
    );

  return shared
    .map((item) => {
      const metrics =
        scoreRelationship(
          leftRows,
          rightRows,
          item
        );

      return {
        ...item,
        ...metrics,
      };
    })
    .filter(
      (item) =>
        item.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    );
}

/**
 * Find the safest relationship
 * between two worksheets.
 */
function findBestRelationship(
  leftRows,
  rightRows
) {
  const candidates =
    findRelationshipCandidates(
      leftRows,
      rightRows
    );

  if (!candidates.length) {
    return null;
  }

  const best =
    candidates[0];

  /**
   * Reject extremely weak joins.
   */
  if (
    best.overlapRatio <
    0.25
  ) {
    return null;
  }

  return best;
}

/**
 * Build a map of all relationships
 * between all worksheets.
 */
function buildRelationshipMap(
  datasets
) {
  const names =
    Object.keys(
      datasets || {}
    );

  const relationships = [];

  for (
    let i = 0;
    i < names.length;
    i += 1
  ) {
    for (
      let j = i + 1;
      j < names.length;
      j += 1
    ) {
      const leftDataset =
        names[i];

      const rightDataset =
        names[j];

      const leftRows =
        datasets[
          leftDataset
        ];

      const rightRows =
        datasets[
          rightDataset
        ];

      if (
        !Array.isArray(
          leftRows
        ) ||
        !leftRows.length ||
        !Array.isArray(
          rightRows
        ) ||
        !rightRows.length
      ) {
        continue;
      }

      const relationship =
        findBestRelationship(
          leftRows,
          rightRows
        );

      if (!relationship) {
        continue;
      }

      relationships.push({
        leftDataset,
        rightDataset,

        leftColumn:
          relationship.leftColumn,

        rightColumn:
          relationship.rightColumn,

        score:
          relationship.score,

        overlapRatio:
          relationship.overlapRatio,

        leftUniqueness:
          relationship.leftUniqueness,

        rightUniqueness:
          relationship.rightUniqueness,
      });
    }
  }

  return relationships;
}

/**
 * Find a direct relationship between
 * two specific datasets.
 */
function getRelationship(
  datasets,
  sourceDataset,
  targetDataset
) {
  if (
    !datasets?.[
      sourceDataset
    ] ||
    !datasets?.[
      targetDataset
    ]
  ) {
    return null;
  }

  const relationship =
    findBestRelationship(
      datasets[
        sourceDataset
      ],
      datasets[
        targetDataset
      ]
    );

  if (!relationship) {
    return null;
  }

  return {
    sourceDataset,
    targetDataset,

    sourceColumn:
      relationship.leftColumn,

    targetColumn:
      relationship.rightColumn,

    score:
      relationship.score,

    overlapRatio:
      relationship.overlapRatio,

    sourceUniqueness:
      relationship.leftUniqueness,

    targetUniqueness:
      relationship.rightUniqueness,
  };
}

module.exports = {
  normalizeJoinValue,
  getUniqueStats,
  calculateOverlap,
  scoreRelationship,
  findRelationshipCandidates,
  findBestRelationship,
  buildRelationshipMap,
  getRelationship,
};