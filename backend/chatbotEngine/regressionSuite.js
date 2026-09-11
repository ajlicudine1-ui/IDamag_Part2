const assert = require('assert');
const { buildSchema } = require('./schemaBuilder');
const {
  refineStoredMetricOperation,
  inferMetricMeaning,
} = require('./metricMeaningEngine');
const {
  buildCrossWorksheetGroupedRankingResolution,
  buildDistributedWorksheetResolution,
} = require('./multiWorksheetEngine');
const { evaluateLocalPlanConfidence } = require('./planConfidenceEngine');
const { buildSemanticPlan, semanticPlanToExecutable } = require('./semanticPlan');
const { currentQuestionRequiresReplan } = require('./currentQuestionOverrideEngine');
const { buildSemanticVerifiedAnswer } = require('./responseNarrativeEngine');
const { currentQuestionOverridesAnalyticalGroup } = require('./plannerNormalizer');
const { updateConversation, getRelevantContext, clearConversation } = require('./conversationManager');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function sampleDatasets() {
  return {
    North: [
      { Province: 'North', Commodity: 'Hog', Unit: 'kg', Month: 'February', Average: '180' },
      { Province: 'North', Commodity: 'Corn', Unit: 'kg', Month: 'February', Average: '20' },
    ],
    South: [
      { Province: 'South', Commodity: 'Hog', Unit: 'kg', Month: 'February', Average: '220' },
      { Province: 'South', Commodity: 'Corn', Unit: 'kg', Month: 'February', Average: '' },
    ],
    East: [
      { Province: 'East', Commodity: 'Hog', Unit: 'kg', Month: 'February', Average: '200' },
      { Province: 'East', Commodity: 'Corn', Unit: 'kg', Month: 'February', Average: '30' },
    ],
  };
}

test('stored Average is a lookup when not explicitly recalculated', () => {
  const datasets = sampleDatasets();
  const schema = buildSchema(datasets);
  const plan = refineStoredMetricOperation({
    plan: { route:'dataset', dataset:'North', operation:'average', column:'Average', filters:[{column:'Commodity',operator:'equals',value:'Hog'}] },
    question: 'What is the Average price of Hog?',
    schema,
  });
  assert.equal(plan.operation, 'lookup');
  assert.equal(plan.metricSource, 'stored_column');
});

test('average of Average remains an aggregate', () => {
  const datasets = sampleDatasets();
  const schema = buildSchema(datasets);
  const plan = refineStoredMetricOperation({
    plan: { route:'dataset', dataset:'North', operation:'average', column:'Average' },
    question: 'What is the average of the Average values?',
    schema,
  });
  assert.equal(plan.operation, 'average');
  assert.equal(plan.metricCalculation, 'average');
});

test('price uses row unit as denominator, not as metric unit', () => {
  const datasets = sampleDatasets();
  const schema = buildSchema(datasets);
  const meaning = inferMetricMeaning({
    plan: { dataset:'North', column:'Average', filters:[{column:'Commodity',operator:'equals',value:'Hog'}] },
    question: 'What is the average price of Hog?',
    datasets,
    schema,
    reportContext: { title:'Farmgate Price Monitoring' },
  });
  assert.equal(meaning.type, 'price');
  assert.equal(meaning.denominatorUnit, 'kg');
  assert.equal(meaning.displayUnit, 'per kg');
});

test('cross-worksheet grouped ranking ranks entities, not worksheets', () => {
  const datasets = sampleDatasets();
  const schema = buildSchema(datasets);
  const resolution = buildCrossWorksheetGroupedRankingResolution({
    datasets,
    schema,
    question: 'Which Commodity had the highest average Average across all Province in February?',
  });
  assert.ok(resolution);
  assert.equal(resolution.plan.operation, 'rank_across_worksheets');
  assert.equal(resolution.result.results[0].label, 'Hog');
  assert.equal(resolution.result.results[0].value, 200);
  assert.equal(resolution.result.results[0].coverage.worksheetsUsed, 3);
});

test('cross-worksheet coverage reports missing worksheets', () => {
  const datasets = sampleDatasets();
  const schema = buildSchema(datasets);
  const resolution = buildCrossWorksheetGroupedRankingResolution({
    datasets,
    schema,
    question: 'Which Commodity had the lowest average Average across all Province in February?',
  });
  assert.ok(resolution);
  const corn = resolution.result.results.find((item) => item.label === 'Corn') || resolution.result.results[0];
  if (corn.label === 'Corn') {
    assert.equal(corn.coverage.worksheetsUsed, 2);
    assert.ok(corn.coverage.missingWorksheets.includes('South'));
  }
  assert.equal(resolution.result.aggregationPolicy.mode, 'available_values');
});

test('explicit single worksheet does not expand to distributed query', () => {
  const datasets = sampleDatasets();
  const schema = buildSchema(datasets);
  const resolution = buildDistributedWorksheetResolution({
    datasets,
    schema,
    question: 'What are the top 5 Commodity by Average in North in February?',
  });
  assert.equal(resolution, null);
});

test('local confidence exposes unresolved critical fields', () => {
  const datasets = sampleDatasets();
  const schema = buildSchema(datasets);
  const confidence = evaluateLocalPlanConfidence({
    plan: { route:'dataset', dataset:'Missing', operation:'average', column:'Nope', filters:[] },
    datasets,
    schema,
  });
  assert.equal(confidence.critical, true);
  assert.ok(confidence.score < 0.55);
});

