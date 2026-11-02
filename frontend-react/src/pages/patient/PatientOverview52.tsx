import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, PlusCircle, FileText, Info } from "lucide-react";
import type { LabHistoryPoint, PatientReport, Symptom, TimelineEvent } from "../../types/api";
import { SymptomTrendChart } from "../../components/charts/SymptomTrendChart";
import { LabTrendsChart } from "../../components/charts/LabTrendsChart";
import { buildLabSeries } from "../../components/charts/labSeries";
import {
  AUTOMATIC_PROMPT_NOTE, NO_RULE_MATCH_CAVEAT, RESEARCH_MODEL_ABSENCE, RESEARCH_MODEL_LEDE,
  monitoringAbsenceCaveat, toPatientReasons,
} from "../../lib/patientLanguage";
import {
  findConflicts, describeConflict, describeRepeatedRatings,
  summariseRecords, describeRecordsLabel, type ValueConflict,
} from "../../lib/recordIntegrity";
import {
  deriveRecordAge, formatRecordDate, observationAgeSentence, symptomGapSentence, loadedSentence,
} from "../../lib/recordAge";
import { pendingReviewCount, reviewStatusSentence } from "../../lib/recordReview";
import { Section, ChartFigure, Notice, PillGroup, ListRow } from "../../design-system/PearlRose";
import { OVERVIEW_RANGES, type OverviewRangeId } from "./overviewRange";
import { SymptomsTable } from "./SymptomsTable";
import { TimelinePanel } from "./TimelinePanel";
import { GeneticCounselingPanel } from "./GeneticCounselingPanel";
import { MedLogPanel } from "./MedLogPanel";
import { readableEventTitle } from "../../lib/timelineLanguage";
import "../../design-lab/concept52.css";
import "../../design-lab/concept52-live.css";

/**
 * Concept 5.2 as the patient Overview, behind `PATIENT_OVERVIEW_52`.
 *
 * Loaded lazily by `PatientDashboard` only when the flag is on, so with the
 * flag off neither this module nor its stylesheet reaches the page.
 *
 * What it replaces is the Overview *presentation* only. The dashboard still
 * owns the shell, the tab bar, authentication, the data fetches, the five
 * tool-tray forms, chat, upload and undo; this component receives the same
 * props the existing `PatientOverview` receives and issues no request of its
 * own.
 *
 * Carried over from the existing Overview so nothing working is lost:
 *   - every sidebar destination (`#labs`, `#signals`, `#timeline`,
 *     `#genetics`) still resolves to a `data-section`;
 *   - the genetic-counselling forms, which save through `onSaved`;
 *   - the full timeline, the medication log and the symptoms table.
 *
 * Deliberately not carried over, by the research-model safety decision:
 *   - the hybrid and evidence-aware prediction cards, the model-signal panel
 *     and the key-signals card. They present an uncalibrated synthetic score
 *     and a "favourable" classification. Those are the only two fields that
 *     arrive solely through enrichment, so nothing this component renders can
 *     go stale while enrichment is pending or has failed;
 *   - the risk engine's "Confidence" badge on timeline flags, which measures
 *     whether checklist inputs were present, not whether the flag is right;
 *   - "updated N minutes ago" labels driven by fetch time, which read as
 *     record freshness. Record dates and page-load time are stated separately.
 */

export interface PatientOverview52Props {
  report: PatientReport;
  rangedReport: PatientReport | null;
  rangedSymptoms: Symptom[];
  rangedLabHistory: LabHistoryPoint[];
  latestLabDate: string | null;
  range: OverviewRangeId;
  onRangeChange: Dispatch<SetStateAction<OverviewRangeId>>;
  reportFetchedAt: number | null;
  enrichmentStatus: string;
  onSaved: () => void;
}

/** The chart's own notation, so a measure never appears in two unit styles. */
const LAB_UNITS: Record<string, string> = {
  WBC: "K/uL", Hemoglobin: "g/dL", Platelets: "K/uL",
};

/** How a lab measure is named inside a risk-engine flag title. */
const FLAG_TOKEN: Record<string, string> = {
  WBC: "wbc", Hemoglobin: "hemoglobin", Platelets: "platelet",
};

function readableEventType(e: TimelineEvent): string {
  return e.type === "ai_risk_flag" ? "automated threshold rule" : String(e.type ?? "").replace(/_/g, " ");
}

/**
 * Automated flags raised on the same day, for the same measure, as an
 * unresolved conflict. They were computed from the conflicting values, so
 * they carry the same uncertainty, and saying so is the only honest option
 * until the record is resolved.
 */
