import { useEffect, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { LabHistoryPoint } from "../../types/api";
import {
  buildLabSeries, computeDomain, toChartPoints, timeDomain, timeTicks,
  type LabSeries, type LabSeriesPoint,
} from "./labSeries";
import { EmptyPane } from "../ui/Spinner";
import "../../styles/lab-trends.css";

/**
 * CBC trends, one chart per analyte.
 *
 * This replaced a single chart that drew WBC (K/uL), hemoglobin (g/dL) and
 * platelets (K/uL) against one unlabelled y-axis. Platelets are an order of
 * magnitude larger than the other two, so they were multiplied by 0.1 to make
 * them fit, and a reader comparing heights was comparing nothing: a hemoglobin
 * of 11.1 g/dL sat above a platelet count of 214 K/uL rendered as 21.4. The
 * scaling was disclosed only in a 10.9px caption.
 *
 * Three separate charts with their own axes remove the question entirely. The
 * x-axis is a real time scale, so irregular sampling intervals are drawn at
 * their true spacing rather than evenly.
 *
 * Nothing is interpolated. `connectNulls` is off and every observation carries
 * a dot, so a gap in sampling reads as a gap instead of a straight line through
 * measurements that were never taken.
 *
 * Labels, units and the analyte order come from `LAB_REFERENCE_RANGES`, the
 * same source the lab cards and the CBC entry form read, so a unit cannot
 * drift between the chart and the rest of the app. No reference band is drawn:
 * the ranges in that file are population defaults, and plotting them over a
 * trend would read as a clinical judgement about this patient.
 */

const LINE_COLOR = "var(--cyan)";

/**
 * The rendered width of a chart, so the number of date labels can be chosen
 * from the space actually available rather than guessed from a breakpoint.
 * Starts at 0, which yields the two-tick floor, so the first paint is already
 * legible and never shows the overlapping axis while it measures.
 */
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

function formatTick(t: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullDate(t: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface TooltipProps {
  active?: boolean;
  payload?: { value: number | null; payload: LabSeriesPoint }[];
  series: LabSeries;
}

function SeriesTooltip({ active, payload, series }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point?.value == null) return null;
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
        boxShadow: "0 4px 12px rgba(17,24,39,0.08)",
        fontSize: 12,
      }}
    >
      <p style={{ fontWeight: 600, color: "var(--text-strong)", marginBottom: 2 }}>
        {formatFullDate(point.t)}
      </p>
      <p style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {series.label}{" "}
        <strong>{point.value}</strong>{" "}
        <span style={{ color: "var(--text-dim)" }}>{series.unit}</span>
      </p>
    </div>
  );
}

