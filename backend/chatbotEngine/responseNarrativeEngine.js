const { formatNumber, normalizeText } = require('./utils');

function metricDisplayName({ plan, result, question } = {}) {
  const meaning = result?.metricMeaning || plan?.metricMeaning || result?.metricSemantics || plan?.metricSemantics || null;
  if (meaning === 'price') return 'price';
  const column = String(result?.column || plan?.column || '').trim();
  const normalized = normalizeText(column);
  if (!column) return 'value';
  if (normalized === 'average' && /\bprice\b/i.test(String(question || ''))) return 'price';
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
    const metricPhrase = aggregation === 'average' ? `average ${metric}` : metric;
    return `${item.label} has the ${adjective} ${metricPhrase}${timePhrase} at ${formatValue(item.value, displayUnit)}.${coverageNote(item, result)}`;
  }

  if (op === 'rank_across_worksheets' && results.length) {
    const adjective = direction === 'asc' ? 'lowest' : 'highest';
    const group = groupDisplayName(groupBy);
    const month = extractFilterValue(plan, result, 'Month');
    const timePhrase = month ? ` in ${month}` : '';
    const metricPhrase = aggregation === 'average' ? `average ${metric}` : metric;
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
};
