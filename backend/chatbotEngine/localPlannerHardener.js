const { normalizeText, parseNumber } = require('./utils');

const ANALYTIC_WORDS = new Set([
  'average','avg','mean','sum','total','count','minimum','min','maximum','max','median'
]);

function cloneFilters(filters) {
  return Array.isArray(filters)
    ? filters.filter(Boolean).map(f => ({ ...f, value: Array.isArray(f.value) ? [...f.value] : f.value }))
    : [];
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWhole(question, value) {
  const q = normalizeText(question);
  const v = normalizeText(value);
  if (!q || !v || v.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(v)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(q);
}

function exactDatasetMention(question, schema) {
  const matches = (schema || [])
    .map(d => d?.name)
    .filter(Boolean)
    .filter(name => containsWhole(question, name))
    .sort((a,b) => normalizeText(b).length - normalizeText(a).length);
  return matches[0] || null;
}

function explicitColumns(question, datasetSchema) {
  return (datasetSchema?.columns || [])
    .map(c => c?.name)
    .filter(Boolean)
    .filter(name => containsWhole(question, name))
    .sort((a,b) => normalizeText(b).length - normalizeText(a).length);
}

function usableDistinctValues(rows, column, max = 700) {
  const values = [];
  const seen = new Set();
  for (const row of rows || []) {
    const raw = row?.[column];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const text = String(raw).trim();
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(raw);
    if (values.length > max) return [];
  }
  return values;
}

function orderedRangeValues(values, startRaw, endRaw) {
  const start = normalizeText(startRaw);
  const end = normalizeText(endRaw);
  const MONTHS = [
    'january','february','march','april','may','june',
    'july','august','september','october','november','december'
  ];
  const normalized = values.map(v => normalizeText(v));
  const monthStart = MONTHS.indexOf(start);
  const monthEnd = MONTHS.indexOf(end);
  if (monthStart >= 0 && monthEnd >= 0) {
    const lo = Math.min(monthStart, monthEnd);
    const hi = Math.max(monthStart, monthEnd);
    const wanted = new Set(MONTHS.slice(lo, hi + 1));
    return values.filter(v => wanted.has(normalizeText(v)));
  }

  const s = normalized.indexOf(start);
  const e = normalized.indexOf(end);
  if (s >= 0 && e >= 0) {
    const lo = Math.min(s,e);
    const hi = Math.max(s,e);
    return values.slice(lo, hi + 1);
  }
  return null;
}

function detectCategoricalRange(question, rows, datasetSchema) {
  const q = normalizeText(question);
  if (!/\b(?:to|through|thru|between)\b/.test(q)) return null;

  let best = null;

  for (const column of datasetSchema?.columns || []) {
    if (!column?.name) continue;
    const values = usableDistinctValues(rows, column.name, 200);
    if (values.length < 2) continue;

    const mentions = values
      .map((value) => {
        const text = normalizeText(value);
        if (!text) return null;
        const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(text)}(?=$|[^\\p{L}\\p{N}])`, 'u');
        const match = pattern.exec(q);
        return match ? { value, text, index: match.index + (match[1]?.length || 0) } : null;
      })
      .filter(Boolean)
      .sort((a,b) => a.index - b.index);

    if (mentions.length < 2) continue;

    for (let i = 0; i < mentions.length - 1; i += 1) {
      const left = mentions[i];
      const right = mentions[i + 1];
      const between = q.slice(left.index + left.text.length, right.index);
      const hasRangeCue = /\b(?:to|through|thru|and)\b/.test(between) &&
        (/\bfrom\b/.test(q.slice(Math.max(0, left.index - 12), left.index)) || /\bbetween\b/.test(q.slice(Math.max(0, left.index - 16), left.index)) || /\b(?:to|through|thru)\b/.test(between));
      if (!hasRangeCue) continue;

      const range = orderedRangeValues(values, left.value, right.value);
      if (!range?.length) continue;

      const candidate = { column: column.name, operator: 'in', value: range };
      if (!best || range.length < best.value.length) best = candidate;
    }
  }

  return best;
}

function inferExactValueFilters(question, rows, datasetSchema, excludedColumns = []) {
  const excluded = new Set(excludedColumns.map(normalizeText));
  const candidates = [];
  for (const column of datasetSchema?.columns || []) {
    if (!column?.name || excluded.has(normalizeText(column.name))) continue;
    const values = usableDistinctValues(rows, column.name);
    if (!values.length) continue;
    for (const value of values) {
      const text = normalizeText(value);
      if (!text) continue;
      if (typeof value === 'number' || parseNumber(value) !== null) {
        if (text.length < 4 && !containsWhole(question, text)) continue;
      }
      if (!containsWhole(question, value)) continue;
      candidates.push({
        column: column.name,
        operator: 'equals',
        value,
        score: text.length,
      });
    }
  }

  // Prefer longer/more specific values and only one exact value per column.
  candidates.sort((a,b) => b.score - a.score);
  const result = [];
  const seenColumns = new Set();
  for (const c of candidates) {
    const key = normalizeText(c.column);
    if (seenColumns.has(key)) continue;
    seenColumns.add(key);
    result.push({ column: c.column, operator: c.operator, value: c.value });
  }
  return result;
}

function mergeStrongFilters(base, additions) {
  const out = cloneFilters(base);
  for (const next of additions || []) {
    if (!next?.column) continue;
    const key = normalizeText(next.column);
    const existing = out.findIndex(f => normalizeText(f?.column) === key);
    if (existing >= 0) {
      // Exact/current-question evidence supersedes a weaker recovered filter.
      out[existing] = { ...next, value: Array.isArray(next.value) ? [...next.value] : next.value };
    } else {
      out.push({ ...next, value: Array.isArray(next.value) ? [...next.value] : next.value });
    }
  }
  return out;
}

function detectExplicitAggregate(question, metricColumn) {
  const q = normalizeText(question);
  const metric = normalizeText(metricColumn);
  if (!q || !metric) return null;

  const mappings = [
    ['average', /\b(?:average|avg|mean)\b/],
    ['sum', /\b(?:sum|total|combined|altogether)\b/],
    ['count', /\b(?:count|how many|number of)\b/],
    ['minimum', /\b(?:minimum|min|lowest|smallest)\b/],
    ['maximum', /\b(?:maximum|max|highest|largest)\b/],
    ['median', /\bmedian\b/],
  ];

  for (const [operation, pattern] of mappings) {
    if (!pattern.test(q)) continue;

    // If the operation word is also the exact field name, require evidence
    // that the user asked to CALCULATE it rather than merely named the field.
    if (ANALYTIC_WORDS.has(metric) && (
      metric === operation ||
      (metric === 'average' && operation === 'average') ||
      (metric === 'total' && operation === 'sum') ||
      (metric === 'maximum' && operation === 'maximum') ||
      (metric === 'minimum' && operation === 'minimum')
    )) {
      const occurrences = (q.match(new RegExp(`\\b${escapeRegex(metric)}\\b`, 'g')) || []).length;
      const calculationCue = new RegExp(`\\b(?:${operation === 'average' ? 'average|avg|mean' : operation})\\s+(?:of\\s+)?(?:the\\s+)?${escapeRegex(metric)}\\b`).test(q) ||
        /\b(?:calculate|compute|get|find)\s+(?:the\s+)?(?:average|mean|sum|total|count|minimum|maximum|median)\b/.test(q);
      if (occurrences < 2 && !calculationCue) return null;
    }
    return operation;
  }
  return null;
}

function chooseLabelColumn(selectColumns, datasetSchema) {
  const columns = Array.isArray(selectColumns) ? selectColumns : [];
  if (!columns.length) return null;
  const identity = columns.find(name => /\b(id|code|number|name|title|project|association|employee|person|commodity)\b/i.test(String(name)));
  if (identity) return identity;
  const text = columns.find(name => {
    const schemaCol = (datasetSchema?.columns || []).find(c => String(c?.name) === String(name));
    return schemaCol && schemaCol.type !== 'number';
  });
  return text || columns[0];
}


function detectLocalRankingDirection(question) {
  const q = normalizeText(question);
  if (!q) return null;
  if (/\b(?:lowest|smallest|least|minimum|min|bottom)\b/.test(q)) return 'asc';
  if (/\b(?:highest|largest|biggest|greatest|most|maximum|max|top)\b/.test(q)) return 'desc';
  return null;
}

function detectLocalRankingLimit(question) {
  const q = normalizeText(question);
  if (!q) return 1;
  const match =
    q.match(/\b(?:top|bottom|first|last)\s+(\d{1,3})\b/) ||
    q.match(/\b(\d{1,3})\s+(?:highest|lowest|largest|smallest)\b/);
  if (!match?.[1]) return 1;
  const n = Number(match[1]);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), 100) : 1;
}

function repairLocalRankingPlan(plan, question, datasetSchema, rows) {
  if (!plan || normalizeText(plan.route) !== 'dataset') return plan;

  const direction = detectLocalRankingDirection(question);
  if (!direction) return plan;

  const metric = plan.column;
  if (!metric) return plan;

  const metricSchema = (datasetSchema?.columns || []).find(
    c => String(c?.name || '') === String(metric)
  );
  const metricIsNumeric = Boolean(
    metricSchema && (
      metricSchema.type === 'number' ||
      (rows || []).some(row => parseNumber(row?.[metric]) !== null)
    )
  );
  if (!metricIsNumeric) return plan;

  const selected = [...new Set(
    (Array.isArray(plan.selectColumns) ? plan.selectColumns : [])
      .filter(Boolean)
      .filter(name => (datasetSchema?.columns || []).some(
        c => String(c?.name || '') === String(name)
      ))
  )];

  // A ranking needs a display/group identity distinct from the numeric metric.
  // Prefer an already selected real text field so questions like
  // "top N <entities> by <metric>" stay completely schema-driven.
  let label = plan.labelColumn || plan.groupBy || null;
  if (!label || String(label) === String(metric)) {
    label = selected.find(name => {
      if (String(name) === String(metric)) return false;
      const col = (datasetSchema?.columns || []).find(
        c => String(c?.name || '') === String(name)
      );
      return col && col.type !== 'number';
    }) || null;
  }

  if (!label) return plan;

  const aggregation = detectExplicitAggregate(question, metric);

  // If the user explicitly asks to aggregate groups (e.g. "highest average
  // salary by division"), rank groups. If the metric itself is a stored field
  // such as a column literally named Average and the wording only names that
  // field, rank rows instead of averaging it again.
  const grouped = Boolean(
    aggregation &&
    !ANALYTIC_WORDS.has(normalizeText(metric))
  );

  return {
    ...plan,
    operation: grouped ? 'rank_groups' : 'rank_rows',
    column: metric,
    labelColumn: label,
    groupBy: grouped ? label : null,
    aggregation: grouped ? aggregation : null,
    direction,
    limit: detectLocalRankingLimit(question),
    selectColumns: [...new Set([label, metric])],
    outputRequested: true,
    showAll: false,
  };
}

function repairMultiFieldList(plan, datasetSchema) {
  const op = normalizeText(plan?.operation);
  const selected = [...new Set((Array.isArray(plan?.selectColumns) ? plan.selectColumns : []).filter(Boolean))];
  if (op !== 'list' || plan?.column || selected.length < 2) return plan;

  const real = selected.filter(name => (datasetSchema?.columns || []).some(c => String(c?.name) === String(name)));
  if (real.length < 2) return plan;
  const label = plan.labelColumn || chooseLabelColumn(real, datasetSchema);
  const value = [...real].reverse().find(name => name !== label) || real[0];
  return {
    ...plan,
    operation: 'lookup',
    column: value,
    labelColumn: label,
    selectColumns: real,
    outputRequested: true,
    showAll: true,
  };
}


function reconcileExplicitDatasetMention({ plan, question, datasets, schema }) {
  if (!plan || typeof plan !== 'object') return plan;

  const mentioned = exactDatasetMention(question, schema);
  if (!mentioned) return plan;

  const datasetSchema = (schema || []).find(
    d => String(d?.name || '') === String(mentioned)
  );
  const rows = datasets?.[mentioned];

  if (!datasetSchema || !Array.isArray(rows)) return plan;

  const next = {
    ...plan,
    dataset: mentioned,
    filters: cloneFilters(plan.filters),
  };

  // Re-resolve the explicit metric against the selected worksheet when the
  // planner chose a different sheet. This matters for same-schema multi-sheet
  // reports where every worksheet exposes the same headers.
  const explicit = explicitColumns(question, datasetSchema);
  if (explicit.length) {
    const numericExplicit = explicit.find(name => {
      const col = (datasetSchema.columns || []).find(
        c => String(c?.name || '') === String(name)
      );
      return col?.type === 'number' || rows.some(r => parseNumber(r?.[name]) !== null);
    });
    const chosen = numericExplicit || explicit[0];
    if (chosen) {
      next.column = chosen;
      next.selectColumns = [
        ...new Set([
          ...(Array.isArray(next.selectColumns) ? next.selectColumns : []),
          chosen,
        ].filter(Boolean)),
      ];
    }
  }

  // Recover exact current-question values from the selected worksheet so a
  // wrong original worksheet cannot leave behind an incomplete scope.
  const range = detectCategoricalRange(question, rows, datasetSchema);
  const exactFilters = inferExactValueFilters(
    question,
    rows,
    datasetSchema,
    [next.column].filter(Boolean)
  );
  const additions = range
    ? [range, ...exactFilters.filter(
        f => normalizeText(f.column) !== normalizeText(range.column)
      )]
    : exactFilters;

  next.filters = mergeStrongFilters(next.filters, additions);

  return next;
}

function hardenLocalPlan({ plan, question, datasets, schema, context = null }) {
  if (!plan || typeof plan !== 'object') return plan;

  const forcedDataset = exactDatasetMention(question, schema);
  let datasetName = forcedDataset || plan.dataset || context?.lastDataset || null;
  let datasetSchema = (schema || []).find(d => String(d?.name) === String(datasetName)) || null;
  let rows = datasets?.[datasetName];

  // If the chosen sheet is unusable, choose the sheet with the strongest exact
  // current-question evidence instead of the first sheet with a similar header.
  if (!datasetSchema || !Array.isArray(rows)) {
    const scored = (schema || []).map(d => {
      const dRows = datasets?.[d?.name];
      if (!Array.isArray(dRows)) return null;
      const explicit = explicitColumns(question, d);
      const values = inferExactValueFilters(question, dRows, d, explicit);
      return { name: d.name, schema: d, rows: dRows, score: explicit.length * 4 + values.length * 2 };
    }).filter(Boolean).sort((a,b) => b.score - a.score);
    if (scored[0]?.score > 0) {
      datasetName = scored[0].name;
      datasetSchema = scored[0].schema;
      rows = scored[0].rows;
    }
  }

  if (!datasetSchema || !Array.isArray(rows)) return plan;

  let next = { ...plan, dataset: datasetName, filters: cloneFilters(plan.filters) };
  const explicit = explicitColumns(question, datasetSchema);

  // Prefer the most specific explicit numeric/schema metric when present.
  if (explicit.length) {
    const numericExplicit = explicit.find(name => {
      const col = (datasetSchema.columns || []).find(c => String(c?.name) === String(name));
      return col?.type === 'number' || rows.some(r => parseNumber(r?.[name]) !== null);
    });
    const chosen = numericExplicit || explicit[0];
    if (!next.column || !explicit.includes(next.column)) next.column = chosen;
    next.selectColumns = [...new Set([...(Array.isArray(next.selectColumns) ? next.selectColumns : []), chosen])];
  }

  const range = detectCategoricalRange(question, rows, datasetSchema);
  const exactFilters = inferExactValueFilters(question, rows, datasetSchema, [next.column].filter(Boolean));
  const additions = range
    ? [range, ...exactFilters.filter(f => normalizeText(f.column) !== normalizeText(range.column))]
    : exactFilters;
  next.filters = mergeStrongFilters(next.filters, additions);

  // Remove same-sheet-name-as-column province filters only when the worksheet
  // itself already encodes that partition and the column is absent. Otherwise
  // keep real Province filters because they are valid and useful.

  const aggregate = next.column ? detectExplicitAggregate(question, next.column) : null;

  /**
   * Promote a weak local CLARIFY plan only when the CURRENT question itself
   * supplies enough deterministic evidence to execute safely.
   *
   * This fixes a common fallback shape where the local parser says
   * `route: clarify` but the hardener has already recovered:
   *   - a real live worksheet,
   *   - a real live column explicitly named by the user, and
   *   - one or more exact/range filters from live row values.
   *
   * The rule is schema/data driven. No worksheet, field, province, commodity,
   * month, status, or business value is hardcoded. Genuine ambiguity remains
   * a clarification because we require an explicit current-question column.
   */
  const routeIsClarify = normalizeText(next.route) === 'clarify';
  const explicitColumnChosen = Boolean(
    next.column && explicit.some(name => String(name) === String(next.column))
  );
  const realChosenColumn = Boolean(
    next.column && (datasetSchema.columns || []).some(
      c => String(c?.name) === String(next.column)
    )
  );
  const hasRecoveredScope = Array.isArray(next.filters) && next.filters.length > 0;

  if (
    routeIsClarify &&
    datasetName &&
    realChosenColumn &&
    explicitColumnChosen &&
    hasRecoveredScope
  ) {
    next.route = 'dataset';
    next.question = undefined;
    next.confidence = Math.max(Number(next.confidence) || 0, 0.9);
    next.outputRequested = true;
    next.selectColumns = [
      ...new Set([
        ...(Array.isArray(next.selectColumns) ? next.selectColumns : []),
        next.column,
      ].filter(Boolean)),
    ];

    // If the wording explicitly requests a calculation, use it. Otherwise an
    // operation-looking header such as Average/Total/Count is just a field
    // lookup and must not be mistaken for the calculation itself.
    next.operation = aggregate || 'lookup';
    next.groupBy = null;
    next.aggregation = null;
    if (!aggregate) next.labelColumn = next.labelColumn || null;
  }

  if (aggregate) {
    next.operation = aggregate;
    next.groupBy = null;
    next.aggregation = null;
    next.labelColumn = null;
    next.outputRequested = true;
  } else if (next.column && ANALYTIC_WORDS.has(normalizeText(next.column)) && normalizeText(next.operation) === normalizeText(next.column)) {
    // Header named Average/Total/etc used as a field, not necessarily as an operation.
    next.operation = 'lookup';
  }

  // Ranking intent must win over a generic multi-field LOOKUP recovered by
  // the local fallback. This keeps Groq outages from changing "top N ... by"
  // questions into unsorted lookups.
  next = repairLocalRankingPlan(next, question, datasetSchema, rows);

  next = repairMultiFieldList(next, datasetSchema);
  return next;
}

module.exports = {
  hardenLocalPlan,
  repairMultiFieldList,
  reconcileExplicitDatasetMention,
};
