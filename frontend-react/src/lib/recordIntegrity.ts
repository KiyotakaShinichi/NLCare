/**
 * Counting records honestly.
 *
 * The demo record contains rows that are byte-identical to one another: 39
 * symptom rows reduce to 8 distinct tuples, 38 lab rows to 17, and the API's
 * `review_reasons` carries one sentence eleven times. All of the duplication
 * sits on a single seed date.
 *
 * The frontend cannot tell whether two identical rows are one event delivered
 * twice or two real events the patient logged minutes apart, because the rows
 * carry no id, no timestamp and no sequence - every field is equal. So this
 * module does not decide. It keeps the raw rows untouched, reports what can be
 * verified (how many distinct records there are, and which days they fall on),
 * and reports separately how many rows it could not distinguish.
 *
 * Nothing here deletes or edits a record. Callers render from `rows` when they
 * need the record itself and from this summary when they need a number, and a
 * number that cannot be justified is not shown at all.
 */

export interface RecordSummary<T> {
  /** Every row exactly as the API returned it, in the order it returned them. */
  rows: T[];
  /** First occurrence of each distinct row. Order follows `rows`. */
  distinct: T[];
  /** Rows that were identical to an earlier row in every field. */
  indistinguishable: number;
  /** Distinct calendar days the distinct rows fall on, ascending. */
  days: string[];
  /** True when at least one row could not be told apart from another. */
  hasIndistinguishable: boolean;
}

/** Stable stringify: key order must not change the identity of a row. */
function identity(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(identity).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${identity(v)}`).join(",")}}`;
}

/**
 * Summarise rows without changing any of them.
 *
 * `dateOf` names the field that carries the day, so `days` can be reported for
 * record types with differently named date fields.
 */
export function summariseRecords<T>(
  rows: readonly T[],
  dateOf: (row: T) => string | null | undefined,
): RecordSummary<T> {
  const seen = new Set<string>();
  const distinct: T[] = [];
  for (const row of rows) {
    const id = identity(row);
    if (seen.has(id)) continue;
    seen.add(id);
    distinct.push(row);
  }
  const days = [...new Set(
    distinct.map((r) => (dateOf(r) ?? "").slice(0, 10)).filter(Boolean),
  )].sort();
  return {
    rows: [...rows],
    distinct,
    indistinguishable: rows.length - distinct.length,
    days,
    hasIndistinguishable: rows.length > distinct.length,
  };
}

/**
 * The sentence a surface shows instead of a bare count.
 *
 * When every row is distinct this is an ordinary count. When it is not, the
 * count is stated as distinct records over named days, and the rows that could
 * not be distinguished are disclosed rather than folded in or thrown away. The
 * wording never asserts that the extra rows are errors, because that is not
 * something the frontend can know.
 */
export function describeRecords<T>(
  summary: RecordSummary<T>,
  singular: string,
  plural: string,
): string {
  const n = summary.distinct.length;
  if (n === 0) return `No ${plural} in this period`;
  const noun = n === 1 ? singular : plural;
  const dayCount = summary.days.length;
  const span = dayCount === 1 ? "on one day" : `across ${dayCount} days`;
  if (!summary.hasIndistinguishable) return `${n} ${noun} ${span}`;
  return `${n} distinct ${noun} ${span}`;
}

/**
 * The same description without its leading number, for a label that sits under
 * a figure which already states it. "8" above "8 distinct ratings across 6
 * days" reads as two different numbers at a glance.
 */
export function describeRecordsLabel<T>(
  summary: RecordSummary<T>,
  singular: string,
  plural: string,
): string {
  return describeRecords(summary, singular, plural).replace(/^(No|\d+)\s+/, "");
}

/** The disclosure that accompanies a count whenever rows could not be told apart. */
export function indistinguishableNote<T>(summary: RecordSummary<T>, plural: string): string | null {
  if (!summary.hasIndistinguishable) return null;
  const n = summary.indistinguishable;
  return (
    `Your record also holds ${n} further ${n === 1 ? "row" : "rows"} that ${n === 1 ? "is" : "are"} ` +
    `identical to ${n === 1 ? "one" : "others"} already shown, with nothing to tell ${n === 1 ? "it" : "them"} ` +
    `apart. ${n === 1 ? "It is" : "They are"} kept in your record but not counted again here, because ` +
    `we cannot tell whether ${n === 1 ? "it is" : "they are"} ${n === 1 ? "a separate report" : "separate reports"} ` +
    `or the same ${plural.replace(/s$/, "")} stored more than once.`
  );
}

/**
 * Collapse identical text for display, keeping the number of occurrences.
 *
 * Used for the API's discussion prompts, where the same sentence can arrive
 * many times because the backend emits one per source row. Showing it once
 * with its count is presentation only: no prompt is dropped, and a prompt that
 * differs by a single character stays separate.
 */
