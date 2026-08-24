const {
  callGroq,
} = require("./groqService");

/**
 * ============================================================
 * LOCAL NATURAL RESPONSE FALLBACK
 * ============================================================
 *
 * This function is used when Groq is unavailable,
 * rate-limited, or fails.
 *
 * IMPORTANT:
 *
 * It NEVER recalculates anything.
 * It NEVER changes result.value.
 * It only changes how the verified answer is presented.
 */
function buildLocalNaturalAnswer({
  question,
  plan,
  result,
}) {
  const originalAnswer = String(
    result?.answer || ""
  ).trim();

  if (!originalAnswer) {
    return "";
  }

  const operation = String(
    result?.operation ||
    plan?.operation ||
    ""
  )
    .toLowerCase()
    .trim();

  const column = String(
    result?.column ||
    plan?.column ||
    ""
  ).trim();

  const questionText = String(
    question || ""
  ).trim();

  /**
   * ==========================================================
   * SUM
   * ==========================================================
   *
   * Prefer the structured verified value instead of trying
   * to extract/recalculate anything from the answer text.
   */
  if (
    operation === "sum" &&
    result?.value !== undefined &&
    result?.value !== null
  ) {
    const value =
      formatVerifiedValue(
        result.value
      );

    if (column) {
      return `The total ${column} is ${value}.`;
    }

    return `The total is ${value}.`;
  }

  /**
   * ==========================================================
   * AVERAGE
   * ==========================================================
   */
  if (
    (
      operation === "average" ||
      operation === "avg" ||
      operation === "mean"
    ) &&
    result?.value !== undefined &&
    result?.value !== null
  ) {
    const value =
      formatVerifiedValue(
        result.value
      );

    if (column) {
      return `The average ${column} is ${value}.`;
    }

    return `The average is ${value}.`;
  }

  /**
   * ==========================================================
   * MINIMUM
   * ==========================================================
   */
  if (
    (
      operation === "min" ||
      operation === "minimum" ||
      operation === "lowest"
    ) &&
    result?.value !== undefined &&
    result?.value !== null
  ) {
    const value =
      formatVerifiedValue(
        result.value
      );

    if (column) {
      return `The lowest ${column} is ${value}.`;
    }

    return `The lowest value is ${value}.`;
  }

  /**
   * ==========================================================
   * MAXIMUM
   * ==========================================================
   */
  if (
    (
      operation === "max" ||
      operation === "maximum" ||
      operation === "highest"
    ) &&
    result?.value !== undefined &&
    result?.value !== null
  ) {
    const value =
      formatVerifiedValue(
        result.value
      );

    if (column) {
      return `The highest ${column} is ${value}.`;
    }

    return `The highest value is ${value}.`;
  }

  /**
   * ==========================================================
   * COUNT
   * ==========================================================
   */
  if (
    operation === "count" &&
    result?.value !== undefined &&
    result?.value !== null
  ) {
    const value =
      formatVerifiedValue(
        result.value
      );

    const subject =
      inferCountSubject(
        questionText
      );

    if (subject) {
      return `There are ${value} ${subject}.`;
    }

    return `The total count is ${value}.`;
  }

  /**
   * ==========================================================
   * STRUCTURED LOOKUP VALUE
   * ==========================================================
   *
   * If calculationEngine provides a direct value, use it.
   */
  if (
    (
      operation === "lookup" ||
      operation === "value"
    ) &&
    result?.value !== undefined &&
    result?.value !== null
  ) {
    const value =
      formatVerifiedValue(
        result.value
      );

    if (column) {
      return `${humanizeColumnName(column)} is ${value}.`;
    }

    return String(value);
  }

  /**
   * ==========================================================
   * GENERIC SAFE CLEANUP
   * ==========================================================
   *
   * For result types that do not have structured handling,
   * clean the existing VERIFIED answer.
   *
   * We are NOT changing values.
   */
  return cleanTechnicalAnswer(
    originalAnswer
  );
}

/**
 * Format an already verified value.
 *
 * This does NOT calculate anything.
 */
function formatVerifiedValue(
  value
) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return new Intl.NumberFormat(
      "en-US",
      {
        maximumFractionDigits: 2,
      }
    ).format(value);
  }

  return String(
    value ?? ""
  ).trim();
}