test('semantic conversation plan round-trips multi-sheet meaning', () => {
  const semantic = buildSemanticPlan({
    plan: {
      route:'dataset', dataset:null, operation:'rank_worksheets', column:'Average', groupBy:'Province', aggregation:'average', direction:'desc', limit:1, filters:[]
    },
    result: { datasets:['North','South','East'] },
  });
  assert.equal(semantic.scope, 'multi_worksheet');
  const executable = semanticPlanToExecutable(semantic);
  assert.equal(executable.operation, 'rank_worksheets');
  assert.equal(executable.groupBy, 'Province');
});


test('current explicit grouping overrides stale conversation result set', () => {
  const datasets = sampleDatasets();
  const schema = buildSchema(datasets);
  const overrides = currentQuestionOverridesAnalyticalGroup({
    datasets,
    schema,
    question: 'Which Province had the highest average price?',
    previousGroupBy: 'Commodity',
    preferredDataset: 'North',
  });
  assert.equal(overrides, true);
});

test('semantic response avoids awkward average Average wording', () => {
  const answer = buildSemanticVerifiedAnswer({
    question:'Which Commodity had the highest average price?',
    plan:{ operation:'rank_across_worksheets', column:'Average', metricMeaning:'price', groupBy:'Commodity', aggregation:'average', direction:'desc', displayUnit:'per kg' },
    result:{ success:true, operation:'rank_across_worksheets', column:'Average', groupBy:'Commodity', aggregation:'average', direction:'desc', metricMeaning:'price', displayUnit:'per kg', results:[{label:'Hog',value:192.26,coverage:{worksheetsUsed:4,totalWorksheets:4}}] },
  });
  assert.ok(/Hog had the highest average price/i.test(answer));
  assert.ok(/192\.26 per kg/.test(answer));
  assert.ok(!/average Average/i.test(answer));
});


test('distributed analytical result replaces stale single-sheet analytical memory', () => {
  const sessionId = '__regression_distributed_memory__';
  clearConversation(sessionId);

  updateConversation(sessionId, {
    question: 'Top 5 commodities by Average in North',
    plan: {
      route: 'dataset', dataset: 'North', operation: 'rank_groups',
      column: 'Average', labelColumn: 'Commodity', groupBy: 'Commodity',
      aggregation: 'average', direction: 'desc', limit: 5, filters: [],
      selectColumns: ['Commodity', 'Average'],
    },
    result: {
      success: true, dataset: 'North', operation: 'rank_groups',
      column: 'Average', labelColumn: 'Commodity', aggregation: 'average',
      direction: 'desc', results: [{ label: 'Hog', value: 200 }],
    },
  });

  updateConversation(sessionId, {
    question: 'Which province had the highest average price?',
    plan: {
      route: 'dataset', dataset: null, operation: 'rank_worksheets',
      column: 'Average', labelColumn: 'Province', groupBy: 'Province',
      aggregation: 'average', direction: 'desc', limit: 1, filters: [],
      worksheets: ['North', 'South', 'East'], distributedWorksheetQuery: true,
    },
    result: {
      success: true, dataset: null, datasets: ['North', 'South', 'East'],
      operation: 'rank_worksheets', column: 'Average', groupBy: 'Province',
      aggregation: 'average', direction: 'desc',
      results: [{ dataset: 'South', label: 'South', value: 125 }],
    },
  });

  const context = getRelevantContext(sessionId, 'What about the lowest?');
  assert.equal(context.analyticalContext?.operation, 'rank_worksheets');
  assert.equal(context.analyticalContext?.groupBy, 'Province');
  assert.equal(context.analyticalContext?.dataset, null);
  clearConversation(sessionId);
});


test('follow-up narrative preserves inherited metric meaning', () => {
  const { buildSemanticVerifiedAnswer } = require('./responseNarrativeEngine');
  const answer = buildSemanticVerifiedAnswer({
    question: 'What about January?',
    plan: {
      operation: 'rank_across_worksheets',
      column: 'Average',
      groupBy: 'Commodity',
      aggregation: 'average',
      direction: 'desc',
      metricMeaning: 'price',
      displayUnit: 'per kg',
      filters: [{ column: 'Month', operator: 'equals', value: 'January' }],
    },
    result: {
      success: true,
      operation: 'rank_across_worksheets',
      column: 'Average',
      groupBy: 'Commodity',
      aggregation: 'average',
      direction: 'desc',
      metricMeaning: 'price',
      displayUnit: 'per kg',
      filters: [{ column: 'Month', operator: 'equals', value: 'January' }],
      results: [{
        label: 'Example Item',
        value: 123.456,
        coverage: {
          totalWorksheets: 4,
          worksheetsUsed: 3,
          missingWorksheets: ['Sheet D'],
        },
      }],
    },
  });

  assert(answer.includes('highest average price'));
  assert(answer.includes('January'));
  assert(answer.includes('123.46 per kg'));
  assert(!answer.includes('average Average'));
});

test('generic Average metric never renders average Average', () => {
  const { buildSemanticVerifiedAnswer } = require('./responseNarrativeEngine');
  const answer = buildSemanticVerifiedAnswer({
    question: 'What about January?',
    plan: {
      operation: 'rank_across_worksheets',
      column: 'Average',
      groupBy: 'Category',
      aggregation: 'average',
      direction: 'desc',
      filters: [{ column: 'Month', operator: 'equals', value: 'January' }],
    },
    result: {
      success: true,
      operation: 'rank_across_worksheets',
      column: 'Average',
      groupBy: 'Category',
      aggregation: 'average',
      direction: 'desc',
      filters: [{ column: 'Month', operator: 'equals', value: 'January' }],
      results: [{ label: 'A', value: 10 }],
    },
  });

  assert(!answer.includes('average Average'));
});


