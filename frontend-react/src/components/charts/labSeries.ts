import type { LabHistoryPoint } from "../../types/api";
import { LAB_REFERENCE_RANGES } from "../../lib/clinical-constants";

/**
 * The data projection behind the CBC trend charts, kept apart from the
 * component so it can be tested directly and so Fast Refresh keeps working.
 *
 * The rule this module exists to enforce: a measurement is carried from the API
 * to the screen unchanged. An earlier version of the chart multiplied platelets
 * by 0.1 so all three analytes would fit one axis, which made the rendered
 * heights meaningless. Nothing here scales, rounds, converts or fills.
 */

const SERIES_KEYS = ["wbc", "hemoglobin", "platelets"] as const;
export type LabSeriesKey = (typeof SERIES_KEYS)[number];

export interface LabSeriesPoint {
  /** The date exactly as the API supplied it. */
  date: string;
  /** Epoch milliseconds, for the time axis. */
  t: number;
  /** The measurement, untransformed. `null` means not measured that day. */
  value: number | null;
}

/** A stretch of time with no measurement, long enough to be worth stating. */
export interface LabGap {
  fromDate: string;
  toDate: string;
  days: number;
}

export interface LabSeries {
  key: LabSeriesKey;
  label: string;
  unit: string;
  points: LabSeriesPoint[];
  /**
   * Distinct measurements: one per (date, value) pair.
   *
   * This was a raw count of rows carrying a value, which reported "38
   * measurements" for a record holding 17 distinct results - the same
   * inflation as the headline counts, in the chart's own header.
   */
  observed: number;
  /** Rows behind those measurements, including ones identical to each other. */
  rowsBehind: number;
  /** Intervals the chart must not draw a continuous line across. */
  gaps: LabGap[];
}

const DAY_MS = 86_400_000;

/** A gap counts when it is both unusual for this patient and absolutely long. */
export const GAP_MIN_DAYS = 30;
export const GAP_CADENCE_MULTIPLE = 3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Stretches between consecutive measurements that should read as "nothing was
 * recorded here" rather than as a trend.
 *
 * `connectNulls={false}` alone does not achieve this. It breaks a line only
 * where a null *point* exists, and the API returns a row per sampling date -
 * so two results six months apart are two adjacent rows, and the chart happily
 * draws one straight segment between them. That segment looks like continuous
 * monitoring. These gaps are what the chart breaks on instead.
 *
 * The rule is relative and absolute at once: longer than three times this
 * patient's usual sampling interval, and at least thirty days. Weekly
 * chemotherapy bloods and a twice-yearly check therefore get different
 * thresholds, and neither is a clinical judgement about the patient.
 *
 * Each interval is measured against the median of the *other* intervals, never
 * including itself. Otherwise two results six months apart would set a
 * six-month cadence and conclude that six months is normal, which is exactly
 * the case that most needs breaking. With fewer than three measurements there
 * is no cadence to speak of, so only the absolute floor applies.
 */
export function findGaps(points: LabSeriesPoint[]): LabGap[] {
  const observed = points.filter((p) => p.value != null);
  if (observed.length < 2) return [];
  const deltas = observed.slice(1).map((p, i) => p.t - observed[i].t);
  const gaps: LabGap[] = [];
  for (let i = 1; i < observed.length; i += 1) {
    const delta = observed[i].t - observed[i - 1].t;
    const others = deltas.filter((_, index) => index !== i - 1);
    const threshold = Math.max(
      median(others) * GAP_CADENCE_MULTIPLE,
      GAP_MIN_DAYS * DAY_MS,
    );
    if (delta > threshold) {
      gaps.push({
        fromDate: observed[i - 1].date,
        toDate: observed[i].date,
        days: Math.round(delta / DAY_MS),
      });
    }
  }
  return gaps;
}

/**
 * The array handed to Recharts: the real observations, plus a null-valued
 * marker inside each gap so the line breaks there.
 *
 * The marker carries no measurement. It exists only to stop one segment being
 * drawn across months in which nothing was recorded.
 */
