import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { PatientOverview } from "../../src/pages/patient/PatientOverview";
import PatientOverview52 from "../../src/pages/patient/PatientOverview52";
import type { PatientReport } from "../../src/types/api";

/**
 * Milestone 7.9D. The KPI strip and model card that used to carry these two
 * sentences are gone from both patient Overviews. An empty record, or a queue
 * with nothing in it, must still say that silence is not a good result.
 */
const ABSENCE = "No CBC trend is available, so the absence of flags cannot be interpreted as reassuring.";
const NO_MATCH = "This is not reassurance about health or treatment response.";
const NO_FLAGS_CLAIM = "No urgent CBC/treatment/radiology risk flags are present.";

function report(clinicalMonitoring: { status: string; message: string } | null, reviewReasons: string[] = []) {
  return {
    patient_id: "P002", patient_name: "T", diagnosis: "x",
    symptoms: [], lab_history: [], timeline: [], medication_logs: [],
    ai_summary: { patient_explanation: "Counts are tracked.", clinical_summary: "", review_reasons: reviewReasons },
    genetic_counseling_readiness: null,
    multimodal_assessment: clinicalMonitoring ? { signals: { clinical_monitoring: clinicalMonitoring } } : null,
  } as unknown as PatientReport;
}

function legacy(r: PatientReport) {
  return render(
    <MemoryRouter>
      <PatientOverview
        report={r} rangedReport={r} rangedSymptoms={[]} rangedLabHistory={[]}
        latestLabDate={null} range="12m" onRangeChange={() => {}} reportFetchedAt={null}
        enrichmentStatus="success" chatMessages={[]} onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}

function flagged(r: PatientReport) {
  return render(
    <MemoryRouter>
      <PatientOverview52
        report={r} rangedReport={r} rangedSymptoms={[]} rangedLabHistory={[]}
        latestLabDate={null} range="12m" onRangeChange={() => {}} reportFetchedAt={null}
        enrichmentStatus="success" onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}

const textOf = (container: HTMLElement) => (container.textContent ?? "").replace(/\s+/g, " ");

describe.each([["flag OFF", legacy], ["flag ON", flagged]] as const)("%s Overview", (_name, mount) => {
  it("shows the server's caveat when the monitoring signal is unavailable", () => {
    const { container } = mount(report({ status: "unavailable", message: ABSENCE }, ["CBC data is missing."]));
    expect(textOf(container)).toContain(ABSENCE);
  });

  it("does not turn another status's message into a statement on the page", () => {
    const { container } = mount(report({ status: "stable_or_no_flags", message: NO_FLAGS_CLAIM }, ["CBC data is missing."]));
    expect(textOf(container)).not.toContain(NO_FLAGS_CLAIM);
  });

  it("renders without a monitoring signal", () => {
    const { container } = mount(report(null, ["CBC data is missing."]));
    expect(textOf(container)).not.toContain(ABSENCE);
  });

  it("says an empty review list is not reassurance", () => {
    const { container } = mount(report({ status: "stable_or_no_flags", message: NO_FLAGS_CLAIM }));
    expect(textOf(container)).toContain(NO_MATCH);
  });

  it("does not add that sentence while items are listed", () => {
    const { container } = mount(report(null, ["CBC data is missing."]));
    expect(textOf(container)).not.toContain(NO_MATCH);
  });
});