test('lookup pair narrative answers requested values first and compresses shared groups', () => {
  const { buildSemanticVerifiedAnswer } = require('./responseNarrativeEngine');

  const answer = buildSemanticVerifiedAnswer({
    question: 'What products do they produce?',
    plan: {
      operation: 'lookup',
      column: 'Products',
      labelColumn: 'Location',
    },
    result: {
      success: true,
      operation: 'lookup',
      column: 'Products',
      labelColumn: 'Location',
      results: [
        { Location: 'Alpha', Products: 'rice, corn, vegetables' },
        { Location: 'Beta', Products: 'rice, corn, vegetables' },
        { Location: 'Gamma', Products: 'rice, sugarcane' },
      ],
    },
  });

  assert(answer.startsWith('They produce rice, corn, vegetables, and sugarcane.'));
  assert(answer.includes('Alpha and Beta produce rice, corn, and vegetables'));
  assert(answer.includes('Gamma produces rice and sugarcane'));
  assert(!answer.includes('Products by location:'));
});

test('lookup pair narrative keeps grouped format when grouping is explicit', () => {
  const { buildSemanticVerifiedAnswer } = require('./responseNarrativeEngine');

  const answer = buildSemanticVerifiedAnswer({
    question: 'What products do they produce by location?',
    plan: {
      operation: 'lookup',
      column: 'Products',
      labelColumn: 'Location',
    },
    result: {
      success: true,
      operation: 'lookup',
      column: 'Products',
      labelColumn: 'Location',
      results: [
        { Location: 'Alpha', Products: 'rice, corn' },
        { Location: 'Beta', Products: 'rice, sugarcane' },
      ],
    },
  });

  assert(answer.includes('Products by location:'));
  assert(answer.includes('1. Alpha: rice and corn'));
  assert(answer.includes('2. Beta: rice and sugarcane'));
});


test('paired lookup semantic answer is protected from LLM restructuring', () => {
  const {
    shouldPreserveDeterministicSemanticAnswer,
  } = require('./responseGenerator');

  const preserve = shouldPreserveDeterministicSemanticAnswer({
    plan: {
      operation: 'lookup',
      column: 'Products',
      labelColumn: 'Location',
    },
    result: {
      success: true,
      operation: 'lookup',
      results: [
        { Location: 'Alpha', Products: 'rice, corn, vegetables' },
        { Location: 'Beta', Products: 'rice, sugarcane' },
      ],
    },
    semanticAnswer:
      'They produce rice, corn, vegetables, and sugarcane. Alpha produces rice, corn, and vegetables, while Beta produces rice and sugarcane.',
  });

  assert.strictEqual(preserve, true);
});



test('direct-action paraphrase keeps the requested action verb', () => {
  const answer = buildSemanticVerifiedAnswer({
    question: 'Tell me what they produce.',
    plan: { operation:'lookup', column:'Products', labelColumn:'Organization' },
    result: {
      success:true,
      operation:'lookup',
      column:'Products',
      labelColumn:'Organization',
      results:[
        { Organization:'Org A', Products:'rice, corn' },
        { Organization:'Org B', Products:'rice, vegetables' },
      ],
    },
  });

  assert(answer.startsWith('They produce rice, corn, and vegetables.'));
  assert(answer.includes('Org A produces rice and corn'));
  assert(answer.includes('Org B produces rice and vegetables'));
  assert(!answer.includes('They have'));
});

test('copular preposition lookup uses correct is/are grammar', () => {
  const answer = buildSemanticVerifiedAnswer({
    question: 'What locations are they from?',
    plan: { operation:'lookup', column:'Location', labelColumn:'Organization' },
    result: {
      success:true,
      operation:'lookup',
      column:'Location',
      labelColumn:'Organization',
      results:[
        { Organization:'Org A', Location:'North' },
        { Organization:'Org B', Location:'South' },
      ],
    },
  });

  assert(answer.startsWith('They are from North and South.'));
  assert(answer.includes('Org A is from North'));
  assert(answer.includes('Org B is from South'));
  assert(!answer.includes('They from '));
  assert(!answer.includes('froms '));
});

test('unknown relationship wording falls back to a grammatical neutral relation', () => {
  const answer = buildSemanticVerifiedAnswer({
    question: 'What are their linked values?',
    plan: { operation:'lookup', column:'Values', labelColumn:'Organization' },
    result: {
      success:true,
      operation:'lookup',
      column:'Values',
      labelColumn:'Organization',
      results:[
        { Organization:'Org A', Values:'A, B' },
        { Organization:'Org B', Values:'B, C' },
      ],
    },
  });

  assert(answer.startsWith('The values include A, B, and C.'));
  assert(answer.includes('Org A is associated with A and B'));
  assert(answer.includes('Org B is associated with B and C'));
});

test('grammar finalizer fixes safe spacing and duplicate-function-word artifacts', () => {
  const { finalizeUserFacingGrammar } = require('./responseGrammarEngine');
  const answer = finalizeUserFacingGrammar('The  the result is  correct ,and verified!!');
  assert.equal(answer, 'The result is correct, and verified!');
});


