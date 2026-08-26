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


function compactPlannerSchema(
  schema,
  {
    question = "",
    retrievalContext = null,
    context = null,
    semanticHints = [],
  } = {}
) {
  const normalizedQuestion =
    normalizeColumnMatchText(
      question
    );

  const retrievedDatasets =
    new Set(
      (Array.isArray(
        retrievalContext
      )
        ? retrievalContext
        : []
      )
        .map(
          (item) =>
            String(
              item?.dataset || ""
            )
        )
        .filter(Boolean)
    );

  const retrievedColumnsByDataset =
    new Map();

  for (
    const item of
    Array.isArray(retrievalContext)
      ? retrievalContext
      : []
  ) {
    const datasetName =
      String(
        item?.dataset || ""
      );

    if (!datasetName) {
      continue;
    }

    if (
      !retrievedColumnsByDataset.has(
        datasetName
      )
    ) {
      retrievedColumnsByDataset.set(
        datasetName,
        new Set()
      );
    }

    const bucket =
      retrievedColumnsByDataset.get(
        datasetName
      );

    for (
      const match of
      Array.isArray(
        item?.matchedValues
      )
        ? item.matchedValues
        : []
    ) {
      if (match?.column) {
        bucket.add(
          String(
            match.column
          )
        );
      }
    }
  }

  const semanticColumns =
    new Set(
      (semanticHints || [])
        .map(
          (item) =>
            normalizeColumnMatchText(
              item?.column
            )
        )
        .filter(Boolean)
    );

  const rankedDatasets =
    (schema || [])
      .map((dataset, index) => {
        const datasetName =
          String(
            dataset?.name || ""
          );

        const normalizedDataset =
          normalizeColumnMatchText(
            datasetName
          );

        let score = 0;

        if (
          retrievedDatasets.has(
            datasetName
          )
        ) {
          score += 100;
        }

        if (
          context?.isFollowUp ===
            true &&
          String(
            context?.lastDataset ||
            ""
          ) === datasetName
        ) {
          score += 80;
        }

        if (
          normalizedDataset &&
          normalizedQuestion.includes(
            normalizedDataset
          )
        ) {
          score += 60;
        }

        for (
          const column of
          dataset?.columns || []
        ) {
          const normalizedColumn =
            normalizeColumnMatchText(
              column?.name
            );

          if (
            normalizedColumn &&
            normalizedQuestion.includes(
              normalizedColumn
            )
          ) {
            score += 20;
          }

          if (
            semanticColumns.has(
              normalizedColumn
            )
          ) {
            score += 15;
          }
        }

        return {
          dataset,
          index,
          score,
        };
      })
      .sort(
        (a, b) =>
          b.score -
            a.score ||
          a.index -
            b.index
      );

  const hasRelevantDataset =
    rankedDatasets.some(
      (item) =>
        item.score > 0
    );

  const selectedDatasets =
    hasRelevantDataset
      ? rankedDatasets
          .filter(
            (item) =>
              item.score > 0
          )
          .slice(0, 4)
      : rankedDatasets
          .slice(
            0,
            Math.min(
              4,
              rankedDatasets.length
            )
          );

  return selectedDatasets.map(
    ({ dataset }) => {
      const datasetName =
        String(
          dataset?.name || ""
        );

      const retrievedColumns =
        retrievedColumnsByDataset.get(
          datasetName
        ) ||
        new Set();

      const rankedColumns =
        (dataset?.columns || [])
          .map(
            (column, index) => {
              const columnName =
                String(
                  column?.name || ""
                );

              const normalizedColumn =
                normalizeColumnMatchText(
                  columnName
                );

              let score = 0;

              if (
                retrievedColumns.has(
                  columnName
                )
              ) {
                score += 100;
              }

              if (
                semanticColumns.has(
                  normalizedColumn
                )
              ) {
                score += 80;
              }

              if (
                normalizedColumn &&
                normalizedQuestion.includes(
                  normalizedColumn
                )
              ) {
                score += 70;
              }

              const columnTokens =
                normalizedColumn
                  .split(/\s+/)
                  .filter(
                    (token) =>
                      token.length >= 3
                  );

              for (
                const token of
                columnTokens
              ) {
                if (
                  normalizedQuestion.includes(
                    token
                  )
                ) {
                  score += 2;
                }
              }

              return {
                column,
                index,
                score,
              };
            }
          )
          .sort(
            (a, b) =>
              b.score -
                a.score ||
              a.index -
                b.index
          );

      const relevantColumns =
        rankedColumns.filter(
          (item) =>
            item.score > 0
        );

      const selectedColumns =
        (
          relevantColumns.length
            ? [
                ...relevantColumns,
                ...rankedColumns.filter(
                  (item) =>
                    item.score === 0
                ),
              ]
            : rankedColumns
        )
          .slice(0, 32);

      return {
        name:
          dataset.name,
        rowCount:
          dataset.rowCount,
        columns:
          selectedColumns.map(
            ({ column }) => ({
              name:
                column.name,
              type:
                column.type,
              examples:
                Array.isArray(
                  column.examples
                )
                  ? column.examples
                      .slice(0, 1)
                  : [],
            })
          ),
      };
    }
  );
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
        aliases: aliases.slice(0, 3),
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
      : scored.slice(0, 6);

  return fallback
    .filter((item) =>
      schemaColumns.has(
        normalizeColumnMatchText(item.column)
      )
    )
    .slice(0, 8)
    .map(({ column, aliases }) => ({
      column,
      aliases,
    }));
}

