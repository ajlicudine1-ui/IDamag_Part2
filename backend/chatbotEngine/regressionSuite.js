const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
const { updateConversation, getRelevantContext, clearConversation, saveCompoundContext } = require('./conversationManager');
const { answerQuestion } = require('./chatbotService');

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

test('plain list narrative uses standardized count-and-list formatting', () => {
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

  assert.strictEqual(
    answer,
    '3 organizations received support:\n1. Org A\n2. Org B\n3. Org C'
  );
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

test('small filtered list narrative uses standardized count-and-list formatting', () => {
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


test('local quantity resolver does not silently drop an ungrounded requested object', () => {
  const {
    resolveLocalQuantityAggregationPlan,
  } = require('./localAggregationResolver');

  const datasets = {
    Sheet1: [
      {
        'Intervention Details': 'OPV Vegetable Seeds',
        'Unit of Measurement': 'kilograms',
        Quantity: 4.4,
      },
      {
        'Intervention Details': 'Vermicast',
        'Unit of Measurement': 'kilograms',
        Quantity: 20,
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
  assert.strictEqual(plan.route, 'clarify');
  assert.strictEqual(
    plan.localGroundingFailed,
    true
  );
  assert.strictEqual(
    plan.localGroundingFailure.phrase,
    'fertilizer'
  );
});

test('strong local resolver preserves grounding failure instead of falling back to a broader count', () => {
  const {
    resolveStrongLocalSemanticPlan,
  } = require('./localSemanticResolver');

  const datasets = {
    Sheet1: [
      {
        'Intervention Details': 'OPV Vegetable Seeds',
        'Unit of Measurement': 'kilograms',
        Quantity: 4.4,
        'Date released': '2026-01-01',
      },
      {
        'Intervention Details': 'Vermicast',
        'Unit of Measurement': 'kilograms',
        Quantity: 20,
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
  assert.strictEqual(plan.route, 'clarify');
  assert.strictEqual(
    plan.localGroundingFailed,
    true
  );
});


test('local planner parity exposes the same executable operation surface as Groq', () => {
  const {
    DATASET_OPERATIONS,
  } = require('./localPlannerParityEngine');

  assert.deepStrictEqual(
    [...DATASET_OPERATIONS].sort(),
    [
      'sum',
      'average',
      'median',
      'minimum',
      'maximum',
      'row_count',
      'non_empty_count',
      'distinct_count',
      'list',
      'lookup',
      'group_count',
      'group_sum',
      'group_average',
      'group_minimum',
      'group_maximum',
      'rank_rows',
      'rank_groups',
    ].sort()
  );
});

test('local planner parity supports schema routes without Groq', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const schema = [{
    name: 'People',
    columns: [
      { name: 'Employee Name', type: 'text' },
      { name: 'Salary', type: 'number' },
    ],
  }];

  const plan =
    ensureLocalPlannerParity({
      plan: { route: 'general' },
      question: 'What columns are available?',
      schema,
      datasets: {},
      context: null,
    });

  assert.strictEqual(plan.route, 'schema');
  assert.strictEqual(plan.intent, 'columns');
});

test('local planner parity repairs grouped sum from live schema', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const datasets = {
    Sheet1: [
      { Province: 'A', Quantity: 10 },
      { Province: 'A', Quantity: 20 },
      { Province: 'B', Quantity: 5 },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Province', type: 'text' },
      { name: 'Quantity', type: 'number' },
    ],
  }];

  const plan =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'sum',
        column: 'Quantity',
        filters: [],
        selectColumns: ['Quantity'],
      },
      question: 'What is the total Quantity by Province?',
      schema,
      datasets,
      context: null,
    });

  assert.strictEqual(plan.operation, 'group_sum');
  assert.strictEqual(plan.column, 'Quantity');
  assert.strictEqual(plan.groupBy, 'Province');
});

test('local planner parity supports average median minimum and maximum', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const datasets = {
    Sheet1: [
      { Category: 'A', Score: 10 },
      { Category: 'B', Score: 20 },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Category', type: 'text' },
      { name: 'Score', type: 'number' },
    ],
  }];

  const cases = [
    ['average Score', 'average'],
    ['median Score', 'median'],
    ['minimum Score', 'minimum'],
    ['maximum Score', 'maximum'],
  ];

  for (const [question, expected] of cases) {
    const plan =
      ensureLocalPlannerParity({
        plan: {
          route: 'dataset',
          dataset: 'Sheet1',
          operation: 'lookup',
          column: 'Score',
          filters: [],
          selectColumns: ['Score'],
        },
        question,
        schema,
        datasets,
        context: null,
      });

    assert.strictEqual(plan.operation, expected);
    assert.strictEqual(plan.column, 'Score');
  }
});

test('local planner parity supports numeric comparison filters', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const datasets = {
    Sheet1: [
      { Employee: 'A', Salary: 100 },
      { Employee: 'B', Salary: 200 },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Employee', type: 'text' },
      { name: 'Salary', type: 'number' },
    ],
  }];

  const plan =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'list',
        column: 'Employee',
        filters: [],
        selectColumns: ['Employee'],
      },
      question: 'List Employee where Salary is greater than 150',
      schema,
      datasets,
      context: null,
    });

  const filter =
    plan.filters.find(
      (item) =>
        item.column === 'Salary'
    );

  assert(filter);
  assert.strictEqual(filter.operator, 'greater_than');
  assert.strictEqual(filter.value, 150);
});

test('local planner parity preserves multiple same-column values as IN and supports NOT IN wording', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const datasets = {
    Sheet1: [
      { Province: 'Pangasinan', Item: 'A' },
      { Province: 'La Union', Item: 'B' },
      { Province: 'Ilocos Norte', Item: 'C' },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Province', type: 'text' },
      { name: 'Item', type: 'text' },
    ],
  }];

  const includePlan =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'list',
        column: 'Item',
        filters: [],
        selectColumns: ['Item'],
      },
      question: 'List Item in Pangasinan and La Union',
      schema,
      datasets,
      context: null,
    });

  const include =
    includePlan.filters.find(
      (item) =>
        item.column === 'Province'
    );

  assert(include);
  assert.strictEqual(include.operator, 'in');

  const excludePlan =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'list',
        column: 'Item',
        filters: [],
        selectColumns: ['Item'],
      },
      question: 'List Item excluding Pangasinan and La Union',
      schema,
      datasets,
      context: null,
    });

  const exclude =
    excludePlan.filters.find(
      (item) =>
        item.column === 'Province'
    );

  assert(exclude);
  assert.strictEqual(exclude.operator, 'not_in');
});

test('local planner parity supports first-word and last-word transforms', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const datasets = {
    Sheet1: [
      { 'Employee Name': 'Doris Joy Garcia' },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Employee Name', type: 'text' },
    ],
  }];

  const first =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'lookup',
        column: 'Employee Name',
        filters: [],
        selectColumns: ['Employee Name'],
      },
      question: 'What is the first name?',
      schema,
      datasets,
      context: null,
    });

  assert.strictEqual(first.transform, 'first_word');

  const last =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'lookup',
        column: 'Employee Name',
        filters: [],
        selectColumns: ['Employee Name'],
      },
      question: 'What is the last name?',
      schema,
      datasets,
      context: null,
    });

  assert.strictEqual(last.transform, 'last_word');
});

test('local planner parity keeps normal list requests showAll when no explicit N', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const datasets = {
    Sheet1: [
      { Commodity: 'Rice' },
      { Commodity: 'Corn' },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Commodity', type: 'text' },
    ],
  }];

  const plan =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'list',
        column: 'Commodity',
        filters: [],
        selectColumns: ['Commodity'],
        showAll: false,
        limit: 10,
      },
      question: 'List all Commodity',
      schema,
      datasets,
      context: null,
    });

  assert.strictEqual(plan.operation, 'list');
  assert.strictEqual(plan.showAll, true);
  assert(plan.limit >= 100);
});

test('local planner parity repairs row ranking label versus metric', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const datasets = {
    Sheet1: [
      { Barangay: 'A', Quantity: 5 },
      { Barangay: 'B', Quantity: 10 },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Barangay', type: 'text' },
      { name: 'Quantity', type: 'number' },
    ],
  }];

  const plan =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'lookup',
        column: 'Barangay',
        filters: [],
        selectColumns: ['Barangay', 'Quantity'],
      },
      question: 'Which Barangay has the highest Quantity?',
      schema,
      datasets,
      context: null,
    });

  assert.strictEqual(plan.operation, 'rank_rows');
  assert.strictEqual(plan.column, 'Quantity');
  assert.strictEqual(plan.labelColumn, 'Barangay');
  assert.strictEqual(plan.direction, 'desc');
});

test('local planner parity repairs grouped average ranking', () => {
  const {
    ensureLocalPlannerParity,
  } = require('./localPlannerParityEngine');

  const datasets = {
    Sheet1: [
      { Division: 'A', Salary: 100 },
      { Division: 'A', Salary: 200 },
      { Division: 'B', Salary: 250 },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Division', type: 'text' },
      { name: 'Salary', type: 'number' },
    ],
  }];

  const plan =
    ensureLocalPlannerParity({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'lookup',
        column: 'Division',
        filters: [],
        selectColumns: ['Division', 'Salary'],
      },
      question: 'Which Division has the highest average Salary?',
      schema,
      datasets,
      context: null,
    });

  assert.strictEqual(plan.operation, 'rank_groups');
  assert.strictEqual(plan.column, 'Salary');
  assert.strictEqual(plan.groupBy, 'Division');
  assert.strictEqual(plan.aggregation, 'average');
});


test('filter-value follow-up wins over same-named schema field', () => {
  const {
    shouldPreferExplicitValueFilter,
  } = require('./followUpContinuityEngine');

  assert.strictEqual(
    shouldPreferExplicitValueFilter({
      isFollowUp: true,
      question: 'what about Phase 3?',
      explicitValueFilters: [
        {
          column: 'Phase',
          operator: 'equals',
          value: 'Phase 3',
        },
      ],
    }),
    true
  );
});

test('filter follow-up preserves previous output field instead of filter field', () => {
  const {
    chooseContinuitySubjectColumn,
  } = require('./followUpContinuityEngine');

  assert.strictEqual(
    chooseContinuitySubjectColumn({
      previousPlan: {
        operation: 'list',
        column: 'Name of Association',
        labelColumn: 'Name of Association',
        selectColumns: [
          'Name of Association',
        ],
      },
      newFilters: [
        {
          column: 'Phase',
          operator: 'equals',
          value: 'Phase 3',
        },
      ],
    }),
    'Name of Association'
  );

  assert.strictEqual(
    chooseContinuitySubjectColumn({
      previousPlan: {
        operation: 'list',
        column: 'Phase',
        labelColumn: 'Name of Association',
        selectColumns: [
          'Phase',
        ],
      },
      newFilters: [
        {
          column: 'Phase',
          operator: 'equals',
          value: 'Phase 1',
        },
      ],
    }),
    'Name of Association'
  );
});

test('continuity narrative rewrites previous scope value while keeping subject wording', () => {
  const {
    rewriteContinuityQuestionWithFilters,
  } = require('./followUpContinuityEngine');

  assert.strictEqual(
    rewriteContinuityQuestionWithFilters({
      subjectQuestion:
        'what are the association in phase 2?',
      previousFilters: [
        {
          column: 'Phase',
          operator: 'equals',
          value: 'Phase 2',
        },
      ],
      newFilters: [
        {
          column: 'Phase',
          operator: 'equals',
          value: 'Phase 3',
        },
      ],
      fallbackQuestion:
        'what about phase 3?',
    }),
    'what are the association in Phase 3?'
  );
});

test('conversational filter-switch list keeps numbered format for small result sets', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'what are the association in Phase 3?',
      plan: {
        operation: 'list',
        column: 'Name of Association',
        filters: [
          {
            column: 'Phase',
            operator: 'equals',
            value: 'Phase 3',
          },
        ],
        conversationalFilterSwitch: true,
      },
      result: {
        success: true,
        operation: 'list',
        count: 3,
        results: [
          'Association A',
          'Association B',
          'Association C',
        ],
      },
    });

  assert(answer);
  assert(answer.includes('1. Association A'));
  assert(answer.includes('2. Association B'));
  assert(answer.includes('3. Association C'));
});

test('single-result filter continuation still returns the requested entity list', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'what are the association in Phase 1?',
      plan: {
        operation: 'list',
        column: 'Name of Association',
        filters: [
          {
            column: 'Phase',
            operator: 'equals',
            value: 'Phase 1',
          },
        ],
        conversationalFilterSwitch: true,
      },
      result: {
        success: true,
        operation: 'list',
        count: 1,
        results: [
          'Association A',
        ],
      },
    });

  assert(answer);
  assert(answer.includes('1. Association A'));
  assert(!/^Phase 1$/i.test(answer.trim()));
});


