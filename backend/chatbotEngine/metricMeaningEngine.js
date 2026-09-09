const { normalizeText, parseNumber } = require('./utils');

const AGGREGATION_WORDS = new Set([
  'sum', 'average', 'avg', 'mean', 'count', 'minimum', 'min', 'maximum', 'max', 'median', 'total'
]);

function cloneFilter(filter) {
  return {
    ...filter,
    value: Array.isArray(filter?.value) ? [...filter.value] : filter?.value,
  };
}

function normalizeColumnName(value) {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

function exactColumnMention(question, columnName) {
  const q = normalizeColumnName(question);
  const c = normalizeColumnName(columnName);
  if (!q || !c) return false;
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(q);
}

function countPhraseOccurrences(question, phrase) {
  const q = normalizeColumnName(question);
  const p = normalizeColumnName(phrase);
  if (!q || !p) return 0;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'gu');
  let count = 0;
  while (regex.exec(q)) count += 1;
  return count;
}

function aggregationKeywordForOperation(operation) {
  const op = normalizeText(operation);
  if (op === 'average') return ['average', 'avg', 'mean'];
  if (op === 'sum') return ['sum', 'total'];
  if (op === 'count' || op === 'distinct_count' || op === 'non_empty_count') return ['count', 'number'];
  if (op === 'minimum') return ['minimum', 'min', 'lowest'];
  if (op === 'maximum') return ['maximum', 'max', 'highest'];
  if (op === 'median') return ['median'];
  return [];
}

function columnLooksOperationLike(columnName, operation) {
  const column = normalizeColumnName(columnName);
  const aliases = aggregationKeywordForOperation(operation);
  return aliases.some((alias) => column === alias || column.startsWith(`${alias} `) || column.endsWith(` ${alias}`));
}

