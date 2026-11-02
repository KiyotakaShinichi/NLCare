import type { PatientReport } from "../../types/api";
import { OVERVIEW_RANGES, latestRecordTime, rangeCutoff, type OverviewRangeId } from "./overviewRange";

function formatWindow(cutoff: number, anchor: number): string | null {
  if (!anchor) return null;
  const from = new Date(cutoff);
  const to = new Date(anchor);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${fmt(from)} to ${fmt(to)}`;
}

interface Props {
  report: PatientReport;
  range: OverviewRangeId;
  onRangeChange: (id: OverviewRangeId) => void;
  /** Distinct symptom ratings, and the phrase that says what was counted. */
  symptomCount: number;
  symptomPhrase: string;
  symptomNote: string | null;
  /** Distinct lab results, and the phrase that says what was counted. */
  labCount: number;
  labPhrase: string;
  labNote: string | null;
  topicCount: number;
  latestLabDate: string | null;
}

/**
 * Three plain figures and the range control, replacing the four KPI cards the
 * overview used to open with.
 *
 * The old tiles put a count, a status string and a band label in the same
 * display slot, so the row read as four unrelated widgets. These are three
 * counts of the same kind - things in the record - and the window they cover
 * is stated in real dates rather than implied by the control.
 */
export function OverviewGlance({
  report, range, onRangeChange,
  symptomCount, symptomPhrase, symptomNote,
  labCount, labPhrase, labNote, topicCount, latestLabDate,
}: Props) {
  const anchor = latestRecordTime(report);
  const window = formatWindow(rangeCutoff(report, range), anchor);

  return (
    <section className="po-section" aria-labelledby="po-glance">
      <div className="po-section-head">
        <div>
          <h2 id="po-glance" className="po-h2">At a glance</h2>
          <p className="po-meta">
            {window ? `Covering ${window}.` : "Covering the records held for you."}
          </p>
        </div>
        <div className="po-seg" role="group" aria-label="Time range">
          {OVERVIEW_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              onClick={() => onRangeChange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* These were raw array lengths. The record holds rows identical in
          every field, so "39 symptom reports you logged" claimed more than the
          data supports. Each figure now counts distinct records and the label
          says so; rows that could not be told apart are disclosed below rather
          than folded in or dropped. */}
      <div className="po-summary">
        <div className="po-summary-item">
          <div className="po-summary-value po-num">{symptomCount}</div>
          <p className="po-summary-label">{symptomPhrase}</p>
        </div>
        <div className="po-summary-item">
          <div className="po-summary-value po-num">{labCount}</div>
          <p className="po-summary-label">
            {labPhrase}{latestLabDate ? `, latest ${latestLabDate}` : ""}
          </p>
        </div>
        <div className="po-summary-item">
          <div className="po-summary-value po-num">{topicCount}</div>
          <p className="po-summary-label">
            {topicCount === 1 ? "topic" : "topics"} to raise with your team
          </p>
        </div>
      </div>
      {(symptomNote || labNote) && (
        <div className="po-summary-integrity">
          {symptomNote && <p>{symptomNote}</p>}
          {labNote && <p>{labNote}</p>}
        </div>
      )}
    </section>
  );
}