test('filter-switch intro derives requested entity instead of copying about wording', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'what about phase 1?',
      plan: {
        operation: 'list',
        column: 'Name of Association',
        labelColumn: 'Name of Association',
        filters: [
          {
            column: 'Phase',
            operator: 'equals',
            value: 'Phase 1',
          },
        ],
        conversationalFilterSwitch: true,
      },
      result: {
        success: true,
        operation: 'list',
        count: 1,
        results: [
          'Santiago Sur Agriculture Cooperative',
        ],
      },
    });

  assert.strictEqual(
    answer,
    `1 association in Phase 1:
1. Santiago Sur Agriculture Cooperative`
  );
});

test('filter-switch formatting stays consistent for multiple result counts', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'what about phase 3?',
      plan: {
        operation: 'list',
        column: 'Name of Association',
        labelColumn: 'Name of Association',
        filters: [
          {
            column: 'Phase',
            operator: 'equals',
            value: 'Phase 3',
          },
        ],
        conversationalFilterSwitch: true,
      },
      result: {
        success: true,
        operation: 'list',
        count: 3,
        results: [
          'Association A',
          'Association B',
          'Association C',
        ],
      },
    });

  assert.strictEqual(
    answer,
    `3 associations in Phase 3:
1. Association A
2. Association B
3. Association C`
  );
});

test('continuation entity noun is derived generically from common name fields', () => {
  const {
    deriveEntityNounFromField,
  } = require('./responseNarrativeEngine');

  assert.strictEqual(
    deriveEntityNounFromField(
      'Name of Association',
      2
    ),
    'Associations'
  );

  assert.strictEqual(
    deriveEntityNounFromField(
      'Employee Name',
      1
    ),
    'Employee'
  );
});


test('ordinal wording grounds to live numbered categorical values', () => {
  const {
    inferCoherentFilters,
  } = require('./filterEngine');

  const rows = [
    { Phase: 'Phase 1', Association: 'A' },
    { Phase: 'Phase 2', Association: 'B' },
    { Phase: 'Phase 3', Association: 'C' },
  ];

  const cases = [
    ['second phase', 'Phase 2'],
    ['phase two', 'Phase 2'],
    ['2nd phase', 'Phase 2'],
    ['third phase', 'Phase 3'],
  ];

  for (const [question, expected] of cases) {
    const filters =
      inferCoherentFilters(
        rows,
        question
      );

    const phase =
      filters.find(
        (filter) =>
          filter.column ===
          'Phase'
      );

    assert(phase);
    assert.strictEqual(
      phase.value,
      expected
    );
  }
});

test('ordinal alias grounding is generic for other numbered dimensions', () => {
  const {
    inferCoherentFilters,
  } = require('./filterEngine');

  const rows = [
    { Level: 'Level 1', Name: 'A' },
    { Level: 'Level 2', Name: 'B' },
    { Level: 'Level 3', Name: 'C' },
  ];

  const filters =
    inferCoherentFilters(
      rows,
      'which names are in third level?'
    );

  const level =
    filters.find(
      (filter) =>
        filter.column ===
        'Level'
    );

  assert(level);
  assert.strictEqual(
    level.value,
    'Level 3'
  );
});

test('ordinal alias grounding does not reinterpret arbitrary numeric identifiers', () => {
  const {
    buildOrdinalValueAliases,
  } = require('./filterEngine');

  assert.deepStrictEqual(
    buildOrdinalValueAliases({
      column: 'Gatepass No.',
      displayValue: 'GP 2',
    }),
    []
  );
});

test('direct filtered entity list uses same stable scoped narrative style', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'what are the association that are in second phase?',
      plan: {
        operation: 'list',
        column: 'Name of Association',
        labelColumn: 'Name of Association',
        filters: [
          {
            column: 'Phase',
            operator: 'equals',
            value: 'Phase 2',
          },
        ],
        directFilteredField: true,
      },
      result: {
        success: true,
        operation: 'list',
        count: 2,
        results: [
          'Association A',
          'Association B',
        ],
      },
    });

  assert.strictEqual(
    answer,
    `2 associations in Phase 2:
1. Association A
2. Association B`
  );
});


test('relative-clause direct filter keeps requested entity field', () => {
  const {
    resolveDirectFilteredFieldPlan,
  } = require('./directQueryResolver');

  const datasets = {
    Main_Table_2026: [
      {
        'Name of Association': 'Association A',
        Phase: 'Phase 2',
      },
      {
        'Name of Association': 'Association B',
        Phase: 'Phase 2',
      },
      {
        'Name of Association': 'Association C',
        Phase: 'Phase 3',
      },
    ],
  };

  const schema = [{
    name: 'Main_Table_2026',
    columns: [
      {
        name: 'Name of Association',
        type: 'text',
      },
      {
        name: 'Phase',
        type: 'text',
      },
    ],
  }];

  const plan =
    resolveDirectFilteredFieldPlan({
      question:
        'what are the association that are in phase 2?',
      schema,
      datasets,
    });

  assert(plan);
  assert.strictEqual(
    plan.operation,
    'list'
  );
  assert.strictEqual(
    plan.column,
    'Name of Association'
  );

  const phase =
    plan.filters.find(
      (filter) =>
        filter.column ===
        'Phase'
    );

  assert(phase);
  assert.strictEqual(
    phase.value,
    'Phase 2'
  );
});

test('relative-clause direct filter is generic outside phase data', () => {
  const {
    resolveDirectFilteredFieldPlan,
  } = require('./directQueryResolver');

  const datasets = {
    People: [
      {
        'Employee Name': 'Ana',
        Department: 'Finance',
      },
      {
        'Employee Name': 'Ben',
        Department: 'HR',
      },
    ],
  };

  const schema = [{
    name: 'People',
    columns: [
      {
        name: 'Employee Name',
        type: 'text',
      },
      {
        name: 'Department',
        type: 'text',
      },
    ],
  }];

  const plan =
    resolveDirectFilteredFieldPlan({
      question:
        'which employees that are in finance?',
      schema,
      datasets,
    });

  assert(plan);
  assert.strictEqual(
    plan.column,
    'Employee Name'
  );
  assert.strictEqual(
    plan.filters[0].column,
    'Department'
  );
  assert.strictEqual(
    plan.filters[0].value,
    'Finance'
  );
});


test('word-boundary matching does not match short live values inside longer words', () => {
  const {
    inferValueFilters,
  } = require('./filterEngine');

  const rows = [
    {
      Association: 'A',
      Phase: 'Phase 2',
      'SEC/DOLE/CDA': 'SEC',
    },
    {
      Association: 'B',
      Phase: 'Phase 2',
      'SEC/DOLE/CDA': 'DOLE',
    },
  ];

  const filters =
    inferValueFilters(
      rows,
      'second phase'
    );

  const phase =
    filters.find(
      (filter) =>
        filter.column === 'Phase'
    );

  const sec =
    filters.find(
      (filter) =>
        filter.column === 'SEC/DOLE/CDA'
    );

  assert(phase);
  assert.strictEqual(
    phase.value,
    'Phase 2'
  );
  assert.strictEqual(
    sec,
    undefined
  );
});

test('second phase and phase 2 resolve to the same direct filtered entity request', () => {
  const {
    resolveDirectFilteredFieldPlan,
  } = require('./directQueryResolver');

  const datasets = {
    Main_Table_2026: [
      {
        Association: 'Association A',
        Phase: 'Phase 2',
        'SEC/DOLE/CDA': 'SEC',
      },
      {
        Association: 'Association B',
        Phase: 'Phase 2',
        'SEC/DOLE/CDA': 'DOLE',
      },
      {
        Association: 'Association C',
        Phase: 'Phase 3',
        'SEC/DOLE/CDA': 'SEC',
      },
    ],
  };

  const schema = [{
    name: 'Main_Table_2026',
    columns: [
      { name: 'Association', type: 'text' },
      { name: 'Phase', type: 'text' },
      { name: 'SEC/DOLE/CDA', type: 'text' },
    ],
  }];

  const natural =
    resolveDirectFilteredFieldPlan({
      question:
        'what are the association that are in second phase?',
      schema,
      datasets,
    });

  const literal =
    resolveDirectFilteredFieldPlan({
      question:
        'what are the association that are in phase 2?',
      schema,
      datasets,
    });

  assert(natural);
  assert(literal);

  assert.strictEqual(
    natural.column,
    'Association'
  );
  assert.strictEqual(
    literal.column,
    'Association'
  );

  assert.deepStrictEqual(
    natural.filters,
    [
      {
        column: 'Phase',
        operator: 'equals',
        value: 'Phase 2',
      },
    ]
  );

  assert.deepStrictEqual(
    literal.filters,
    [
      {
        column: 'Phase',
        operator: 'equals',
        value: 'Phase 2',
      },
    ]
  );
});

test('direct filtered Association narrative is consistent for phase wording', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const plan = {
    operation: 'list',
    column: 'Association',
    labelColumn: 'Association',
    filters: [
      {
        column: 'Phase',
        operator: 'equals',
        value: 'Phase 2',
      },
    ],
    directFilteredField: true,
  };

  const result = {
    success: true,
    operation: 'list',
    count: 2,
    results: [
      'Association A',
      'Association B',
    ],
  };

  const natural =
    buildSemanticVerifiedAnswer({
      question:
        'what are the association that are in second phase?',
      plan,
      result,
    });

  const literal =
    buildSemanticVerifiedAnswer({
      question:
        'what are the association that are in phase 2?',
      plan,
      result,
    });

  const expected =
    `2 associations in Phase 2:
1. Association A
2. Association B`;

  assert.strictEqual(
    natural,
    expected
  );

  assert.strictEqual(
    literal,
    expected
  );
});


test('universal grounding rejects a requested object that does not exist', () => {
  const {
    enforceUniversalGrounding,
  } = require('./universalGroundingEngine');

  const rows = [
    {
      'Intervention Details': 'Vermicast',
      'Unit of Measurement': 'kilograms',
      Quantity: 10,
    },
    {
      'Intervention Details': 'OPV Vegetable Seeds',
      'Unit of Measurement': 'kilograms',
      Quantity: 5,
    },
  ];

  const grounding =
    enforceUniversalGrounding({
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
        ],
      },
      question:
        'How many kilograms of fertilizer were released?',
      rows,
      columns: [
        'Intervention Details',
        'Unit of Measurement',
        'Quantity',
      ],
    });

  assert.strictEqual(
    grounding.valid,
    false
  );
  assert.strictEqual(
    grounding.plan.route,
    'clarify'
  );
  assert.strictEqual(
    grounding.plan.universalGroundingFailed,
    true
  );
});

test('universal grounding repairs an omitted live value filter', () => {
  const {
    enforceUniversalGrounding,
  } = require('./universalGroundingEngine');

  const rows = [
    {
      Association: 'A',
      Phase: 'Phase 2',
    },
    {
      Association: 'B',
      Phase: 'Phase 3',
    },
  ];

  const grounding =
    enforceUniversalGrounding({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'list',
        column: 'Association',
        filters: [],
      },
      question:
        'List associations in Phase 2',
      rows,
      columns: [
        'Association',
        'Phase',
      ],
    });

  assert.strictEqual(
    grounding.valid,
    true
  );

  const phase =
    grounding.plan.filters.find(
      (filter) =>
        filter.column === 'Phase'
    );

  assert(phase);
  assert.strictEqual(
    phase.value,
    'Phase 2'
  );
  assert.strictEqual(
    grounding.plan.universalGroundingRepaired,
    true
  );
});

test('universal grounding validates filters emitted by any planner source', () => {
  const {
    enforceUniversalGrounding,
  } = require('./universalGroundingEngine');

  const rows = [
    {
      Province: 'Pangasinan',
      Status: 'Active',
    },
  ];

  const grounding =
    enforceUniversalGrounding({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'list',
        column: 'Province',
        filters: [
          {
            column: 'Status',
            operator: 'equals',
            value: 'Imaginary',
          },
        ],
      },
      question:
        'List Province where Status is Imaginary',
      rows,
      columns: [
        'Province',
        'Status',
      ],
    });

  assert.strictEqual(
    grounding.valid,
    false
  );
});

test('complex filter parity collapses same-column OR into IN plus AND filter', () => {
  const {
    resolveComplexFilterPlan,
  } = require('./complexFilterParityEngine');

  const rows = [
    {
      Province: 'Pangasinan',
      Status: 'Active',
      Project: 'A',
    },
    {
      Province: 'La Union',
      Status: 'Active',
      Project: 'B',
    },
    {
      Province: 'Ilocos Norte',
      Status: 'Pending',
      Project: 'C',
    },
  ];

  const plan =
    resolveComplexFilterPlan({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'list',
        column: 'Project',
        filters: [],
      },
      question:
        'List Project in Pangasinan or La Union and Active',
      rows,
    });

  assert.strictEqual(
    plan.complexFilterResolved,
    true
  );
  assert.strictEqual(
    plan.filterGroups.length,
    0
  );

  const province =
    plan.filters.find(
      (filter) =>
        filter.column === 'Province'
    );

  const status =
    plan.filters.find(
      (filter) =>
        filter.column === 'Status'
    );

  assert(province);
  assert.strictEqual(
    province.operator,
    'in'
  );
  assert.deepStrictEqual(
    province.value,
    [
      'Pangasinan',
      'La Union',
    ]
  );

  assert(status);
  assert.strictEqual(
    status.value,
    'Active'
  );
});

