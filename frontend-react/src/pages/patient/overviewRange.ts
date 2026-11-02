import type { PatientReport } from "../../types/api";

export const OVERVIEW_RANGES = [
  { id: "3m", label: "3 months", days: 92 },
  { id: "6m", label: "6 months", days: 183 },
  { id: "12m", label: "12 months", days: 365 },
] as const;

export type OverviewRangeId = (typeof OVERVIEW_RANGES)[number]["id"];

/**
 * The newest timestamp anywhere in the record.
 *
 * The range windows are measured back from this rather than from the wall
 * clock. A record that has not been added to for a while is still a record the
 * patient wants to read; anchoring to "today" would show them an empty chart
 * and imply the data had vanished.
 */
export function latestRecordTime(report: PatientReport | null): number {
  if (!report) return 0;
  const times = [
    ...(report.symptoms ?? []).map((s) => new Date(s.date).getTime()),
    ...(report.lab_history ?? []).map((p) => new Date(p.date).getTime()),
  ].filter((n) => Number.isFinite(n));
  return times.length ? Math.max(...times) : 0;
}

export function rangeCutoff(report: PatientReport | null, range: OverviewRangeId): number {
  const days = OVERVIEW_RANGES.find((r) => r.id === range)?.days ?? 183;
  return latestRecordTime(report) - days * 86_400_000;
}