export function toChartPoints(series: LabSeries): LabSeriesPoint[] {
  if (series.gaps.length === 0) return series.points;
  const breakAfter = new Map(series.gaps.map((g) => [g.fromDate, g]));
  const out: LabSeriesPoint[] = [];
  for (const point of series.points) {
    out.push(point);
    const gap = breakAfter.get(point.date);
    if (gap) {
      out.push({ date: `${gap.fromDate}..${gap.toDate}`, t: point.t + 1, value: null });
    }
  }
  return out;
}

/**
 * A y-domain that always contains every measurement.
 *
 * Computed here rather than left to Recharts' "auto" so it can be asserted in a
 * test: an outlier must widen the axis, never be cropped out of it.
 */
/** A round step near one tenth of the span, so ticks land on readable values. */
function niceStep(span: number): number {
  const exponent = Math.floor(Math.log10(span));
  const base = 10 ** exponent;
  const normalized = span / base;
  const multiple = normalized <= 1.5 ? 0.2 : normalized <= 3 ? 0.5 : normalized <= 7 ? 1 : 2;
  return multiple * base;
}

/** Floating-point tidy-up: 2.0000000000000004 is not a tick label. */
function clean(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(value.toFixed(decimals));
}

export function computeDomain(points: LabSeriesPoint[]): [number, number] {
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(min) * 0.2 || 1;
  const step = niceStep(span);
  // Rounded outward, never inward, so the bounds cannot crop a measurement.
  return [
    clean(Math.floor(min / step) * step, step),
    clean(Math.ceil(max / step) * step, step),
  ];
}

/**
 * Explicit date ticks for a time axis, chosen from the domain and the width.
 *
 * Recharts was left to pick its own ticks, with `minTickGap` as the only
 * guard. Measured on the rendered SVG that produced **39 labels in a 180px
 * box, 37 of 38 adjacent pairs overlapping** - the axis rendered as a grey
 * smear. `minTickGap` governs the spacing of ticks Recharts has already
 * decided to draw; it does not stop a tick being generated per data point, so
 * it never fired.
 *
 * Ticks are therefore computed here and passed in. The count comes from the
 * width, at roughly one label per 86px - enough for "May 17" plus breathing
 * room at 11px - clamped to between two and six. Two is the floor because an
 * axis still has to say where it starts and ends.
 *
 * The values are real timestamps inside the domain, evenly spaced, with the
 * first and last pinned to the domain bounds so the axis never implies the
 * series extends past its data. They are not rounded to month boundaries: a
 * label must name a position the axis actually reaches.
 */
export const TICK_PX_PER_LABEL = 86;
export const MIN_TICKS = 2;
export const MAX_TICKS = 6;

export function tickCountForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return MIN_TICKS;
  const fits = Math.floor(width / TICK_PX_PER_LABEL);
  return Math.max(MIN_TICKS, Math.min(MAX_TICKS, fits));
}

export function timeTicks(domain: [number, number], width: number): number[] {
  const [start, end] = domain;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  if (end <= start) return [start];
  const count = tickCountForWidth(width);
  if (count <= 2) return [start, end];
  const step = (end - start) / (count - 1);
  const ticks: number[] = [];
  for (let i = 0; i < count; i += 1) ticks.push(Math.round(start + step * i));
  ticks[ticks.length - 1] = end;
  return ticks;
}

/** The time domain of a series, from its observations only. */
export function timeDomain(points: LabSeriesPoint[]): [number, number] {
  const times = points.filter((p) => p.value != null).map((p) => p.t);
  if (times.length === 0) return [0, 0];
  return [Math.min(...times), Math.max(...times)];
}

/**
 * Project the API's history into one series per analyte.
 *
 * Points whose value is null are kept rather than dropped, so the chart can
 * break its line there and the table can say "not measured" instead of leaving
 * a cell that reads as zero.
 */
export function buildLabSeries(data: LabHistoryPoint[]): LabSeries[] {
  const ordered = [...data].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  return SERIES_KEYS.map((key) => {
    const meta = LAB_REFERENCE_RANGES[key];
    const points = ordered.map((row) => ({
      date: row.date,
      t: new Date(row.date).getTime(),
      value: row[key] ?? null,
    }));
    const withValue = points.filter((p) => p.value != null);
    const distinct = new Set(withValue.map((p) => `${p.date}|${p.value}`));
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      points,
      observed: distinct.size,
      rowsBehind: withValue.length,
      gaps: findGaps(points),
    };
  });
}