test('complex filter parity creates OR-of-AND groups for independent alternatives', () => {
  const {
    resolveComplexFilterPlan,
  } = require('./complexFilterParityEngine');

  const rows = [
    {
      Province: 'Pangasinan',
      Status: 'Active',
      Project: 'A',
    },
    {
      Province: 'La Union',
      Status: 'Pending',
      Project: 'B',
    },
    {
      Province: 'Pangasinan',
      Status: 'Pending',
      Project: 'C',
    },
  ];

  const plan =
    resolveComplexFilterPlan({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'lookup',
        column: 'Project',
        filters: [],
      },
      question:
        'Pangasinan and Active or La Union and Pending',
      rows,
    });

  assert.strictEqual(
    plan.complexFilterResolved,
    true
  );
  assert.strictEqual(
    plan.filterGroupLogic,
    'or'
  );
  assert.strictEqual(
    plan.filterGroups.length,
    2
  );

  assert.deepStrictEqual(
    plan.filterGroups[0].filters.map(
      (filter) => [
        filter.column,
        filter.value,
      ]
    ),
    [
      ['Province', 'Pangasinan'],
      ['Status', 'Active'],
    ]
  );

  assert.deepStrictEqual(
    plan.filterGroups[1].filters.map(
      (filter) => [
        filter.column,
        filter.value,
      ]
    ),
    [
      ['Province', 'La Union'],
      ['Status', 'Pending'],
    ]
  );
});

test('complex filter parity refuses partial AND OR grounding', () => {
  const {
    resolveComplexFilterPlan,
  } = require('./complexFilterParityEngine');

  const rows = [
    {
      Province: 'Pangasinan',
      Status: 'Active',
      Project: 'A',
    },
  ];

  const plan =
    resolveComplexFilterPlan({
      plan: {
        route: 'dataset',
        dataset: 'Sheet1',
        operation: 'list',
        column: 'Project',
        filters: [],
      },
      question:
        'Pangasinan and ImaginaryStatus',
      rows,
    });

  assert.strictEqual(
    plan.complexFilterGroundingFailed,
    true
  );
  assert.deepStrictEqual(
    plan.complexFilterUngroundedClauses,
    [
      'ImaginaryStatus',
    ]
  );
});


test('all simple list answers use the same format across planner sources', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const plannerSources = [
    'groq',
    'local-fallback',
    'conversation',
    'conversation-local',
    'deterministic-direct',
  ];

  for (const plannerSource of plannerSources) {
    const answer =
      buildSemanticVerifiedAnswer({
        question:
          'Which associations are registered with SEC or DOLE?',
        plan: {
          route: 'dataset',
          operation: 'list',
          column: 'Association',
          filters: [
            {
              column: 'SEC/DOLE/CDA',
              operator: 'in',
              value: ['SEC', 'DOLE'],
            },
          ],
          plannerSource,
        },
        result: {
          success: true,
          operation: 'list',
          count: 3,
          results: [
            'Association A',
            'Association B',
            'Association C',
          ],
        },
      });

    assert.strictEqual(
      answer,
      'The associations for SEC and DOLE are Association A, Association B, and Association C.'
    );
  }
});

test('single equals filter may add a natural scope while retaining count-and-list format', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question: 'What associations are in Phase 2?',
      plan: {
        route: 'dataset',
        operation: 'list',
        column: 'Association',
        filters: [
          {
            column: 'Phase',
            operator: 'equals',
            value: 'Phase 2',
          },
        ],
      },
      result: {
        success: true,
        operation: 'list',
        count: 2,
        results: [
          'Association A',
          'Association B',
        ],
      },
    });

  assert.strictEqual(
    answer,
    'The associations in Phase 2 are Association A and Association B.'
  );
});

test('IN filters do not render array values as awkward list scopes', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'Which associations are registered with SEC or DOLE?',
      plan: {
        route: 'dataset',
        operation: 'list',
        column: 'Association',
        filters: [
          {
            column: 'SEC/DOLE/CDA',
            operator: 'in',
            value: ['SEC', 'DOLE'],
          },
        ],
      },
      result: {
        success: true,
        operation: 'list',
        results: [
          'Association A',
          'Association B',
        ],
      },
    });

  assert.strictEqual(
    answer,
    'The associations for SEC and DOLE are Association A and Association B.'
  );
});

test('actual V7.36.2 response behavior allows simple verified lists to receive optional language polish', () => {
  const {
    shouldPreserveDeterministicSemanticAnswer,
  } = require('./responseGenerator');

  assert.strictEqual(
    shouldPreserveDeterministicSemanticAnswer({
      plan: {
        route: 'dataset',
        operation: 'list',
        column: 'Association',
        labelColumn: null,
      },
      result: {
        success: true,
        operation: 'list',
        results: [
          'Association A',
          'Association B',
        ],
      },
      semanticAnswer:
        `2 associations:\n1. Association A\n2. Association B`,
    }),
    false
  );
});


test('response style router keeps simple scalar lists as clean lists', () => {
  const {
    classifyResponseStyle,
  } = require('./responseStyleRouter');

  const style =
    classifyResponseStyle({
      question:
        'Which associations are in Pangasinan?',
      plan: {
        operation: 'list',
        column: 'Association',
      },
      result: {
        operation: 'list',
        results: [
          'Association A',
          'Association B',
        ],
      },
    });

  assert.strictEqual(
    style,
    'simple_list'
  );
});

test('response style router sends paired lookups to human-like relationship narrative', () => {
  const {
    classifyResponseStyle,
  } = require('./responseStyleRouter');

  const style =
    classifyResponseStyle({
      question:
        'What commodities do they produce?',
      plan: {
        operation: 'lookup',
        column: 'Commodities',
        labelColumn: 'Municipality',
      },
      result: {
        operation: 'lookup',
        column: 'Commodities',
        labelColumn: 'Municipality',
        results: [
          {
            Municipality: 'Sison',
            Commodities: 'rice, corn, vegetables',
          },
          {
            Municipality: 'Mabini',
            Commodities: 'rice, vegetables, sugarcane',
          },
        ],
      },
    });

  assert.strictEqual(
    style,
    'relationship_grouped'
  );
});

test('response style router sends scalar calculations to concise numeric analysis', () => {
  const {
    classifyResponseStyle,
  } = require('./responseStyleRouter');

  const style =
    classifyResponseStyle({
      question:
        'What is the total land area?',
      plan: {
        operation: 'sum',
        column: 'Total Land Area (ha)',
      },
      result: {
        operation: 'sum',
        value: 123.45,
      },
    });

  assert.strictEqual(
    style,
    'numeric_analysis'
  );
});

test('response style router prioritizes ranking over generic grouped output', () => {
  const {
    classifyResponseStyle,
  } = require('./responseStyleRouter');

  const style =
    classifyResponseStyle({
      question:
        'Which association has the largest land area?',
      plan: {
        operation: 'rank_groups',
        column: 'Total Land Area (ha)',
        groupBy: 'Association',
        direction: 'desc',
      },
      result: {
        operation: 'rank_groups',
        groupBy: 'Association',
        direction: 'desc',
        results: [
          {
            label: 'Association A',
            value: 161.6967,
          },
        ],
      },
    });

  assert.strictEqual(
    style,
    'ranking'
  );
});

test('response style router prioritizes conversational continuation for follow-ups', () => {
  const {
    classifyResponseStyle,
  } = require('./responseStyleRouter');

  const style =
    classifyResponseStyle({
      question:
        'What about Phase 3?',
      plan: {
        operation: 'list',
        column: 'Association',
        conversationalFilterSwitch: true,
      },
      result: {
        operation: 'list',
        results: [
          'Association A',
        ],
      },
    });

  assert.strictEqual(
    style,
    'follow_up'
  );
});

test('relationship narrative remains human-like instead of becoming a raw list', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'What commodities do they produce?',
      plan: {
        operation: 'lookup',
        column: 'Commodities',
        labelColumn: 'Municipality',
      },
      result: {
        success: true,
        operation: 'lookup',
        column: 'Commodities',
        labelColumn: 'Municipality',
        results: [
          {
            Municipality: 'Sison',
            Commodities: 'rice, corn, vegetables',
          },
          {
            Municipality: 'Anda',
            Commodities: 'rice, corn, vegetables',
          },
          {
            Municipality: 'Binalonan',
            Commodities: 'rice, corn, vegetables',
          },
          {
            Municipality: 'Mabini',
            Commodities: 'rice, vegetables, sugarcane',
          },
        ],
      },
    });

  assert.strictEqual(
    answer,
    'They produce rice, corn, vegetables, and sugarcane. Sison, Anda, and Binalonan produce rice, corn, and vegetables, while Mabini produces rice, vegetables, and sugarcane.'
  );
});


test('strong morphological referential resolver selects municipality and rejects IP substring collisions', () => {
  const {
    findStrongMorphologicalQuestionColumn,
  } = require('./plannerNormalizer');

  const schema = [{
    name: 'Main_Table_2026',
    columns: [
      { name: 'Association' },
      { name: 'Municipality' },
      { name: 'IP' },
      { name: 'Province' },
    ],
  }];

  const resolved =
    findStrongMorphologicalQuestionColumn({
      schema,
      question: 'What municipalities are they from?',
      preferredDataset: 'Main_Table_2026',
    });

  assert(resolved);
  assert.strictEqual(resolved.column, 'Municipality');
});


test('human relationship narrative deduplicates case variants across grouped values', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'What climate-related risks do they face?',
      plan: {
        operation: 'lookup',
        column: 'Climate-related Risks/Hazards',
        labelColumn: 'Amia Villages',
        filters: [
          {
            column: 'Province',
            operator: 'equals',
            value: 'Pangasinan',
          },
        ],
      },
      result: {
        success: true,
        operation: 'lookup',
        column: 'Climate-related Risks/Hazards',
        labelColumn: 'Amia Villages',
        results: [
          {
            'Amia Villages': 'Sison',
            'Climate-related Risks/Hazards':
              'Landslide, Soil Erosion, Typhoon, Drought, Flood',
          },
          {
            'Amia Villages': 'Binalonan',
            'Climate-related Risks/Hazards':
              'Typhoon, Flood, Drought',
          },
          {
            'Amia Villages': 'Anda',
            'Climate-related Risks/Hazards':
              'Typhoon, Storm Surge, Drought, Sea level rise, Soil erosion',
          },
          {
            'Amia Villages': 'Mabini',
            'Climate-related Risks/Hazards':
              'Typhoon, Drought, Landslide, erosion',
          },
        ],
      },
    });

  assert.strictEqual(
    answer,
    'They face Landslide, Soil Erosion, Typhoon, Drought, Flood, Storm Surge, Sea level rise, and erosion. Sison faces Landslide, Soil Erosion, Typhoon, Drought, and Flood, Binalonan faces Typhoon, Flood, and Drought, Anda faces Typhoon, Storm Surge, Drought, Sea level rise, and Soil erosion, and Mabini faces Typhoon, Drought, Landslide, and erosion.'
  );
});

test('human relationship narrative uses a natural comma-and detail sentence for many groups', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const answer =
    buildSemanticVerifiedAnswer({
      question:
        'What AMIA villages are they from?',
      plan: {
        operation: 'lookup',
        column: 'Amia Villages',
        labelColumn: 'Association',
      },
      result: {
        success: true,
        operation: 'lookup',
        column: 'Amia Villages',
        labelColumn: 'Association',
        results: [
          { Association: 'Association A', 'Amia Villages': 'Sison' },
          { Association: 'Association B', 'Amia Villages': 'Binalonan' },
          { Association: 'Association C', 'Amia Villages': 'Anda' },
          { Association: 'Association D', 'Amia Villages': 'Mabini' },
        ],
      },
    });

  assert.strictEqual(
    answer,
    'They are from Sison, Binalonan, Anda, and Mabini. Association A is from Sison, Association B is from Binalonan, Association C is from Anda, and Association D is from Mabini.'
  );
});


