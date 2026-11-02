import { useEffect, useRef, useState } from "react";
import {
  ScatterChart, Scatter, Symbols, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { Symptom } from "../../types/api";
import { summariseRecords } from "../../lib/recordIntegrity";
import { timeTicks } from "./labSeries";
import "../../styles/symptom-chart.css";

/**
 * Patient-reported symptom severity over time.
 *
 * A dot plot, not a line. Symptom reports are events the patient chose to log,
 * not a monitored signal: joining them would draw severity for every day in
 * between, none of which was reported. Each dot is one report and nothing is
 * drawn where nothing was recorded.
 *
 * Severity is a single 0-10 scale shared by every symptom, so one axis serves
 * them all - unlike the lab analytes, which carry three different units. The
 * axis is pinned to [0, 10] so a quiet month cannot auto-scale itself into
 * looking severe.
 *
 * On aggregation, and on what a dot is. The record can contain rows that are
 * identical in every field - same day, same symptom, same severity, same notes,
 * and no id or timestamp to tell them apart. A dot is drawn once per distinct
 * rating, so the earlier caption "one dot per report" was false: 39 rows
 * produced 8 dots. The caption now says what is actually drawn and the count of
 * rows that could not be distinguished is stated rather than hidden. Where the
 * same symptom carries different severities on one day, every one of them is
 * plotted - contradictory ratings are shown as they are, not averaged away.
 */

const SERIES_COLORS = ["#0E7490", "#1E3A5F", "#0F766E", "#5B21B6", "#9D174D"];

/**
 * A shape as well as a colour, so symptoms can be told apart without colour
 * vision. Amber replaces teal-green here, which was nearly identical to teal.
 */
const MARKERS = [
  { type: "circle", color: "#0E7490" },
  { type: "diamond", color: "#1E3A5F" },
  { type: "square", color: "#B45309" },
  { type: "triangle", color: "#5B21B6" },
  { type: "star", color: "#9D174D" },
  { type: "cross", color: "#0F766E" },
  { type: "wye", color: "#44536A" },
] as const;

export interface SymptomTrendChartProps {
  symptoms: Symptom[];
  height?: number;
  /** Compact axes and fewer ticks for narrow columns. */
  dense?: boolean;
  /** Larger dots for the hero placement on the overview. */
  emphasis?: boolean;
  /**
   * Every symptom in the record. Turns on marker shapes, and keeps each symptom's
   * marker the same when the list is filtered.
   */
  markerNames?: readonly string[];
}

interface Row {
  t: number;
  severity: number;
  symptom: string;
  date: string;
  notes: string;
  /** Rows identical to this one, including itself. */
  occurrences: number;
  /** Unique within the chart: date, symptom and severity together. */
  id: string;
}

/**
 * One row per distinct rating, carrying how many identical rows produced it.
 *
 * Keys were previously `${date}-${symptom}`, which collided whenever a day
 * held the same symptom twice - the demo record did so 34 times and React
 * logged 451 duplicate-key errors on every page load. Severity is part of the
 * identity now, and identical rows collapse to one entry rather than competing
 * for the same key.
 */
function groupSymptoms(symptoms: Symptom[]): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  const seen = new Map<string, Row>();
  for (const s of symptoms) {
    const t = new Date(s.date).getTime();
    if (Number.isNaN(t) || typeof s.severity !== "number") continue;
    const id = `${s.date}|${s.symptom}|${s.severity}`;
    const existing = seen.get(id);
    if (existing) {
      existing.occurrences += 1;
      continue;
    }
    const row: Row = {
      t, severity: s.severity, symptom: s.symptom, date: s.date,
      notes: s.notes, occurrences: 1, id,
    };
    seen.set(id, row);
    const bucket = grouped.get(s.symptom);
    if (bucket) bucket.push(row);
    else grouped.set(s.symptom, [row]);
  }
  return grouped;
}

/** Chart width, so the date axis can choose how many labels it has room for. */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function fmtDate(t: number) {
  const d = new Date(t);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function DotTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: Row }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="po-tooltip">
      <p className="po-tooltip-title">{row.symptom}</p>
      <p className="po-tooltip-value">
        Severity <strong>{row.severity}</strong> of 10
      </p>
      <p className="po-tooltip-meta">
        {new Date(row.t).toLocaleDateString(undefined, {
          year: "numeric", month: "long", day: "numeric",
        })}
      </p>
      {row.notes && <p className="po-tooltip-note">{row.notes}</p>}
    </div>
  );
}

