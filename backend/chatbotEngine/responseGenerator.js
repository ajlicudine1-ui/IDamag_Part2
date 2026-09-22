const {
  callGroq,
} = require("./groqService");

const {
  formatVerifiedResultAnswer,
} = require("./responseFormatter");

const {
  formatNumber,
} = require("./utils");

const {
  buildSemanticVerifiedAnswer,
} = require("./responseNarrativeEngine");

const {
  finalizeUserFacingGrammar,
} = require("./responseGrammarEngine");


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



function decorateVerifiedAnswer(answer, plan, result) {
  let text = String(answer || "").trim();
  if (!text) return text;

  const unit = result?.displayUnit || plan?.displayUnit || result?.unit || plan?.unit || null;
  const scalarValue = result?.value;
  if (unit && scalarValue !== null && scalarValue !== undefined) {
    const formatted = formatNumber(scalarValue);
    if (formatted && !text.toLowerCase().includes(String(unit).toLowerCase())) {
      const escaped = String(formatted).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`\\b${escaped}\\b`), `${formatted} ${unit}`);
    }
  }

  const quality = result?.dataQuality;
  if (quality && quality.missingCount > 0 && quality.missingRate >= 0.05) {
    text += `\n\nNote: ${quality.missingCount} of ${quality.totalRows} matching record(s) had no value for this field.`;
  }
  return text;
}

function buildLocalNaturalAnswer({
  question,
  plan,
  result,
}) {
  const semanticAnswer = buildSemanticVerifiedAnswer({ question, plan, result });
  return finalizeUserFacingGrammar(
    decorateVerifiedAnswer(
      semanticAnswer || formatVerifiedResultAnswer({ question, plan, result }),
      plan,
      result
    )
  );
}


function shouldPreserveDeterministicSemanticAnswer({
  plan,
  result,
  semanticAnswer,
} = {}) {
  if (!semanticAnswer) return false;

  const operation = String(
    result?.operation ||
    plan?.operation ||
    ""
  ).trim().toLowerCase();

  if (!["lookup", "list", "value"].includes(operation)) {
    return false;
  }

  const rows = Array.isArray(result?.results)
    ? result.results
    : [];

  if (!rows.length) return false;

  const labelColumn =
    result?.labelColumn ||
    plan?.labelColumn ||
    null;

  const valueColumn =
    result?.column ||
    plan?.column ||
    null;

  if (!labelColumn || !valueColumn) {
    return false;
  }

  // Preserve the deterministic semantic formatter when the verified result is
  // a paired/relationship lookup (label + requested value). The local
  // formatter already groups multi-value cells and answers the requested field
  // first. Allowing the LLM to rewrite this can re-expand the answer into
  // repetitive "label - value" lines even though the verified local answer is
  // already better.
  return rows.some((row) =>
    row &&
    typeof row === "object" &&
    Object.prototype.hasOwnProperty.call(row, labelColumn) &&
    Object.prototype.hasOwnProperty.call(row, valueColumn)
  );
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

    unit:
      result?.displayUnit || plan?.displayUnit || result?.unit || plan?.unit || undefined,

    metricMeaning:
      result?.metricMeaning || plan?.metricMeaning || undefined,

    metricSource:
      plan?.metricSource || undefined,

    coverage:
      result?.coverage || undefined,

    aggregationPolicy:
      result?.aggregationPolicy || undefined,

    dataQuality:
      result?.dataQuality || undefined,

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
  const semanticAnswer =
    buildSemanticVerifiedAnswer({
      question,
      plan,
      result,
    });

  const fallback =
    finalizeUserFacingGrammar(
      decorateVerifiedAnswer(
        semanticAnswer ||
          formatVerifiedResultAnswer({
            question,
            plan,
            result,
          }),
        plan,
        result
      )
    );

  if (
    shouldPreserveDeterministicSemanticAnswer({
      plan,
      result,
      semanticAnswer,
    })
  ) {
    return fallback;
  }

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
- Preserve and naturally include the verified unit when one is provided.
- Preserve any missing-data note when dataQuality says it is material.
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

    return finalizeUserFacingGrammar(
      naturalAnswer
    );
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
  shouldPreserveDeterministicSemanticAnswer,
};
