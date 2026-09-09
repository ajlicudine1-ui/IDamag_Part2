/**
 * ============================================================
 * USER-FACING GRAMMAR FINALIZER
 * ============================================================
 *
 * A conservative final pass for already-generated answers.
 *
 * IMPORTANT:
 * - Never changes verified numbers, names, dates, ordering, or data values.
 * - Never rewrites domain meaning.
 * - Only fixes presentation-level spacing and punctuation artifacts that are
 *   safe to correct mechanically.
 * - Semantic subject/verb/preposition grammar belongs in the deterministic
 *   response templates (responseNarrativeEngine / responseFormatter).
 */

function finalizeUserFacingGrammar(answer) {
  let text = String(answer || '').trim();
  if (!text) return text;

  // Normalize non-breaking spaces copied from model/provider output.
  text = text.replace(/\u00a0/g, ' ');

  // Preserve line structure while cleaning horizontal whitespace.
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n');

  // Remove spaces before punctuation and ensure one space after sentence
  // punctuation when another word follows on the same line.
  text = text.replace(/[ \t]+([,.;:!?])/g, '$1');
  text = text.replace(/([,;:])(?=[^\s\n])/g, '$1 ');
  text = text.replace(/([.!?])(?=[A-Za-z])/g, '$1 ');

  // Collapse accidental repeated punctuation without touching ellipses.
  text = text.replace(/,{2,}/g, ',');
  text = text.replace(/;{2,}/g, ';');
  text = text.replace(/:{2,}/g, ':');
  text = text.replace(/!{2,}/g, '!');
  text = text.replace(/\?{2,}/g, '?');

  // Remove duplicated adjacent function words that occasionally appear after
  // template + language-polish composition. Case-insensitive, text-preserving.
  text = text.replace(/\b(the|a|an|is|are|was|were|has|have|had|of|to|for|in|on|at|by)\s+\1\b/gi, '$1');

  // Avoid more than two blank lines in a chatbot bubble.
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

module.exports = {
  finalizeUserFacingGrammar,
};