export function SymptomTrendChart({
  symptoms, height = 260, dense = false, emphasis = false, markerNames,
}: SymptomTrendChartProps) {
  const [plotRef, plotWidth] = useMeasuredWidth<HTMLDivElement>();
  const grouped = groupSymptoms(symptoms);
  const series = [...grouped.entries()];
  const total = series.reduce((n, [, rows]) => n + rows.length, 0);
  const summary = summariseRecords(
    symptoms.filter((s) => typeof s.severity === "number"),
    (s) => s.date,
  );

  if (total === 0) {
    return (
      <div className="po-chart-empty">
        <p>No symptoms logged yet.</p>
        <p className="po-chart-empty-hint">
          Anything you record in the support chat appears here.
        </p>
      </div>
    );
  }

  const times = series.flatMap(([, rows]) => rows.map((r) => r.t));
  const span: [number, number] = [Math.min(...times), Math.max(...times)];
  const pad = Math.max((span[1] - span[0]) * 0.06, 86_400_000);
  const tickSize = markerNames ? 13 : 12;
  const markerFor = (name: string) =>
    markerNames ? MARKERS[Math.max(0, markerNames.indexOf(name)) % MARKERS.length] : null;

  const table = (
    <div
      className="po-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Symptom ratings table, scrollable sideways"
    >
      <table className="po-table">
        <caption>
          Every distinct rating, newest first, with how many identical rows your record
          holds for it.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Symptom</th>
            <th scope="col">Severity (0-10)</th>
            <th scope="col">Rows recorded</th>
          </tr>
        </thead>
        <tbody>
          {series
            .flatMap(([, rows]) => rows)
            .sort((a, b) => b.date.localeCompare(a.date) || a.symptom.localeCompare(b.symptom))
            .map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.date}</th>
                <td>{row.symptom}</td>
                <td className="po-num">{row.severity}</td>
                <td className="po-num">{row.occurrences}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <figure className="po-chart-figure">
      <div
        ref={plotRef}
        role="img"
        aria-label={
          `Symptom severity dot plot. ${total} distinct rating${total === 1 ? "" : "s"} ` +
          `across ${series.length} symptom${series.length === 1 ? "" : "s"} on ` +
          `${summary.days.length} day${summary.days.length === 1 ? "" : "s"}, ` +
          `severity on a 0 to 10 scale. One dot per distinct rating; ` +
          `the table below lists every one with how many times it was recorded.`
        }
      >
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 8, right: 14, left: dense ? -8 : 4, bottom: 4 }}>
            <CartesianGrid stroke={"var(--po-pearl-line)"} strokeDasharray="2 5" vertical={false} />
            {/* Explicit ticks, as on the lab charts: Recharts generated one
                label per point and `minTickGap` did not prevent it. */}
            <XAxis
              type="number"
              dataKey="t"
              domain={[span[0] - pad, span[1] + pad]}
              ticks={timeTicks([span[0] - pad, span[1] + pad], plotWidth)}
              interval={0}
              scale="time"
              tickFormatter={fmtDate}
              tick={{ fontSize: tickSize, fill: "var(--po-ink-3)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--po-pearl-line)" }}
            />
            <YAxis
              type="number"
              dataKey="severity"
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 8, 10]}
              tick={{ fontSize: tickSize, fill: "var(--po-ink-3)" }}
              tickLine={false}
              axisLine={false}
              width={dense ? 32 : 40}
              label={dense ? undefined : {
                value: "Severity (0-10)",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: markerNames ? 13 : 10, fill: "var(--po-ink-3)", textAnchor: "middle" },
              }}
            />
            <ZAxis range={emphasis ? [150, 150] : [70, 70]} />
            <Tooltip content={<DotTooltip />} cursor={{ stroke: "var(--po-pearl-line)" }} />
            {series.map(([name, rows], i) => (
              <Scatter
                key={name}
                name={name}
                data={rows}
                // Recharts keys its own children; `id` keeps ours unique too.
                fill={markerFor(name)?.color ?? SERIES_COLORS[i % SERIES_COLORS.length]}
                shape={markerFor(name)?.type}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <figcaption className="po-legend">
        {series.map(([name, rows], i) => (
          <span key={name} className="po-legend-item" data-marker={markerFor(name)?.type}>
            {markerNames ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <Symbols cx={8} cy={8} size={70} type={markerFor(name)!.type} fill={markerFor(name)!.color} />
              </svg>
            ) : (
              <span
                className="po-legend-dot"
                style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
              />
            )}
            {name}
            <span className="po-legend-count">
              {rows.length} {rows.length === 1 ? "rating" : "ratings"}
            </span>
          </span>
        ))}
      </figcaption>

      {/* What the plot actually shows, stated rather than implied. The old
          caption said "each dot is one report", which stopped being true the
          moment the record held two identical rows. */}
      <p className="po-chart-note">
        One dot for each distinct rating you recorded: {total}{" "}
        {total === 1 ? "dot" : "dots"} across {summary.days.length}{" "}
        {summary.days.length === 1 ? "day" : "days"}. Where you rated the same symptom
        differently on one day, every rating is plotted. The spaces between dots are days
        nothing was recorded, not days you were well.
      </p>
      {summary.hasIndistinguishable && (
        <p className="po-chart-note po-chart-note--integrity">
          Your record holds {summary.indistinguishable} further{" "}
          {summary.indistinguishable === 1 ? "row" : "rows"} identical to{" "}
          {summary.indistinguishable === 1 ? "one" : "ones"} already plotted, with no date, time or
          note to tell {summary.indistinguishable === 1 ? "it" : "them"} apart.{" "}
          {summary.indistinguishable === 1 ? "It is" : "They are"} kept in your record and listed in
          the table below, but not drawn again here.
        </p>
      )}

      <details className="po-disclosure">
        <summary>View reports as a table</summary>
        {table}
      </details>
    </figure>
  );
}
