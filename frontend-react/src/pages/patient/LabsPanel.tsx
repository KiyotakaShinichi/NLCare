import { lazy, Suspense, useMemo } from "react";
import { FlaskConical, Droplet, Heart, Shield, Info } from "lucide-react";
import { SectionCard } from "../../components/ui/SectionCard";
import { LabCard } from "../../components/ui/LabCard";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { NON_DIAGNOSTIC_DISCLAIMER } from "../../lib/clinical-constants";
import type { PatientReport } from "../../types/api";
import { summariseRecords } from "../../lib/recordIntegrity";

// Recharts is ~200 KB gzipped — code-split so the chart only loads when the
// labs panel actually renders.
const LabTrendsChart = lazy(() =>
  import("../../components/charts/LabTrendsChart").then((m) => ({ default: m.LabTrendsChart })),
);

function ChartFallback() {
  return (
    <div
      style={{
        height: 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-faint)",
        fontSize: "0.78rem",
      }}
    >
      Loading chart…
    </div>
  );
}

interface Props { report: PatientReport; lastFetchedAt?: number | null }

/**
 * Lab values panel.  Replaces the older trio of generic ``MetricCard``s with
 * domain-aware ``LabCard``s that read their reference ranges, status
 * thresholds, and tooltip copy from ``lib/clinical-constants.ts`` — the
 * single source of truth shared with the CBC entry form.
 */
export function LabsPanel({ report, lastFetchedAt }: Props) {
  const { latest_labs: labs, lab_history } = report;
  const history = useMemo(() => lab_history ?? [], [lab_history]);

  // Pre-shaped histories per metric so LabCard can render a sparkline + delta
  // without redoing the projection on every render.
  const histories = useMemo(() => ({
    wbc:        history.map((p) => ({ date: p.date, value: p.wbc })),
    hemoglobin: history.map((p) => ({ date: p.date, value: p.hemoglobin })),
    platelets:  history.map((p) => ({ date: p.date, value: p.platelets })),
  }), [history]);

  const lastSampleDate = history.length > 0 ? history[history.length - 1].date : null;

  const sampleCount = summariseRecords(history, (p) => p.date).distinct.length;

  return (
    <SectionCard
      title="Lab values (CBC)"
      icon={FlaskConical}
      meta={
        <span className="flex items-center gap-2">
          {/* Distinct results. The record holds rows identical in every field,
              so a raw length reported 38 samples for 17 results. */}
          <span>
            {sampleCount > 0
              ? `${sampleCount} ${sampleCount === 1 ? "result" : "results"}`
              : "no data"}
          </span>
          {lastFetchedAt != null && <span style={{ opacity: 0.6 }}>·</span>}
          <RelativeTime timestamp={lastFetchedAt ?? null} prefix="updated" />
        </span>
      }
      footer={
        <span className="inline-flex items-start gap-1.5">
          <Info size={11} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
          <span>
            Reference ranges shown are population defaults, not personalised to you.{" "}
            {NON_DIAGNOSTIC_DISCLAIMER}
          </span>
        </span>
      }
    >
      {/* Wraps on the space actually available rather than on screen width.
          A fixed three-column grid gave each card about 107px at 390px and
          clipped "HEMOGLOBIN" and "PLATELETS" mid-word. A viewport breakpoint
          was not enough either: this grid sits inside a column narrower than
          the window, so at 200% zoom three cards still fitted the media query
          while each measured 103px. 180px is the width a card needs for its
          name, value, unit and reference range. */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
      >
        <LabCard
          labKey="wbc"
          icon={Shield}
          value={labs?.wbc ?? null}
          history={histories.wbc}
          lastSampleDate={lastSampleDate}
        />
        <LabCard
          labKey="hemoglobin"
          icon={Heart}
          value={labs?.hemoglobin ?? null}
          history={histories.hemoglobin}
          lastSampleDate={lastSampleDate}
        />
        <LabCard
          labKey="platelets"
          icon={Droplet}
          value={labs?.platelets ?? null}
          history={histories.platelets}
          lastSampleDate={lastSampleDate}
        />
      </div>
      <Suspense fallback={<ChartFallback />}>
        <LabTrendsChart data={lab_history ?? []} />
      </Suspense>
    </SectionCard>
  );
}