function hasExplicitCalculationCue(question, operation, columnName) {
  const q = normalizeText(question);
  const op = normalizeText(operation);
  const aliases = aggregationKeywordForOperation(op);
  const column = normalizeColumnName(columnName);

  if (!q || !aliases.length) return false;

  // Strong calculation wording. These indicate that the user wants values
  // combined/reduced rather than a stored field merely named Average/Total/etc.
  const strongPatterns = [
    /\b(?:calculate|compute|find|get)\s+(?:the\s+)?(?:average|mean|sum|total|count|minimum|maximum|median)\b/,
    /\b(?:average|mean|sum|total|count|minimum|maximum|median)\s+of\b/,
    /\b(?:average|mean|sum|total|count|minimum|maximum|median)\s+across\b/,
    /\b(?:average|mean|sum|total|count|minimum|maximum|median)\s+for\s+all\b/,
    /\b(?:overall|combined|aggregate|aggregated)\b/,
    /\bfrom\b.+\bto\b/,
    /\bbetween\b.+\band\b/,
  ];
  if (strongPatterns.some((pattern) => pattern.test(q))) return true;

  // When the operation-like word is also the live column name, a repeated
  // occurrence usually means one occurrence is the calculation and the other
  // is the stored metric: "average Average price".
  for (const alias of aliases) {
    if (countPhraseOccurrences(question, alias) >= 2) return true;
  }

  // "average of the Average column" / "sum of Total" etc.
  if (column) {
    const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b(?:${aliases.join('|')})\\b[^.?!]{0,30}\\bof\\b[^.?!]{0,30}\\b${escapedColumn}\\b`, 'u').test(q)) {
      return true;
    }
  }

  return false;
}

function refineStoredMetricOperation({ plan, question, schema = [] } = {}) {
  if (!plan || plan.route !== 'dataset' || !plan.column) return plan;

  const op = normalizeText(plan.operation);
  const aggregateOps = new Set(['average', 'sum', 'count', 'minimum', 'maximum', 'median']);
  if (!aggregateOps.has(op)) return plan;

  const datasetSchema = (schema || []).find((item) => !plan.dataset || String(item?.name || '') === String(plan.dataset));
  const realColumn = datasetSchema?.columns?.find((item) => String(item?.name || '') === String(plan.column));
  if (!realColumn) return plan;

  const explicitlyNamed = exactColumnMention(question, plan.column);
  if (!explicitlyNamed) return plan;

  // Only protect fields whose names can be confused with analytical verbs.
  if (!columnLooksOperationLike(plan.column, op)) return plan;

  if (hasExplicitCalculationCue(question, op, plan.column)) {
    return {
      ...plan,
      metricSource: 'stored_column',
      metricCalculation: op,
      storedMetricDisambiguated: true,
    };
  }

  // Exact stored metric reference with no true aggregation cue = retrieve the
  // field value(s), do not silently aggregate it.
  return {
    ...plan,
    operation: 'lookup',
    aggregation: null,
    groupBy: null,
    metricSource: 'stored_column',
    metricCalculation: null,
    storedMetricDisambiguated: true,
    selectColumns: Array.isArray(plan.selectColumns) && plan.selectColumns.length
      ? [...new Set(plan.selectColumns.filter(Boolean))]
      : [plan.column],
    outputRequested: true,
  };
}

function matchesFilter(row, filter) {
  if (!filter?.column) return true;
  const actual = row?.[filter.column];
  const op = normalizeText(filter.operator || 'equals');
  const expected = filter.value;
  const actualText = normalizeText(actual);

  if (op === 'equals') return actualText === normalizeText(expected);
  if (op === 'contains') return actualText.includes(normalizeText(expected));
  if (op === 'in') {
    const list = Array.isArray(expected) ? expected : [expected];
    return list.some((item) => actualText === normalizeText(item));
  }
  if (['>', 'gt', 'greater_than'].includes(op)) return Number(actual) > Number(expected);
  if (['<', 'lt', 'less_than'].includes(op)) return Number(actual) < Number(expected);
  if (['>=', 'gte', 'greater_than_or_equal'].includes(op)) return Number(actual) >= Number(expected);
  if (['<=', 'lte', 'less_than_or_equal'].includes(op)) return Number(actual) <= Number(expected);
  return true;
}

function rowsMatchingPlan({ datasets, plan }) {
  if (!plan?.dataset || !Array.isArray(datasets?.[plan.dataset])) return [];
  const filters = Array.isArray(plan.filters) ? plan.filters : [];
  return datasets[plan.dataset].filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

function inferAssociatedUnitColumn({ schema = [], dataset = null } = {}) {
  const datasetSchema = (schema || []).find((item) => !dataset || String(item?.name || '') === String(dataset));
  if (!datasetSchema) return null;

  const candidates = (datasetSchema.columns || [])
    .map((column) => column?.name)
    .filter(Boolean)
    .filter((name) => /^(?:unit|uom|unit of measure|measurement unit)$/i.test(String(name).trim()));
  return candidates[0] || null;
}

function inferMetricMeaning({ plan, question, datasets = {}, schema = [], reportContext = null } = {}) {
  const column = String(plan?.column || '').trim();
  if (!column) return {
    type: null,
    displayUnit: null,
    numeratorUnit: null,
    denominatorUnit: null,
    confidence: 0,
  };

  const contextText = normalizeText([
    question,
    typeof reportContext === 'string' ? reportContext : reportContext?.title,
    column,
  ].filter(Boolean).join(' '));

  let type = null;
  let confidence = 0.45;
  if (/\b(price|farmgate|farm gate|selling price|market price)\b/.test(contextText)) {
    type = 'price';
    confidence = 0.92;
  } else if (/\b(salary|cost|amount|budget|revenue|expense|value|peso|php)\b/.test(contextText)) {
    type = 'currency';
    confidence = 0.8;
  } else if (/\b(area|hectare|hectares|\bha\b)\b/.test(contextText)) {
    type = 'area';
    confidence = 0.82;
  } else if (/\b(percent|percentage|rate)\b|%/.test(contextText)) {
    type = 'percentage';
    confidence = 0.82;
  } else if (/\b(count|number|members|beneficiaries|employees|farmers|persons|respondents)\b/.test(contextText)) {
    type = 'count';
    confidence = 0.7;
  }

  const matchingRows = rowsMatchingPlan({ datasets, plan });
  const unitColumn = inferAssociatedUnitColumn({ schema, dataset: plan?.dataset });
  let denominatorUnit = null;
  if (unitColumn && matchingRows.length) {
    const units = [...new Set(matchingRows
      .map((row) => String(row?.[unitColumn] ?? '').trim())
      .filter(Boolean))];
    if (units.length === 1) denominatorUnit = units[0];
  }

  let numeratorUnit = plan?.unit || null;
  let displayUnit = numeratorUnit;

  // Price metrics use the row's measurement unit as a denominator. Do NOT
  // append "kg" directly to a price value; that changes the metric meaning.
  if (type === 'price' && denominatorUnit) {
    displayUnit = numeratorUnit ? `${numeratorUnit}/${denominatorUnit}` : `per ${denominatorUnit}`;
  }

  return {
    type,
    displayUnit,
    numeratorUnit,
    denominatorUnit,
    unitColumn,
    confidence,
  };
}


function shouldSkipMetricMeaningForPlan(plan) {
  const operation =
    normalizeText(
      plan?.operation
    );

  if (
    !plan?.column
  ) {
    return false;
  }

  /**
   * A plain list is categorical/identity output, not a numeric metric.
   * Do not attach percentage/currency/quantity semantics just because the
   * worksheet contains another unit-bearing numeric column.
   */
  if (
    operation ===
      "list"
  ) {
    return true;
  }

  /**
   * Plain lookups of obvious descriptive/identity fields are also not metrics.
   * Numeric/measure-looking field names continue through normal inference.
   */
  if (
    operation ===
      "lookup" &&
    !plan?.aggregation &&
    !plan?.groupBy &&
    !plan?.direction
  ) {
    const measureCue =
      /\b(?:amount|cost|price|value|total|average|avg|mean|rate|percent|percentage|qty|quantity|count|number|area|yield|loss|salary|income|expense|weight|height|length|duration|time|age|volume|capacity|score|index)\b/i;

    return !measureCue.test(
      String(
        plan.column || ""
      )
    );
  }

  return false;
}

function enrichPlanMetricMeaning({ plan, question, datasets, schema, reportContext } = {}) {
  if (!plan || plan.route !== 'dataset' || !plan.column) return plan;

  if (
    shouldSkipMetricMeaningForPlan(
      plan
    )
  ) {
    return {
      ...plan,
      metricMeaning: null,
      metricSemantics: null,
      metricSource: null,
      displayUnit: null,
      denominatorUnit: null,
      unit: null,
      unitColumn: null,
      metricMeaningConfidence: 1,
      metricMeaningSkipped: true,
    };
  }

  const meaning = inferMetricMeaning({ plan, question, datasets, schema, reportContext });
  return {
    ...plan,
    metricMeaning: meaning.type || plan.metricMeaning || null,
    metricSemantics: meaning.type || plan.metricSemantics || null,
    displayUnit: meaning.displayUnit || plan.displayUnit || null,
    denominatorUnit: meaning.denominatorUnit || plan.denominatorUnit || null,
    unitColumn: meaning.unitColumn || plan.unitColumn || null,
    metricMeaningConfidence: meaning.confidence,
  };
}

module.exports = {
  shouldSkipMetricMeaningForPlan,
  exactColumnMention,
  hasExplicitCalculationCue,
  refineStoredMetricOperation,
  inferMetricMeaning,
  enrichPlanMetricMeaning,
  rowsMatchingPlan,
};