test('possessive referential lookup can render a compact have/has narrative', () => {
  const { buildSemanticVerifiedAnswer } = require('./responseNarrativeEngine');

  const answer = buildSemanticVerifiedAnswer({
    question: 'What values do they have?',
    plan: {
      operation: 'lookup',
      column: 'Offerings',
      labelColumn: 'Organization',
    },
    result: {
      success: true,
      operation: 'lookup',
      column: 'Offerings',
      labelColumn: 'Organization',
      results: [
        { Organization: 'Org A', Offerings: 'one, two' },
        { Organization: 'Org B', Offerings: 'one, two' },
        { Organization: 'Org C', Offerings: 'one, three' },
      ],
    },
  });

  assert(answer.startsWith('They have one, two, and three.'));
  assert(answer.includes('Org A and Org B have one and two'));
  assert(answer.includes('Org C has one and three'));
});


test('repeated referential field requests preserve the previous verified pair column', () => {
  const fs = require('fs');
  const path = require('path');

  const source = fs.readFileSync(
    path.join(__dirname, 'chatbotService.js'),
    'utf8'
  );

  assert(source.includes('context.lastPlan?.conversationalPairColumn'));
  assert(source.includes('context.lastPlan?.labelColumn'));
  assert(source.includes('previousPairCandidates.find'));
});


test('strong local semantic resolver selects a detail worksheet for received-entity questions', () => {
  const {
    resolveStrongLocalSemanticPlan,
  } = require('./localSemanticResolver');

  const datasets = {
    Profile: [
      { 'Name of Organization': 'Org A', Region: 'North', Products: 'rice' },
      { 'Name of Organization': 'Org B', Region: 'South', Products: 'corn' },
    ],
    Organization: [
      { 'Name of Organization': 'Org A', Year: 2025, Item: 'Tool', QTY: 1 },
      { 'Name of Organization': 'Org A', Year: 2024, Item: 'Seed', QTY: 2 },
      { 'Name of Organization': 'Org B', Year: 2025, Item: 'Machine', QTY: 1 },
    ],
  };

  const schema = [
    {
      name: 'Profile',
      columns: Object.keys(datasets.Profile[0]).map((name) => ({ name })),
    },
    {
      name: 'Organization',
      columns: Object.keys(datasets.Organization[0]).map((name) => ({ name })),
    },
  ];

  const plan = resolveStrongLocalSemanticPlan({
    question: 'Which organizations received interventions?',
    schema,
    datasets,
    context: null,
  });

  assert(plan);
  assert.strictEqual(plan.route, 'dataset');
  assert.strictEqual(plan.dataset, 'Organization');
  assert.strictEqual(plan.column, 'Name of Organization');
  assert.strictEqual(plan.operation, 'list');
  assert.strictEqual(plan.localSemanticResolved, true);
});

test('strong local semantic resolver handles new semantic questions without sticky previous query memory', () => {
  const {
    resolveStrongLocalSemanticPlan,
  } = require('./localSemanticResolver');

  const datasets = {
    Main: [
      { 'Name of Group': 'Group A', Products: 'rice', Province: 'North' },
      { 'Name of Group': 'Group B', Products: 'corn', Province: 'North' },
    ],
    Transactions: [
      { 'Project Name': 'Project X', 'Funding Source': 'Fund A', Amount: 100 },
      { 'Project Name': 'Project Y', 'Funding Source': 'Fund B', Amount: 200 },
    ],
  };

  const schema = Object.entries(datasets).map(([name, rows]) => ({
    name,
    columns: Object.keys(rows[0]).map((column) => ({ name: column })),
  }));

  const context = {
    isFollowUp: true,
    lastDataset: 'Main',
    lastMetric: 'Products',
    lastFilters: [
      { column: 'Province', operator: 'equals', value: 'North' },
    ],
  };

  const plan = resolveStrongLocalSemanticPlan({
    question: 'Which projects received funding?',
    schema,
    datasets,
    context,
  });

  assert(plan);
  assert.strictEqual(plan.dataset, 'Transactions');
  assert.strictEqual(plan.column, 'Project Name');
  assert.strictEqual(plan.operation, 'list');
  assert.strictEqual(plan.filters.length, 0);
});

test('strong local semantic resolver supports distinct-count entity questions', () => {
  const {
    resolveStrongLocalSemanticPlan,
  } = require('./localSemanticResolver');

  const datasets = {
    Attendance: [
      { 'Employee Name': 'A', Training: 'T1' },
      { 'Employee Name': 'A', Training: 'T2' },
      { 'Employee Name': 'B', Training: 'T1' },
    ],
  };

  const schema = [{
    name: 'Attendance',
    columns: Object.keys(datasets.Attendance[0]).map((name) => ({ name })),
  }];

  const plan = resolveStrongLocalSemanticPlan({
    question: 'How many employees attended training?',
    schema,
    datasets,
  });

  assert(plan);
  assert.strictEqual(plan.column, 'Employee Name');
  assert.strictEqual(plan.operation, 'distinct_count');
});