function compactRetrievalContextForPlanner(
  retrievalContext,
  question = ""
) {
  if (!Array.isArray(retrievalContext)) {
    return [];
  }

  const normalizedQuestion =
    normalizeColumnMatchText(
      question
    );

  return retrievalContext
    .filter(
      (dataset) =>
        dataset &&
        typeof dataset === "object"
    )
    .slice(0, 2)
    .map((dataset) => {
      const matchedValues =
        Array.isArray(
          dataset.matchedValues
        )
          ? dataset.matchedValues
              .slice(0, 6)
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
          : [];

      const priorityColumns =
        new Set(
          matchedValues
            .filter(
              (item) =>
                item &&
                typeof item === "object" &&
                item.column
            )
            .map(
              (item) =>
                String(item.column)
            )
        );

      const rows =
        Array.isArray(
          dataset.rows
        )
          ? dataset.rows
              .slice(0, 1)
              .map((row) => {
                if (
                  !row ||
                  typeof row !== "object"
                ) {
                  return row;
                }

                const ranked =
                  Object.entries(row)
                    .map(
                      ([key, value]) => {
                        const normalizedKey =
                          normalizeColumnMatchText(
                            key
                          );

                        let score = 0;

                        if (
                          priorityColumns.has(
                            key
                          )
                        ) {
                          score += 20;
                        }

                        if (
                          normalizedKey &&
                          normalizedQuestion.includes(
                            normalizedKey
                          )
                        ) {
                          score += 15;
                        }

                        return {
                          key,
                          value,
                          score,
                        };
                      }
                    )
                    .sort(
                      (a, b) =>
                        b.score -
                        a.score
                    )
                    .slice(0, 8);

                const compactRow = {};

                for (
                  const item of ranked
                ) {
                  compactRow[
                    item.key
                  ] = item.value;
                }

                return compactRow;
              })
          : [];

      return {
        dataset:
          dataset.dataset || null,
        matchedValues,
        rows,
      };
    });
}

function compactConversationContext(
  context
) {
  if (
    !context ||
    context.isFollowUp !== true
  ) {
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
  const semanticHints =
    compactSemanticHintsForQuestion({
      semanticHints:
        buildSemanticHints(schema),

      question,

      schema,
    });

  const compactSchema =
    compactPlannerSchema(
      schema,
      {
        question,
        retrievalContext,
        context,
        semanticHints,
      }
    );

  const exactQuestionColumnMatch =
    getExactQuestionColumnMatch({
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
      retrievalContext,
      question
    );

  const systemPrompt = `
You are the QUERY PLANNER for a data-grounded chatbot.

Return ONE valid JSON object only. No Markdown or explanation.
JavaScript executes and verifies the plan. Never calculate or answer
dataset values yourself. Never invent worksheet names, columns, filters,
joins, or row values.

ROUTES

Dataset:
{
  "route":"dataset",
  "dataset":"exact worksheet name",
  "operation":"sum|average|median|minimum|maximum|row_count|non_empty_count|distinct_count|list|lookup|group_count|group_sum|group_average|group_minimum|group_maximum|rank_rows|rank_groups",
  "column":"exact metric/output column or null",
  "labelColumn":"exact label column or null",
  "groupBy":"exact grouping column or null",
  "aggregation":"sum|average|count|null",
  "direction":"asc|desc|null",
  "filters":[
    {
      "column":"exact column",
      "operator":"equals|not_equals|contains|starts_with|ends_with|greater_than|greater_or_equal|less_than|less_or_equal|in|not_in",
      "value":"scalar or array for in/not_in"
    }
  ],
  "selectColumns":["exact requested output columns"],
  "outputRequested":true,
  "transform":"first_word|last_word|null",
  "limit":10,
  "showAll":false
}

Schema:
{"route":"schema","intent":"datasets|columns|row_counts|find_column|describe","dataset":null,"column":null}

General:
{"route":"general"}

Clarify:
{"route":"clarify","question":"short clarification"}

RULES

1. Use only worksheet and column names present in SCHEMA.
2. For a record value lookup, use operation "lookup".
3. If one output field is requested, return only that field in selectColumns.
   Preserve all fields only when the user asks for several.
4. Exact user wording matching a real schema column has priority over a
   similar column.
5. SEMANTIC HINTS map user wording to exact schema columns. They identify
   column meaning only; they are never row values.
6. RETRIEVED DATA is evidence for exact worksheet, column, and filter values.
   Do not calculate from it. Use only entities actually requested by the user.
7. Preserve a person's/entity's full identity. Do not split one multi-word
   entity into several entities because shorter values are contained inside it.
8. When one record is identified by multiple independent fields, preserve all
   useful filters. Example: FIRST NAME=DORIS JOY AND LAST NAME=GARCIA.
9. Use an "in" filter only when the user explicitly asks for multiple
   independent values from the same column.
10. For normal list requests with no explicit N, set showAll=true.
11. Requested fields may live in different worksheets. Preserve them;
    JavaScript handles cross-worksheet resolution. Do not invent a join.
12. For rankings use rank_rows/rank_groups with direction and limit.
    If the user asks WHO/WHICH/WHAT entity has the highest/lowest metric,
    the plan MUST include BOTH:
    - the numeric metric in "column"
    - the identifying/entity field in "labelColumn"
    and include both in selectColumns. Do not return a plain lookup for
    this kind of question. For singular highest/lowest use limit=1 unless
    the user explicitly asks for top/bottom N.
    Examples of identity wording are generic: who, which municipality,
    which project, which program, which commodity, which position title.
    Choose the identity column only from the CURRENT SCHEMA.
13. For follow-ups, inherit only missing pieces from CONVERSATION CONTEXT.
    Current explicit field/entity wording overrides old context.
14. If genuinely ambiguous, return route "clarify".
15. If the user challenges a prior answer, create an executable dataset plan
    so JavaScript verifies the claim. Never accept the correction as fact.

Return JSON only.
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
      maxTokens: 600,
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