import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { PatientOverview } from "../../src/pages/patient/PatientOverview";
import PatientOverview52 from "../../src/pages/patient/PatientOverview52";
import { KeySignalsCard } from "../../src/pages/patient/KeySignalsCard";
import {
  RESEARCH_MODEL_ABSENCE,
  RESEARCH_MODEL_LEDE,
} from "../../src/lib/patientLanguage";
import type { PatientReport } from "../../src/types/api";

/**
 * Milestone 7.4, Priority 4. Neither patient Overview may present an
 * individualised research-model result: the heads are not calibrated or
 * validated for any decision about one person, and the toxicity head is
 * explicitly `calibrated=false`. The absence of a score must also not read as
 * the absence of risk.
 */
const MODEL_FIELDS = {
  hybrid_prediction: {
    classification: { decision: "favorable_pattern", probability: 0.973, raw_probability: 0.973, calibrated: false, confidence: "high", evidence: null, model_version: "v", question: "q" },
    response_score: { decision: "strong_response_signal", response_score: 0.81, uncertainty_band: [0.7, 0.9], confidence: "high", evidence: null, model_version: "v", question: "q" },
    toxicity: { decision: "low_toxicity_signal", probability: 0.556, calibrated: false, confidence: "high", evidence: null, model_version: "v", question: "q" },
    claim_boundary: "boundary",
  },
  evidence_aware_prediction: { decision: "favorable_pattern", probability: 0.973, calibrated: false, confidence: "high" },
  synthetic_model_prediction: { hybrid_mle_signal: { hybrid_score: 97, classification_probability: 0.973 } },
  synthetic_model_explanation: { summary: "model says favorable" },
  monitoring_score: 0.973,
};
const REPORT = {
  patient_id: "P001", patient_name: "T", diagnosis: "x",
  symptoms: [], lab_history: [], timeline: [], medication_logs: [],
  ai_summary: { patient_explanation: "Counts are tracked.", clinical_summary: "", review_reasons: [] },
  genetic_counseling_readiness: null,
  ...MODEL_FIELDS,
} as unknown as PatientReport;

const MODEL_WORDING =
  /favou?rable|unfavou?rable|concerning signal|class probability|synthetic class|confidence:\s*(?:high|medium|low)|calibrated classifier|hybrid score|hybrid monitoring|monitoring model|response score|response-pattern|support-review (?:grouping|pattern)|97\.3|55\.6|0\.973|\b97\s?%/i;

function legacy() {
  return render(
    <MemoryRouter>
      <PatientOverview
        report={REPORT} rangedReport={REPORT} rangedSymptoms={[]} rangedLabHistory={[]}
        latestLabDate={null} range="12m" onRangeChange={() => {}} reportFetchedAt={null}
        enrichmentStatus="success" chatMessages={[]} onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}
function flagged() {
  return render(
    <MemoryRouter>
      <PatientOverview52
        report={REPORT} rangedReport={REPORT} rangedSymptoms={[]} rangedLabHistory={[]}
        latestLabDate={null} range="12m" onRangeChange={() => {}} reportFetchedAt={null}
        enrichmentStatus="success" onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("no individualised research-model output on either patient Overview", () => {
  it("legacy (flag OFF) Overview renders none, even when every model field is populated", () => {
    const { container } = legacy();
    expect(container.textContent).not.toMatch(MODEL_WORDING);
  });

  it("Concept 5.2 (flag ON) Overview renders none", () => {
    const { container } = flagged();
    expect(container.textContent).not.toMatch(MODEL_WORDING);
  });

  it("the summary card shows no model chip", () => {
    const { container } = render(<KeySignalsCard summary={REPORT.ai_summary ?? null} report={REPORT} lastFetchedAt={null} />);
    expect(container.textContent).not.toMatch(MODEL_WORDING);
  });

  it.each([["legacy", legacy], ["flag ON", flagged]] as const)(
    "%s Overview says model output is not shown and that its absence is not safety",
    (_n, mount) => {
      const { container } = mount();
      const text = (container.textContent ?? "").replace(/\s+/g, " ");
      expect(text).toContain(RESEARCH_MODEL_LEDE);
      expect(text).toContain(RESEARCH_MODEL_ABSENCE);
      expect(RESEARCH_MODEL_ABSENCE).toMatch(/does not mean there is no risk/i);
      expect(RESEARCH_MODEL_ABSENCE).toMatch(/contact your care team/i);
    },
  );

  it("keeps the sidebar #signals destination resolvable in both", () => {
    for (const mount of [legacy, flagged]) {
      const { container, unmount } = mount();
      expect(container.querySelector('[data-section="signals"]')).not.toBeNull();
      unmount();
    }
  });
});