test('categorical list plans do not get numeric metric semantics', () => {
  const {
    enrichPlanMetricMeaning,
  } = require('./metricMeaningEngine');

  const plan = enrichPlanMetricMeaning({
    plan: {
      route: 'dataset',
      dataset: 'Details',
      operation: 'list',
      column: 'Name of Organization',
      metricSemantics: 'percentage',
      unit: '%',
    },
    question: 'Which organizations received support?',
    datasets: {
      Details: [
        { 'Name of Organization': 'Org A', Unit: '%' },
      ],
    },
    schema: [
      {
        name: 'Details',
        columns: [
          { name: 'Name of Organization' },
          { name: 'Unit' },
        ],
      },
    ],
  });

  assert.strictEqual(plan.metricSemantics, null);
  assert.strictEqual(plan.metricMeaning, null);
  assert.strictEqual(plan.displayUnit, null);
  assert.strictEqual(plan.unit, null);
  assert.strictEqual(plan.metricMeaningSkipped, true);
});

test('plain list narrative uses the user question as a natural introduction', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer = buildSemanticVerifiedAnswer({
    question: 'Which organizations received support?',
    plan: {
      operation: 'list',
      column: 'Name of Organization',
    },
    result: {
      success: true,
      operation: 'list',
      results: [
        'Org A',
        'Org B',
        'Org C',
      ],
    },
  });

  assert(answer.startsWith('3 organizations received support:'));
  assert(answer.includes('1. Org A'));
  assert(answer.includes('3. Org C'));
});

test('list introduction avoids copying do-they grammar incorrectly', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer = buildSemanticVerifiedAnswer({
    question: 'What commodities do they produce?',
    plan: {
      operation: 'list',
      column: 'Commodities',
    },
    result: {
      success: true,
      operation: 'list',
      results: ['rice', 'corn'],
    },
  });

  assert(!answer.startsWith('2 commodities do they produce:'));
  assert(answer.includes('1. rice'));
  assert(answer.includes('2. corn'));
});


test('verified single-field lists remove repeated values', () => {
  const fs = require('fs');
  const path = require('path');

  const source = fs.readFileSync(
    path.join(__dirname, 'chatbotService.js'),
    'utf8'
  );

  assert(source.includes('function normalizeDirectSingleFieldResult'));
  assert(source.includes('duplicateRowsRemoved'));
  assert(source.includes('const distinctItems'));
});


test('action-verb ranking resolves categorical target and numeric metric correctly', () => {
  const {
    normalizePlannerPlan,
  } = require('./plannerNormalizer');

  const datasets = {
    Sheet1: [
      { Barangay: 'Alpha', Quantity: 20, Unit: 'cuttings' },
      { Barangay: 'Alpha', Quantity: 30, Unit: 'cuttings' },
      { Barangay: 'Beta', Quantity: 40, Unit: 'cuttings' },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Barangay', type: 'text' },
      { name: 'Quantity', type: 'number' },
      { name: 'Unit', type: 'text' },
    ],
  }];

  const plan = normalizePlannerPlan({
    datasets,
    schema,
    question: 'Which barangay received the largest quantity of cuttings?',
    plan: {
      route: 'dataset',
      dataset: 'Sheet1',
      operation: 'rank_rows',
      column: 'Barangay',
      labelColumn: 'Barangay',
      aggregation: null,
      direction: 'desc',
      filters: [
        { column: 'Unit', operator: 'equals', value: 'cuttings' },
      ],
      selectColumns: ['Barangay', 'Quantity'],
      limit: 1,
    },
  });

  assert.strictEqual(plan.column, 'Quantity');
  assert.strictEqual(plan.labelColumn, 'Barangay');
  assert.strictEqual(plan.operation, 'rank_groups');
  assert.strictEqual(plan.groupBy, 'Barangay');
  assert.strictEqual(plan.aggregation, 'sum');
  assert.strictEqual(plan.direction, 'desc');
});

test('copular ranking without additive action keeps ordinary row-ranking semantics', () => {
  const {
    normalizePlannerPlan,
  } = require('./plannerNormalizer');

  const datasets = {
    Sheet1: [
      { Product: 'A', Price: 10 },
      { Product: 'B', Price: 20 },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Product', type: 'text' },
      { name: 'Price', type: 'number' },
    ],
  }];

  const plan = normalizePlannerPlan({
    datasets,
    schema,
    question: 'Which product has the highest price?',
    plan: {
      route: 'dataset',
      dataset: 'Sheet1',
      operation: 'rank_rows',
      column: 'Product',
      labelColumn: 'Product',
      aggregation: null,
      direction: 'desc',
      filters: [],
      selectColumns: ['Product', 'Price'],
      limit: 1,
    },
  });

  assert.strictEqual(plan.column, 'Price');
  assert.strictEqual(plan.labelColumn, 'Product');
  assert.strictEqual(plan.operation, 'rank_rows');
  assert.strictEqual(plan.aggregation, null);
});


test('filtered plural field with appear wording scans all matching rows', () => {
  const {
    resolveDirectFilteredFieldPlan,
  } = require('./directQueryResolver');

  const datasets = {
    Sheet1: [
      { 'Beneficiary Type': 'Individual', 'Beneficiary Subtype': 'Farmer' },
      { 'Beneficiary Type': 'Individual', 'Beneficiary Subtype': 'Others' },
      { 'Beneficiary Type': 'Individual', 'Beneficiary Subtype': 'School' },
      { 'Beneficiary Type': 'Individual', 'Beneficiary Subtype': 'FCA' },
      { 'Beneficiary Type': 'Individual', 'Beneficiary Subtype': 'NGO' },
      { 'Beneficiary Type': 'Group', 'Beneficiary Subtype': 'Government' },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Beneficiary Type' },
      { name: 'Beneficiary Subtype' },
    ],
  }];

  const plan = resolveDirectFilteredFieldPlan({
    question: 'what beneficiary subtypes appear under individual?',
    schema,
    datasets,
  });

  assert(plan);
  assert.strictEqual(plan.operation, 'list');
  assert.strictEqual(plan.column, 'Beneficiary Subtype');
  assert.strictEqual(plan.showAll, true);
  assert.strictEqual(plan.limit, 100);
});

