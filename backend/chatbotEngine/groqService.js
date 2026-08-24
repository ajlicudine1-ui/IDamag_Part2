  const {
    buildSemanticHints,
  } = require("./semanticDictionary");
  
  const GROQ_URL =
    "https://api.groq.com/openai/v1/chat/completions";

  const GROQ_MODEL =
    process.env.GROQ_MODEL ||
    "llama-3.3-70b-versatile";

async function callGroq(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is missing from the backend environment."
    );
  }

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || GROQ_MODEL,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens || 1000,
      messages,
    }),
  });

  const body = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body?.error?.message ||
        `Groq request failed with HTTP ${response.status}.`
    );
  }

  return (
    body?.choices?.[0]?.message?.content?.trim() ||
    ""
  );
}

async function answerGeneralQuestion({
  question,
  schema,
}) {
  const safeSchema = schema.map((dataset) => ({
    name: dataset.name,
    rowCount: dataset.rowCount,

    columns: dataset.columns.map((column) => ({
      name: column.name,
      type: column.type,
    })),
  }));

  const answer = await callGroq(
    [
      {
        role: "system",
        content: `
You are a helpful assistant inside a data chatbot.

Answer:
- general knowledge questions
- grammar questions
- translation questions
- explanation questions
- writing questions
- rewriting questions

Do NOT invent dataset values.

You only know the supplied dataset schema.

Exact dataset calculations, lookups, filtering, joining,
ranking, counting, and aggregation must be handled by
the dataset engine.

If the user is asking about actual dataset values,
do not guess them.
`,
      },

      {
        role: "user",
        content:
          `DATASET SCHEMA:\n${JSON.stringify(
            safeSchema
          )}\n\n` +
          `QUESTION:\n${question}`,
      },
    ],
    {
      temperature: 0.3,
      maxTokens: 1000,
    }
  );

  return {
    success: true,
    source: "groq",
    operation: "general",
    answer,
  };
}

// ============================================================
// EXTRACT JSON
// ============================================================

function extractJsonObject(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (
    start === -1 ||
    end === -1 ||
    end <= start
  ) {
    throw new Error(
      "Groq did not return valid JSON."
    );
  }

  return JSON.parse(
    cleaned.slice(start, end + 1)
  );
}


function normalizeColumnMatchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactColumnMatchText(value) {
  return normalizeColumnMatchText(value)
    .replace(/\s+/g, "")
    .trim();
}

function getExactQuestionColumnMatch({
  question,
  schema,
}) {
  const normalizedQuestion =
    normalizeColumnMatchText(
      question
    );

  const compactQuestion =
    compactColumnMatchText(
      question
    );

  if (
    !normalizedQuestion ||
    !compactQuestion
  ) {
    return null;
  }

  const matches = [];

  for (const dataset of schema || []) {
    for (const column of dataset?.columns || []) {
      const name =
        column?.name;

      if (!name) {
        continue;
      }

      const normalizedColumn =
        normalizeColumnMatchText(
          name
        );

      const compactColumn =
        compactColumnMatchText(
          name
        );

      if (
        !normalizedColumn ||
        !compactColumn
      ) {
        continue;
      }

      let score = 0;

      if (
        normalizedQuestion ===
        normalizedColumn
      ) {
        score = 100;
      } else if (
        compactQuestion ===
        compactColumn
      ) {
        score = 99;
      } else if (
        normalizedQuestion.includes(
          normalizedColumn
        )
      ) {
        score =
          95 +
          normalizedColumn.length /
            10000;
      } else if (
        compactQuestion.includes(
          compactColumn
        )
      ) {
        score =
          94 +
          compactColumn.length /
            10000;
      }

      if (score > 0) {
        matches.push({
          dataset:
            dataset.name,

          column:
            name,

          score,

          normalizedLength:
            normalizedColumn.length,
        });
      }
    }
  }

  if (!matches.length) {
    return null;
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      b.normalizedLength -
        a.normalizedLength
  );

  return matches[0];
}

function shouldForceQuestionColumn({ plan, exactColumnMatch }) {
  if (!plan || plan.route !== "dataset" || !exactColumnMatch) {
    return false;
  }

  const operation = String(plan.operation || "").trim().toLowerCase();

  return new Set([
    "sum",
    "average",
    "median",
    "minimum",
    "maximum",
    "non_empty_count",
    "distinct_count",
    "list",
    "rank_rows",
  ]).has(operation);
}


function compactPlannerSchema(schema) {
  return (schema || []).map((dataset) => ({
    name: dataset.name,
    rowCount: dataset.rowCount,
    columns: (dataset.columns || []).map((column) => ({
      name: column.name,
      type: column.type,
      examples: Array.isArray(column.examples)
        ? column.examples.slice(0, 2)
        : [],
    })),
  }));
}

