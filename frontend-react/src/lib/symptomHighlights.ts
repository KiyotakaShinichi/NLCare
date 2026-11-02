import type { Symptom } from "../types/api";

/**
 * Which records the Symptom Log summary may name, each taken whole.
 *
 * Presentation only: no record is changed, dropped or re-scored. A summary that
 * shows a name, a score and a date together must take all three from one record;
 * it used to pair the newest row's name with the maximum score across every
 * symptom and date.
 *
 * Records carry a date but no time, so the order within one day is unknown. The
 * record order is kept for ties, and the caller says when a day holds several.
 */

/** A rating on the 0-10 scale, or null when the record has no usable one. */
export function ratedSeverity(record: Symptom): number | null {
  const value: unknown = record.severity;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function recordTime(record: Symptom): number | null {
  const time = record.date ? new Date(record.date).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

/** The record's calendar date, or null when it has no valid date. */
export function recordedDate(record: Symptom): string | null {
  return recordTime(record) === null ? null : String(record.date).slice(0, 10);
}

/** Newest first; undated records last. Stable, so ties keep the record's order. */
export function sortNewestFirst(records: readonly Symptom[]): Symptom[] {
  const time = (record: Symptom) => recordTime(record) ?? Number.NEGATIVE_INFINITY;
  return [...records].sort((a, b) => {
    const [ta, tb] = [time(a), time(b)];
    return ta === tb ? 0 : tb > ta ? 1 : -1;
  });
}

export interface SymptomHighlights {
  /** The newest record with a valid date. */
  latest: Symptom | null;
  /** The highest valid rating; on a tie, the newest such record, then record order. */
  highest: Symptom | null;
}

/** Expects `sortNewestFirst` order, so the first match is also the tie-break winner. */
export function symptomHighlights(newestFirst: readonly Symptom[]): SymptomHighlights {
  const latest = newestFirst.find((record) => recordTime(record) !== null) ?? null;
  let highest: Symptom | null = null;
  for (const record of newestFirst) {
    const severity = ratedSeverity(record);
    if (severity !== null && (highest === null || severity > (ratedSeverity(highest) as number))) highest = record;
  }
  return { latest, highest };
}