test('explicit referential copular lookup uses semantic human-like relationship narrative', () => {
  const {
    buildSemanticVerifiedAnswer,
  } = require('./responseNarrativeEngine');

  const question =
    'What AMIA villages are they from?';

  const plan = {
    route: 'dataset',
    dataset: 'Main_Table_2026',
    operation: 'lookup',
    column: 'Amia Villages',
    labelColumn: 'Association',
    filters: [
      {
        column: 'Province',
        operator: 'equals',
        value: 'Pangasinan',
      },
    ],
    conversationalPairColumn:
      'Association',
    explicitReferentialField: true,
  };

  const result = {
    success: true,
    operation: 'lookup',
    column: 'Amia Villages',
    labelColumn: 'Association',
    results: [
      {
        Association:
          'Calia Gawis Farmers Association Inc.',
        'Amia Villages': 'Sison',
      },
      {
        Association:
          'Brgy. Mangkasuy Binalonan Farmers Association Inc.',
        'Amia Villages': 'Binalonan',
      },
      {
        Association:
          'Anda Mushroom Growers and Organic Farmers Association',
        'Amia Villages': 'Anda',
      },
      {
        Association:
          'San Pedro Mabini Farmers Agriculture Cooperative',
        'Amia Villages': 'Mabini',
      },
    ],
  };

  const answer =
    buildSemanticVerifiedAnswer({
      question,
      plan,
      result,
    });

  assert.strictEqual(
    answer,
    'They are from Sison, Binalonan, Anda, and Mabini. Calia Gawis Farmers Association Inc. is from Sison, Brgy. Mangkasuy Binalonan Farmers Association Inc. is from Binalonan, Anda Mushroom Growers and Organic Farmers Association is from Anda, and San Pedro Mabini Farmers Agriculture Cooperative is from Mabini.'
  );
});


test('current explicit distinct field wins over relationship subject in direct filtered question', () => {
  const {
    resolveDirectFilteredFieldPlan,
    normalizeDirectRequestedFieldPhrase,
  } = require('./directQueryResolver');

  assert.strictEqual(
    normalizeDirectRequestedFieldPhrase(
      'distinct commodities are produced by associations'
    ),
    'commodities'
  );

  const datasets = {
    Main_Table_2026: [
      {
        Association: 'Association A',
        Commodities: 'rice, corn, vegetables',
        Province: 'Pangasinan',
      },
      {
        Association: 'Association B',
        Commodities: 'rice, vegetables, sugarcane',
        Province: 'Pangasinan',
      },
      {
        Association: 'Association C',
        Commodities: 'corn',
        Province: 'La Union',
      },
    ],
  };

  const schema = [{
    name: 'Main_Table_2026',
    columns: [
      { name: 'Association', type: 'text' },
      { name: 'Commodities', type: 'text' },
      { name: 'Province', type: 'text' },
    ],
  }];

  const plan =
    resolveDirectFilteredFieldPlan({
      question:
        'What distinct commodities are produced by associations in Pangasinan?',
      schema,
      datasets,
    });

  assert(plan);
  assert.strictEqual(
    plan.operation,
    'list'
  );
  assert.strictEqual(
    plan.column,
    'Commodities'
  );
  assert.deepStrictEqual(
    plan.filters,
    [
      {
        column: 'Province',
        operator: 'equals',
        value: 'Pangasinan',
      },
    ]
  );
});

test('direct field relationship cleanup is generic outside commodities', () => {
  const {
    resolveDirectFilteredFieldPlan,
  } = require('./directQueryResolver');

  const datasets = {
    Sheet1: [
      {
        Project: 'Project A',
        Status: 'Completed',
        Province: 'Pangasinan',
      },
      {
        Project: 'Project B',
        Status: 'Active',
        Province: 'Pangasinan',
      },
    ],
  };

  const schema = [{
    name: 'Sheet1',
    columns: [
      { name: 'Project', type: 'text' },
      { name: 'Status', type: 'text' },
      { name: 'Province', type: 'text' },
    ],
  }];

  const plan =
    resolveDirectFilteredFieldPlan({
      question:
        'What unique projects are located in Pangasinan?',
      schema,
      datasets,
    });

  assert(plan);
  assert.strictEqual(
    plan.column,
    'Project'
  );
  assert.strictEqual(
    plan.filters[0].column,
    'Province'
  );
  assert.strictEqual(
    plan.filters[0].value,
    'Pangasinan'
  );
});


test('Groq diagnostics distinguish invalid JSON, rate limit, and authentication failures', () => {
  const {
    classifyGroqError,
  } = require('./groqService');

  const invalidJson =
    new Error(
      'Groq did not return valid JSON.'
    );
  invalidJson.groqErrorType =
    'invalid_json';

  assert.strictEqual(
    classifyGroqError(
      invalidJson
    ).status,
    'invalid_json'
  );

  const rateLimit =
    new Error(
      'Rate limit reached for model.'
    );
  rateLimit.httpStatus =
    429;
  rateLimit.groqCode =
    'rate_limit_exceeded';

  const rateDiagnostic =
    classifyGroqError(
      rateLimit
    );

  assert.strictEqual(
    rateDiagnostic.status,
    'rate_limited'
  );
  assert.strictEqual(
    rateDiagnostic.httpStatus,
    429
  );
  assert.strictEqual(
    rateDiagnostic.code,
    'rate_limit_exceeded'
  );

  const auth =
    new Error(
      'Invalid API key'
    );
  auth.httpStatus =
    401;

  assert.strictEqual(
    classifyGroqError(
      auth
    ).status,
    'authentication_error'
  );
});

test('Groq diagnostics identify missing key, timeout, network, and server failures', () => {
  const {
    classifyGroqError,
  } = require('./groqService');

  assert.strictEqual(
    classifyGroqError(
      new Error(
        'GROQ_API_KEY is missing from the backend environment.'
      )
    ).status,
    'missing_api_key'
  );

  assert.strictEqual(
    classifyGroqError(
      new Error(
        'Request timed out'
      )
    ).status,
    'timeout'
  );

  assert.strictEqual(
    classifyGroqError(
      new Error(
        'fetch failed: network connection reset'
      )
    ).status,
    'network_error'
  );

  const server =
    new Error(
      'Groq unavailable'
    );
  server.httpStatus =
    503;

  assert.strictEqual(
    classifyGroqError(
      server
    ).status,
    'server_error'
  );
});


test('distinct multi-value cells normalize to individual semantic values in local direct path', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'function splitDistinctCellValues'
    )
  );

  assert(
    source.includes(
      'wantsDistinctValues'
    )
  );

  assert(
    source.includes(
      'multiValueNormalized'
    )
  );
});

test('distinct cell splitter is generic for categorical comma lists and preserves long name-like values', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  const helperStart =
    source.indexOf(
      'function splitDistinctCellValues'
    );

  const helperEnd =
    source.indexOf(
      'function normalizeDirectSingleFieldResult',
      helperStart
    );

  assert(
    helperStart >= 0 &&
    helperEnd > helperStart
  );

  const helperSource =
    source.slice(
      helperStart,
      helperEnd
    );

  const makeHelper =
    new Function(
      `${helperSource}; return splitDistinctCellValues;`
    );

  const splitDistinctCellValues =
    makeHelper();

  assert.deepStrictEqual(
    splitDistinctCellValues(
      'rice, corn, vegetables'
    ),
    [
      'rice',
      'corn',
      'vegetables',
    ]
  );

  assert.deepStrictEqual(
    splitDistinctCellValues(
      'Typhoon, Flood, Drought'
    ),
    [
      'Typhoon',
      'Flood',
      'Drought',
    ]
  );

  assert.deepStrictEqual(
    splitDistinctCellValues(
      'A very long organization name with many descriptive words, another very long descriptive organization value'
    ),
    [
      'A very long organization name with many descriptive words, another very long descriptive organization value',
    ]
  );
});


test('Groq invalid JSON is eligible for one JSON repair retry only', () => {
  const {
    shouldRetryGroqJsonError,
  } = require('./groqService');

  const invalid =
    new Error(
      'Groq returned malformed JSON.'
    );
  invalid.groqErrorType =
    'invalid_json';

  assert.strictEqual(
    shouldRetryGroqJsonError(
      invalid
    ),
    true
  );

  const rateLimited =
    new Error(
      'Rate limit reached'
    );
  rateLimited.httpStatus =
    429;

  assert.strictEqual(
    shouldRetryGroqJsonError(
      rateLimited
    ),
    false
  );
});

test('Groq JSON repair prompt preserves planner context and demands JSON only', () => {
  const {
    buildGroqJsonRepairMessages,
  } = require('./groqService');

  const messages =
    buildGroqJsonRepairMessages({
      originalSystemPrompt:
        'SYSTEM CONTRACT',
      originalUserPrompt:
        'QUESTION: test',
      invalidResponse:
        'Here is your answer: {bad json}',
    });

  assert.strictEqual(
    messages.length,
    2
  );

  assert(
    messages[0].content.includes(
      'SYSTEM CONTRACT'
    )
  );

  assert(
    messages[0].content.includes(
      'exactly ONE syntactically valid JSON object only'
    )
  );

  assert(
    messages[1].content.includes(
      'QUESTION: test'
    )
  );

  assert(
    messages[1].content.includes(
      '{bad json}'
    )
  );
});


test('Groq-first primary planner is placed before deterministic direct-field routes', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  const groqFirst =
    source.indexOf(
      'V7.36.5 — GROQ-FIRST PRIMARY PLANNER'
    );

  const directField =
    source.indexOf(
      'DIRECT FILTERED FIELD LOOKUP — PLANNER INDEPENDENT'
    );

  assert(
    groqFirst >= 0
  );

  assert(
    directField > groqFirst
  );

  assert(
    source.includes(
      'GROQ_PRIMARY_THRESHOLD'
    )
  );

  assert(
    source.includes(
      '"low_confidence"'
    )
  );
});

test('Groq-first handoff cross-checks explicit fields, filters, and referential labels', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'explicit-field-mismatch'
    )
  );

  assert(
    source.includes(
      'scope-filter-mismatch'
    )
  );

  assert(
    source.includes(
      'referential-label-missing-or-mismatched'
    )
  );

  assert(
    source.includes(
      'groqPlanConfidence'
    )
  );

  assert(
    source.includes(
      'groqConfidenceIssues'
    )
  );
});

test('Groq-first low-confidence handoff avoids a second normal Groq retry before local', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'Groq already ran before deterministic/local semantic planning.'
    )
  );

  assert(
    /false\s*&&\s*!groqPlan\s*&&/.test(
      source
    )
  );
});


test('V7.36.5b production response generator matches the actual uploaded V7.36.2 response policy', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'responseGenerator.js'
      ),
      'utf8'
    );

  assert(
    !source.includes(
      'require("./responseStyleRouter")'
    )
  );

  assert(
    source.includes(
      'optional Groq language polish'
    )
  );

  assert(
    source.includes(
      'a paired/relationship lookup'
    )
  );
});

test('V7.36.5b keeps paired relationship answers deterministic like actual V7.36.2', () => {
  const {
    shouldPreserveDeterministicSemanticAnswer,
  } = require('./responseGenerator');

  assert.strictEqual(
    shouldPreserveDeterministicSemanticAnswer({
      plan: {
        operation: 'lookup',
        column: 'Commodities',
        labelColumn: 'Amia Villages',
      },
      result: {
        success: true,
        operation: 'lookup',
        column: 'Commodities',
        labelColumn: 'Amia Villages',
        results: [
          {
            'Amia Villages': 'Sison',
            Commodities: 'rice, corn, vegetables',
          },
        ],
      },
      semanticAnswer:
        'They produce rice, corn, and vegetables. Sison produces rice, corn, and vegetables.',
    }),
    true
  );
});

test('V7.36.5b keeps Groq-first routing ahead of deterministic direct-field handlers', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  const groqFirst =
    source.indexOf(
      'V7.36.5 — GROQ-FIRST PRIMARY PLANNER'
    );

  const directField =
    source.indexOf(
      'DIRECT FILTERED FIELD LOOKUP — PLANNER INDEPENDENT'
    );

  assert(
    groqFirst >= 0 &&
    directField > groqFirst
  );

  assert(
    source.includes(
      'GROQ_PRIMARY_THRESHOLD'
    )
  );

  assert(
    source.includes(
      'referential-label-missing-or-mismatched'
    )
  );
});


test('local referential fallback preserves current requested field and previous verified pair column', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    /const valueColumn\s*=\s*findLiveColumn\(\s*plan\.column\s*\)/m.test(
      source
    )
  );

  assert(
    source.includes(
      'Upgrade to a relationship lookup only when a distinct verified pair'
    )
  );

  assert(
    /labelColumn\s*:\s*pairColumn/m.test(
      source
    )
  );
});

test('conversation-family responses expose Groq handoff diagnostics', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'const buildGroqHandoffDiagnostics'
    )
  );

  assert(
    /plannerSource\s*:\s*"conversation-local"\s*,\s*\.\.\.buildGroqHandoffDiagnostics\(\)/m.test(
      source
    )
  );

  assert(
    /plannerSource\s*:\s*"conversation"\s*,\s*\.\.\.buildGroqHandoffDiagnostics\(\)/m.test(
      source
    )
  );
});