function flagsSharingConflict(c: ValueConflict, timeline: TimelineEvent[]): string[] {
  const token = FLAG_TOKEN[c.measure];
  if (!token) return [];
  return timeline
    .filter((e) => e.type === "ai_risk_flag" && String(e.date).slice(0, 10) === c.day)
    .map((e) => String(e.title ?? "").replace(/^Risk flag:\s*/i, ""))
    .filter((t) => t.toLowerCase().includes(token))
    .map((t) => t.replace(/_/g, " "));
}

function highestSelfReported(symptoms: Symptom[]): Symptom | null {
  return symptoms.reduce<Symptom | null>((best, s) => {
    if (typeof s.severity !== "number" || !Number.isFinite(s.severity)) return best;
    if (!best) return s;
    if (s.severity !== best.severity) return s.severity > best.severity ? s : best;
    return String(s.date) > String(best.date) ? s : best;
  }, null);
}

/** One gap sentence for the group, only when every series breaks identically. */
function sharedLabGaps(data: LabHistoryPoint[]) {
  const series = buildLabSeries(data);
  if (series.length < 2) return null;
  const key = (s: (typeof series)[number]) =>
    s.gaps.map((g) => `${g.fromDate}|${g.toDate}|${g.days}`).join(",");
  const first = key(series[0]);
  if (!first) return null;
  if (!series.every((s) => key(s) === first)) return null;
  return series[0].gaps;
}

/** The figures both the header and the body need, from props alone. */
function deriveFigures(report: PatientReport, symptoms: Symptom[], labs: LabHistoryPoint[]) {
  const symptomSummary = summariseRecords(symptoms, (s) => s.date);
  const labSummary = summariseRecords(labs, (p) => p.date);
  const topics = toPatientReasons(report.ai_summary?.review_reasons ?? []);
  return {
    symptomSummary,
    labSummary,
    topics,
    symptomPhrase: describeRecordsLabel(symptomSummary, "rating you recorded", "ratings you recorded"),
    labPhrase: describeRecordsLabel(labSummary, "blood test", "blood tests"),
  };
}

/** Progressive disclosure for data-quality notes; the summary names the count. */
function DataNotes({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="c52-notes">
      <summary>
        <Info size={15} aria-hidden="true" />
        {label}
        <span className="c52-notes-count">{count}</span>
      </summary>
      <div className="c52-notes-body">{children}</div>
    </details>
  );
}

/* ───────────────────────────────────────────────────────────────────────── */

