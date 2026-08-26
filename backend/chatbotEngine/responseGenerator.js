const {
  callGroq,
} = require("./groqService");

const {
  formatVerifiedResultAnswer,
} = require("./responseFormatter");


/**
 * ============================================================
 * RESPONSE GENERATOR
 * ============================================================
 *
 * Architecture:
 *
 * VERIFIED JavaScript result
 *        ↓
 * deterministic local formatter
 *        ↓
 * optional Groq language polish
 *        ↓
 * final answer
 *
 * If Groq is unavailable/rate-limited, the LOCAL answer is already
 * complete and user-friendly.
 *
 * Groq NEVER performs calculations here.
 */


function shouldNaturalize(
  plan,
  result
) {
  if (!result) {
    return false;
  }

  if (
    result.success ===
      false
  ) {
    return false;
  }

  if (
    plan?.route ===
      "clarify" ||
    result?.operation ===
      "clarify"
  ) {
    return false;
  }

  return true;
}


function buildLocalNaturalAnswer({
  question,
  plan,
  result,
}) {
  return formatVerifiedResultAnswer({
    question,
    plan,
    result,
  });
}


function buildCompactVerifiedPayload({
  plan,
  result,
}) {
  /**
   * Send only presentation-relevant verified fields to Groq.
   *
   * This reduces token use and prevents debug/internal fields from
   * distracting the language formatter.
   */
  return {
    operation:
      result?.operation ||
      plan?.operation ||
      null,

    column:
      result?.column ||
      plan?.column ||
      null,

    groupBy:
      result?.groupBy ||
      plan?.groupBy ||
      null,

    labelColumn:
      result?.labelColumn ||
      plan?.labelColumn ||
      null,

    aggregation:
      result?.aggregation ||
      plan?.aggregation ||
      null,

    direction:
      result?.direction ||
      plan?.direction ||
      null,

    value:
      result?.value,

    count:
      result?.count,

    metric:
      result?.metric,

    leftLabel:
      result?.leftLabel,

    rightLabel:
      result?.rightLabel,

    leftValue:
      result?.leftValue,

    rightValue:
      result?.rightValue,

    difference:
      result?.difference,

    percentage:
      result?.percentage,

    winner:
      result?.winner,

    results:
      Array.isArray(
        result?.results
      )
        ? result.results
        : undefined,

    filterGroups:
      Array.isArray(
        result?.filterGroups
      )
        ? result.filterGroups.map(
            (group) => ({
              index:
                group?.index,
              filters:
                group?.filters,
              results:
                group?.results,
            })
          )
        : undefined,
  };
}


/**
 * ============================================================
 * OPTIONAL GROQ POLISH
 * ============================================================
 *
 * Groq receives:
 * - the user's question
 * - the already-good LOCAL answer
 * - a compact VERIFIED payload
 *
 * It is explicitly forbidden from changing facts.
 */
async function generateNaturalResponse({
  question,
  plan,
  result,
}) {
  const fallback =
    buildLocalNaturalAnswer({
      question,
      plan,
      result,
    });

  if (
    !shouldNaturalize(
      plan,
      result
    )
  ) {
    return fallback;
  }

  /**
   * If the local formatter could not produce anything useful,
   * preserve the verified engine answer.
   */
  if (!fallback) {
    return String(
      result?.answer ||
      ""
    ).trim();
  }

  const verifiedPayload =
    buildCompactVerifiedPayload({
      plan,
      result,
    });

  const systemPrompt = `
You are the final language formatter for a data chatbot.

The data and calculations are already VERIFIED by JavaScript.

Your task is ONLY to improve wording.

STRICT RULES:
- Never calculate or recalculate.
- Never change any number.
- Never change a person's name or spelling.
- Never change a place/project/program/commodity/entity name.
- Never change dates, IDs, percentages, counts, rankings, or ordering.
- Never invent facts.
- Never omit a requested returned value.
- Never expose internal dataset/worksheet/debug terminology.
- Do not mention rows, recordsUsed, filters, selectColumns, operation, route, or dataset names unless the user explicitly asks.
- If there are multiple entities, keep each entity paired with its own verified values.
- For grouped calculations, describe the aggregation naturally.
- For rankings, preserve the exact verified order.
- For follow-ups, be concise and conversational.
- Return ONLY the final answer.

The LOCAL ANSWER is already fact-safe. Prefer making only small stylistic improvements.
`.trim();

  try {
    const response =
      await callGroq(
        [
          {
            role:
              "system",
            content:
              systemPrompt,
          },

          {
            role:
              "user",
            content:
              `QUESTION:\n${question}\n\n` +
              `LOCAL ANSWER:\n${fallback}\n\n` +
              `VERIFIED DATA:\n${JSON.stringify(
                verifiedPayload
              )}`,
          },
        ],
        {
          temperature:
            0.05,

          /**
           * Response writing should be short.
           * This also lowers Groq token usage significantly.
           */
          maxTokens:
            500,
        }
      );

    const naturalAnswer =
      String(
        response || ""
      ).trim();

    if (!naturalAnswer) {
      return fallback;
    }

    return naturalAnswer;
  } catch (error) {
    console.error(
      "Natural response generation failed:",
      error?.message ||
      error
    );

    /**
     * Groq failure/rate-limit is harmless here because the local
     * response formatter is designed to be production-quality.
     */
    return fallback;
  }
}


module.exports = {
  generateNaturalResponse,
};