test('Groq failure on referential follow-up can recover a paired local lookup', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'localReferentialRecovery'
    )
  );

  assert(
    /operation\s*:\s*"lookup"/m.test(
      source
    )
  );

  assert(
    /conversationalPairColumn\s*:\s*pairColumn/m.test(
      source
    )
  );
});


test('Groq confidence rejects referential list plans that drop a verified prior pair column', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'referential-label-dropped-from-verified-context'
    )
  );

  assert(
    source.includes(
      'priorPairCandidates'
    )
  );

  assert(
    source.includes(
      'verifiedPriorPair'
    )
  );

  assert(
    source.includes(
      'liveColumns.has'
    )
  );
});

test('Groq referential relationship guard compares prior pair against the current output column', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    /normalized\s*!==\s*normalizeText\(\s*plan\.column\s*\)/m.test(
      source
    )
  );
});


test('Groq planner prompt preserves verified relationship labels on referential follow-ups', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'groqService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'preserve the previously VERIFIED'
    )
  );

  assert(
    source.includes(
      'keep that relationship column'
    )
  );

  assert(
    source.includes(
      'Do not reduce a verified relationship lookup into a plain list'
    )
  );

  assert(
    source.includes(
      'Current explicit field/entity wording overrides old context'
    )
  );
});

test('Groq referential prompt strengthening is generic and contains no AMIA-specific production rule', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'groqService.js'
      ),
      'utf8'
    );

  const start =
    source.indexOf(
      'For referential follow-ups using wording'
    );

  const end =
    source.indexOf(
      '14. If genuinely ambiguous',
      start
    );

  assert(
    start >= 0 &&
    end > start
  );

  const policy =
    source.slice(
      start,
      end
    );

  assert(
    !/Amia Villages|Climate-related Risks\/Hazards|Commodities|Pangasinan/.test(
      policy
    )
  );
});


test('Groq correct-but-incomplete referential plans are repaired before confidence rejection', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  const repairCall =
    source.indexOf(
      'const groqRepair ='
    );

  const confidenceCall =
    source.indexOf(
      'const confidence =',
      repairCall
    );

  assert(
    repairCall >= 0 &&
    confidenceCall > repairCall
  );

  assert(
    source.includes(
      'verified-referential-label-restored'
    )
  );

  assert(
    source.includes(
      '"groq-repaired"'
    )
  );

  assert(
    source.includes(
      'groqPlanRepaired:'
    )
  );
});

test('Groq referential repair refuses to graft stale context across a changed scope', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'Current explicit scope must win'
    )
  );

  assert(
    source.includes(
      '!sameSimpleFilters('
    )
  );
});

test('Groq referential repair only restores live schema pair columns', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'const priorPairCandidates = ['
    )
  );

  assert(
    source.includes(
      'findLiveColumn('
    )
  );

  assert(
    source.includes(
      'conversationalPairColumn:'
    )
  );
});


test('successful Groq list path shares central distinct multi-value normalization', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  const parityIndex =
    source.indexOf(
      'V7.36.5g — DISTINCT MULTI-VALUE PARITY'
    );

  const validationIndex =
    source.lastIndexOf(
      'resultValidation.result',
      parityIndex
    );

  const saveIndex =
    source.indexOf(
      'SAVE VERIFIED CONVERSATION STATE',
      parityIndex
    );

  assert(
    validationIndex >= 0 &&
    parityIndex > validationIndex &&
    saveIndex > parityIndex
  );

  assert(
    source.slice(
      parityIndex,
      saveIndex
    ).includes(
      'normalizeDirectSingleFieldResult({'
    )
  );
});

test('number-of numeric metric resolver outranks generic unit-number interpretation', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'function resolveExplicitNumericMetricPlan'
    )
  );

  assert(
    source.includes(
      'explicit-live-numeric-metric-restored'
    )
  );

  assert(
    source.includes(
      'prevents "number" in "number of X"'
    )
  );

  assert(
    source.includes(
      'explicitNumericMetricResolved'
    )
  );
});

test('Groq numeric metric repair runs before Groq confidence evaluation', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  const metricRepair =
    source.indexOf(
      'const numericMetricRepair ='
    );

  const confidence =
    source.indexOf(
      'const confidence =',
      metricRepair
    );

  assert(
    metricRepair >= 0 &&
    confidence > metricRepair
  );
});

test('numeric metric repair is also applied centrally for local and conversation parity', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  const executeStart =
    source.indexOf(
      'const executeResolvedPlan ='
    );

  const parityRepair =
    source.indexOf(
      'const explicitNumericMetricRepair =',
      executeStart
    );

  assert(
    executeStart >= 0 &&
    parityRepair > executeStart
  );
});

test('numeric metric field normalization generically equates number-of and No.-of style schema names', () => {
  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        'chatbotService.js'
      ),
      'utf8'
    );

  assert(
    source.includes(
      'function normalizeLooseMetricPhrase'
    )
  );

  assert(
    source.includes(
      '(?:no|num|number|count)'
    )
  );
});


// ============================================================
// V7.36.5m — COMPOUND GROUNDING + REFERENTIAL SCOPE SAFETY
// ============================================================

test('categorical phrase containing a number does not create an overlapping unrelated numeric filter', () => {
  const { inferValueFilters } = require('./filterEngine');

  const rows = [
    { Phase: 'Phase 2', Province: 'Pangasinan', 'CRAO-MIS Balance': '3' },
    { Phase: 'Phase 3', Province: 'Pangasinan', 'CRAO-MIS Balance': '-4' },
    { Phase: 'Phase 3', Province: 'La Union', 'CRAO-MIS Balance': '7' },
  ];

  const filters = inferValueFilters(
    rows,
    'How many Phase 3 associations are in Pangasinan?'
  );

  assert.ok(filters.some((filter) =>
    filter.column === 'Phase' &&
    filter.value === 'Phase 3'
  ));

  assert.ok(filters.some((filter) =>
    filter.column === 'Province' &&
    filter.value === 'Pangasinan'
  ));

  assert.equal(
    filters.some((filter) =>
      filter.column === 'CRAO-MIS Balance' &&
      String(filter.value) === '3'
    ),
    false
  );
});

test('independent numeric occurrence survives categorical phrase overlap suppression', () => {
  const { inferValueFilters } = require('./filterEngine');

  const rows = [
    { Phase: 'Phase 3', Balance: '3' },
    { Phase: 'Phase 2', Balance: '7' },
  ];

  const filters = inferValueFilters(
    rows,
    'Show Phase 3 with Balance 3'
  );

  assert.ok(filters.some((filter) =>
    filter.column === 'Phase' &&
    filter.value === 'Phase 3'
  ));

  assert.ok(filters.some((filter) =>
    filter.column === 'Balance' &&
    String(filter.value) === '3'
  ));
});

test('referential metric follow-up does not clear verified scope as a fresh analytical question', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'chatbotService.js'),
    'utf8'
  );

  assert.match(
    source,
    /startsFreshAnalyticalScope\s*&&\s*!looksLikeContinuousFollowUp\(\s*cleanQuestion\s*\)/s
  );
});



// ============================================================
// V7.36.5o — CONTINUOUS COMPOUND Q&A
// ============================================================

test('compound context is persisted to the real session for later follow-ups', () => {
  const sessionId = 'v7365o-compound-memory';
  clearConversation(sessionId);

  saveCompoundContext(sessionId, {
    question: 'How many Phase 3 associations are in Pangasinan, and what is their total land area?',
    clauses: [
      {
        question: 'How many Phase 3 associations are in Pangasinan',
        plan: {
          route: 'dataset',
          dataset: 'Main',
          operation: 'row_count',
          filters: [
            { column: 'Phase', operator: 'equals', value: 'Phase 3' },
            { column: 'Province', operator: 'equals', value: 'Pangasinan' },
          ],
        },
        result: { success: true, operation: 'row_count', value: 2 },
      },
      {
        question: 'what is their total land area?',
        plan: {
          route: 'dataset',
          dataset: 'Main',
          operation: 'sum',
          column: 'Total Land Area (ha)',
          filters: [
            { column: 'Phase', operator: 'equals', value: 'Phase 3' },
            { column: 'Province', operator: 'equals', value: 'Pangasinan' },
          ],
        },
        result: { success: true, operation: 'sum', value: 182.78 },
      },
    ],
  });

  const context = getRelevantContext(sessionId, 'what about phase 2?');
  assert.equal(context.isFollowUp, true);
  assert.ok(context.compoundContext);
  assert.equal(context.compoundContext.clauses.length, 2);
  assert.equal(context.compoundContext.clauses[0].plan.operation, 'row_count');
  assert.equal(context.compoundContext.clauses[1].plan.operation, 'sum');
  assert.equal(context.compoundContext.clauses[1].plan.column, 'Total Land Area (ha)');
});

test('continuous compound follow-up preserves unrelated filters and replaces only the mentioned column', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'chatbotService.js'),
    'utf8'
  );

  assert.match(source, /conversationalCompoundContinuation/);
  assert.match(
    source,
    /!replacementColumns\.has\(filter\.column\)/
  );
  assert.match(
    source,
    /previousCompoundContext\.clauses\.length > 1/
  );
});

test('explicit operation change does not force compound operation inheritance', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'chatbotService.js'),
    'utf8'
  );

  assert.match(source, /const explicitlyChangesOperation\s*=/);
  assert.match(source, /!explicitlyChangesOperation\s*&&\s*previousCompoundContext/);
});


test('real answerQuestion continues prior compound intent before Groq can collapse the follow-up', async () => {
  const sessionId = 'v7365p-real-compound-followup';
  clearConversation(sessionId);

  const datasets = {
    Main: [
      { Phase: 'Phase 3', Province: 'Pangasinan', Association: 'A', 'Total Land Area (ha)': 100 },
      { Phase: 'Phase 3', Province: 'Pangasinan', Association: 'B', 'Total Land Area (ha)': 82.78 },
      { Phase: 'Phase 2', Province: 'Pangasinan', Association: 'C', 'Total Land Area (ha)': 50 },
      { Phase: 'Phase 2', Province: 'Pangasinan', Association: 'D', 'Total Land Area (ha)': 70 },
      { Phase: 'Phase 2', Province: 'La Union', Association: 'E', 'Total Land Area (ha)': 500 },
    ],
  };

  saveCompoundContext(sessionId, {
    question: 'How many Phase 3 associations are in Pangasinan, and what is their total land area?',
    clauses: [
      {
        question: 'How many Phase 3 associations are in Pangasinan',
        plan: {
          route: 'dataset',
          dataset: 'Main',
          operation: 'row_count',
          filters: [
            { column: 'Phase', operator: 'equals', value: 'Phase 3' },
            { column: 'Province', operator: 'equals', value: 'Pangasinan' },
          ],
          selectColumns: [],
        },
        result: { success: true, source: 'dataset', dataset: 'Main', operation: 'row_count', value: 2 },
      },
      {
        question: 'what is their total land area?',
        plan: {
          route: 'dataset',
          dataset: 'Main',
          operation: 'sum',
          column: 'Total Land Area (ha)',
          filters: [
            { column: 'Phase', operator: 'equals', value: 'Phase 3' },
            { column: 'Province', operator: 'equals', value: 'Pangasinan' },
          ],
          selectColumns: [],
        },
        result: { success: true, source: 'dataset', dataset: 'Main', operation: 'sum', value: 182.78 },
      },
    ],
  });

  const result = await answerQuestion(datasets, 'what about phase 2?', sessionId);

  assert.equal(result.operation, 'compound');
  assert.equal(result.plannerSource, 'conversation-compound');
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].operation, 'row_count');
  assert.equal(result.results[0].value, 2);
  assert.equal(result.results[1].operation, 'sum');
  assert.equal(result.results[1].value, 120);

  for (const item of result.results) {
    const filters = item.debugPlan.filters;
    assert.ok(filters.some((f) => f.column === 'Phase' && f.value === 'Phase 2'));
    assert.ok(filters.some((f) => f.column === 'Province' && f.value === 'Pangasinan'));
  }
});


// ============================================================
// V7.36.5q — SYSTEMIC COMPLEX-QUESTION CLASSIFICATION
// ============================================================

test('dependent detail enrichment stays one request instead of being split', () => {
  const { decomposeComplexQuestion } = require('./complexQuestionParityEngine');
  const result = decomposeComplexQuestion(
    'Which association has the highest number of members, and what province and barangay is it located in?'
  );

  assert.equal(result.isComplex, false);
  assert.equal(result.clauses.length, 1);
});

test('dependent analytical calculation still splits as a compound request', () => {
  const { decomposeComplexQuestion } = require('./complexQuestionParityEngine');
  const result = decomposeComplexQuestion(
    'List the associations in La Union that produce sugar cane, and tell me the total number of members among them.'
  );

  assert.equal(result.isComplex, true);
  assert.equal(result.clauses.length, 2);
  assert.deepEqual(result.dependentClauseIndexes, [1]);
});


