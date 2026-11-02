import { useState } from "react";
import { Activity } from "lucide-react";
import { SectionCard } from "../../components/ui/SectionCard";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { EmptyState } from "../../components/ui/states";
import type { Symptom } from "../../types/api";
import { summariseRecords } from "../../lib/recordIntegrity";
import { ratedSeverity, recordedDate, sortNewestFirst, symptomHighlights } from "../../lib/symptomHighlights";
import "../../styles/symptom-summary.css";

interface Props {
  symptoms: Symptom[];
  /** Compact mode = used as a side panel beside another card; trims notes
   *  and shows fewer rows so it doesn't dwarf the column it sits in. */
  compact?: boolean;
  lastFetchedAt?: number | null;
}

function SeverityBar({ value, compact }: { value: number; compact?: boolean }) {
  const color =
    value >= 7 ? "#dc2626" :
    value >= 4 ? "#d97706" : "#059669";
  // The bar keeps its colour; these darker versions meet 4.5:1 as small text on
  // the white rows and on the grey summary. Same thresholds.
  const textColor =
    value >= 7 ? "#b91c1c" :
    value >= 4 ? "#92400e" : "#047857";
  const label =
    value >= 7 ? "Severe" :
    value >= 4 ? "Moderate" : "Mild";
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 rounded-full"
        style={{ height: 4, background: "var(--surface2)", minWidth: 24 }}
      >
        <div
          className="rounded-full transition-all"
          style={{
            width: `${(value / 10) * 100}%`,
            height: 4,
            background: color,
          }}
        />
      </div>
      <span
        className="tabular-nums font-semibold"
        style={{ color: textColor, fontSize: "max(13px, 0.8rem)", minWidth: 18, textAlign: "right" }}
      >
        {value}
      </span>
      {!compact && (
        <span
          className="font-medium"
          style={{ color: "var(--text-faint)", fontSize: "0.7rem", minWidth: 56, textAlign: "right" }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/** One record's name, score and date, always together. */
function SymptomFact({ label, record, note }: { label: string; record: Symptom; note?: string | null }) {
  const severity = ratedSeverity(record);
  return (
    <div className="symptom-fact">
      <dt className="symptom-fact-label">{label}</dt>
      <dd className="symptom-fact-body">
        <span className="symptom-summary-name">{record.symptom || "Symptom name not recorded"}</span>
        {severity === null ? (
          <span className="symptom-severity-missing">Severity not recorded</span>
        ) : (
          <>
            <span className="sr-only">Severity {severity} out of 10.</span>
            <div className="symptom-summary-bar" aria-hidden="true">
              <SeverityBar value={severity} compact />
            </div>
          </>
        )}
        <span className="symptom-summary-meta">{recordedDate(record) ?? "Date not recorded"}</span>
        {note && <span className="symptom-summary-meta">{note}</span>}
      </dd>
    </div>
  );
}

export function SymptomsTable({ symptoms, compact = false, lastFetchedAt }: Props) {
  const sorted = sortNewestFirst(symptoms ?? []);
  const [expanded, setExpanded] = useState(false);
  const initialLimit = 5;
  const visible = expanded ? sorted : sorted.slice(0, initialLimit);
  const hiddenCount = Math.max(0, sorted.length - visible.length);

  // Summary row: each entry names one record, so a name is never paired with
  // another record's score or date.
  const { latest, highest } = symptomHighlights(sorted);
  // Distinct ratings. The record can hold rows identical in every field, so
  // a raw length here disagreed with the overview's verified count.
  const distinctCount = summariseRecords(sorted, (x) => x.date).distinct.length;
  // Records have no time of day, so "latest" within a busy day cannot be known.
  const latestDate = latest ? recordedDate(latest) : null;
  const ratingsOnLatestDate = latestDate
    ? summariseRecords(sorted.filter((x) => recordedDate(x) === latestDate), (x) => x.date).distinct.length
    : 0;
  const latestNote = ratingsOnLatestDate > 1 ? `One of ${ratingsOnLatestDate} ratings recorded on this date.` : null;
  const highestSeverity = highest ? ratedSeverity(highest) : null;
  const summaryTone =
    highestSeverity === null ? null :
    highestSeverity >= 7 ? "concern" :
    highestSeverity >= 4 ? "watch" : "good";

  return (
    <SectionCard
      title="Symptom log"
      icon={Activity}
      collapsible
      collapseId="patient-symptom-log"
      meta={
        <span className="flex items-center gap-2">
          {sorted.length > 0 && (
            <span>
              {distinctCount} distinct
              {sorted.length !== distinctCount && ` · ${sorted.length} rows`}
            </span>
          )}
          {sorted.length > 0 && lastFetchedAt != null && <span style={{ opacity: 0.6 }}>·</span>}
          <RelativeTime timestamp={lastFetchedAt ?? null} prefix="updated" />
        </span>
      }
    >
      {sorted.length === 0 ? (
        <EmptyState label="No symptoms recorded — add new ones from the support chat." />
      ) : (
        <>
          {(latest || highest) && (
            <div className={`symptom-summary symptom-summary--facts${summaryTone ? ` symptom-summary--${summaryTone}` : ""}`}>
              <dl className="symptom-facts">
                {latest && latest === highest ? (
                  <SymptomFact label="Latest recorded symptom and highest recorded severity" record={latest} note={latestNote} />
                ) : (
                  <>
                    {latest && <SymptomFact label="Latest recorded symptom" record={latest} note={latestNote} />}
                    {highest && <SymptomFact label="Highest recorded severity" record={highest} />}
                  </>
                )}
              </dl>
              <span className="symptom-summary-meta">
                {distinctCount} distinct
                {" "}{distinctCount === 1 ? "rating" : "ratings"}
                {sorted.length !== distinctCount && ` from ${sorted.length} rows`}
              </span>
            </div>
          )}
          <ul className={compact ? "symptom-list symptom-list--compact" : "symptom-list"}>
            {visible.map((s, i) => (
              <li key={i} className={compact ? "symptom-row symptom-row--compact" : "symptom-row"}>
                <span className="symptom-date">{s.date?.slice(5, 10)}</span>
                <div className="symptom-info">
                  <p className="symptom-name">{s.symptom}</p>
                  {!compact && s.notes && <p className="symptom-notes">{s.notes}</p>}
                </div>
                <div className="symptom-severity">
                  {ratedSeverity(s) === null
                    ? <span className="symptom-severity-missing">Severity not recorded</span>
                    : <SeverityBar value={s.severity} compact={compact} />}
                </div>
              </li>
            ))}
          </ul>
          {(hiddenCount > 0 || expanded) && (
            <button
              type="button"
              className="symptom-view-all"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded
                ? `Show latest ${initialLimit} only`
                : `View all ${sorted.length} ${sorted.length === 1 ? "row" : "rows"}`}
            </button>
          )}
        </>
      )}
    </SectionCard>
  );
}