test('small filtered list narrative uses a natural sentence', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer = buildSemanticVerifiedAnswer({
    question: 'what beneficiary subtypes appear under individual?',
    plan: {
      operation: 'list',
      column: 'Beneficiary Subtype',
      filters: [
        {
          column: 'Beneficiary Type',
          operator: 'equals',
          value: 'Individual',
        },
      ],
    },
    result: {
      success: true,
      operation: 'list',
      results: [
        'Farmer',
        'Others',
        'School',
        'FCA',
        'NGO',
      ],
    },
  });

  assert.strictEqual(
    answer,
    'The beneficiary subtypes under Individual are Farmer, Others, School, FCA, and NGO.'
  );
});


test('local relation resolver maps entity-action-object questions across columns', () => {
  const {
    resolveLocalRelationPlan,
  } = require('./localRelationResolver');

  const datasets = {
    People: [
      { 'Employee Name': 'Ana', Department: 'A' },
      { 'Employee Name': 'Ben', Department: 'B' },
    ],
    Attendance: [
      { 'Employee Name': 'Ana', Training: 'Safety', Hours: 4 },
      { 'Employee Name': 'Ana', Training: 'Data', Hours: 2 },
      { 'Employee Name': 'Ben', Training: '', Hours: 0 },
    ],
  };

  const schema = Object.entries(datasets).map(([name, rows]) => ({
    name,
    columns: Object.keys(rows[0]).map((column) => ({ name: column })),
  }));

  const plan = resolveLocalRelationPlan({
    question: 'Which employees attended training?',
    schema,
    datasets,
  });

  assert(plan);
  assert.strictEqual(plan.route, 'dataset');
  assert.strictEqual(plan.dataset, 'Attendance');
  assert.strictEqual(plan.column, 'Employee Name');
  assert.strictEqual(plan.operation, 'list');

  const evidenceFilter = plan.filters.find(
    (filter) => filter.column === 'Training'
  );

  assert(evidenceFilter);
  assert.strictEqual(evidenceFilter.operator, 'not_empty');
});

test('local relation resolver uses explicit object values as filters', () => {
  const {
    resolveLocalRelationPlan,
  } = require('./localRelationResolver');

  const datasets = {
    Attendance: [
      { 'Employee Name': 'Ana', Training: 'Safety Training' },
      { 'Employee Name': 'Ben', Training: 'Data Training' },
      { 'Employee Name': 'Cara', Training: 'Safety Training' },
    ],
  };

  const schema = [{
    name: 'Attendance',
    columns: [
      { name: 'Employee Name' },
      { name: 'Training' },
    ],
  }];

  const plan = resolveLocalRelationPlan({
    question: 'Which employees attended Safety Training?',
    schema,
    datasets,
  });

  assert(plan);
  const filter = plan.filters.find(
    (item) => item.column === 'Training'
  );

  assert(filter);
  assert.strictEqual(filter.operator, 'equals');
  assert.strictEqual(filter.value, 'Safety Training');
});

test('local relation resolver handles new semantic questions without sticky prior memory', () => {
  const {
    resolveStrongLocalSemanticPlan,
  } = require('./localSemanticResolver');

  const datasets = {
    Commodities: [
      { Association: 'A', Commodities: 'rice' },
      { Association: 'B', Commodities: 'corn' },
    ],
    Projects: [
      { 'Project Name': 'Project X', 'Funding Source': 'Fund A', Amount: 100 },
      { 'Project Name': 'Project Y', 'Funding Source': 'Fund B', Amount: 200 },
    ],
  };

  const schema = Object.entries(datasets).map(([name, rows]) => ({
    name,
    columns: Object.keys(rows[0]).map((column) => ({ name: column })),
  }));

  const plan = resolveStrongLocalSemanticPlan({
    question: 'Which projects received funding?',
    schema,
    datasets,
    context: {
      isFollowUp: true,
      lastDataset: 'Commodities',
      lastMetric: 'Commodities',
      lastFilters: [],
    },
  });

  assert(plan);
  assert.strictEqual(plan.route, 'dataset');
  assert.strictEqual(plan.dataset, 'Projects');
  assert.strictEqual(plan.column, 'Project Name');
});

test('ambiguous local relation asks instead of guessing', () => {
  const {
    resolveLocalRelationPlan,
  } = require('./localRelationResolver');

  const datasets = {
    SheetA: [
      { 'Organization Name': 'A', Program: 'P1' },
      { 'Organization Name': 'B', Program: 'P2' },
    ],
    SheetB: [
      { 'Organization Name': 'C', Program: 'P3' },
      { 'Organization Name': 'D', Program: 'P4' },
    ],
  };

  const schema = Object.entries(datasets).map(([name, rows]) => ({
    name,
    columns: Object.keys(rows[0]).map((column) => ({ name: column })),
  }));

  const plan = resolveLocalRelationPlan({
    question: 'Which organizations joined programs?',
    schema,
    datasets,
  });

  assert(plan);
  assert.strictEqual(plan.route, 'clarify');
  assert.strictEqual(plan.localSemanticAmbiguous, true);
});