test('ranked entity plus referential detail fields executes as one row-aware request', async () => {
  const { answerQuestion } = require('./chatbotService');
  const { clearConversation } = require('./conversationManager');

  const sessionId = `rank-detail-${Date.now()}`;
  clearConversation(sessionId);

  const datasets = {
    Main: [
      { Association: 'A', Province: 'North', Barangay: 'One', 'No. of members': 50 },
      { Association: 'B', Province: 'South', Barangay: 'Two', 'No. of members': 100 },
      { Association: 'C', Province: 'East', Barangay: 'Three', 'No. of members': 80 },
    ],
  };

  const result = await answerQuestion(
    datasets,
    'Which association has the highest number of members, and what province and barangay is it located in?',
    sessionId
  );

  assert.equal(result.success, true);
  assert.equal(result.operation, 'rank_rows');
  assert.equal(result.column, 'No. of members');
  assert.equal(result.labelColumn, 'Association');
  assert.equal(result.results[0].label, 'B');
  assert.equal(result.results[0].row.Province, 'South');
  assert.equal(result.results[0].row.Barangay, 'Two');
  assert.ok((result.debugPlan.selectColumns || []).includes('Province'));
  assert.ok((result.debugPlan.selectColumns || []).includes('Barangay'));
});

test('continuous compound follow-up preserves explicit token from multi-value field instead of whole prior cell', async () => {
  const { answerQuestion } = require('./chatbotService');
  const { saveCompoundContext, clearConversation } = require('./conversationManager');

  const sessionId = `complex-token-${Date.now()}`;
  clearConversation(sessionId);

  const datasets = {
    Main: [
      { Province: 'La Union', Association: 'LU Sugar', Commodities: 'rice, sugar cane, high value crops', 'No. of members': 82 },
      { Province: 'Pangasinan', Association: 'Pang Sugar', Commodities: 'rice, vegetables, sugar cane', 'No. of members': 65 },
      { Province: 'Pangasinan', Association: 'Pang Rice', Commodities: 'rice, vegetables', 'No. of members': 100 },
    ],
  };

  saveCompoundContext(sessionId, {
    question: 'List the associations in La Union that produce sugar cane, and tell me the total number of members among them.',
    clauses: [
      {
        question: 'List the associations in La Union that produce sugar cane',
        plan: {
          route: 'dataset',
          dataset: 'Main',
          operation: 'list',
          column: 'Association',
          labelColumn: 'Association',
          filters: [
            { column: 'Commodities', operator: 'equals', value: 'rice, sugar cane, high value crops' },
            { column: 'Province', operator: 'equals', value: 'La Union' },
          ],
          selectColumns: ['Association'],
          showAll: true,
        },
        result: { success: true, source: 'dataset', dataset: 'Main', operation: 'list', results: ['LU Sugar'] },
      },
      {
        question: 'tell me the total number of members among them',
        plan: {
          route: 'dataset',
          dataset: 'Main',
          operation: 'sum',
          column: 'No. of members',
          filters: [
            { column: 'Commodities', operator: 'equals', value: 'rice, sugar cane, high value crops' },
            { column: 'Province', operator: 'equals', value: 'La Union' },
          ],
          selectColumns: ['No. of members'],
        },
        result: { success: true, source: 'dataset', dataset: 'Main', operation: 'sum', value: 82 },
      },
    ],
  });

  const result = await answerQuestion(datasets, 'what about pangasinan?', sessionId);

  assert.equal(result.operation, 'compound');
  assert.equal(result.results.length, 2);
  assert.match(result.results[0].answer || '', /Pang Sugar/i);
  assert.equal(result.results[1].value, 65);

  for (const item of result.results) {
    const filters = item.debugPlan.filters || [];
    assert.ok(filters.some((f) => f.column === 'Province' && f.value === 'Pangasinan'));
    assert.ok(filters.some((f) => f.column === 'Commodities' && /sugar cane/i.test(String(f.value))));
  }
});


test('multi-value token matching tolerates spacing variants such as sugar cane and sugarcane', () => {
  const { valueMatchesToken } = require('./valueNormalizer');

  assert.equal(
    valueMatchesToken('rice, vegetables, sugarcane', 'sugar cane'),
    true
  );

  assert.equal(
    valueMatchesToken('rice, vegetables, sugar cane', 'sugarcane'),
    true
  );
});

test('continuous compound follow-up survives live multi-value spelling variants across scopes', async () => {
  const { answerQuestion } = require('./chatbotService');
  const { saveCompoundContext, clearConversation } = require('./conversationManager');

  const sessionId = `complex-token-spacing-${Date.now()}`;
  clearConversation(sessionId);

  const datasets = {
    Main: [
      { Province: 'La Union', Association: 'LU Sugar', Commodities: 'rice, sugar cane, high value crops', 'No. of members': 82 },
      { Province: 'Pangasinan', Association: 'Pang Sugar', Commodities: 'rice, vegetables, sugarcane', 'No. of members': 65 },
      { Province: 'Pangasinan', Association: 'Pang Rice', Commodities: 'rice, vegetables', 'No. of members': 100 },
    ],
  };

  saveCompoundContext(sessionId, {
    question: 'List the associations in La Union that produce sugar cane, and tell me the total number of members among them.',
    clauses: [
      {
        question: 'List the associations in La Union that produce sugar cane',
        plan: {
          route: 'dataset',
          dataset: 'Main',
          operation: 'list',
          column: 'Association',
          labelColumn: 'Association',
          filters: [
            { column: 'Commodities', operator: 'equals', value: 'sugar cane' },
            { column: 'Province', operator: 'equals', value: 'La Union' },
          ],
          selectColumns: ['Association'],
          showAll: true,
        },
        result: { success: true, source: 'dataset', dataset: 'Main', operation: 'list', results: ['LU Sugar'] },
      },
      {
        question: 'tell me the total number of members among them',
        plan: {
          route: 'dataset',
          dataset: 'Main',
          operation: 'sum',
          column: 'No. of members',
          filters: [
            { column: 'Commodities', operator: 'equals', value: 'sugar cane' },
            { column: 'Province', operator: 'equals', value: 'La Union' },
          ],
          selectColumns: ['No. of members'],
        },
        result: { success: true, source: 'dataset', dataset: 'Main', operation: 'sum', value: 82 },
      },
    ],
  });

  const result = await answerQuestion(datasets, 'what about pangasinan?', sessionId);

  assert.equal(result.operation, 'compound');
  assert.equal(result.success, true);
  assert.match(result.results[0].answer || '', /Pang Sugar/i);
  assert.equal(result.results[1].value, 65);
});


// ============================================================
// PROBLEM #1 — COMPLEX QUESTION ARCHITECTURE REGRESSIONS
// ============================================================

test('same-column multi-value scope becomes IN instead of impossible AND', async () => {
  const input = {
    Main: [
      { Province: 'Pangasinan', Association: 'P1' },
      { Province: 'La Union', Association: 'L1' },
      { Province: 'Ilocos Sur', Association: 'I1' },
    ],
  };

  const result = await answerQuestion(
    input,
    'Show the associations in Pangasinan and La Union.',
    `same-column-in-${Date.now()}`
  );

  assert.equal(result.success, true);
  assert.equal(result.operation, 'list');
  assert.deepEqual(new Set(result.results), new Set(['P1', 'L1']));
  assert.equal(result.debugPlan?.filters?.length, 1);
  assert.equal(result.debugPlan?.filters?.[0]?.operator, 'in');
  assert.deepEqual(new Set(result.debugPlan?.filters?.[0]?.value), new Set(['Pangasinan', 'La Union']));
});

test('compound category scope carries into grouped for-each aggregate', async () => {
  const input = {
    Main: [
      { Province: 'Pangasinan', Association: 'P1', 'No. of members': 100 },
      { Province: 'Pangasinan', Association: 'P2', 'No. of members': 60 },
      { Province: 'La Union', Association: 'L1', 'No. of members': 80 },
      { Province: 'La Union', Association: 'L2', 'No. of members': 40 },
      { Province: 'Ilocos Sur', Association: 'I1', 'No. of members': 200 },
    ],
  };

  const result = await answerQuestion(
    input,
    'How many associations are in Pangasinan and La Union, and what is the average number of members for each province?',
    `grouped-scope-${Date.now()}`
  );

  assert.equal(result.success, true);
  assert.equal(result.operation, 'compound');
  const second = result.results?.[1];
  assert.equal(second?.operation, 'group_average');
  assert.equal(second?.debugPlan?.groupBy, 'Province');
  const provinceFilter = second?.debugPlan?.filters?.find((filter) => filter.column === 'Province');
  assert.equal(provinceFilter?.operator, 'in');
  assert.deepEqual(new Set(provinceFilter?.value), new Set(['Pangasinan', 'La Union']));
  assert.match(second?.answer || '', /Pangasinan/i);
  assert.match(second?.answer || '', /La Union/i);
});

test('ranking with dependent detail fields returns the ranked entity and requested fields', async () => {
  const input = {
    Main: [
      { Province: 'Pangasinan', Barangay: 'A', Association: 'P1', 'No. of members': 100 },
      { Province: 'Ilocos Sur', Barangay: 'B', Association: 'I1', 'No. of members': 200 },
    ],
  };

  const result = await answerQuestion(
    input,
    'Which association has the highest number of members, and what province and barangay is it located in?',
    `rank-detail-${Date.now()}`
  );

  assert.equal(result.success, true);
  assert.equal(result.operation, 'rank_rows');
  assert.equal(result.results?.[0]?.label, 'I1');
  assert.equal(result.results?.[0]?.value, 200);
  assert.equal(result.results?.[0]?.row?.Province, 'Ilocos Sur');
  assert.equal(result.results?.[0]?.row?.Barangay, 'B');
  assert.match(result.answer || '', /Ilocos Sur/i);
  assert.match(result.answer || '', /Barangay:\s*B/i);
});

test('referential compound ranking preserves the identity column from the listed set', async () => {
  const input = {
    Main: [
      { Association: 'A1', Province: 'P1', 'Climate-related Risks/Hazards': 'Drought', 'Total Land Area (ha)': 20 },
      { Association: 'A2', Province: 'P2', 'Climate-related Risks/Hazards': 'Drought', 'Total Land Area (ha)': 30 },
      { Association: 'A3', Province: 'P3', 'Climate-related Risks/Hazards': 'Flood', 'Total Land Area (ha)': 100 },
    ],
  };

  const result = await answerQuestion(
    input,
    'List the associations exposed to drought, then tell me which one has the largest total land area.',
    `referential-rank-${Date.now()}`
  );

  assert.equal(result.success, true);
  const second = result.results?.[1];
  assert.equal(second?.debugPlan?.labelColumn, 'Association');
  assert.equal(second?.debugPlan?.groupBy, 'Association');
  assert.match(second?.answer || '', /A2/i);
  assert.doesNotMatch(second?.answer || '', /P2 has the highest/i);
});

test('how-many categorical target is counted rather than summed as a text metric', async () => {
  const input = {
    Main: [
      { Association: 'A1', Registration: 'DOLE', 'Land Area': 10 },
      { Association: 'A2', Registration: 'DOLE', 'Land Area': 20 },
      { Association: 'A3', Registration: 'SEC', 'Land Area': 30 },
    ],
  };

  const result = await answerQuestion(
    input,
    'How many associations are registered under DOLE?',
    `categorical-count-${Date.now()}`
  );

  assert.equal(result.success, true);
  assert.equal(result.operation, 'row_count');
  assert.equal(result.value, 2);
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

// ============================================================
// V7.36.5l — COMPLEX QUESTION PARITY
// ============================================================

test('complex question parity splits independent analytical requests joined by and', () => {
  const { decomposeComplexQuestion } = require('./complexQuestionParityEngine');
  const result = decomposeComplexQuestion(
    'How many associations are in Pangasinan and what is their average assistance amount?'
  );
  assert.equal(result.isComplex, true);
  assert.equal(result.clauses.length, 2);
  assert.match(result.clauses[0], /How many associations/i);
  assert.match(result.clauses[1], /what is their average/i);
  assert.deepEqual(result.dependentClauseIndexes, [1]);
});

test('complex question parity splits operation-first second calculation', () => {
  const { decomposeComplexQuestion } = require('./complexQuestionParityEngine');
  const result = decomposeComplexQuestion(
    'What is the total Amount in Region 1 and average Quantity?'
  );
  assert.equal(result.isComplex, true);
  assert.deepEqual(result.clauses, [
    'What is the total Amount in Region 1',
    'average Quantity',
  ]);
});

test('complex question parity preserves ordinary AND filters', () => {
  const { decomposeComplexQuestion } = require('./complexQuestionParityEngine');
  const result = decomposeComplexQuestion(
    'Which associations are in Pangasinan and La Union?'
  );
  assert.equal(result.isComplex, false);
  assert.equal(result.clauses.length, 1);
});

test('complex question parity preserves linked multi-field wording', () => {
  const { decomposeComplexQuestion } = require('./complexQuestionParityEngine');
  const result = decomposeComplexQuestion(
    'Show the Association and Municipality for Pangasinan'
  );
  assert.equal(result.isComplex, false);
  assert.equal(result.clauses.length, 1);
});

test('complex question parity splits semicolon-separated analytical requests', () => {
  const { decomposeComplexQuestion } = require('./complexQuestionParityEngine');
  const result = decomposeComplexQuestion(
    'Count the records in North; calculate the maximum Amount in South'
  );
  assert.equal(result.isComplex, true);
  assert.equal(result.clauses.length, 2);
});


test('compound execution uses one isolated shared context for dependent clauses', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'chatbotService.js'),
    'utf8'
  );

  assert.match(
    source,
    /const compoundSessionId\s*=\s*`\$\{sessionId\}::compound::\$\{Date\.now\(\)\}`/
  );

  assert.doesNotMatch(
    source,
    /::compound::\$\{Date\.now\(\)\}::\$\{index\}/
  );
});