export interface RepeatedText {
  text: string;
  occurrences: number;
}

export function consolidateText(items: readonly string[]): RepeatedText[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const raw of items) {
    const text = String(raw).trim();
    if (!text) continue;
    if (!counts.has(text)) order.push(text);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return order.map((text) => ({ text, occurrences: counts.get(text) ?? 1 }));
}

/**
 * Days where one measure carries more than one value.
 *
 * The demo record contains a day that disagrees with itself: 2026-01-01 holds
 * WBC 6.0 and WBC 1.5 from the same source, and fatigue rated 0, 3 and 10.
 * These are not duplicates - they are contradictions, and they are what
 * produces the record's most urgent discussion prompt.
 *
 * Collapsing them would pick a winner the record does not support, and
 * averaging them would invent a value that was never recorded. So they are
 * reported, and the surface shows the disagreement instead of an answer.
 */
export interface ValueConflict {
  day: string;
  measure: string;
  /** Distinct values, ascending. */
  values: number[];
  /** How many rows hold each distinct value, same order as `values`. */
  counts: number[];
  /** Total rows behind the conflict. */
  rows: number;
}

export function findConflicts<T>(
  rows: readonly T[],
  dateOf: (row: T) => string | null | undefined,
  measureOf: (row: T) => string,
  valueOf: (row: T) => number | null | undefined,
): ValueConflict[] {
  const buckets = new Map<string, { day: string; measure: string; values: Map<number, number> }>();
  for (const row of rows) {
    const day = (dateOf(row) ?? "").slice(0, 10);
    const value = valueOf(row);
    if (!day || typeof value !== "number" || !Number.isFinite(value)) continue;
    const measure = measureOf(row);
    const key = `${day}|${measure}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.values.set(value, (bucket.values.get(value) ?? 0) + 1);
    else buckets.set(key, { day, measure, values: new Map([[value, 1]]) });
  }
  return [...buckets.values()]
    .filter((b) => b.values.size > 1)
    .map((b) => {
      const values = [...b.values.keys()].sort((a, c) => a - c);
      const counts = values.map((v) => b.values.get(v) ?? 0);
      return { day: b.day, measure: b.measure, values, counts, rows: counts.reduce((a, c) => a + c, 0) };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.measure.localeCompare(b.measure));
}

/**
 * One sentence naming a disagreement, without resolving it.
 *
 * Wording matters here. An earlier version said the record "disagrees with
 * itself and nothing in it says which is right", which asserts that one of the
 * values is wrong. The frontend cannot know that. Two values for one measure on
 * one day may be two genuine observations, or one observation stored twice, or
 * a generation artefact - and the record carries no time, no sequence and no
 * id to tell those apart. It is an open question, not a confirmed error.
 */
export function describeConflict(c: ValueConflict, unit?: string): string {
  const withUnit = (v: number) => (unit ? `${v} ${unit}` : String(v));
  const parts = c.values.map((v, i) => `${c.counts[i]} ${c.counts[i] === 1 ? "row" : "rows"} with ${withUnit(v)}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts.join("");
  return `${c.measure} on ${c.day} appears in ${c.rows} rows holding ${c.values.length} different values: ${list}. The record carries no time of day, no order and no separate identifier for these rows, so it cannot be told whether they are separate observations, repeated entries or one stored inconsistently.`;
}

/**
 * Repeated same-day ratings, which are not a disagreement.
 *
 * Patient-reported severity legitimately varies through a day - fatigue at 0 in
 * the morning and 10 by evening is a normal record, not a broken one. Treating
 * it as a contradiction would teach the reader to distrust their own reporting.
 * It is described as a range instead.
 */
export function describeRepeatedRatings(c: ValueConflict): string {
  const sorted = [...c.values].sort((a, b) => a - b);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  return `You rated ${c.measure} ${c.values.length} times on ${c.day}, from ${low} to ${high} out of 10. Severity can change through a day, so these are kept as separate ratings rather than combined.`;
}

/**
 * Whether two rows for one measure are comparable enough to call a question.
 *
 * On 2026-01-01 the record holds two CBC panels whose hemoglobin and platelets
 * are identical and whose WBC differs. Two independent blood draws would differ in
 * all three; one analyte differing while the others match exactly is the shape
 * of a copy, not of a second sample. That is reported as context, and it is
 * still not a verdict - only the backend can say which value is real.
 */
export function siblingsMatch<T>(
  rows: readonly T[],
  day: string,
  dateOf: (row: T) => string | null | undefined,
  others: ((row: T) => number | null | undefined)[],
): boolean {
  const onDay = rows.filter((r) => (dateOf(r) ?? "").slice(0, 10) === day);
  if (onDay.length < 2) return false;
  return others.every((get) => {
    const values = new Set(onDay.map(get).filter((v) => typeof v === "number"));
    return values.size === 1;
  });
}
