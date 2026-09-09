const { formatNumber, normalizeText } = require('./utils');

function metricDisplayName({ plan, result, question } = {}) {
  const meaning = result?.metricMeaning || plan?.metricMeaning || result?.metricSemantics || plan?.metricSemantics || null;
  if (meaning === 'price') return 'price';
  const column = String(result?.column || plan?.column || '').trim();
  const normalized = normalizeText(column);
  if (!column) return 'value';
  if (normalized === 'average' && /\bprice\b/i.test(String(question || ''))) return 'price';

  // Avoid exposing implementation-style phrases such as "average Average".
  // If a stored column itself is named Average and no stronger semantic label
  // is known, describe it generically as a value rather than repeating the
  // column name as both aggregation and metric.
  if (normalized === 'average') return 'value';

  return column;
}

function formatValue(value, displayUnit) {
  const number = formatNumber(value);
  if (!displayUnit) return number;
  if (/^per\s+/i.test(displayUnit)) return `${number} ${displayUnit}`;
  if (/^[₱$€£¥]/.test(displayUnit)) return `${displayUnit}${number}`;
  if (/\/$/.test(displayUnit)) return `${number} ${displayUnit}`;
  return `${number} ${displayUnit}`;
}

function coverageNote(item, result) {
  const coverage = item?.coverage || result?.coverage;
  if (!coverage) return '';
  const total = Number(coverage.totalWorksheets || coverage.total || 0);
  const used = Number(coverage.worksheetsUsed || coverage.used || 0);
  if (!total || used >= total) return '';
  const missing = Array.isArray(coverage.missingWorksheets) ? coverage.missingWorksheets : [];
  return ` Based on ${used} of ${total} worksheets${missing.length ? `; no usable value in ${missing.join(', ')}` : ''}.`;
}

function extractFilterValue(plan, result, columnName) {
  const filters = Array.isArray(result?.filters) && result.filters.length
    ? result.filters
    : Array.isArray(plan?.filters) ? plan.filters : [];
  const target = normalizeText(columnName);
  const match = filters.find((filter) => normalizeText(filter?.column) === target);
  if (!match) return null;
  if (Array.isArray(match.value)) return match.value.join(', ');
  if (match.value === null || match.value === undefined || String(match.value).trim() === '') return null;
  return String(match.value).trim();
}

function groupDisplayName(groupBy) {
  const raw = String(groupBy || '').trim();
  if (!raw) return 'group';
  const normalized = normalizeText(raw);
  const aliases = { commodity: 'commodity', province: 'province', municipality: 'municipality', office: 'office', division: 'division' };
  return aliases[normalized] || raw;
}


function humanizeFieldName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b([A-Z])([a-z])/g, '$1$2')
    .trim();
}

function pluralizeSimple(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'items';
  if (/s$/i.test(raw)) return raw;
  if (/y$/i.test(raw) && !/[aeiou]y$/i.test(raw)) return raw.slice(0, -1) + 'ies';
  return raw + 's';
}

function splitDisplayValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap(splitDisplayValues)
      .filter(Boolean);
  }

  const raw = String(value).trim();
  if (!raw) return [];

  // Display-only normalization for multi-value cells.
  // Keep this conservative and generic: commas, semicolons, pipes, and
  // line breaks are common separators in worksheet cells.
  return raw
    .split(/\s*(?:,|;|\||\r?\n)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function joinNaturalList(values) {
  const unique = [...new Set((values || []).map((v) => String(v).trim()).filter(Boolean))];
  if (!unique.length) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

function thirdPersonSingularVerb(baseVerb) {
  const verb = normalizeText(baseVerb);
  if (!verb) return 'has';
  if (verb === 'have') return 'has';
  if (verb === 'do') return 'does';
  if (verb === 'go') return 'goes';
  if (verb === 'be') return 'is';
  if (/(s|sh|ch|x|z|o)$/.test(verb)) return `${verb}es`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
  return `${verb}s`;
}

function extractQuestionVerb(question) {
  const q = String(question || '').trim();

  // "What commodities do they produce?"
  let match = q.match(/\bdo\s+(?:they|these|those|the\s+\w+(?:\s+\w+)*)\s+([a-z][a-z-]*)\b/i);
  if (match) return normalizeText(match[1]);

  // "What services are they using?" -> use "use"
  match = q.match(/\b(?:are|were)\s+they\s+([a-z][a-z-]*?)(?:ing)?\b/i);
  if (match) return normalizeText(match[1]);

  return 'have';
}

function questionUsesThey(question) {
  return /\bthey\b/i.test(String(question || ''));
}

function explicitlyRequestsGrouping(question, labelColumn) {
  const q = normalizeText(question);
  const label = normalizeText(humanizeFieldName(labelColumn));
  if (!q || !label) return false;

  const singular = label.replace(/s$/, '');
  const variants = [...new Set([label, singular].filter(Boolean))]
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  return variants.some((v) => new RegExp(
    `\\b(?:by|per)\\s+(?:each\\s+|every\\s+)?${v}s?\\b|` +
    `\\b(?:for|from)\\s+(?:each|every)\\s+${v}s?\\b`,
    'i'
  ).test(q));
}

function canonicalValueSet(values) {
  return [...new Set((values || []).map((v) => String(v).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .join('\u0001');
}

function buildLookupPairNarrative({ question, plan, result } = {}) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  const labelColumn = result?.labelColumn || plan?.labelColumn || null;
  const valueColumn = result?.column || plan?.column || null;

  if (!rows.length || !labelColumn || !valueColumn) return null;

  const normalizedLabel = normalizeText(labelColumn);
  const normalizedValue = normalizeText(valueColumn);
  if (!normalizedLabel || !normalizedValue || normalizedLabel === normalizedValue) return null;

  const grouped = new Map();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const labelRaw = row[labelColumn];
    if (labelRaw === null || labelRaw === undefined || String(labelRaw).trim() === '') continue;

    const label = String(labelRaw).trim();
    const values = splitDisplayValues(row[valueColumn]);

    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(...values);
  }

  if (!grouped.size) return null;

  // If the user explicitly asks "by municipality", "per office",
  // "for each province", etc., keep the grouped report-style response.
  if (explicitlyRequestsGrouping(question, labelColumn)) {
    const labelName = humanizeFieldName(labelColumn);
    const valueName = humanizeFieldName(valueColumn);
    const heading = `${pluralizeSimple(valueName)} by ${labelName.toLowerCase()}:`;

    const lines = [...grouped.entries()].map(([label, values], index) => {
      const displayValues = joinNaturalList(values);
      return `${index + 1}. ${label}: ${displayValues || 'no recorded value'}`;
    });

    return `${heading}\n${lines.join('\n')}`;
  }

  // Otherwise answer the field the user actually asked for first, then give a
  // compact natural explanation of how those values relate to the labels.
  // This is schema-driven and does not hardcode commodities, municipalities,
  // associations, projects, offices, etc.
  const allValues = [];
  for (const values of grouped.values()) allValues.push(...values);
  const distinctValues = [...new Set(allValues.map((v) => String(v).trim()).filter(Boolean))];

  if (!distinctValues.length) return null;

  const verb = extractQuestionVerb(question);
  const subject = questionUsesThey(question) ? 'They' : 'The records';
  const firstSentence = `${subject} ${verb} ${joinNaturalList(distinctValues)}.`;

  // Merge labels that share the same value set so the explanation is concise.
  const clusters = new Map();
  for (const [label, values] of grouped.entries()) {
    const uniqueValues = [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
    const key = canonicalValueSet(uniqueValues);
    if (!clusters.has(key)) clusters.set(key, { labels: [], values: uniqueValues });
    clusters.get(key).labels.push(label);
  }

  const clusterEntries = [...clusters.values()].filter((entry) => entry.values.length);
  if (!clusterEntries.length) return firstSentence;

  const clauses = clusterEntries.map((entry) => {
    const labels = joinNaturalList(entry.labels);
    const clauseVerb = entry.labels.length === 1 ? thirdPersonSingularVerb(verb) : verb;
    return `${labels} ${clauseVerb} ${joinNaturalList(entry.values)}`;
  });

  let detailSentence = '';
  if (clauses.length === 1) {
    detailSentence = `${clauses[0]}.`;
  } else if (clauses.length === 2) {
    detailSentence = `${clauses[0]}, while ${clauses[1]}.`;
  } else {
    detailSentence = `${clauses.slice(0, -1).join('; ')}, while ${clauses[clauses.length - 1]}.`;
  }

  return `${firstSentence} ${detailSentence}`;
}

function buildSemanticVerifiedAnswer({ question, plan, result } = {}) {
  if (!result || result.success === false) return null;

  const op = normalizeText(result.operation || plan?.operation);
  const metric = metricDisplayName({ plan, result, question });
  const displayUnit = result?.displayUnit || plan?.displayUnit || result?.unit || plan?.unit || null;
  const aggregation = normalizeText(result?.aggregation || plan?.aggregation);
  const direction = normalizeText(result?.direction || plan?.direction);
  const groupBy = result?.groupBy || plan?.groupBy || null;
  const results = Array.isArray(result?.results) ? result.results : [];

  if (op === 'rank_worksheets' && results.length) {
    const item = results[0];
    const adjective = direction === 'asc' ? 'lowest' : 'highest';
    const month = extractFilterValue(plan, result, 'Month');
    const timePhrase = month ? ` in ${month}` : '';
    const metricPhrase = aggregation === 'average'
      ? (normalizeText(metric).startsWith('average ') ? metric : `average ${metric}`)
      : metric;
    return `${item.label} has the ${adjective} ${metricPhrase}${timePhrase} at ${formatValue(item.value, displayUnit)}.${coverageNote(item, result)}`;
  }

  if (op === 'rank_across_worksheets' && results.length) {
    const adjective = direction === 'asc' ? 'lowest' : 'highest';
    const group = groupDisplayName(groupBy);
    const month = extractFilterValue(plan, result, 'Month');
    const timePhrase = month ? ` in ${month}` : '';
    const metricPhrase = aggregation === 'average'
      ? (normalizeText(metric).startsWith('average ') ? metric : `average ${metric}`)
      : metric;
    const lines = results.map((item, index) => `${index + 1}. ${item.label}: ${formatValue(item.value, displayUnit)}${coverageNote(item, result)}`);
    if (results.length === 1) {
      const item = results[0];
      return `${item.label} had the ${adjective} ${metricPhrase}${timePhrase} across the available worksheets at ${formatValue(item.value, displayUnit)}.${coverageNote(item, result)}`;
    }
    return `The ${results.length} ${group}${results.length === 1 ? '' : 's'} with the ${adjective} ${metricPhrase}${timePhrase} are:\n${lines.join('\n')}`;
  }

  if (op === 'multi_worksheet' && results.length) {
    return `${metric} by ${groupBy || 'worksheet'}:\n` + results
      .map((item, index) => `${index + 1}. ${item.label}: ${formatValue(item.value, displayUnit)}${coverageNote(item, result)}`)
      .join('\n');
  }

  if (op === 'lookup' && results.length) {
    const pairNarrative = buildLookupPairNarrative({ question, plan, result });
    if (pairNarrative) return pairNarrative;
  }

  if (result?.value !== undefined && result?.value !== null && (op === 'lookup' || op === 'average' || op === 'sum' || op === 'minimum' || op === 'maximum' || op === 'median')) {
    const meaning = result?.metricMeaning || plan?.metricMeaning || null;
    if (!meaning && !plan?.storedMetricDisambiguated) return null;

    const operationLabel = op === 'lookup'
      ? ''
      : op === 'average'
        ? 'average '
        : op === 'sum'
          ? 'total '
          : op === 'minimum'
            ? 'minimum '
            : op === 'maximum'
              ? 'maximum '
              : op === 'median'
                ? 'median '
                : '';
    const noun = meaning === 'price' ? 'price' : metric;
    return `The ${operationLabel}${noun} is ${formatValue(result.value, displayUnit)}.`;
  }

  return null;
}

module.exports = {
  buildSemanticVerifiedAnswer,
  metricDisplayName,
  formatValue,
  buildLookupPairNarrative,
};