function compactSemanticHintsForQuestion({
  semanticHints,
  question,
  schema,
}) {
  const q = normalizeColumnMatchText(question);
  const schemaColumns = new Set();

  for (const dataset of schema || []) {
    for (const column of dataset?.columns || []) {
      if (column?.name) {
        schemaColumns.add(
          normalizeColumnMatchText(column.name)
        );
      }
    }
  }

  const scored = (semanticHints || [])
    .map((hint) => {
      const column = String(hint?.column || "");
      const aliases = Array.isArray(hint?.aliases)
        ? hint.aliases
        : [];

      let score = 0;

      const normalizedColumn =
        normalizeColumnMatchText(column);

      if (
        normalizedColumn &&
        q.includes(normalizedColumn)
      ) {
        score += 10;
      }

      for (const alias of aliases) {
        const normalizedAlias =
          normalizeColumnMatchText(alias);

        if (
          normalizedAlias &&
          q.includes(normalizedAlias)
        ) {
          score += 8;
        }
      }

      return {
        column,
        aliases: aliases.slice(0, 6),
        score,
      };
    })
    .filter((item) => item.column)
    .sort((a, b) => b.score - a.score);

  const relevant = scored.filter(
    (item) => item.score > 0
  );

  const fallback =
    relevant.length
      ? relevant
      : scored.slice(0, 12);

  return fallback
    .filter((item) =>
      schemaColumns.has(
        normalizeColumnMatchText(item.column)
      )
    )
    .slice(0, 16)
    .map(({ column, aliases }) => ({
      column,
      aliases,
    }));
}

function compactRetrievalContextForPlanner(
  retrievalContext
) {
  if (!Array.isArray(retrievalContext)) {
    return [];
  }

  return retrievalContext
    .filter(
      (dataset) =>
        dataset &&
        typeof dataset === "object"
    )
    .slice(0, 4)
    .map((dataset) => ({
      dataset:
        dataset.dataset || null,

      matchedValues:
        Array.isArray(
          dataset.matchedValues
        )
          ? dataset.matchedValues
              .slice(0, 12)
              .map((item) => {
                if (
                  item &&
                  typeof item === "object"
                ) {
                  return {
                    column:
                      item.column || null,
                    value:
                      item.value ?? null,
                  };
                }

                return item;
              })
          : [],

      rows:
        Array.isArray(
          dataset.rows
        )
          ? dataset.rows
              .slice(0, 3)
              .map((row) => {
                if (
                  !row ||
                  typeof row !== "object"
                ) {
                  return row;
                }

                const compactRow = {};

                for (
                  const [
                    key,
                    value,
                  ] of Object.entries(row)
                ) {
                  if (
                    Object.keys(compactRow)
                      .length >= 12
                  ) {
                    break;
                  }

                  compactRow[key] =
                    value;
                }

                return compactRow;
              })
          : [],
    }));
}

function compactConversationContext(
  context
) {
  if (!context) {
    return null;
  }

  const lastPlan =
    context.isFollowUp &&
    context.lastPlan &&
    typeof context.lastPlan ===
      "object"
      ? {
          route:
            context.lastPlan.route ||
            null,
          dataset:
            context.lastPlan.dataset ||
            null,
          operation:
            context.lastPlan.operation ||
            null,
          column:
            context.lastPlan.column ||
            null,
          labelColumn:
            context.lastPlan
              .labelColumn ||
            null,
          groupBy:
            context.lastPlan.groupBy ||
            null,
          aggregation:
            context.lastPlan
              .aggregation ||
            null,
          direction:
            context.lastPlan.direction ||
            null,
          filters:
            Array.isArray(
              context.lastPlan.filters
            )
              ? context.lastPlan.filters
                  .slice(0, 6)
              : [],
          selectColumns:
            Array.isArray(
              context.lastPlan
                .selectColumns
            )
              ? context.lastPlan
                  .selectColumns
                  .slice(0, 8)
              : [],
          outputRequested:
            context.lastPlan
              .outputRequested === true,
          showAll:
            context.lastPlan
              .showAll === true,
          limit:
            context.lastPlan.limit ||
            null,
        }
      : null;

  return {
    isFollowUp:
      context.isFollowUp === true,

    lastEntity:
      context.lastEntity || null,

    lastDataset:
      context.lastDataset || null,

    lastIntent:
      context.lastIntent || null,

    lastMetric:
      context.lastMetric || null,

    lastFilters:
      Array.isArray(
        context.lastFilters
      )
        ? context.lastFilters.slice(0, 6)
        : [],

    lastPlan,
  };
}