/** One analyte's line. `tableHint` says where the reader can find every value. */
export function LabTrendPlot({
  series, height = 150, tickSize = 12, tableHint = "The table below lists every value.",
}: {
  series: LabSeries;
  height?: number;
  tickSize?: number;
  tableHint?: string;
}) {
  const { label, unit, points, observed } = series;
  const [plotRef, plotWidth] = useMeasuredWidth<HTMLDivElement>();
  const xDomain = timeDomain(points);
  const xTicks = timeTicks(xDomain, plotWidth);

  return (
    <div
      ref={plotRef}
      role="img"
      aria-label={
        `${label} trend in ${unit}. ${observed} distinct result` +
        `${observed === 1 ? "" : "s"} between ${formatFullDate(points[0].t)} and ` +
        `${formatFullDate(points[points.length - 1].t)}. ${tableHint}`
      }
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={toChartPoints(series)} margin={{ top: 6, right: 12, left: 4, bottom: 2 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border-soft)" vertical={false} />
          {/* Ticks are supplied, not inferred. Left to itself Recharts drew
              one label per data point - 39 labels in a 180px box with 37 of
              38 adjacent pairs overlapping - and `minTickGap` did not fire,
              because it spaces ticks that already exist rather than
              limiting how many are made. */}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={xDomain}
            ticks={xTicks}
            interval={0}
            tickFormatter={formatTick}
            tick={{ fontSize: tickSize, fill: "var(--text-dim)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            allowDataOverflow={false}
          />
          <YAxis
            tick={{ fontSize: tickSize, fill: "var(--text-dim)" }}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={computeDomain(points)}
            allowDataOverflow={false}
          />
          <Tooltip
            content={<SeriesTooltip series={series} />}
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
          />
          <Line
            type="linear"
            dataKey="value"
            name={label}
            stroke={LINE_COLOR}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: LINE_COLOR }}
            activeDot={{ r: 5, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SeriesPanel({ series }: { series: LabSeries }) {
  const { label, unit, observed } = series;
  const headingId = `lab-trend-${series.key}`;

  return (
    <section className="lab-trend-panel" aria-labelledby={headingId}>
      <div className="lab-trend-head">
        <h3 id={headingId} className="lab-trend-title">
          {label} <span className="lab-trend-unit">{unit}</span>
        </h3>
        <span className="lab-trend-count">
          {observed === 0
            ? "no results"
            : `${observed} ${observed === 1 ? "result" : "results"}`}
        </span>
      </div>

      {observed === 0 ? (
        <p className="lab-trend-empty">
          No {label} results have been recorded yet.
        </p>
      ) : (
        <LabTrendPlot series={series} />
      )}

      {series.gaps.length > 0 && (
        <p className="lab-trend-gap-note">
          {series.gaps.length === 1 ? "A gap of " : "Gaps of "}
          {series.gaps.map((g, i) => (
            <span key={g.fromDate}>
              {i > 0 && (i === series.gaps.length - 1 ? " and " : ", ")}
              {g.days} days ({g.fromDate} to {g.toDate})
            </span>
          ))}
          {series.gaps.length === 1 ? " has" : " have"} no recorded results. The line is broken
          there rather than drawn through.
        </p>
      )}
    </section>
  );
}

/**
 * One row per distinct set of results, with how many rows produced it.
 *
 * Rows were keyed by `row.date` alone. The record holds 23 rows dated
 * 2026-01-01, so React logged 22 duplicate-key errors for this table on every
 * page load - and two of those rows disagree with each other (WBC 6.0 and WBC
 * 1.5 on the same day, same source). Collapsing them to one row would hide a
 * contradiction, so rows that differ are all kept and only rows identical in
 * every analyte are counted together.
 */
function tableRows(series: LabSeries[]) {
  const dates = series[0]?.points ?? [];
  const order: string[] = [];
  const byIdentity = new Map<string, {
    id: string; t: number; date: string; values: (number | null)[]; occurrences: number;
  }>();
  dates.forEach((row, index) => {
    const values = series.map((s) => s.points[index]?.value ?? null);
    const id = `${row.date}|${values.join("|")}`;
    const existing = byIdentity.get(id);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    order.push(id);
    byIdentity.set(id, { id, t: row.t, date: row.date, values, occurrences: 1 });
  });
  return order.map((id) => byIdentity.get(id)!);
}

function TrendTable({ series }: { series: LabSeries[] }) {
  const rows = tableRows(series);
  const repeated = rows.filter((r) => r.occurrences > 1);
  return (
    <details className="lab-trend-table-wrap">
      <summary className="lab-trend-table-toggle">View measurements as a table</summary>
      <div
            className="lab-trend-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Complete blood count table, scrollable sideways"
          >
        <table className="lab-trend-table">
          <caption>
            Complete blood count results by date. Each column states its own unit, dates with no
            result are marked, and the last column says how many rows your record holds for that
            set of values.
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              {series.map((s) => (
                <th scope="col" key={s.key}>
                  {s.label} <span className="lab-trend-unit">{s.unit}</span>
                </th>
              ))}
              <th scope="col">Rows recorded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{formatFullDate(row.t)}</th>
                {series.map((s, i) => {
                  const value = row.values[i] ?? null;
                  return (
                    <td key={s.key} className="tabular-nums">
                      {value == null ? <span className="lab-trend-missing">not measured</span> : value}
                    </td>
                  );
                })}
                <td className="tabular-nums">{row.occurrences}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {repeated.length > 0 && (
        <p className="lab-trend-table-hint">
          Some dates carry more than one row with the same values, and nothing in the record
          tells them apart. They are listed once with a count rather than repeated, and none
          has been removed.
        </p>
      )}
    </details>
  );
}

/** The panel's gap sentence as plain text, so identical notes can be recognised. */
function gapNote(series: LabSeries): string | null {
  if (series.gaps.length === 0) return null;
  const spans = series.gaps.map((g, i) => {
    const sep = i === 0 ? "" : i === series.gaps.length - 1 ? " and " : ", ";
    return `${sep}${g.days} days (${g.fromDate} to ${g.toDate})`;
  }).join("");
  return `${series.gaps.length === 1 ? "A gap of " : "Gaps of "}${spans}${series.gaps.length === 1 ? " has" : " have"} no recorded results. The line is broken there rather than drawn through.`;
}

/** A gap shared by every analyte is said once. Gaps that differ are each named. */
export function GapNotes({ series }: { series: LabSeries[] }) {
  const notes = series.map((s) => ({ label: s.label, note: gapNote(s) })).filter((n) => n.note);
  if (notes.length === 0) return null;
  if (notes.length === series.length && notes.every((n) => n.note === notes[0].note)) {
    return <p className="lab-trend-gap-note">{notes[0].note}</p>;
  }
  return (
    <>
      {notes.map((n) => (
        <p key={n.label} className="lab-trend-gap-note"><strong>{n.label}:</strong> {n.note}</p>
      ))}
    </>
  );
}

export function LabTrendsChart({ data }: { data: LabHistoryPoint[] }) {
  if (!data.length) {
    return <EmptyPane label="No lab history recorded yet" />;
  }
  const series = buildLabSeries(data);

  return (
    <div className="lab-trends">
      <div className="lab-trend-grid">
        {series.map((s) => (
          <SeriesPanel key={s.key} series={s} />
        ))}
      </div>
      <TrendTable series={series} />
    </div>
  );
}
