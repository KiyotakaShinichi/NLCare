import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Fail-closed handling of a chat turn whose outcome is unknown.
 *
 * What is known: aborting `fetch` only disconnects this browser; the server
 * keeps working and has persisted a confirmed write 35-64 s after the client
 * gave up. What is not available: no existing endpoint reports an action's
 * identity or terminal status (the only audit route is the destructive
 * `DELETE /me/record-write-actions/{id}`, which needs an id the client does not
 * have). So the frontend cannot learn the outcome, and does not pretend to.
 *
 * What it does instead is contain: while held, the chat composer, keyboard
 * submission, quick actions and the confirmation cards cannot send anything
 * that could confirm or cancel again. Reading records and using the dedicated
 * record forms is unaffected.
 *
 * What does NOT release the hold: a change in the chat history. Any message
 * pair - another tab, a late earlier turn, an unrelated question - changes it,
 * and none of that says anything about the action in doubt. The only way out is
 * the patient's own acknowledgement, offered after a successful refresh of their
 * conversation and records, so that they have been shown the current state.
 *
 * Persistence: a content-free marker in `sessionStorage` lets the hold survive
 * a hard reload in the same tab. It holds no message text and no patient
 * identifier, and sign-in and sign-out remove it. It cannot reach another tab
 * or device; that needs server-side state.
 */
export const OUTCOME_HOLD_STORAGE_KEY = "nlcare.chatOutcomeHold.v1";

export type HoldPhase = "idle" | "refreshing" | "refreshed" | "failed";

export interface ConfirmationHold {
  phase: HoldPhase;
  /** True only after a refresh succeeded in this page load. */
  canAcknowledge: boolean;
  onRefresh: () => Promise<void> | void;
  onAcknowledge: () => void;
}

interface Stored { held: boolean; quarantine: string[] }

function readStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(OUTCOME_HOLD_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v?.held !== "boolean" || !Array.isArray(v.quarantine)) return null;
    return { held: v.held, quarantine: v.quarantine.filter((x): x is string => typeof x === "string").slice(0, 200) };
  } catch {
    return null;
  }
}

function writeStored(s: Stored): void {
  try { sessionStorage.setItem(OUTCOME_HOLD_STORAGE_KEY, JSON.stringify(s)); } catch { /* storage unavailable: containment is then in-memory only */ }
}

/** Called on sign-in and sign-out so a held chat is never inherited by another patient. */
export function clearOutcomeHold(): void {
  try { sessionStorage.removeItem(OUTCOME_HOLD_STORAGE_KEY); } catch { /* ignore */ }
}

interface Options<H> {
  /** Loads the conversation from the server. Must throw on failure. */
  loadHistory: () => Promise<H>;
  /** Refresh the views the patient will read (chat, report). Called after a successful load. */
  onRefreshed: () => void;
}

export function useChatOutcomeHold<H>({ loadHistory, onRefreshed }: Options<H>) {
  const [stored, setStored] = useState<Stored | null>(readStored);
  const [phase, setPhase] = useState<HoldPhase>("idle");
  const running = useRef(false);

  const begin = useCallback((pendingMessageIds: string[]) => {
    setStored((cur) => {
      const quarantine = [...new Set([...(cur?.quarantine ?? []), ...pendingMessageIds])];
      const next = { held: true, quarantine };
      writeStored(next);
      return next;
    });
    setPhase("idle");
  }, []);

  const onRefresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPhase("refreshing");
    try {
      await loadHistory();
      setPhase("refreshed");
      onRefreshed();
    } catch {
      setPhase("failed");
    } finally {
      running.current = false;
    }
  }, [loadHistory, onRefreshed]);

  const onAcknowledge = useCallback(() => {
    if (phase !== "refreshed") return;
    setStored((cur) => {
      const next = { held: false, quarantine: cur?.quarantine ?? [] };
      writeStored(next);
      return next;
    });
  }, [phase]);

  const hold: ConfirmationHold | null = stored?.held
    ? { phase, canAcknowledge: phase === "refreshed", onRefresh, onAcknowledge }
    : null;
  const quarantined: ReadonlySet<string> = useMemo(() => new Set(stored?.quarantine ?? []), [stored]);
  return { hold, quarantined, begin };
}