/**
 * Uses Groq only as a language interpreter.
 *
 * Groq NEVER receives the full dataset rows.
 *
 * Groq only receives:
 * - worksheet names
 * - column names
 * - column types
 * - a few example values
 *
 * JavaScript performs the real lookup/calculation.
 */
async function createSchemaAwarePlan({
  question,
  schema,
  context = null,
  retrievalContext = null,
}) {
  const compactSchema =
    compactPlannerSchema(
      schema
    );

  const exactQuestionColumnMatch =
    getExactQuestionColumnMatch({
      question,
      schema,
    });

  const semanticHints =
    compactSemanticHintsForQuestion({
      semanticHints:
        buildSemanticHints(schema),

      question,

      schema,
    });

  const safeContext =
    compactConversationContext(
      context
    );

  // ============================================================
  // VERIFIED RETRIEVAL CONTEXT
  // ============================================================
  //
  // These are relevant REAL rows/values found dynamically by
  // dataRetriever.js from the currently loaded datasets.
  //
  // Groq may use them to identify the correct worksheet, entity,
  // filter column, and exact filter values. Groq must NOT calculate
  // answers from these rows; JavaScript remains the calculation
  // and verification engine.
  //
  const safeRetrievalContext =
    compactRetrievalContextForPlanner(
      retrievalContext
    );

  const systemPrompt = `
You are a schema-aware query planner for a data chatbot.

Your ONLY job is to understand the user's natural-language
question and convert it into a structured query plan.

You must NOT:
- calculate dataset values
- estimate values
- invent values
- invent worksheet names
- invent column names
- fabricate filters
- answer the dataset question yourself

The JavaScript dataset engine will perform all calculations,
filtering, lookups, joins, and rankings.

Return VALID JSON ONLY.

Do not include markdown.
Do not include explanations before or after the JSON.

============================================================
AVAILABLE ROUTES
============================================================

1) DATASET OPERATION

{
  "route": "dataset",

  "dataset": "exact worksheet name",

  "operation":
    "sum|average|median|minimum|maximum|row_count|non_empty_count|distinct_count|list|lookup|group_count|group_sum|group_average|group_minimum|group_maximum|rank_rows|rank_groups",

  "column":
    "exact metric/output column name or null",

  "labelColumn":
    "exact label/entity column name or null",

  "groupBy":
    "exact grouping column name or null",

  "aggregation":
    "sum|average|count|null",

  "direction":
    "asc|desc|null",

  "filters": [
    {
      "column": "exact column name",
      "operator":
        "equals|not_equals|contains|starts_with|ends_with|greater_than|greater_or_equal|less_than|less_or_equal|in|not_in",
      "value":
        "single value from the user's question, or an array of values when operator is in/not_in"
    }
  ],

  "selectColumns": [
    "exact requested output column names"
  ],

  "outputRequested": true,

  "transform":
    "first_word|last_word|null",

  "limit": 10,

  "showAll": false
}

============================================================
2) SCHEMA QUESTION
============================================================

{
  "route": "schema",

  "intent":
    "datasets|columns|row_counts|find_column|describe",

  "dataset":
    "exact worksheet name or null",

  "column":
    "exact column name or null"
}

============================================================
3) GENERAL QUESTION
============================================================

{
  "route": "general"
}

============================================================
4) CLARIFICATION
============================================================

{
  "route": "clarify",

  "question":
    "one short clarification question"
}

============================================================
SEMANTIC ALIAS RULES
============================================================

You will receive SEMANTIC HINTS.

Each semantic hint maps natural user wording to an exact
column that exists in the current schema.

Example:

{
  "column": "ACTUAL SALARY",
  "aliases": [
    "actual salary",
    "salary",
    "current salary",
    "actual pay",
    "pay",
    "current pay"
  ]
}

If the user's wording clearly matches one semantic alias,
use the corresponding exact schema column.

Semantic aliases have priority over guessing between multiple
similar columns.

Example:

If:

"pay" -> ACTUAL SALARY

and the schema also contains:

AUTHORIZED SALARY

then:

"What is Roberto's pay?"

means ACTUAL SALARY.

Do NOT return both ACTUAL SALARY and AUTHORIZED SALARY unless
the user explicitly asks for both.

Similarly:

"job title" -> POSITION TITLE

means return POSITION TITLE only.

"salary grade" -> SG

means SG only.

"section" -> UNIT/SECTION/STATION

means UNIT/SECTION/STATION when that alias is supplied.

IMPORTANT:

- Semantic hints identify COLUMN MEANING only.
- They do NOT contain dataset answers.
- They must never be treated as row values.
- Never invent an alias that is not supplied.
- Never invent a column.
- The selected column must still exist in the supplied schema.
- If the user explicitly requests multiple different fields,
  preserve all of them.

============================================================
RETRIEVED REAL DATA
============================================================

You may receive RETRIEVED REAL DATA.

This context was dynamically found by JavaScript from the
currently loaded worksheets. It is not hardcoded application data.

Use RETRIEVED REAL DATA only to improve query planning:

- identify exact worksheet names
- identify exact column names
- identify exact entity/filter values
- preserve multiple entities named by the user
- choose the correct filter column when the schema alone is unclear

IMPORTANT:

- RETRIEVED REAL DATA contains actual dataset rows, but you are
  still a QUERY PLANNER only.
- Do NOT calculate totals, averages, counts, differences, rankings,
  percentages, minimums, or maximums from these rows.
- Do NOT answer the user's dataset question yourself.
- JavaScript will execute and verify the final plan.
- Never invent a value that is absent from both the user's question
  and the supplied retrieved/schema context.
- If multiple retrieved values from the SAME column correspond to
  multiple entities explicitly requested by the user, preserve all
  of them using one "in" filter.
- Do not discard a second or third requested entity merely because
  one entity is a stronger match.
- Retrieved rows are evidence for planning, not permission to add
  unrelated filters or output fields.
- If retrieval returns no useful match, rely on the schema and the
  user's wording as before.

============================================================
GENERAL RULES
============================================================

- Use ONLY worksheet names that exist in the supplied schema.

- Use ONLY column names that exist in the supplied schema.

- EXACT USER COLUMN WORDING HAS HIGHEST PRIORITY:
  If the user's question contains the complete name of a real schema
  column after normalizing case, punctuation, whitespace, and line
  breaks, select that exact schema column instead of a merely similar
  column. This applies dynamically to every dataset and column.

- If two real columns differ by an important word and the user explicitly
  names one complete column, preserve that distinguishing word.

- Do NOT invent worksheet names.

- Do NOT invent column names.

- Example values are hints only.

- Example values are NOT exhaustive.

- A filter value may come directly from the user's question
  even if it does not appear in the example values.

- Do NOT calculate the answer.

- Do NOT estimate the answer.

- Do NOT return actual dataset values.

- If the user asks for a value from a record or row,
  use operation "lookup".

- If the user asks for only one semantic concept or output
  field, put ONLY the best matching exact column in
  selectColumns.

- Do NOT add related columns merely because they have similar
  meanings or names.

- Example:
  If "pay" maps to ACTUAL SALARY, do NOT additionally return
  AUTHORIZED SALARY.

- Example:
  If "job title" maps to POSITION TITLE, do NOT additionally
  return CATEGORY OF POSITION.

- If the user explicitly asks for multiple different output
  fields, put ALL requested fields in selectColumns.

- Do NOT collapse a genuine multiple-field request into one
  field.

- Do NOT collapse a multiple-field request into one field.

- For operation "list", return the complete list by default.
- A normal list request with no explicit number must set "showAll": true.
- Only limit a list when the user explicitly asks for a number such as 5, 10, 20, first N, top N, or similar.

- Do NOT remove requested output fields just because they are
  stored in different worksheets.

- outputRequested should normally be true for lookup questions
  where the user explicitly asks for one or more fields.

============================================================
CROSS-WORKSHEET RULES
============================================================

IMPORTANT:

A user's requested fields may exist in DIFFERENT worksheets.

The dataset engine supports dynamic cross-worksheet lookup.

Therefore:

- Preserve ALL requested fields in selectColumns even when those
  fields come from different worksheets.

- Do NOT restrict selectColumns to the selected dataset.

- Do NOT remove a requested column just because it is not in the
  primary worksheet.

- The dataset engine will dynamically discover a shared column
  between worksheets.

- Do NOT invent the join/shared column.

- Do NOT invent relationships.

- Do NOT manually specify a join unless the user explicitly asks
  about a column that exists in the schema.

- Choose as "dataset" the worksheet that best represents the
  main entity or identifying part of the user's question.

Example schema:

Worksheet A:
- Record ID
- Person
- Province

Worksheet B:
- Record ID
- Status
- Month

Question:
"person with record id 1011 and its month"

Correct planning behavior:

{
  "route": "dataset",
  "dataset": "Worksheet A",
  "operation": "lookup",
  "column": null,
  "labelColumn": null,
  "groupBy": null,
  "aggregation": null,
  "direction": null,
  "filters": [
    {
      "column": "Record ID",
      "operator": "equals",
      "value": "1011"
    }
  ],
  "selectColumns": [
    "Person",
    "Month"
  ],
  "outputRequested": true,
  "transform": null,
  "limit": 10,
  "showAll": false
}

Notice:

"Person" exists in Worksheet A.

"Month" exists in Worksheet B.

Both MUST still remain in selectColumns.

The dataset engine will determine how to connect them.

Another example:

Question:
"show the crop and fertilizer used for farm id 1011"

If:
- Crop exists in one worksheet
- Fertilizer Used exists in another worksheet
- Farm ID exists in both

Then selectColumns MUST contain:

[
  "Crop",
  "Fertilizer Used"
]

Do NOT return only one of them.

============================================================
MULTI-ENTITY FILTER RULES
============================================================

The dataset engine supports multi-value filters with:

"operator": "in"

and:

"operator": "not_in"

Use "in" when the user names MULTIPLE values that belong to
the SAME filter column.

Example:

Question:
"What is the actual salary of Roberto Perales and Vener Dllig?"

Correct plan:

{
  "route": "dataset",
  "dataset": "PERMANENT ONLY",
  "operation": "lookup",
  "column": null,
  "labelColumn": null,
  "groupBy": null,
  "aggregation": null,
  "direction": null,
  "filters": [
    {
      "column": "NAME",
      "operator": "in",
      "value": [
        "Roberto Perales",
        "Vener Dllig"
      ]
    }
  ],
  "selectColumns": [
    "ACTUAL SALARY"
  ],
  "outputRequested": true,
  "transform": null,
  "limit": 10,
  "showAll": true
}

IMPORTANT:

- NEVER represent multiple values from the SAME column as
  multiple equals filters.

WRONG:

[
  {
    "column": "NAME",
    "operator": "equals",
    "value": "Roberto Perales"
  },
  {
    "column": "NAME",
    "operator": "equals",
    "value": "Vener Dllig"
  }
]

That would mean:

NAME = Roberto Perales
AND
NAME = Vener Dllig

which cannot match one row.

Instead use:

{
  "column": "NAME",
  "operator": "in",
  "value": [
    "Roberto Perales",
    "Vener Dllig"
  ]
}

which means:

NAME = Roberto Perales
OR
NAME = Vener Dllig

Use the same behavior for any dataset and any column.

Examples:

"What are the positions of Roberto, Vener and Juan?"
→ one NAME filter using operator "in"

"Show production for Ilocos Norte and Ilocos Sur"
→ one PROVINCE filter using operator "in"

"Show records for PMED and FOD"
→ one DIVISION filter using operator "in"

"Give me the municipalities of Farmer A and Farmer B"
→ one Farmer filter using operator "in"

If the user names multiple values for DIFFERENT columns,
keep them as separate filters because separate filters still
represent AND conditions.

Example:

"employees in PMED with ACTIVE status"

Correct:

[
  {
    "column": "DIVISION",
    "operator": "equals",
    "value": "PMED"
  },
  {
    "column": "STATUS",
    "operator": "equals",
    "value": "ACTIVE"
  }
]

Do NOT use "in" merely because the word "and" appears in the
question.

Use "in" only when multiple values belong to the SAME column.

For multi-entity lookup questions, normally set:

"showAll": true

so every matching entity can be returned.

Use "not_in" only when the user explicitly excludes multiple
values.

Example:

"show employees not in PMED or FOD"

may use:

{
  "column": "DIVISION",
  "operator": "not_in",
  "value": [
    "PMED",
    "FOD"
  ]
}

Do NOT calculate any result yourself.

============================================================
LOOKUP RULES
============================================================

- If the user asks for information about a specific record,
  use "lookup".

Examples:

"farmer with farm id 1011"

"what is the planting month of farm 1011"

"show the farmer and planting month for farm id 1011"

"what is the municipality and irrigation for farm 1011"

These are lookup operations.

- The identifying value belongs in filters.

Example:

{
  "column": "Farm ID",
  "operator": "equals",
  "value": "1011"
}

- Requested result fields belong in selectColumns.

- Do NOT place the identifying key in selectColumns unless the
  user also explicitly asks to return it.

============================================================
MULTIPLE FIELD RULES
============================================================

If the user asks for multiple pieces of information,
ALWAYS preserve all of them.

Examples:

"farmer and municipality"
→ selectColumns contains both matching columns.

"farmer and planting month"
→ selectColumns contains both.

"province, crop and expected yield"
→ selectColumns contains all three.

"farmer, municipality, planting month and irrigation"
→ selectColumns contains all four.

Even if these fields occur in different worksheets,
keep ALL of them.

============================================================
LIST RULES
============================================================

The following normally mean operation "list":

- "list X"
- "list of X"
- "show X"
- "show me X"
- "give me X"
- "what are the X"
- "what is the list of X"
- "display X"

For a normal list request with NO explicit numeric limit,
ALWAYS set:

"showAll": true

Examples:

"list names"
→ operation "list", showAll true

"list of farmers"
→ operation "list", showAll true

"show municipalities"
→ operation "list", showAll true

"what are the provinces"
→ operation "list", showAll true

"give me the farmer names"
→ operation "list", showAll true

Only set:

"showAll": false

when the user EXPLICITLY requests a numeric limit.

Examples:

"list first 10 names"
→ operation "list", showAll false, limit 10

"show 5 farmers"
→ operation "list", showAll false, limit 5

"give me 20 municipalities"
→ operation "list", showAll false, limit 20

Do NOT use the default limit of 10 for an ordinary list request.

If the user asks to list multiple related fields together,
use lookup rather than list.

Example:

"list farmers and their municipality"

→ lookup

with:

"showAll": true

and selectColumns containing both fields.

============================================================
COUNT RULES
============================================================

"how many rows"
"how many records"
"how many entries"

→ row_count

"how many unique X"
"how many distinct X"

→ distinct_count

"how many populated X"
"how many non-empty X"

→ non_empty_count

============================================================
AGGREGATION RULES
============================================================

"total X"
"sum of X"
"what is the total X"

→ sum

"average X"
"mean X"

→ average

"median X"

→ median

"highest X"
"maximum X"
"largest X"

→ maximum

"lowest X"
"minimum X"
"smallest X"

→ minimum

============================================================
GROUPING RULES
============================================================

"count by X"

→ group_count

"total Y by X"

→ group_sum

"average Y by X"

→ group_average

"highest Y by X"

→ group_maximum

"lowest Y by X"

→ group_minimum

============================================================
RANKING RULES
============================================================

"top N X by Y"

usually means:

operation:
"rank_rows"

direction:
"desc"

"bottom N X by Y"

usually means:

operation:
"rank_rows"

direction:
"asc"

"top N X by total Y"

means:

operation:
"rank_groups"

aggregation:
"sum"

direction:
"desc"

"top N X by average Y"

means:

operation:
"rank_groups"

aggregation:
"average"

direction:
"desc"

"bottom N X by total Y"

means:

operation:
"rank_groups"

aggregation:
"sum"

direction:
"asc"

============================================================
NAME TRANSFORM RULES
============================================================

"first name"

means:

"transform": "first_word"

on the appropriate person/name column.

"last name"

means:

"transform": "last_word"

============================================================
GENERAL / NON-DATA QUESTIONS
============================================================

Grammar questions use:

{
  "route": "general"
}

Translation uses:

{
  "route": "general"
}

Writing and rewriting use:

{
  "route": "general"
}

General knowledge uses:

{
  "route": "general"
}


============================================================
CONVERSATION / FOLLOW-UP RULES
============================================================

You may receive CONVERSATION CONTEXT containing:

- isFollowUp
- lastEntity
- lastDataset
- lastIntent
- lastMetric
- lastFilters
- lastPlan

Use this context ONLY to understand what the user means now.
Do not reuse previous dataset values as answers.

If isFollowUp is true, prefer modifying the previous plan rather
than treating the message as unrelated, when the user's wording
clearly refers to the previous question.

Examples:

Previous question:
"What is the total of Irrigated Total Area Planted?"

Follow-up:
"How about Rainfed Total Area Planted?"

Correct behavior:
- preserve the previous analytical operation
- change only the requested metric
- keep the same dataset unless the new metric requires another one

Previous question:
"What is the project ID of 64885?"

Follow-up:
"How about the project title?"

Correct behavior:
- preserve the previous entity/filter
- preserve lookup operation
- replace the requested output field with the newly requested field

Previous question:
"What is the Project ID and Project Title of 64885?"

Follow-up:
"How about 64882?"

Correct behavior:
- preserve the previously requested output fields
- change only the identifying/filter value

Previous question:
"Which Project Title has the highest Allocated Amount?"

Follow-up:
"Concreting of Brgy. Estancia-Brgy. Nalvo FMR is highest."

Correct behavior:
- interpret this as a challenge/correction to the previous analytical result
- preserve the previous metric and ranking intent
- identify the mentioned real entity from RETRIEVED REAL DATA when possible
- produce a structured dataset plan that lets JavaScript verify the user's claim
- do NOT agree with the user from memory or general knowledge
- do NOT calculate the answer yourself

Previous question:
"Which Project Title has the highest Allocated Amount?"

Follow-up:
"Didn't you know Estancia-Brgy. Nalvo is the highest?"

Correct behavior:
- treat this as a request to verify the claim against the current dataset
- do not ask "which column?" when lastPlan/lastMetric clearly provide it

Previous question:
"What is Roberto's authorized salary?"

Follow-up:
"No, I mean actual salary."

Correct behavior:
- preserve entity/filter
- change only the requested metric/output field

Previous question:
"What is the position title of Roberto?"

Follow-up:
"What about Vener?"

Correct behavior:
- preserve the requested field
- change only the entity/filter

IMPORTANT FOLLOW-UP RULES:

- A short phrase such as "how about...", "what about...", "and...", "no, I mean...",
  "didn't you know...", "actually...", or a bare replacement entity/value may be a follow-up.
- If the current wording explicitly names a new real schema column, that new column has priority.
- If the current wording explicitly names a new real entity/filter value, that new value has priority.
- Inherit only the missing parts of the previous plan.
- Never overwrite an explicitly stated current field with an old field.
- Never overwrite an explicitly stated current entity with an old entity.
- Never invent a prior context when isFollowUp is false.
- Never answer a correction/challenge without sending a plan that JavaScript can verify.
- Do not turn a valid follow-up into "general" merely because it is conversational.
- Do not ask for clarification when lastPlan/lastMetric/lastFilters already resolve the ambiguity safely.

============================================================
CLAIM VERIFICATION / CORRECTION RULES
============================================================

Users may challenge or correct a previous answer.

Examples:
- "that's wrong"
- "actually X is the highest"
- "didn't you know X is the highest?"
- "I think X has the lowest value"
- "no, Y should be first"
- "that project is higher"
- "are you sure?"

When this happens:

1. Use the previous plan/context to identify the metric, operation,
   grouping/label field, and relevant dataset.
2. Use any explicitly mentioned current entity/value as the subject to verify.
3. Return a normal DATASET query plan that JavaScript can execute.
4. Do NOT return a conversational apology as the dataset answer.
5. Do NOT trust the user's claim as fact.
6. Do NOT calculate or compare values yourself.
7. If the claim refers to "highest", "lowest", "top", "bottom", or a ranking,
   preserve the previous ranking/maximum/minimum intent when safe.
8. If the claim cannot be verified because the referenced field/entity is absent
   from the supplied schema/retrieval context, use route "clarify".

The purpose is:
Groq understands the correction;
JavaScript verifies whether it is true.

============================================================
AMBIGUITY
============================================================

If multiple columns are equally plausible
and the user's meaning cannot be safely determined,
use:

{
  "route": "clarify",
  "question": "..."
}

Do not guess when the schema genuinely makes the request
ambiguous.

============================================================
FINAL REQUIREMENT
============================================================

Return ONE valid JSON object only.

No Markdown.

No explanation.

No code block.
`;

  const response = await callGroq(
    [
      {
        role: "system",
        content: systemPrompt,
      },

      {
        role: "user",
        content:
          `SCHEMA:\n${JSON.stringify(
            compactSchema
          )}\n\n` +

          `SEMANTIC HINTS:\n${JSON.stringify(
            semanticHints
          )}\n\n` +

          `RETRIEVED REAL DATA:\n${JSON.stringify(
            safeRetrievalContext
          )}\n\n` +

          `CONVERSATION CONTEXT:\n${JSON.stringify(
            safeContext
          )}\n\n` +

          `QUESTION:\n${question}`,
      },
    ],
    {
      temperature: 0,
      maxTokens: 1200,
    }
  );

  const plan =
    extractJsonObject(response);

  // ==========================================================
  // EXACT SCHEMA COLUMN SAFETY NET
  // ==========================================================
  //
  // If the user literally typed a complete real schema column
  // name, prefer that exact column over a semantically similar
  // column selected by Groq. No dataset-specific names are
  // hardcoded here.
  //
  if (
    shouldForceQuestionColumn({
      plan,
      exactColumnMatch:
        exactQuestionColumnMatch,
    })
  ) {
    plan.column =
      exactQuestionColumnMatch.column;

    if (
      exactQuestionColumnMatch.dataset
    ) {
      plan.dataset =
        exactQuestionColumnMatch.dataset;
    }

    if (
      String(plan.operation || "")
        .trim()
        .toLowerCase() === "list"
    ) {
      plan.selectColumns = [
        exactQuestionColumnMatch.column,
      ];
    }
  }

  // ==========================================================
  // NORMALIZE PLAN
  // ==========================================================

  if (
    plan.route === "dataset"
  ) {
    if (
      !Array.isArray(
        plan.filters
      )
    ) {
      plan.filters = [];
    }

    if (
      !Array.isArray(
        plan.selectColumns
      )
    ) {
      plan.selectColumns = [];
    }

    // ========================================================
    // MULTI-ENTITY FILTER NORMALIZATION
    // ========================================================
    //
    // Ensure "in" and "not_in" always use arrays.
    //
    plan.filters = plan.filters
      .map((filter) => {
        if (
          !filter ||
          typeof filter !== "object"
        ) {
          return null;
        }

        const operator = String(
          filter.operator || "equals"
        )
          .trim()
          .toLowerCase();

        if (
          operator === "in" ||
          operator === "not_in"
        ) {
          const values =
            Array.isArray(filter.value)
              ? filter.value
              : [filter.value];

          return {
            ...filter,
            operator,
            value: values.filter(
              (value) =>
                value !== null &&
                value !== undefined &&
                String(value).trim() !== ""
            ),
          };
        }

        return {
          ...filter,
          operator,
        };
      })
      .filter(Boolean);


    // ========================================================
    // MERGE SAME-COLUMN EQUALITY FILTERS
    // ========================================================
    //
    // Safety net:
    // If the planner still emits:
    //
    // NAME = Roberto
    // NAME = Vener
    //
    // merge them into:
    //
    // NAME IN [Roberto, Vener]
    //
    const groupedEquals = new Map();
    const otherFilters = [];

    for (const filter of plan.filters) {
      const operator = String(
        filter.operator || "equals"
      )
        .trim()
        .toLowerCase();

      if (
        operator === "equals" &&
        filter.column &&
        filter.value !== null &&
        filter.value !== undefined &&
        String(filter.value).trim() !== ""
      ) {
        const key = String(filter.column)
          .trim()
          .toLowerCase();

        if (!groupedEquals.has(key)) {
          groupedEquals.set(key, {
            column: filter.column,
            values: [],
          });
        }

        const group =
          groupedEquals.get(key);

        const normalizedValue =
          String(filter.value)
            .trim()
            .toLowerCase();

        if (
          !group.values.some(
            (value) =>
              String(value)
                .trim()
                .toLowerCase() ===
              normalizedValue
          )
        ) {
          group.values.push(
            filter.value
          );
        }

        continue;
      }

      otherFilters.push(filter);
    }

    const mergedEquals = [];

    for (const group of groupedEquals.values()) {
      if (group.values.length === 1) {
        mergedEquals.push({
          column: group.column,
          operator: "equals",
          value: group.values[0],
        });
      } else {
        mergedEquals.push({
          column: group.column,
          operator: "in",
          value: group.values,
        });
      }
    }

    plan.filters = [
      ...mergedEquals,
      ...otherFilters,
    ];

    if (
      typeof plan.showAll !==
      "boolean"
    ) {
      plan.showAll = false;
    }

    if (
      typeof plan.outputRequested !==
      "boolean"
    ) {
      plan.outputRequested =
        plan.operation === "lookup" &&
        plan.selectColumns.length > 0;
    }

    const parsedLimit =
      Number(plan.limit);

    if (
      !Number.isInteger(
        parsedLimit
      ) ||
      parsedLimit <= 0
    ) {
      plan.limit = 10;
    }

    // ========================================================
    // LIST BEHAVIOR
    // ========================================================
    //
    // Ordinary list requests should return the COMPLETE list.
    // Only apply a limit when the user explicitly asks for one.
    //
    // Examples:
    // "list names"              -> showAll = true
    // "list of farmers"         -> showAll = true
    // "what are the provinces"  -> showAll = true
    // "show 5 farmers"          -> showAll = false, limit = 5
    // "first 10 names"          -> showAll = false, limit = 10
    //
    if (
      String(plan.operation || "")
        .trim()
        .toLowerCase() === "list"
    ) {
      const cleanQuestion = String(question || "").trim();

      const explicitLimitPatterns = [
        /\b(?:top|first|last|bottom)\s+(\d+)\b/i,
        /\b(?:show|list|give|display)\s+(?:me\s+)?(?:the\s+)?(?:first\s+)?(\d+)\b/i,
        /\b(\d+)\s+(?:names?|farmers?|records?|rows?|entries?|items?|provinces?|municipalities?|cities?|values?)\b/i,
      ];

      let explicitLimit = null;

      for (const pattern of explicitLimitPatterns) {
        const match = cleanQuestion.match(pattern);

        if (match && Number.isInteger(Number(match[1]))) {
          explicitLimit = Number(match[1]);
          break;
        }
      }

      if (explicitLimit !== null && explicitLimit > 0) {
        plan.showAll = false;
        plan.limit = explicitLimit;
      } else {
        plan.showAll = true;
      }
    }
  }

  return plan;
}

module.exports = {
  callGroq,
  answerGeneralQuestion,
  createSchemaAwarePlan,
};