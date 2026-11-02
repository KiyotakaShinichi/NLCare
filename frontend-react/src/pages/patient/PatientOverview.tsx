import type { Dispatch, SetStateAction } from "react";
import { Info, ShieldCheck } from "lucide-react";
import { OverviewGlance } from "./OverviewGlance";
import type { OverviewRangeId } from "./overviewRange";
import {
  summariseRecords, describeRecordsLabel, indistinguishableNote,
} from "../../lib/recordIntegrity";
import { toPatientReasons } from "../../lib/patientLanguage";
import { SymptomTrendChart } from "../../components/charts/SymptomTrendChart";
import { LabsPanel } from "./LabsPanel";
import { KeySignalsCard } from "./KeySignalsCard";
import { ReviewWithCareTeamCard } from "./ReviewWithCareTeamCard";
import { RecentAiExplanationsCard } from "./RecentAiExplanationsCard";
import { ResearchModelNotice } from "./ResearchModelNotice";
import { GeneticCounselingPanel } from "./GeneticCounselingPanel";
import { MedLogPanel } from "./MedLogPanel";
import { SymptomsTable } from "./SymptomsTable";
import { TimelinePanel } from "./TimelinePanel";
import type { ChatMessage, LabHistoryPoint, PatientReport, Symptom } from "../../types/api";

interface Props {
  report: PatientReport;
  rangedReport: PatientReport | null;
  rangedSymptoms: Symptom[];
  rangedLabHistory: LabHistoryPoint[];
  latestLabDate: string | null;
  range: OverviewRangeId;
  onRangeChange: Dispatch<SetStateAction<OverviewRangeId>>;
  reportFetchedAt: number | null;
  enrichmentStatus: string;
  chatMessages: ChatMessage[];
  onSaved: () => void;
}

/**
 * The patient overview, in the Pearl Rose reading order.
 *
 * Split out of PatientDashboard, which had grown past the 500-line service
 * limit once the redesign landed. The dashboard keeps the data wiring, the
 * chat surface and the tab state; this file owns what the overview looks like.
 *
 * Order is deliberate: who the record belongs to, what is in it, what the
 * patient reported, what was measured, then what they might want to raise -
 * and only after all of that, the synthetic model output.
 */