/**
 * Makes database-style column names more readable
 * without changing their meaning.
 */
function humanizeColumnName(
  column
) {
  return String(
    column || ""
  )
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to identify what the user is counting.
 *
 * Examples:
 *
 * "How many employees are in PMED?"
 * -> "employees in PMED"
 *
 * "How many farmers are in Ilocos Norte?"
 * -> "farmers in Ilocos Norte"
 */
function inferCountSubject(
  question
) {
  const text = String(
    question || ""
  )
    .replace(/[?!.]+$/g, "")
    .trim();

  if (!text) {
    return "";
  }

  const howManyMatch =
    text.match(
      /^how many\s+(.+)$/i
    );

  if (howManyMatch) {
    return String(
      howManyMatch[1] || ""
    )
      .trim()
      .replace(
        /^(?:is|are)\s+/i,
        ""
      );
  }

  const numberOfMatch =
    text.match(
      /(?:number|count)\s+of\s+(.+)$/i
    );

  if (numberOfMatch) {
    return String(
      numberOfMatch[1] || ""
    ).trim();
  }

  return "";
}

/**
 * ============================================================
 * GENERIC TECHNICAL ANSWER CLEANER
 * ============================================================
 *
 * Used only if we cannot create a structured local response.
 *
 * It removes obvious internal terminology while preserving
 * the verified content.
 */
function cleanTechnicalAnswer(
  answer
) {
  let text = String(
    answer || ""
  ).trim();

  if (!text) {
    return "";
  }

  /**
   * Example:
   *
   * "The sum Irrigated Total Area Planted in Sheet1 is
   * 199,134, based on 124 record(s)."
   *
   * becomes:
   *
   * "The sum Irrigated Total Area Planted is 199,134."
   */

  text = text.replace(
    /\s+in\s+Sheet\d+\s+is\s+/gi,
    " is "
  );

  /**
   * Other generic worksheet naming.
   *
   * Be conservative here so real user-facing names
   * are not accidentally removed.
   */
  text = text.replace(
    /,\s*based on\s+\d+\s+record\(s\)\.?/gi,
    "."
  );

  text = text.replace(
    /\s+based on\s+\d+\s+record\(s\)\.?/gi,
    "."
  );

  /**
   * Clean duplicated spaces.
   */
  text = text
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

/**
 * Returns a human-friendly LOCAL answer if
 * Groq natural-response generation fails.
 */
function fallbackAnswer({
  question,
  plan,
  result,
}) {
  return buildLocalNaturalAnswer({
    question,
    plan,
    result,
  });
}

/**
 * Determines whether a result should be
 * rewritten naturally.
 */
function shouldNaturalize(
  plan,
  result
) {
  if (!result) {
    return false;
  }

  if (
    result.success === false
  ) {
    return false;
  }

  if (
    !result.answer ||
    typeof result.answer !==
      "string"
  ) {
    return false;
  }

  /**
   * Clarification messages should remain
   * deterministic.
   */
  if (
    plan?.route === "clarify"
  ) {
    return false;
  }

  return true;
}

/**
 * Produce a human-friendly answer using ONLY
 * the already verified result.
 *
 * Groq is a LANGUAGE FORMATTER only.
 *
 * JavaScript remains responsible for all
 * calculations.
 */
async function generateNaturalResponse({
  question,
  plan,
  result,
}) {
  const fallback =
    fallbackAnswer({
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

  const systemPrompt = `
You are the final response writer for the I-DAMAG chatbot.

Your ONLY job is to rewrite an already VERIFIED answer into
clear, concise, natural language.

============================================================
ABSOLUTE DATA SAFETY RULES
============================================================

The VERIFIED RESULT was calculated by JavaScript from the
current dataset.

You MUST trust the VERIFIED RESULT.

You MUST NOT:

- recalculate anything
- estimate anything
- change numeric values
- change names
- change dates
- change percentages
- change counts
- change rankings
- add dataset facts
- remove important requested values
- invent explanations
- invent context
- infer facts that are not present
- answer from your own knowledge
- answer from general knowledge

You are a LANGUAGE FORMATTER only.

============================================================
INTERNAL DATA NAMES
============================================================

Never expose internal worksheet or dataset names unless the
user specifically asks about them.

Examples of internal names that should normally NOT appear:

- Sheet1
- Sheet2
- PERMANENT ONLY
- worksheet names
- dataset names

Do not mention how many database records were used unless the
user specifically asks.

Bad:

"The sum Irrigated Total Area Planted in Sheet1 is 199,134,
based on 124 record(s)."

Good:

"The total Irrigated Total Area Planted is 199,134."

============================================================
NUMBERS
============================================================

Every factual number in the final answer must come directly
from the VERIFIED RESULT.

Never perform arithmetic.

If the verified result says:

167129

you may format it as:

167,129

but you must not change its value.

If the verified result already includes a currency symbol,
preserve it.

Do not add a currency symbol unless the verified result or
field meaning clearly provides one.

============================================================
LOOKUPS
============================================================

For a simple lookup, answer naturally and directly.

Example:

Question:
"What is the actual salary of Roberto Perales?"

Verified result:
"ACTUAL SALARY: 167,129.00"

Good:
"Roberto Perales' actual salary is 167,129.00."

Do not use unnecessary phrases such as:

- according to the provided data
- based on the information
- it appears that
- approximately

unless uncertainty is actually present in the verified result.

============================================================
FOLLOW-UP QUESTIONS
============================================================

Follow-up answers should sound conversational.

Example:

Question:
"What is his position title?"

Verified result:
"POSITION TITLE: DIRECTOR IV"

Good:
"His position title is Director IV."

Do not repeat unnecessary information unless it improves
clarity.

============================================================
COUNTS
============================================================

For count questions, describe WHAT the user asked to count,
not the technical database rows.

Use the wording of the user's question to identify the subject.

Example:

Question:
"How many employees are in PMED?"

Verified result:
"There are 15 record(s) in PERMANENT ONLY where DIVISION
equals \\"PMED\\"."

Good:
"There are 15 employees in PMED."

Bad:
"There are 15 record(s) in PERMANENT ONLY where DIVISION
equals PMED."

Another example:

Question:
"How many farmers are in Ilocos Norte?"

Verified result:
"There are 54 record(s) where PROVINCE equals Ilocos Norte."

Good:
"There are 54 farmers in Ilocos Norte."

IMPORTANT:

- "record(s)" is internal database terminology.
- Do not use "record(s)" when the user's question clearly
  identifies what is being counted.
- Do not mention worksheet names unless necessary.
- Do not expose internal filter syntax.
- NEVER change the verified count.

============================================================
AGGREGATES
============================================================

Use natural aggregate wording.

Instead of:

"The sum Irrigated Total Area Planted in Sheet1 is 199,134,
based on 124 record(s)."

Say:

"The total Irrigated Total Area Planted is 199,134."

Instead of:

"The sum Rainfed Total Area Planted in Sheet1 is 111,553,
based on 119 record(s)."

Say:

"The total Rainfed Total Area Planted is 111,553."

Never change the verified numeric value.

============================================================
LISTS
============================================================

If the verified result contains a list:

- preserve every returned item
- preserve the order when meaningful
- do not invent additional items
- do not silently remove items
- use a readable numbered or bulleted list when appropriate

============================================================
RANKINGS
============================================================

Preserve:

- ranking order
- labels
- values
- requested limit

Never reorder a verified ranking.

============================================================
STYLE
============================================================

Use natural conversational English.

Be concise.

Avoid robotic database language.

Do not expose:

- record(s)
- rows
- worksheet
- dataset
- Sheet1
- Sheet2
- where COLUMN equals VALUE
- selectColumns
- filters
- operation
- route

unless the user specifically asks about the underlying
data structure.

Return ONLY the final user-facing answer.
`;

  try {
    const response =
      await callGroq(
        [
          {
            role: "system",
            content:
              systemPrompt,
          },

          {
            role: "user",
            content:
              `QUESTION:\n${question}\n\n` +
              `OPERATION:\n${String(
                plan?.operation || ""
              )}\n\n` +
              `VERIFIED RESULT:\n${JSON.stringify(
                result
              )}`,
          },
        ],
        {
          temperature: 0.1,
          maxTokens: 1200,
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
      error
    );

    /**
     * Groq failed, but we DO NOT return the
     * ugly calculationEngine response anymore.
     *
     * Instead we use the verified structured
     * result to create a local natural answer.
     */
    return fallback;
  }
}

module.exports = {
  generateNaturalResponse,
};