// ============================================================
// V7.36.5n — MULTI-VALUE FILTER + REFERENTIAL METRIC GROUNDING
// ============================================================

test('live token inside a delimited multi-value cell becomes a grounded filter', () => {
  const { inferValueFilters } = require('./filterEngine');

  const rows = [
    {
      Province: 'La Union',
      Association: 'A',
      Commodities: 'rice, sugar cane, high value crops',
      Enterprises: 'Sugar Cane Vinegar Production',
    },
    {
      Province: 'La Union',
      Association: 'B',
      Commodities: 'rice, vegetables',
      Enterprises: 'Sugar Cane Vinegar Production',
    },
  ];

  const filters = inferValueFilters(
    rows,
    'List the associations in La Union that produce sugar cane'
  );

  assert.ok(filters.some((filter) =>
    filter.column === 'Province' &&
    filter.value === 'La Union'
  ));

  assert.ok(filters.some((filter) =>
    filter.column === 'Commodities' &&
    String(filter.value).trim().toLowerCase() === 'sugar cane'
  ));
});

test('referential tail is removed from explicit metric grounding phrase', () => {
  const {
    extractExplicitGroundingPhrases,
  } = require('./universalGroundingEngine');

  const phrases = extractExplicitGroundingPhrases(
    'tell me the total number of members among them'
  );

  assert.ok(
    phrases.some((phrase) =>
      /members$/i.test(phrase)
    )
  );

  assert.equal(
    phrases.some((phrase) =>
      /among them/i.test(phrase)
    ),
    false
  );
});

test('number of members among them grounds to No. of members column', () => {
  const {
    enforceUniversalGrounding,
  } = require('./universalGroundingEngine');

  const rows = [
    { Association: 'A', 'No. of members': 10 },
    { Association: 'B', 'No. of members': 20 },
  ];

  const result = enforceUniversalGrounding({
    plan: {
      route: 'dataset',
      dataset: 'Sheet1',
      operation: 'sum',
      column: 'No. of members',
      filters: [],
    },
    question: 'tell me the total number of members among them',
    rows,
    columns: ['Association', 'No. of members'],
  });

  assert.equal(result.valid, true);
  assert.equal(result.plan.route, 'dataset');
});

// ============================================================
// V7.36.5o — SHARED COMPOUND-SCOPE PARITY
// ============================================================

test('dependent compound clause inherits every missing verified scope filter generically', () => {
  const {
    getMissingInheritedFilters,
  } = require('./compoundContextParityEngine');

  const missing = getMissingInheritedFilters({
    previousPlan: {
      route: 'dataset',
      dataset: 'Sales',
      filters: [
        { column: 'Region', operator: 'equals', value: 'North' },
        { column: 'Product', operator: 'equals', value: 'Rice' },
      ],
    },
    currentPlan: {
      route: 'dataset',
      dataset: 'Sales',
      operation: 'sum',
      column: 'Quantity',
      filters: [
        { column: 'Product', operator: 'equals', value: 'Rice' },
      ],
    },
    question: 'what is their total quantity?',
  });

  assert.deepEqual(missing, [
    { column: 'Region', operator: 'equals', value: 'North' },
  ]);
});

test('compound parity question is planner-source agnostic for Groq and local plans', () => {
  const {
    buildCompoundParityQuestion,
  } = require('./compoundContextParityEngine');

  const previousPlan = {
    route: 'dataset',
    dataset: 'Inventory',
    filters: [
      { column: 'Category', operator: 'equals', value: 'Seed' },
      { column: 'Office', operator: 'equals', value: 'Field Unit A' },
    ],
  };

  for (const plannerSource of ['groq', 'local-fallback']) {
    const question = buildCompoundParityQuestion({
      question: 'tell me the total amount among them',
      previousPlan,
      currentPlan: {
        route: 'dataset',
        dataset: 'Inventory',
        operation: 'sum',
        column: 'Amount',
        filters: [
          { column: 'Category', operator: 'equals', value: 'Seed' },
        ],
        plannerSource,
      },
    });

    assert.match(question, /Office:\s*Field Unit A/i);
    assert.doesNotMatch(question, /plannerSource/i);
  }
});

test('real compound answer keeps the full first-clause scope for among-them aggregation', async () => {
  const { answerQuestion } = require('./chatbotService');

  const input = {
    Main: [
      {
        Province: 'La Union',
        Association: 'LU Sugar',
        Commodities: 'rice, sugar cane, high value crops',
        'No. of members': 82,
      },
      {
        Province: 'Pangasinan',
        Association: 'Pang Sugar',
        Commodities: 'rice, vegetables, sugarcane',
        'No. of members': 65,
      },
      {
        Province: 'Ilocos Sur',
        Association: 'IS Sugar',
        Commodities: 'rice, corn, sugarcane',
        'No. of members': 88,
      },
    ],
  };

  const result = await answerQuestion(
    input,
    'List the associations in La Union that produce sugar cane, and tell me the total number of members among them.',
    `compound-scope-${Date.now()}`
  );

  assert.equal(result.success, true);
  assert.equal(result.operation, 'compound');
  assert.equal(result.results?.[1]?.value, 82);
  assert.ok(
    result.results?.[1]?.debugPlan?.filters?.some((filter) =>
      filter.column === 'Province' && filter.value === 'La Union'
    )
  );
  assert.equal(
    result.results?.[1]?.debugPlan?.compoundContextParityApplied,
    true
  );
});

// ============================================================
// V7.36.5p — RANKING + STORED-METRIC / AGGREGATION PRECEDENCE
// ============================================================

test('highest stored metric whose header contains total is treated as row ranking, not complex filter', () => {
  const { enforcePlannerInvariants } = require('./plannerInvariantEngine');

  const datasets = {
    Sheet1: [
      { 'SP Name': 'Project A', Province: 'Pangasinan', Municipality: 'A', 'Total SP Cost': 100 },
      { 'SP Name': 'Project B', Province: 'La Union', Municipality: 'B', 'Total SP Cost': 250 },
    ],
  };
  const schema = [{
    name: 'Sheet1',
    columns: Object.keys(datasets.Sheet1[0]).map((name) => ({ name })),
  }];

  const repaired = enforcePlannerInvariants({
    datasets,
    schema,
    plan: {
      route: 'dataset',
      dataset: 'Sheet1',
      operation: 'lookup',
      column: 'Total SP Cost',
      filters: [],
      selectColumns: ['Total SP Cost'],
    },
    question: 'Which subproject has the highest total SP cost, and what province and municipality is it located in?',
  });

  assert.equal(repaired.operation, 'rank_rows');
  assert.equal(repaired.column, 'Total SP Cost');
  assert.equal(repaired.labelColumn, 'SP Name');
  assert.equal(repaired.direction, 'desc');
  assert.equal(repaired.limit, 1);
  assert.ok(repaired.selectColumns.includes('Province'));
  assert.ok(repaired.selectColumns.includes('Municipality'));
  assert.equal(repaired.universalSemanticRescue, true);
});

test('total numeric metric repairs lookup to sum when no ranking intent exists', () => {
  const { enforcePlannerInvariants } = require('./plannerInvariantEngine');

  const datasets = {
    Sheet1: [
      { Province: 'Pangasinan', 'SP Status (Stage)': 'Completed', 'Total SP Cost': 100 },
      { Province: 'Pangasinan', 'SP Status (Stage)': 'Completed', 'Total SP Cost': 250 },
    ],
  };
  const schema = [{
    name: 'Sheet1',
    columns: Object.keys(datasets.Sheet1[0]).map((name) => ({ name })),
  }];

  const repaired = enforcePlannerInvariants({
    datasets,
    schema,
    plan: {
      route: 'dataset',
      dataset: 'Sheet1',
      operation: 'lookup',
      column: 'Total SP Cost',
      filters: [
        { column: 'Province', operator: 'equals', value: 'Pangasinan' },
        { column: 'SP Status (Stage)', operator: 'equals', value: 'Completed' },
      ],
      selectColumns: ['Total SP Cost'],
    },
    question: 'what is their total SP cost',
  });

  assert.equal(repaired.operation, 'sum');
  assert.equal(repaired.column, 'Total SP Cost');
  assert.equal(repaired.aggregateIntentParityApplied, true);
  assert.equal(repaired.filters.length, 2);
});

test('grouped compound clause inherits multi-value scope from previous filters and removes grouping-label filter artifacts', () => {
  const { mergeInheritedScopeIntoPlan } = require('./compoundContextParityEngine');

  const previousPlan = {
    route: 'dataset',
    dataset: 'Sheet1',
    operation: 'row_count',
    filters: [
      {
        column: 'Province',
        operator: 'in',
        value: ['Pangasinan', 'La Union'],
      },
    ],
  };

  const currentPlan = {
    route: 'dataset',
    dataset: 'Sheet1',
    operation: 'group_average',
    column: 'Total SP Cost',
    groupBy: 'Province',
    labelColumn: 'Province',
    filters: [
      {
        column: 'Proponent LGU',
        operator: 'equals',
        value: 'Province',
      },
    ],
    selectColumns: ['Province', 'Total SP Cost'],
  };

  const merged = mergeInheritedScopeIntoPlan({
    previousPlan,
    currentPlan,
    question: 'what is the average total SP cost for each province',
  });

  assert.equal(merged.changed, true);
  assert.equal(merged.plan.operation, 'group_average');
  assert.equal(merged.plan.groupBy, 'Province');
  assert.equal(merged.plan.groupingPhraseFilterArtifactRemoved, true);
  assert.equal(
    merged.plan.filters.some((filter) => filter.column === 'Proponent LGU'),
    false
  );
  const provinceFilter = merged.plan.filters.find((filter) => filter.column === 'Province');
  assert.equal(provinceFilter?.operator, 'in');
  assert.deepEqual(new Set(provinceFilter?.value), new Set(['Pangasinan', 'La Union']));
});

test('grouped compound scope inheritance is planner-source agnostic', () => {
  const { mergeInheritedScopeIntoPlan } = require('./compoundContextParityEngine');
  const previousPlan = {
    route: 'dataset',
    dataset: 'AnyDataset',
    filters: [{ column: 'Region', operator: 'in', value: ['North', 'South'] }],
  };

  for (const plannerSource of ['groq', 'local-fallback']) {
    const merged = mergeInheritedScopeIntoPlan({
      previousPlan,
      currentPlan: {
        route: 'dataset',
        dataset: 'AnyDataset',
        operation: 'group_average',
        column: 'Amount',
        groupBy: 'Region',
        labelColumn: 'Region',
        filters: [],
        plannerSource,
      },
      question: 'what is the average amount for each region',
    });

    const regionFilter = merged.plan.filters.find((filter) => filter.column === 'Region');
    assert.equal(regionFilter?.operator, 'in');
    assert.deepEqual(new Set(regionFilter?.value), new Set(['North', 'South']));
  }
});

test('planner invariant removes ranking detail fields misread as categorical filters', () => {
  const { enforcePlannerInvariants } = require('./plannerInvariantEngine');
  const datasets = {
    Sheet1: [
      { 'SP Name': 'A', 'Total SP Cost': '100', Province: 'North', Municipality: 'Town A', 'Proponent LGU': 'Province' },
      { 'SP Name': 'B', 'Total SP Cost': '200', Province: 'South', Municipality: 'Town B', 'Proponent LGU': 'Municipality' },
    ],
  };
  const schema = buildSchema(datasets);
  const plan = enforcePlannerInvariants({
    datasets,
    schema,
    question: 'Which subproject has the highest total SP cost, and what province and municipality is it located in?',
    plan: {
      route: 'dataset', dataset: 'Sheet1', operation: 'rank_rows', column: 'Total SP Cost', labelColumn: 'SP Name', direction: 'desc',
      filters: [{ column: 'Proponent LGU', operator: 'in', value: ['Province', 'Municipality'] }],
      selectColumns: ['SP Name', 'Total SP Cost', 'Province', 'Municipality'], limit: 1,
    },
  });
  assert.equal(plan.filters.length, 0);
  assert.equal(plan.projectionFieldFilterArtifactRemoved, true);
});