export function PatientOverview({
  report, rangedReport, rangedSymptoms, rangedLabHistory, latestLabDate,
  range, onRangeChange, reportFetchedAt, enrichmentStatus, chatMessages, onSaved,
}: Props) {
  // Counts are taken from distinct records, not array lengths: the record holds
  // rows identical in every field and the raw lengths overstated what it says.
  const symptomSummary = summariseRecords(rangedSymptoms, (s) => s.date);
  const labSummary = summariseRecords(rangedLabHistory, (p) => p.date);
  const topics = toPatientReasons(report.ai_summary?.review_reasons ?? []);

  return (
    <>
    <div className="po-surface-ground">
      <div className="po-page">
        <OverviewGlance
          report={report}
          range={range}
          onRangeChange={onRangeChange}
          symptomCount={symptomSummary.distinct.length}
          symptomPhrase={describeRecordsLabel(symptomSummary, "rating you recorded", "ratings you recorded")}
          symptomNote={indistinguishableNote(symptomSummary, "ratings")}
          labCount={labSummary.distinct.length}
          labPhrase={describeRecordsLabel(labSummary, "blood test", "blood tests")}
          labNote={indistinguishableNote(labSummary, "blood tests")}
          topicCount={topics.length}
          latestLabDate={latestLabDate}
        />

        {enrichmentStatus === "loading" && (
          <p className="patient-progressive-load" role="status">
            Patient records are ready. Loading synthetic engineering details separately...
          </p>
        )}
        {enrichmentStatus === "error" && (
          <p className="patient-progressive-load is-warning" role="status">
            Patient records are available, but synthetic engineering details could not be loaded.
          </p>
        )}

        <section className="po-section" aria-labelledby="po-symptoms" data-section="symptoms">
          <div className="po-section-head">
            <div>
              <h2 id="po-symptoms" className="po-h2">How you have been feeling</h2>
              <p className="po-body">
                Every dot is one report you logged, placed on the day you logged it.
                Nothing is drawn for the days in between, because nothing was recorded
                for them.
              </p>
            </div>
            {rangedSymptoms.length > 0 && rangedSymptoms.length < 8 && (
              <span className="po-sparse-note">
                <Info size={15} aria-hidden="true" />
                {rangedSymptoms.length} report{rangedSymptoms.length === 1 ? "" : "s"} in this period
              </span>
            )}
          </div>
          <div className="po-stage">
            <SymptomTrendChart symptoms={rangedSymptoms} height={340} emphasis />
          </div>
        </section>

        <section className="po-section" data-section="labs">
          {rangedReport && (
            <LabsPanel report={rangedReport} lastFetchedAt={reportFetchedAt} />
          )}
        </section>
      </div>
    </div>

    <div className="dashboard-content dashboard-grid">
      {/* Row 3 — Today's summary · Review queue (merged with Next review)
          · Model signal.  Review queue is now ONE strong card so the
          WBC/platelet warning doesn't show twice on the dashboard. */}
      <div className="col-4" data-section="summary">
        <KeySignalsCard
          summary={report.ai_summary ?? null}
          report={report}
          lastFetchedAt={reportFetchedAt}
        />
      </div>
      <div className="col-4" data-section="review">
        <ReviewWithCareTeamCard summary={report.ai_summary ?? null} report={report} />
      </div>
      <div className="col-4" data-section="signals">
        <ResearchModelNotice />
      </div>
      {/* Row 4 — Symptoms · Timeline · Recent AI explanations.  All
          three are compact peer cards; none of them is allowed to
          stretch into a tall scroll monolith on its own. */}
      <div className="col-4" data-section="symptoms">
        <SymptomsTable symptoms={report.symptoms ?? []} compact lastFetchedAt={reportFetchedAt} />
      </div>
      <div className="col-4" data-section="timeline">
        <TimelinePanel events={report.timeline ?? []} lastFetchedAt={reportFetchedAt} />
      </div>
      <div className="col-4" data-section="ai-explanations">
        <RecentAiExplanationsCard messages={chatMessages} />
      </div>

      {/* Row 5 — Family & Genetics readiness summary.  The detailed
          forms (family history, genetic test, biomarker, tumor
          marker) live behind the GeneticCounselingPanel's own
          collapsible body so the overview never opens as a giant
          inline form page. */}
      <div className="dashboard-grid-full" data-section="genetics">
        <GeneticCounselingPanel
          readiness={report.genetic_counseling_readiness ?? null}
          onSaved={onSaved}
          defaultCollapsed
        />
      </div>
      {/* Row 6 — medication log full-width (compact table). */}
      <div className="dashboard-grid-full" data-section="medications">
        <MedLogPanel meds={report.medication_logs ?? []} />
      </div>

      {/* Page-level safety footnote — reinforces the topbar pill so the
          PoC boundary is visible after the user scrolls the dashboard. */}
      <div className="dashboard-grid-full">
        <p
          className="inline-flex items-start gap-2 text-[0.74rem] leading-relaxed"
          style={{
            color: "var(--text-faint)",
            margin: "8px 0 0",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface2)",
          }}
        >
          <ShieldCheck
            size={13}
            style={{ color: "var(--rose-deep)", flexShrink: 0, marginTop: 1 }}
            aria-hidden="true"
          />
          <span>
            <strong style={{ color: "var(--text-dim)" }}>Proof-of-concept</strong> — this dashboard summarises
            what you have logged and what the AI noticed. It does not diagnose, recommend treatment, or
            replace clinician judgement. If something feels wrong, contact your care team.
          </span>
        </p>
      </div>
    </div>
    </>
  );
}
