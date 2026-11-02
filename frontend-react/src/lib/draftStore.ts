import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AuthContext } from "../context/authContextCore";

/**
 * In-memory, patient-scoped holding area for unsaved form drafts and for the
 * state of the save that is sending them.
 *
 * Why it exists: the genetic-counselling forms live inside the Overview, which
 * React unmounts when the patient opens Support and remounts on return. Local
 * `useState` therefore lost whatever had been typed, silently.
 *
 * Why it is shaped like this:
 *   - Module memory only. Nothing is written to localStorage, sessionStorage or
 *     IndexedDB, so a draft of family-history or genetic-test details never
 *     outlives the tab and never lands on disk. A reload clears it.
 *   - Keyed by patient id, so a draft typed for one patient can never be
 *     rendered for another.
 *   - Cleared on every `setSession` and `clearSession` (see AuthContext), i.e.
 *     on sign-in, sign-out and any change of authenticated patient.
 *   - Components read it through `useSyncExternalStore`, so a mounted form
 *     follows the store whoever changed it, and a remounted form starts from it.
 *
 * Save lifecycle. A save used to be tracked in the panel instance, which is
 * exactly what unmounts. Leaving during a save and returning showed the
 * submitted text again, and a failure while away left no message. The lifecycle
 * (pending / failed) now lives here, next to the draft it belongs to, and the
 * reset after a success is applied to the *stored* draft rather than to
 * whichever panel instance happens to exist.
 *
 * This is not idempotency. Refusing a second `beginOperation` stops this tab
 * from submitting the same form twice while a request is outstanding; it cannot
 * stop another tab, a retry after reload, or a client that bypasses the UI. The
 * server has to deduplicate.
 */
const drafts = new Map<string, Map<string, unknown>>();

export interface Operation { id: number; status: "pending" | "failed" }
const operations = new Map<string, Map<string, Operation>>();
let nextOperationId = 1;

const listeners = new Set<() => void>();
function emit(): void { listeners.forEach((l) => l()); }
export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function bucket<V>(map: Map<string, Map<string, V>>, patientId: string): Map<string, V> {
  let b = map.get(patientId);
  if (!b) { b = new Map(); map.set(patientId, b); }
  return b;
}

export function readDraft<T>(patientId: string | null, key: string): T | undefined {
  if (!patientId) return undefined;
  return drafts.get(patientId)?.get(key) as T | undefined;
}

export function writeDraft<T>(patientId: string | null, key: string, value: T): void {
  if (!patientId) return;
  bucket(drafts, patientId).set(key, value);
  emit();
}

export function clearDraft(patientId: string | null, key: string): void {
  if (!patientId) return;
  drafts.get(patientId)?.delete(key);
  emit();
}

/** Drops every draft and every operation for every patient. Called on sign-in, sign-out and patient change. */
export function clearAllDrafts(): void {
  drafts.clear();
  operations.clear();
  emit();
}

export function readOperation(patientId: string | null, key: string): Operation | undefined {
  if (!patientId) return undefined;
  return operations.get(patientId)?.get(key);
}

/**
 * Start a save. Returns its id, or null if one is already pending for this
 * patient and form (or there is no patient). A previous failure is replaced.
 */
export function beginOperation(patientId: string | null, key: string): number | null {
  if (!patientId) return null;
  const b = bucket(operations, patientId);
  if (b.get(key)?.status === "pending") return null;
  const id = nextOperationId++;
  b.set(key, { id, status: "pending" });
  emit();
  return id;
}

/**
 * The save succeeded. Applies `reset` to the stored draft (so only what was
 * submitted is cleared; `reset` receives the current draft and keeps anything
 * edited since) and ends the operation. Returns false, and changes nothing, if
 * this operation is unknown or already finished - for instance because the
 * patient signed out, which discards operations - so a late response can never
 * touch another patient's form or recreate a draft after sign-out.
 */
export function completeOperation<T>(
  patientId: string | null, key: string, id: number, reset: (current: T) => T,
): boolean {
  if (!patientId) return false;
  const b = operations.get(patientId);
  const op = b?.get(key);
  if (!b || !op || op.id !== id || op.status !== "pending") return false;
  b.delete(key);
  const current = readDraft<T>(patientId, key);
  if (current !== undefined) bucket(drafts, patientId).set(key, reset(current));
  emit();
  return true;
}

/** The save failed. The draft is untouched and the failure stays until the next attempt. */
export function failOperation(patientId: string | null, key: string, id: number): boolean {
  if (!patientId) return false;
  const b = operations.get(patientId);
  const op = b?.get(key);
  if (!b || !op || op.id !== id || op.status !== "pending") return false;
  b.set(key, { id, status: "failed" });
  emit();
  return true;
}

/**
 * `useState` whose value lives in the draft store under `key` for the signed-in
 * patient. Without an authenticated patient (or outside the auth provider) it
 * behaves exactly like `useState`.
 *
 * Identity changes. The value is derived from the store for the *current*
 * patient on every render, so if the authenticated patient changes while the
 * component stays mounted the previous patient's text is never shown. Updates
 * issued by callbacks created for the previous patient are ignored.
 */
export function useDraftState<T>(key: string, initial: T) {
  const patientId = useContext(AuthContext)?.patientId ?? null;
  const [fallback, setFallback] = useState<T>(initial);
  // The first `initial`, held stably: callers pass a fresh object literal every render.
  const [initialValue] = useState<T>(initial);
  const stored = useSyncExternalStore(
    subscribeDrafts,
    () => readDraft<T>(patientId, key),
    () => undefined,
  );
  const value = patientId ? (stored ?? initialValue) : fallback;

  const current = useRef(patientId);
  useEffect(() => { current.current = patientId; });

  // The store is written here, synchronously, and not inside a state updater: an
  // updater only runs when React next renders the component, and the dashboard
  // unmounts the panel in the same tick as a successful save.
  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      if (current.current !== patientId) return;
      if (patientId === null) { setFallback(next); return; }
      const prev = readDraft<T>(patientId, key) ?? initialValue;
      writeDraft(patientId, key, typeof next === "function" ? (next as (p: T) => T)(prev) : next);
    },
    [patientId, key, initialValue],
  );

  return [value, update] as const;
}

export type OperationStatus = "idle" | "pending" | "failed";

/**
 * Bound view of the save lifecycle for one form of the current patient.
 * `begin` returns null while a save is already pending, including one started
 * by an earlier mount of the same form.
 */
export function useDraftOperation(key: string) {
  const patientId = useContext(AuthContext)?.patientId ?? null;
  const op = useSyncExternalStore(
    subscribeDrafts,
    () => readOperation(patientId, key),
    () => undefined,
  );
  const status: OperationStatus = op?.status ?? "idle";
  const begin = useCallback(() => beginOperation(patientId, key), [patientId, key]);
  const complete = useCallback(
    <T>(id: number, reset: (current: T) => T) => completeOperation<T>(patientId, key, id, reset),
    [patientId, key],
  );
  const fail = useCallback((id: number) => failOperation(patientId, key, id), [patientId, key]);
  return { status, begin, complete, fail };
}