test('planner invariant removes exact duplicate filters generically', () => {
  const { enforcePlannerInvariants } = require('./plannerInvariantEngine');
  const datasets = { Main: [{ Region: 'North', Amount: '10' }] };
  const schema = buildSchema(datasets);
  const plan = enforcePlannerInvariants({
    datasets,
    schema,
    question: 'What is the total amount in North?',
    plan: {
      route: 'dataset', dataset: 'Main', operation: 'sum', column: 'Amount',
      filters: [
        { column: 'Region', operator: 'equals', value: 'North' },
        { column: 'Region', operator: 'equals', value: 'North' },
      ],
      selectColumns: ['Amount'],
    },
  });
  assert.equal(plan.filters.length, 1);
});

test('compound follow-on aggregate inherits scope even without a pronoun', () => {
  const { mergeInheritedScopeIntoPlan } = require('./compoundContextParityEngine');
  const previousPlan = {
    route: 'dataset', dataset: 'Main', operation: 'list', column: 'Project',
    filters: [{ column: 'Region', operator: 'equals', value: 'North' }],
  };
  const currentPlan = {
    route: 'dataset', dataset: 'Main', operation: 'average', column: 'Amount', filters: [],
  };
  const merged = mergeInheritedScopeIntoPlan({
    previousPlan,
    currentPlan,
    question: 'what is the average amount',
  });
  assert.equal(merged.changed, true);
  assert.equal(merged.plan.filters[0].column, 'Region');
  assert.equal(merged.plan.filters[0].value, 'North');
});

test('aggregate formatter avoids total Total and average Average wording', () => {
  const { formatAggregateAnswer } = require('./responseFormatter');
  assert.equal(
    formatAggregateAnswer({ operation: 'sum', column: 'Total SP Cost', value: 100 }),
    'the total sp cost is 100.'
  );
  assert.equal(
    formatAggregateAnswer({ operation: 'average', column: 'Average Price', value: 25 }),
    'the average price is 25.'
  );
});

test('problem2 exact preferred live value outranks fuzzy cross-field candidates', () => {
  const { resolveEntityAcrossDatasets } = require('./entityResolver');
  const datasets = {
    Main: [
      { Province: 'La Union', Category: 'Union', Name: 'Alpha' },
      { Province: 'Pangasinan', Category: 'La Union-like', Name: 'Beta' },
    ],
  };
  const result = resolveEntityAcrossDatasets({
    datasets,
    requestedValue: 'La Union',
    preferredDataset: 'Main',
    preferredColumn: 'Province',
  });
  assert.equal(result.resolved, true);
  assert.equal(result.column, 'Province');
  assert.equal(result.resolvedValue, 'La Union');
  assert.equal(result.exactLiveValueMatch, true);
});

test('problem2 live schema metric grounding corrects a conflicting numeric metric choice', () => {
  const { validateQueryPlan } = require('./queryValidator');
  const datasets = {
    Main: [
      { Project: 'A1', Cost: '100', Beneficiaries: '4' },
      { Project: 'A2', Cost: '200', Beneficiaries: '8' },
    ],
  };
  const schema = buildSchema(datasets);
  const validation = validateQueryPlan({
    datasets,
    schema,
    question: 'What is the average cost?',
    plan: {
      route: 'dataset', dataset: 'Main', operation: 'average', column: 'Beneficiaries', filters: [],
    },
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.plan.column, 'Cost');
  assert.equal(validation.plan.liveSchemaMetricGrounded, true);
});

test('problem2 unresolved categorical filter values are rejected before execution', () => {
  const { validateResolvedFilterValues } = require('./queryValidator');
  const datasets = { Main: [{ Province: 'La Union' }, { Province: 'Pangasinan' }] };
  const validation = validateResolvedFilterValues({
    datasets,
    plan: {
      route: 'dataset', dataset: 'Main', operation: 'row_count',
      filters: [{ column: 'Province', operator: 'equals', value: 'Imaginary Province' }],
    },
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.code, 'FILTER_VALUE_NOT_GROUNDED');
});

test('problem2 result validation rejects a numeric answer inconsistent with filtered live rows', () => {
  const { validateResult } = require('./resultValidator');
  const datasets = {
    Main: [
      { Region: 'North', Amount: '10' },
      { Region: 'North', Amount: '20' },
      { Region: 'South', Amount: '500' },
    ],
  };
  const validation = validateResult({
    datasets,
    plan: {
      route: 'dataset', dataset: 'Main', operation: 'sum', column: 'Amount',
      filters: [{ column: 'Region', operator: 'equals', value: 'North' }],
    },
    result: {
      success: true, operation: 'sum', value: 530, answer: 'The total is 530.',
    },
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.code, 'NUMERIC_SOURCE_MISMATCH');
});

test('problem2 live filter grounding can repair a wrong planner field when one live field uniquely supports the value', () => {
  const { validateResolvedFilterValues } = require('./queryValidator');
  const datasets = {
    Main: [
      { Province: 'Pangasinan', Enterprises: 'Vegetable Production', Commodities: 'Rice, Sugar Cane' },
      { Province: 'La Union', Enterprises: 'Mushroom Production', Commodities: 'Corn' },
    ],
  };

  const validation = validateResolvedFilterValues({
    datasets,
    question: 'Which Pangasinan associations produce sugarcane?',
    plan: {
      route: 'dataset',
      dataset: 'Main',
      operation: 'lookup',
      filters: [
        { column: 'Province', operator: 'equals', value: 'Pangasinan' },
        { column: 'Enterprises', operator: 'equals', value: 'sugarcane' },
      ],
    },
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.plan.liveFilterFieldGrounded, true);
  assert.equal(validation.plan.filters[0].column, 'Province');
  assert.equal(validation.plan.filters[1].column, 'Commodities');
});

test('problem2 lookup removes duplicate projected entity rows from denormalized data', () => {
  const { executePlan } = require('./calculationEngine');
  const datasets = {
    Association: [
      { Province: 'Pangasinan', Commodity: 'Sugar Cane', 'Name of Association': 'Alpha Association' },
      { Province: 'Pangasinan', Commodity: 'Sugar Cane', 'Name of Association': 'Alpha Association' },
      { Province: 'Pangasinan', Commodity: 'Sugar Cane', 'Name of Association': 'Beta Association' },
      { Province: 'La Union', Commodity: 'Sugar Cane', 'Name of Association': 'Gamma Association' },
    ],
  };

  const result = executePlan({
    datasets,
    question: 'Which Pangasinan associations produce sugar cane?',
    plan: {
      route: 'dataset',
      dataset: 'Association',
      operation: 'lookup',
      filters: [
        { column: 'Province', operator: 'equals', value: 'Pangasinan' },
        { column: 'Commodity', operator: 'equals', value: 'Sugar Cane' },
      ],
      selectColumns: ['Name of Association'],
      outputRequested: true,
      showAll: true,
      limit: 100,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.matchedRowCount, 3);
  assert.equal(result.count, 2);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0]['Name of Association'], 'Alpha Association');
  assert.equal(result.results[1]['Name of Association'], 'Beta Association');
  assert.equal(result.duplicateLookupRowsRemoved, true);
});

test('problem2 aggregate field guard prefers explicitly named numeric measure over entity noun', () => {
  const { enforceExplicitQuestionColumn } = require('./plannerNormalizer');
  const { buildSchema } = require('./schemaBuilder');

  const datasets = {
    Main: [
      { Province: 'North', Association: 'Group A', 'Total Land Area (ha)': '10.5' },
      { Province: 'North', Association: 'Group B', 'Total Land Area (ha)': '20.0' },
    ],
  };
  const schema = buildSchema(datasets);

  const repaired = enforceExplicitQuestionColumn({
    plan: {
      route: 'dataset',
      dataset: 'Main',
      operation: 'sum',
      column: 'Total Land Area (ha)',
      filters: [{ column: 'Province', operator: 'equals', value: 'North' }],
      selectColumns: ['Total Land Area (ha)'],
    },
    schema,
    question: 'What is the total land area of the North associations?',
  });

  assert.equal(repaired.operation, 'sum');
  assert.equal(repaired.column, 'Total Land Area (ha)');
  assert.equal(repaired.dataset, 'Main');
});

test('problem2 aggregate field guard does not replace a numeric metric with an explicit text entity', () => {
  const { enforceExplicitQuestionColumn } = require('./plannerNormalizer');
  const { buildSchema } = require('./schemaBuilder');

  const datasets = {
    Main: [
      { Association: 'Group A', Amount: '10' },
      { Association: 'Group B', Amount: '20' },
    ],
  };
  const schema = buildSchema(datasets);

  const repaired = enforceExplicitQuestionColumn({
    plan: {
      route: 'dataset',
      dataset: 'Main',
      operation: 'sum',
      column: 'Amount',
      filters: [],
      selectColumns: ['Amount'],
    },
    schema,
    question: 'What is the total for the associations?',
  });

  assert.equal(repaired.column, 'Amount');
});

test('problem2 list projection returns requested entity instead of filter field', () => {
  const { enforcePlannerInvariants } = require('./plannerInvariantEngine');
  const { buildSchema } = require('./schemaBuilder');
  const datasets = {
    Main: [
      { Association: 'Alpha Group', Commodities: 'rice, sugarcane' },
      { Association: 'Beta Group', Commodities: 'corn' },
    ],
  };
  const schema = buildSchema(datasets);
  const repaired = enforcePlannerInvariants({
    datasets,
    schema,
    question: 'List the associations whose commodities include sugarcane.',
    plan: {
      route: 'dataset', dataset: 'Main', operation: 'list', column: 'Commodities',
      filters: [
        { column: 'Commodities', operator: 'contains', value: 'sugarcane' },
        { column: 'Commodities', operator: 'equals', value: 'sugarcane' },
      ],
      selectColumns: ['Commodities'], outputRequested: true, showAll: true,
    },
  });
  assert.equal(repaired.column, 'Association');
  assert.deepEqual(repaired.selectColumns, ['Association']);
  assert.equal(repaired.listProjectionGrounded, true);
  assert.equal(repaired.filters.length, 1);
  assert.equal(repaired.filters[0].operator, 'contains');
});

test('problem2 deterministic ranking answer is preserved to prevent unsupported entity relabeling', () => {
  const { shouldPreserveDeterministicSemanticAnswer } = require('./responseGenerator');
  const keep = shouldPreserveDeterministicSemanticAnswer({
    plan: { route: 'dataset', operation: 'rank_rows', column: 'Total Cost', labelColumn: 'Name of Association' },
    result: { operation: 'rank_rows', results: [{ label: 'Alpha Association', value: 100 }] },
    semanticAnswer: 'Alpha Association has the highest total cost at 100.',
  });
  assert.equal(keep, true);
});


test('problem2 grounded list response names the output field, not the filter field', () => {
  const { buildSemanticVerifiedAnswer } = require('./responseNarrativeEngine');
  const answer = buildSemanticVerifiedAnswer({
    question: 'List the associations whose commodities include sugarcane.',
    plan: {
      route: 'dataset',
      dataset: 'Main',
      operation: 'list',
      column: 'Association',
      labelColumn: 'Association',
      filters: [
        { column: 'Commodities', operator: 'contains', value: 'sugarcane' },
      ],
      selectColumns: ['Association'],
      listProjectionGrounded: true,
      showAll: true,
    },
    result: {
      success: true,
      operation: 'list',
      column: 'Association',
      count: 3,
      results: ['Group A', 'Group B', 'Group C'],
    },
  });

  assert.equal(
    answer,
    'The associations whose commodities include sugarcane are Group A, Group B, and Group C.'
  );
});

test('problem2 grounded list response is preserved for Groq and local parity', () => {
  const { shouldPreserveDeterministicSemanticAnswer } = require('./responseGenerator');
  const keep = shouldPreserveDeterministicSemanticAnswer({
    plan: {
      route: 'dataset',
      operation: 'list',
      column: 'Association',
      filters: [{ column: 'Commodities', operator: 'contains', value: 'sugarcane' }],
      listProjectionGrounded: true,
    },
    result: {
      success: true,
      operation: 'list',
      column: 'Association',
      results: ['Group A', 'Group B'],
    },
    semanticAnswer: 'The associations whose commodities include sugarcane are Group A and Group B.',
  });
  assert.equal(keep, true);
});