/** Replaces `OverviewHeader` above the tab bar when the flag is on. */
export function Overview52Header({
  report, patientId, rangedSymptoms, rangedLabHistory, latestLabDate,
}: {
  report: PatientReport;
  patientId: string | null;
  rangedSymptoms: Symptom[];
  rangedLabHistory: LabHistoryPoint[];
  latestLabDate: string | null;
}) {
  const age = deriveRecordAge(report);
  const f = deriveFigures(report, rangedSymptoms, rangedLabHistory);
  const figures = [
    { value: String(f.symptomSummary.distinct.length), label: f.symptomPhrase, text: false },
    {
      value: String(f.labSummary.distinct.length),
      label: `${f.labPhrase}${latestLabDate ? `, latest ${latestLabDate}` : ""}`,
      text: false,
    },
    {
      value: String(f.topics.length),
      label: `${f.topics.length === 1 ? "topic" : "topics"} to raise with your team`,
      text: false,
    },
    { value: formatRecordDate(age.latestDate) ?? "—", label: "newest observation", text: true },
  ];

  return (
    <div className="c4 c52 c52-live">
      <section className="pr-header" aria-labelledby="ov52-title">
        <div className="pr-header-top">
          <div style={{ minWidth: 0 }}>
            <p className="pr-kicker">
              {report.patient_name || (patientId ? `Patient ${patientId}` : "Your record")} · synthetic demo session
            </p>
            <h1 id="ov52-title" className="pr-title">Your monitoring record</h1>
            <p className="c52-standfirst">{observationAgeSentence(age)}</p>
          </div>
          {/* Same destinations as the existing header: both open the chat,
              where the tool tray and composer live. */}
          <div className="pr-actions">
            <Link to="/patient/chat" className="pr-btn pr-btn--quiet">
              <PlusCircle size={16} aria-hidden="true" />Log how you feel
            </Link>
            <Link to="/patient/chat" className="pr-btn pr-btn--primary">
              <MessageSquare size={16} aria-hidden="true" />Ask about your record
            </Link>
          </div>
        </div>
        <div className="pr-figures">
          {figures.map((fig) => (
            <div className="pr-figure" key={fig.label}>
              <span className={`pr-figure-value${fig.text ? " pr-figure-value--text" : ""}`}>{fig.value}</span>
              <span className="pr-figure-label">{fig.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Replaces `PatientOverview` below the tab bar when the flag is on. */
export default function PatientOverview52({
  report, rangedSymptoms, rangedLabHistory, range, onRangeChange, reportFetchedAt, onSaved,
}: PatientOverview52Props) {
  const age = deriveRecordAge(report);
  const f = deriveFigures(report, rangedSymptoms, rangedLabHistory);
  const peak = highestSelfReported(f.symptomSummary.distinct);
  const rated = f.symptomSummary.distinct.filter(
    (s) => typeof s.severity === "number" && Number.isFinite(s.severity),
  ).length;
  const timeline = report.timeline ?? [];

  const repeatedRatings = findConflicts(
    rangedSymptoms, (s) => s.date, (s) => s.symptom, (s) => s.severity,
  );
  const labRows = rangedLabHistory.flatMap((p) => [
    { date: p.date, measure: "WBC", value: p.wbc },
    { date: p.date, measure: "Hemoglobin", value: p.hemoglobin },
    { date: p.date, measure: "Platelets", value: p.platelets },
  ]);
  const labQuestions = findConflicts(labRows, (r) => r.date, (r) => r.measure, (r) => r.value);
  const groupGaps = sharedLabGaps(rangedLabHistory);
  const sourcesOn = (day: string) => [...new Set(
    rangedLabHistory
      .filter((p) => String(p.date).slice(0, 10) === day)
      .map((p) => (p as { source?: string | null }).source)
      .filter((x): x is string => Boolean(x)),
  )];
  const gap = symptomGapSentence(age);
  const loaded = loadedSentence(reportFetchedAt);
  const recent = [...timeline].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const pending = pendingReviewCount(report);
  const absenceCaveat = monitoringAbsenceCaveat(report);

  return (
    <div className="c4 c52 c52-live">
      <div className="c52-grid">
        <div className="c52-col">
          {/* General guidance, always visible. The flag-off Overview carries the
              same instruction; dropping it here would be a safety regression. */}
          <Notice tone="info" title="If something feels wrong">
            Contact your care team. This page summarises what is recorded in your file. It does
            not diagnose, recommend treatment, or replace a clinician's judgement.
          </Notice>

          {/* Clinician-attributed review notes are intentionally NOT rendered.
              The backend record has no verified author, no audience and no
              patient-release decision, so showing one would present an
              unauthenticated string as clinical communication. See
              lib/recordReview.ts and MILESTONE-7-1-REMEDIATION.md. */}

          <div data-section="symptoms">
            <Section
              titleId="ov52-symptoms"
              title="How you have been feeling"
              lede="One dot for each distinct rating you recorded, on the day you recorded it. The spaces between dots are days nothing was logged, not days you were well."
              aside={
                <PillGroup<OverviewRangeId>
                  label="Time range" options={OVERVIEW_RANGES}
                  value={range} onChange={(id) => onRangeChange(id)}
                />
              }
            >
              <ChartFigure
                caption={peak && (
                  <>
                    The highest severity you rated yourself in this period was{" "}
                    <strong>{peak.severity} out of 10 for {peak.symptom}</strong>, on{" "}
                    {String(peak.date).slice(0, 10)}. Taken from {rated} distinct{" "}
                    {rated === 1 ? "rating" : "ratings"} — 0–10 is how you described the symptom
                    that day, not a measurement and not an assessment of your condition.
                  </>
                )}
              >
                <SymptomTrendChart symptoms={rangedSymptoms} height={300} emphasis />
              </ChartFigure>

              <DataNotes
                label="Notes about how these ratings were recorded"
                count={repeatedRatings.length > 0 ? 1 : 0}
              >
                <Notice tone="info" title="You rated the same symptom more than once on a day">
                  {repeatedRatings.map((c) => describeRepeatedRatings(c)).join(" ")} Every rating is
                  plotted. None has been averaged away or removed.
                </Notice>
              </DataNotes>

              <details className="c52-notes">
                <summary>
                  <FileText size={15} aria-hidden="true" />
                  Every symptom rating in your record
                </summary>
                <div className="c52-notes-body">
                  <SymptomsTable symptoms={report.symptoms ?? []} compact lastFetchedAt={null} />
                </div>
              </details>
            </Section>
          </div>

          <div data-section="labs">
            <Section
              titleId="ov52-labs"
              title="Blood counts"
              lede="Three tests, three units, three scales. They are read one at a time, never against one another."
            >
              {/* The chart titles each test with an h4; this keeps the outline
                  h2 -> h3 -> h4 instead of skipping a level. */}
              <h3 className="sr-only">Results for each test</h3>
              {absenceCaveat && <p className="pr-note">{absenceCaveat}</p>}
              {labQuestions.map((c) => {
                const flags = flagsSharingConflict(c, timeline);
                const sources = sourcesOn(c.day);
                return (
                  <Notice key={`${c.day}-${c.measure}`} tone="question" title={`Unresolved: ${c.measure} on ${c.day} has conflicting values`}>
                    {describeConflict(c, LAB_UNITS[c.measure])}
                    {sources.length > 0 && ` Every one of these rows is labelled with the source ${sources.map((x) => `"${x}"`).join(", ")}.`}
                    {" "}The chart draws every row, so that date shows all of the values together; no single value has
                    been selected as the measurement, none has been averaged, and nothing in the record has been changed.
                    {flags.length > 0 &&
                      ` The record also holds ${flags.length} automated ${flags.length === 1 ? "flag" : "flags"} on that date (${flags.join(", ")}). ${flags.length === 1 ? "It was" : "They were"} computed from these rows, so ${flags.length === 1 ? "it is" : "they are"} qualified by the same unresolved conflict and ${flags.length === 1 ? "is" : "are"} not a confirmed finding.`}
                    {" "}Ask your care team which value is correct.
                  </Notice>
                );
              })}
              <div data-lab-gaps={groupGaps ? "grouped" : undefined}>
                <ChartFigure caption="Reference ranges shown elsewhere in the record are population defaults, not personalised to you.">
                  <LabTrendsChart data={rangedLabHistory} />
                </ChartFigure>
              </div>

              <DataNotes
                label="Notes about gaps and disagreements in these results"
                count={groupGaps ? 1 : 0}
              >
                {groupGaps && (
                  <Notice tone="info" title="All three counts break in the same places">
                    {groupGaps.length === 1 ? "A gap of " : "Gaps of "}
                    {groupGaps.map((g, i) => (
                      <span key={g.fromDate}>
                        {i > 0 && (i === groupGaps.length - 1 ? " and " : ", ")}
                        {g.days} days ({g.fromDate} to {g.toDate})
                      </span>
                    ))}
                    {groupGaps.length === 1 ? " has" : " have"} no recorded results for any of the
                    three tests, so each line is broken there rather than drawn through. A break is a
                    missing observation, not a normal one.
                  </Notice>
                )}
              </DataNotes>
            </Section>
          </div>

          <Section titleId="ov52-next" title="Recently, and what to ask">
            <div className="pr-two">
              <div>
                <h3 className="pr-h3">Recent activity</h3>
                <ul className="pr-list">
                  {recent.map((e, i) => (
                    <ListRow
                      key={`${e.date}-${e.title}-${i}`}
                      icon={<FileText size={14} aria-hidden="true" />}
                      title={readableEventTitle(e)}
                      meta={`${String(e.date).slice(0, 10)} · ${readableEventType(e)}`}
                    />
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="pr-h3">Topics you might raise</h3>
                <ul className="pr-list">
                  {f.topics.slice(0, 3).map((t) => (
                    <ListRow
                      key={t.source}
                      icon={<Info size={14} aria-hidden="true" />}
                      tone="note"
                      title={t.observation}
                      meta={
                        <>
                          {t.suggestion}
                          {t.occurrences > 1 && ` Flagged ${t.occurrences} times in your record.`}
                        </>
                      }
                    />
                  ))}
                </ul>
                <p className="pr-note">{f.topics.length > 0 ? AUTOMATIC_PROMPT_NOTE : NO_RULE_MATCH_CAVEAT}</p>
              </div>
            </div>
          </Section>

          {/* Full record panels, carried over unchanged so every sidebar
              destination and every form still works. */}
          <div data-section="timeline" className="c52-panel">
            <TimelinePanel events={timeline} lastFetchedAt={null} hideConfidence />
          </div>

          <div data-section="genetics" className="c52-panel">
            <GeneticCounselingPanel
              readiness={report.genetic_counseling_readiness ?? null}
              onSaved={onSaved}
              defaultCollapsed
            />
          </div>

          <div data-section="medications" className="c52-panel">
            <MedLogPanel meds={report.medication_logs ?? []} />
          </div>

          {/* The sidebar's "Signals" destination. The research model is not
              shown on this surface by decision; the destination says so rather
              than silently going nowhere. */}
          <div data-section="signals">
            <Section
              titleId="ov52-research"
              title="Research model outputs"
              lede={RESEARCH_MODEL_LEDE}
            >
              <p className="c52-unavailable">
                <strong>Not shown in your record view.</strong>
                {RESEARCH_MODEL_ABSENCE}
              </p>
            </Section>
          </div>
        </div>

        <aside className="c52-aside" aria-label="Record status">
          <div className="c52-card c52-status">
            <h2 className="c52-card-title">Record status</h2>
            <dl>
              <div>
                <dt>How current this is</dt>
                <dd>{observationAgeSentence(age)}</dd>
              </div>
              {gap && (
                <div>
                  <dt>Symptom reporting</dt>
                  <dd>{gap}</dd>
                </div>
              )}
              <div>
                <dt>Review and notification status</dt>
                <dd>{reviewStatusSentence(pending)}</dd>
              </div>
              {loaded && (
                <div>
                  <dt>This page</dt>
                  <dd>{loaded}</dd>
                </div>
              )}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