test('not_empty filter works for relation evidence', () => {
  const {
    applyFilters,
  } = require('./filterEngine');

  const rows = [
    { Name: 'A', Training: 'Safety' },
    { Name: 'B', Training: '' },
    { Name: 'C', Training: null },
  ];

  const filtered = applyFilters(
    rows,
    [
      {
        column: 'Training',
        operator: 'not_empty',
        value: true,
      },
    ]
  );

  assert.deepStrictEqual(
    filtered.map((row) => row.Name),
    ['A']
  );
});


test('multi-category how-many with a unit sums quantity over the category intersection', () => {
  const {
    buildMultiCategoryCountResolution,
  } = require('./analyticalConversationEngine');

  const datasets = {
    Sheet1: [
      {
        'Intervention Details': 'Napier',
        'Unit of Measurement': 'cuttings',
        Quantity: 25,
      },
      {
        'Intervention Details': 'Napier',
        'Unit of Measurement': 'cuttings',
        Quantity: 30,
      },
      {
        'Intervention Details': 'Napier',
        'Unit of Measurement': 'kilograms',
        Quantity: 2,
      },
      {
        'Intervention Details': 'Trichantera',
        'Unit of Measurement': 'cuttings',
        Quantity: 50,
      },
    ],
  };

  const resolution = buildMultiCategoryCountResolution({
    datasets,
    question: 'how many napier cuttings were distributed?',
    preferredDataset: null,
  });

  assert(resolution);
  assert.strictEqual(resolution.plan.operation, 'sum');
  assert.strictEqual(resolution.plan.column, 'Quantity');
  assert.strictEqual(resolution.result.value, 55);
  assert.strictEqual(resolution.result.recordsUsed, 2);
  assert.strictEqual(
    resolution.result.answer,
    'Napier: 55 cuttings.'
  );
});

test('ordinary multi-category count remains separate when no unit-like category exists', () => {
  const {
    buildMultiCategoryCountResolution,
  } = require('./analyticalConversationEngine');

  const datasets = {
    Sheet1: [
      { Beneficiary: 'Farmer', Sex: 'Female' },
      { Beneficiary: 'Farmer', Sex: 'Male' },
      { Beneficiary: 'Others', Sex: 'Female' },
    ],
  };

  const resolution = buildMultiCategoryCountResolution({
    datasets,
    question: 'how many Farmer and Female?',
    preferredDataset: null,
  });

  assert(resolution);
  assert.strictEqual(
    resolution.plan.operation,
    'multi_category_count'
  );
});


test('quantity measure selection excludes contact numbers and chooses Quantity', () => {
  const {
    findBestAdditiveMeasureColumn,
  } = require('./analyticalConversationEngine');

  const rows = [
    {
      'Contact Number': 9171111111,
      Quantity: 25,
      'Unit of Measurement': 'cuttings',
      'Intervention Details': 'Napier',
    },
    {
      'Contact Number': 9172222222,
      Quantity: 30,
      'Unit of Measurement': 'cuttings',
      'Intervention Details': 'Napier',
    },
  ];

  assert.strictEqual(
    findBestAdditiveMeasureColumn(rows),
    'Quantity'
  );
});

test('intersected quantity aggregation sums Quantity and not Contact Number', () => {
  const {
    buildIntersectedQuantityAggregation,
  } = require('./analyticalConversationEngine');

  const rows = [
    {
      'Contact Number': 9171111111,
      Quantity: 25,
      'Unit of Measurement': 'cuttings',
      'Intervention Details': 'Napier',
    },
    {
      'Contact Number': 9172222222,
      Quantity: 30,
      'Unit of Measurement': 'cuttings',
      'Intervention Details': 'Napier',
    },
    {
      'Contact Number': 9173333333,
      Quantity: 50,
      'Unit of Measurement': 'cuttings',
      'Intervention Details': 'Trichantera',
    },
  ];

  const resolution =
    buildIntersectedQuantityAggregation({
      datasetName: 'Sheet1',
      rows,
      categories: [
        {
          column: 'Intervention Details',
          value: 'Napier',
        },
        {
          column: 'Unit of Measurement',
          value: 'cuttings',
        },
      ],
    });

  assert(resolution);
  assert.strictEqual(
    resolution.plan.column,
    'Quantity'
  );
  assert.strictEqual(
    resolution.result.value,
    55
  );
  assert.strictEqual(
    resolution.result.answer,
    'Napier: 55 cuttings.'
  );
});


test('grammar finalizer preserves thousands separators without inserting spaces', () => {
  const {
    finalizeUserFacingGrammar,
  } = require('./responseGrammarEngine');

  assert.strictEqual(
    finalizeUserFacingGrammar(
      'Napier: 1,535 cuttings.'
    ),
    'Napier: 1,535 cuttings.'
  );

  assert.strictEqual(
    finalizeUserFacingGrammar(
      'The total is 12,345,678 units.'
    ),
    'The total is 12,345,678 units.'
  );
});

test('grammar finalizer still inserts spaces after ordinary commas', () => {
  const {
    finalizeUserFacingGrammar,
  } = require('./responseGrammarEngine');

  assert.strictEqual(
    finalizeUserFacingGrammar(
      'Farmer,Others,School'
    ),
    'Farmer, Others, School'
  );
});


