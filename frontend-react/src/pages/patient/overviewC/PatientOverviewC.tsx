import { useMemo, type Dispatch, type SetStateAction } from "react";
import { ShieldCheck } from "lucide-react";
import { SymptomTrendChart } from "../../../components/charts/SymptomTrendChart";
import { ClinicalBoundaryBanner } from "../../../components/ui/ClinicalBoundaryBanner";
import { useKeepQueryParam } from "../../../hooks/useQueryParam";
import { MONITORING_BOUNDARY, OWN_RECORD_NOTE, REPEATED_RATINGS_NOTE } from "../../../lib/patientLanguage";
import {
  describeRecordsLabel, describeRepeatedRatings, findConflicts, indistinguishableNote, summariseRecords, consolidateText,
} from "../../../lib/recordIntegrity";
import type { ChatMessage, LabHistoryPoint, PatientReport, Symptom } from "../../../types/api";
import { GeneticCounselingPanel } from "../GeneticCounselingPanel";
import { KeySignalsCard } from "../KeySignalsCard";
import { MedLogPanel } from "../MedLogPanel";
import { OverviewGlance } from "../OverviewGlance";
import { OverviewHeader } from "../OverviewHeader";
import { RecentAiExplanationsCard } from "../RecentAiExplanationsCard";
import { ResearchModelNotice } from "../ResearchModelNotice";
import { SymptomsTable } from "../SymptomsTable";
import { TimelinePanel } from "../TimelinePanel";
import type { OverviewRangeId } from "../overviewRange";
import { LabReadings } from "./LabReadings";
import { RecordCoverage } from "./RecordCoverage";
import { ReviewItems } from "./ReviewItems";

interface Props {
  report: PatientReport;
  patientId: string | null;
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
 * Design C: one calm reading column, following the approved mockup's order.
 *
 * This file is layout and view state. Data comes through the dashboard, and the
 * wording and record handling come from the components used by the other
 * Overviews. The shell, chat, holds and forms stay in PatientDashboard.
 */
export default function PatientOverviewC({
  report, patientId, rangedSymptoms, rangedLabHistory, latestLabDate,
  range, onRangeChange, reportFetchedAt, enrichmentStatus, chatMessages, onSaved,
}: Props) {
  useKeepQueryParam("range", range, "6m");

  const reasons = useMemo(() => report.ai_summary?.review_reasons ?? [], [report]);
  const symptomSummary = summariseRecords(rangedSymptoms, (s) => s.date);
  const labSummary = summariseRecords(rangedLabHistory, (p) => p.date);

  // From the whole record, so a symptom keeps its marker when the range changes.
  const markerNames = useMemo(
    () => [...new Set((report.symptoms ?? []).map((s) => s.symptom))].sort(), [report],
  );

  const repeatedRatings = findConflicts(rangedSymptoms, (s) => s.date, (s) => s.symptom, (s) => s.severity);

  return (
    <div className="pc">
      <div className="pc-column">
        <OverviewHeader report={report} patientId={patientId}>
          <div className="pc-soft">
            <ClinicalBoundaryBanner />
            <p>{OWN_RECORD_NOTE}</p>
          </div>
        </OverviewHeader>

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

        <div data-section="review">
          <ReviewItems reasons={reasons} />
        </div>

        <div className="pc-glance">
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
            topicCount={consolidateText(reasons).length}
            latestLabDate={latestLabDate}
          />
          <RecordCoverage report={report} />
        </div>

        <div data-section="summary">
          <KeySignalsCard
            summary={report.ai_summary ?? null}
            report={report}
            lastFetchedAt={reportFetchedAt}
            showChips={false}
          />
        </div>

        <section className="pc-panel" aria-labelledby="pc-labs" data-section="labs">
          <h2 id="pc-labs" className="po-h2">Lab values (CBC)</h2>
          <LabReadings report={report} history={rangedLabHistory} latestLabDate={latestLabDate} />
        </section>

        <section className="pc-panel" aria-labelledby="pc-symptoms" data-section="symptoms">
          <h2 id="pc-symptoms" className="po-h2">How you have been feeling</h2>
          <p className="pc-meta">
            Every dot is one report you logged, placed on the day you logged it. Nothing is drawn
            for the days in between, because nothing was recorded for them.
          </p>
          <div className="pc-sheet">
            <SymptomTrendChart symptoms={rangedSymptoms} height={260} emphasis markerNames={markerNames} />
            {repeatedRatings.length > 0 && (
              <details className="pc-details pc-question">
                <summary>You rated the same symptom more than once on a day</summary>
                <p>{repeatedRatings.map((c) => describeRepeatedRatings(c)).join(" ")} {REPEATED_RATINGS_NOTE}</p>
              </details>
            )}
          </div>
          <SymptomsTable symptoms={report.symptoms ?? []} compact lastFetchedAt={reportFetchedAt} />
        </section>

        <div data-section="timeline">
          <TimelinePanel events={report.timeline ?? []} lastFetchedAt={reportFetchedAt} hideConfidence plainTitles />
        </div>

        <div data-section="medications">
          <MedLogPanel meds={report.medication_logs ?? []} stacked />
        </div>

        <div data-section="ai-explanations">
          <RecentAiExplanationsCard messages={chatMessages} />
        </div>

        <div data-section="genetics">
          <GeneticCounselingPanel
            readiness={report.genetic_counseling_readiness ?? null}
            onSaved={onSaved}
            defaultCollapsed
          />
        </div>

        <div data-section="signals" className="pc-research">
          <ResearchModelNotice />
        </div>

        <footer className="pc-foot">
          <ShieldCheck size={16} aria-hidden="true" />
          <div>
            <p>{MONITORING_BOUNDARY}</p>
            <p>
              <strong>Proof-of-concept</strong> — this dashboard summarises what you have logged and what
              the AI noticed. It does not diagnose, recommend treatment, or replace clinician judgement.
              If something feels wrong, contact your care team.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
