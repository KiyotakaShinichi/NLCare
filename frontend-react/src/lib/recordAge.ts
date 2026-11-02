import type { PatientReport } from "../types/api";

/**
 * Telling the patient what is actually true about time.
 *
 * The audit found that every recency cue on the portal described the browser's
 * own refresh rather than the record: "Today's summary" over a record whose
 * newest row is five months old, a hard-coded "updated just now", and a
 * relative timestamp fed from the fetch time. A reader reasonably concluded
 * their status was current.
 *
 * Everything here is derived from dates already in the payload. Nothing is
 * assumed, and where the payload says nothing the functions return null rather
 * than a comforting default.
 */

const DAY_MS = 86_400_000;

export interface RecordAge {
  /** Newest date across every kind of record, ISO yyyy-mm-dd. Null if empty. */
  latestDate: string | null;
  /** Whole days between that date and now. Null when there is no record. */
  ageDays: number | null;
  /** Newest date per stream, so the page can say which part is stale. */
  latestByStream: { labs: string | null; symptoms: string | null; timeline: string | null };
  /** True once the newest record is older than 60 days. */
  isStale: boolean;
}

function newest(dates: (string | null | undefined)[]): string | null {
  const valid = dates
    .map((d) => (d ?? "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return valid.length ? valid.sort()[valid.length - 1] : null;
}

export function deriveRecordAge(report: PatientReport | null, now = Date.now()): RecordAge {
  const labs = newest((report?.lab_history ?? []).map((p) => p.date));
  const symptoms = newest((report?.symptoms ?? []).map((s) => s.date));
  const timeline = newest((report?.timeline ?? []).map((e) => e.date));
  const latestDate = newest([labs, symptoms, timeline]);
  const t = latestDate ? Date.parse(`${latestDate}T00:00:00Z`) : NaN;
  const ageDays = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
  return {
    latestDate,
    ageDays,
    latestByStream: { labs, symptoms, timeline },
    isStale: ageDays != null && ageDays > 60,
  };
}

/** "17 May 2026" — one date format for the whole preview. */
export function formatRecordDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** How long ago, in words, without implying anything about what it means. */
export function describeAge(ageDays: number | null): string | null {
  if (ageDays == null) return null;
  if (ageDays === 0) return "today";
  if (ageDays === 1) return "yesterday";
  if (ageDays < 31) return `${ageDays} days ago`;
  const months = Math.floor(ageDays / 30);
  if (months < 24) return `about ${months} month${months === 1 ? "" : "s"} ago`;
  return `about ${Math.floor(months / 12)} years ago`;
}

/**
 * The sentence that replaces "Today's summary" and "updated just now".
 *
 * It names the newest record and how old it is, and it never characterises the
 * patient's condition. "Nothing has been recorded since" is a statement about
 * the record, not about health.
 */
export function recordAgeSentence(age: RecordAge): string {
  const date = formatRecordDate(age.latestDate);
  if (!date) return "No dated records yet.";
  const ago = describeAge(age.ageDays);
  const suffix = ago && age.ageDays && age.ageDays > 0 ? ` — recorded ${ago}` : "";
  return `The newest thing in your record is from ${date}${suffix}.`;
}

/**
 * The same fact, scoped to what `deriveRecordAge` actually measures.
 *
 * `deriveRecordAge` looks at lab results, symptom ratings and timeline events
 * only - observations. "The newest thing in your record" over-claims: the demo
 * patient's record holds a clinician review entry three days old while the
 * newest observation is five months old. The live Overview uses this wording;
 * `recordAgeSentence` is kept unchanged for the preview routes that use it.
 */
export function observationAgeSentence(age: RecordAge): string {
  const date = formatRecordDate(age.latestDate);
  if (!date) return "No dated observations yet.";
  const ago = describeAge(age.ageDays);
  const suffix = ago && age.ageDays && age.ageDays > 0 ? ` — recorded ${ago}` : "";
  return `Your newest observation is from ${date}${suffix}.`;
}

/**
 * What a gap in reporting is, said neutrally.
 *
 * The old chip read "No new symptoms" in a positive tone, which turns an
 * absence of reporting into a finding of wellness. This states the absence and
 * nothing else.
 */
export function symptomGapSentence(age: RecordAge): string | null {
  const date = formatRecordDate(age.latestByStream.symptoms);
  if (!date) return "No symptom ratings recorded yet.";
  const days = age.latestByStream.symptoms
    ? Math.max(0, Math.floor((Date.now() - Date.parse(`${age.latestByStream.symptoms}T00:00:00Z`)) / DAY_MS))
    : null;
  if (days != null && days <= 7) return null;
  return `No symptom rating has been recorded since ${date}. That is a gap in the record, not a statement about how you are.`;
}

/**
 * Separating the browser's refresh from the record's date.
 *
 * Both are true and they mean different things, so the preview shows them as
 * two labelled facts rather than one ambiguous "updated" string.
 */
export function loadedSentence(fetchedAt: number | null): string | null {
  if (fetchedAt == null) return null;
  const d = new Date(fetchedAt);
  if (Number.isNaN(d.getTime())) return null;
  return `This page loaded at ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. That is when your browser fetched the record, not when anything was measured.`;
}
