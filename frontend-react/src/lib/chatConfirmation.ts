/**
 * Could this chat text confirm or cancel a pending record preview?
 *
 * The server resolves a pending preview from the *text* of the next message:
 * a whole-message "confirm save", "yes", "cancel" and similar. The backend
 * matcher is stricter than this one on purpose. This one is deliberately
 * broader, so that when a turn's outcome is unknown the frontend errs towards
 * treating it as a possible write. It is a containment heuristic, not a
 * statement about what the backend will do.
 *
 * Whole-message matching only: "no fever today" or "yes my fatigue was 8" are
 * ordinary conversation and must not freeze the chat.
 */
const AFFIRM = String.raw`yes|y|yep|yeah|ok|okay|sure|confirm|confirmed|i confirm|i-confirm|save|save it|save this|go ahead|proceed|do it|oo|opo|sige|kumpirmahin`;
const NEGATE = String.raw`no|nope|cancel|cancel save|stop|never ?mind|nevermind|do not save|don['’]?t save|huwag|wag|hindi`;
const WHOLE = new RegExp(
  String.raw`^(?:please\s+)?(?:${AFFIRM}|${NEGATE})(?:\s+(?:please|it|this|save|now))?[\s.!?]*$`,
  "i",
);

export function looksLikeConfirmationOrCancel(text: string): boolean {
  const t = String(text ?? "").trim();
  return t.length > 0 && t.length <= 40 && WHOLE.test(t);
}