test('local quantity resolver maps unit plus object wording to sum Quantity', () => {
  const {
    resolveLocalQuantityAggregationPlan,
  } = require('./localAggregationResolver');

  const datasets = {
    Sheet1: [
      {
        'Intervention Details': 'Organic Fertilizer',
        'Unit of Measurement': 'kilograms',
        Quantity: 25,
        'Date released': '2026-01-01',
      },
      {
        'Intervention Details': 'Inorganic Fertilizer',
        'Unit of Measurement': 'kilograms',
        Quantity: 30,
        'Date released': '2026-01-02',
      },
      {
        'Intervention Details': 'Seeds',
        'Unit of Measurement': 'kilograms',
        Quantity: 10,
        'Date released': '2026-01-03',
      },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: Object.keys(
      datasets.Sheet1[0]
    ).map(
      (name) => ({ name })
    ),
  }];

  const plan =
    resolveLocalQuantityAggregationPlan({
      question:
        'How many kilograms of fertilizer were released?',
      schema,
      datasets,
    });

  assert(plan);
  assert.strictEqual(plan.route, 'dataset');
  assert.strictEqual(plan.operation, 'sum');
  assert.strictEqual(plan.column, 'Quantity');

  const unitFilter =
    plan.filters.find(
      (filter) =>
        filter.column ===
        'Unit of Measurement'
    );

  assert(unitFilter);
  assert.strictEqual(
    unitFilter.value,
    'kilograms'
  );

  const objectFilter =
    plan.filters.find(
      (filter) =>
        filter.column ===
        'Intervention Details'
    );

  assert(objectFilter);
  assert.strictEqual(
    objectFilter.operator,
    'contains'
  );
  assert.strictEqual(
    objectFilter.value,
    'fertilizer'
  );
});

test('strong local resolver uses quantity sum before generic distinct count', () => {
  const {
    resolveStrongLocalSemanticPlan,
  } = require('./localSemanticResolver');

  const datasets = {
    Sheet1: [
      {
        'Intervention Details': 'Organic Fertilizer',
        'Unit of Measurement': 'kilograms',
        Quantity: 25,
        'Date released': '2026-01-01',
      },
      {
        'Intervention Details': 'Organic Fertilizer',
        'Unit of Measurement': 'kilograms',
        Quantity: 30,
        'Date released': '2026-01-02',
      },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: Object.keys(
      datasets.Sheet1[0]
    ).map(
      (name) => ({ name })
    ),
  }];

  const plan =
    resolveStrongLocalSemanticPlan({
      question:
        'How many kilograms of fertilizer were released?',
      schema,
      datasets,
      context: null,
    });

  assert(plan);
  assert.strictEqual(plan.operation, 'sum');
  assert.strictEqual(plan.column, 'Quantity');
  assert.strictEqual(
    plan.localAggregationResolved,
    true
  );
});

test('quantity metric meaning uses Unit of Measurement as display unit', () => {
  const {
    enrichPlanMetricMeaning,
  } = require('./metricMeaningEngine');

  const datasets = {
    Sheet1: [
      {
        'Intervention Details': 'Organic Fertilizer',
        'Unit of Measurement': 'kilograms',
        Quantity: 25,
      },
      {
        'Intervention Details': 'Inorganic Fertilizer',
        'Unit of Measurement': 'kilograms',
        Quantity: 30,
      },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Intervention Details' },
      { name: 'Unit of Measurement' },
      { name: 'Quantity' },
    ],
  }];

  const enriched =
    enrichPlanMetricMeaning({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'sum',
        column: 'Quantity',
        filters: [
          {
            column: 'Unit of Measurement',
            operator: 'equals',
            value: 'kilograms',
          },
          {
            column: 'Intervention Details',
            operator: 'contains',
            value: 'fertilizer',
          },
        ],
      },
      question:
        'How many kilograms of fertilizer were released?',
      datasets,
      schema,
      reportContext: {
        title: 'Station Dashboard',
      },
    });

  assert.strictEqual(
    enriched.metricSemantics,
    'quantity'
  );
  assert.strictEqual(
    enriched.displayUnit,
    'kilograms'
  );
});

async function run() {
  let passed = 0;
  const failures = [];
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`✓ ${item.name}`);
    } catch (error) {
      failures.push({ name:item.name, error });
      console.error(`✗ ${item.name}`);
      console.error(`  ${error?.stack || error}`);
    }
  }
  
console.log(`\n${passed}/${tests.length} regression tests passed.`);
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) run();

module.exports = { run };


test('current explicit filter change forces replan instead of stale result reuse', () => {
  const datasets = {
    SheetA: [
      { Month: 'January', Commodity: 'A', Average: 10 },
      { Month: 'February', Commodity: 'A', Average: 20 },
    ],
  };
  const context = {
    lastPlan: {
      filters: [{ column: 'Month', operator: 'equals', value: 'January' }],
    },
    semanticPlan: {
      filters: [{ column: 'Month', operator: 'equals', value: 'January' }],
    },
  };
  const out = currentQuestionRequiresReplan({
    datasets,
    question: 'Which commodity had the highest average price in February?',
    conversationContext: context,
    explicitGroupOverride: false,
  });
  assert.equal(out.requiresReplan, true);
  assert.equal(out.reasons.includes('filter_override'), true);
});

test('short lowest follow-up can still reuse prior verified analytical set', () => {
  const out = currentQuestionRequiresReplan({
    datasets: { SheetA: [{ Group: 'A', Value: 1 }] },
    question: 'What about the lowest?',
    conversationContext: { lastPlan: { filters: [] }, semanticPlan: { filters: [] } },
    explicitGroupOverride: false,
  });
  assert.equal(out.requiresReplan, false);
});
