import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import PatientOverview52, { Overview52Header } from "../../src/pages/patient/PatientOverview52";
import { resolvePatientOverview52 } from "../../src/lib/featureFlags";
import { pendingReviewCount, reviewStatusSentence } from "../../src/lib/recordReview";
import type { PatientReport } from "../../src/types/api";
import { expectNoA11yViolations } from "../a11y";

/**
 * A record shaped like the live demo patient where it matters:
 *   - 23 manual WBC rows on 2026-01-01 (twelve at 6.0, eleven at 1.5), with
 *     automated WBC flags on that same date - the counts the live API returns;
 *   - a risk-engine timeline flag carrying a "high" confidence level;
 *   - a review note recorded with the role "clinician";
 *   - a synthetic model prediction that must never reach this surface.
 */
const REPORT = {
  patient_id: "P001",
  patient_name: "Test Patient",
  diagnosis: "Breast cancer",
  symptoms: [
    { date: "2026-01-01", symptom: "fatigue", severity: 3, notes: "" },
    { date: "2026-01-01", symptom: "fatigue", severity: 7, notes: "" },
    { date: "2026-03-24", symptom: "nausea", severity: 2, notes: "" },
  ],
  lab_history: [
    ...Array.from({ length: 12 }, () => ({ date: "2026-01-01", wbc: 6.0, hemoglobin: 12.0, platelets: 200, source: "manual" })),
    ...Array.from({ length: 11 }, () => ({ date: "2026-01-01", wbc: 1.5, hemoglobin: 12.0, platelets: 200, source: "manual" })),
    { date: "2026-05-17", wbc: 4.2, hemoglobin: 11.8, platelets: 190, source: "curated_synthetic_demo_journey" },
  ],
  timeline: [
    { date: "2026-01-01", type: "ai_risk_flag", title: "Risk flag: low_wbc", evidence_source: "risk_engine",
      uncertainty: { confidence_level: "high", uncertainty_reason: "all checklist items satisfied" } },
    { date: "2026-01-01", type: "ai_risk_flag", title: "Risk flag: critical_wbc_suppression", evidence_source: "risk_engine" },
    { date: "2026-05-17", type: "lab", title: "CBC result", evidence_source: "lab_record" },
  ],
  ai_summary: { review_reasons: [] },
  medication_logs: [],
  genetic_counseling_readiness: {
    schema_version: "1", patient_id: "P001", boundary_note: "",
    family_history: [{ id: 1, relation: "mother", cancer_type: "breast", review_status: "pending" }],
    genetic_test_records: [], biomarker_records: [], tumor_marker_records: [],
    review_notes: [
      { id: 1, reviewer_role: "clinician", decision: "accepted",
        notes: "please come to the hospital asap", created_at: "2026-10-16T02:10:31" },
    ],
    flags: [], missing_data: [], readiness_status: "incomplete", questions_to_ask: [],
  },
  hybrid_prediction: {
    classification: { decision: "favorable_pattern", probability: 0.9684, calibrated: false,
      evidence: { sufficiency: "sufficient" } },
  },
  evidence_aware_prediction: { decision: "favorable_pattern", probability: 0.9684, calibrated: false, confidence: "high" },
} as unknown as PatientReport;

function renderOverview(report: PatientReport = REPORT) {
  return render(
    <MemoryRouter>
      <PatientOverview52
        report={report}
        rangedReport={report}
        rangedSymptoms={report.symptoms ?? []}
        rangedLabHistory={report.lab_history ?? []}
        latestLabDate="2026-05-17"
        range="12m"
        onRangeChange={vi.fn()}
        reportFetchedAt={Date.UTC(2026, 9, 19, 9, 30)}
        enrichmentStatus="success"
        onSaved={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("PATIENT_OVERVIEW_52 flag resolution", () => {
  it("is off unless the build sets exactly \"true\"", () => {
    expect(resolvePatientOverview52(undefined, false, null)).toBe(false);
    expect(resolvePatientOverview52("", false, null)).toBe(false);
    expect(resolvePatientOverview52("1", false, null)).toBe(false);
    expect(resolvePatientOverview52("TRUE", false, null)).toBe(false);
    expect(resolvePatientOverview52("true", false, null)).toBe(true);
  });

  it("honours the local override in development only", () => {
    expect(resolvePatientOverview52(undefined, true, "on")).toBe(true);
    expect(resolvePatientOverview52("true", true, "off")).toBe(false);
    expect(resolvePatientOverview52(undefined, true, "garbage")).toBe(false);
  });

  it("ignores the local override in a production build, so a patient cannot switch it", () => {
    expect(resolvePatientOverview52(undefined, false, "on")).toBe(false);
    expect(resolvePatientOverview52("true", false, "off")).toBe(true);
  });
});

describe("review and notification status is scoped to what this view can know", () => {
  it("never claims anyone did or did not review or get notified", () => {
    const s = reviewStatusSentence(0);
    expect(s).toMatch(/This view does not provide notification status\./);
    expect(s).toMatch(/Nothing on this page shows whether a clinician has looked/);
    expect(s).not.toMatch(/No clinician has reviewed it|no one has been notified|NLCare has no record/i);
    expect(s).not.toMatch(/has been reviewed|was reviewed/i);
  });

  it("does not read note authorship as review, with or without a note", () => {
    const withNote = reviewStatusSentence(pendingReviewCount(REPORT));
    const without = reviewStatusSentence(pendingReviewCount({
      ...REPORT,
      genetic_counseling_readiness: { ...REPORT.genetic_counseling_readiness!, review_notes: [] },
    } as PatientReport));
    expect(withNote).toBe(without);
    expect(withNote).not.toMatch(/clinician review|role|wrote/i);
  });

  it("reports pending genetics entries as a field value, not as a review state", () => {
    expect(pendingReviewCount(REPORT)).toBe(1);
    expect(reviewStatusSentence(1)).toMatch(/review-status field that reads "pending"/);
  });
});

describe("Concept 5.2 patient Overview", () => {
  it("never shows the synthetic model's score, classification or confidence", () => {
    renderOverview();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/0\.968/);
    expect(text).not.toMatch(/favou?rable/i);
    expect(text).not.toMatch(/Confidence:/i);
    expect(text).not.toMatch(/probability/i);
    expect(screen.getByRole("heading", { name: "Research model outputs" })).toBeInTheDocument();
    expect(text).toMatch(/This view does not show them/);
  });

  it("keeps every sidebar destination resolvable", () => {
    const { container } = renderOverview();
    for (const id of ["symptoms", "labs", "timeline", "genetics", "medications", "signals"]) {
      expect(container.querySelector(`[data-section="${id}"]`), id).not.toBeNull();
    }
  });

  it("does not render the genetic-counselling review note anywhere, in any form", () => {
    renderOverview();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/please come to the hospital/i);
    expect(text).not.toMatch(/recorded as from a clinician/i);
    expect(text).not.toMatch(/Recorded with the role/i);
    expect(screen.queryByRole("region", { name: /clinician/i })).toBeNull();
    expect(text).not.toMatch(/No clinician has reviewed it|nothing has been sent anywhere/);
    expect(text).not.toMatch(/Who has seen this/);
    expect(screen.getByText("Review and notification status")).toBeInTheDocument();
  });

  it("keeps the general care-team guidance visible without opening anything", () => {
    renderOverview();
    const heading = screen.getByText("If something feels wrong");
    expect(heading).toBeVisible();
    expect(heading.closest("details")).toBeNull();
    expect(document.body.textContent).toMatch(/Contact your care team/);
    expect(document.body.textContent).toMatch(/does not diagnose, recommend treatment, or replace a clinician/);
  });

  it("separates observation date from page-load time and makes no fetch-time freshness claim", () => {
    renderOverview();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Your newest observation is from/);
    expect(text).toMatch(/not when anything was measured/);
    expect(text).not.toMatch(/updated (just now|\d+ (second|minute)s? ago)/i);
    expect(text).not.toMatch(/The newest thing in your record/);
  });

  it("states the real row counts and shows the WBC conflict without opening a disclosure", () => {
    renderOverview();
    const title = screen.getByText(/Unresolved: WBC on 2026-01-01 has conflicting values/);
    expect(title).toBeVisible();
    expect(title.closest("details")).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/appears in 23 rows holding 2 different values: 11 rows with 1\.5 K\/uL and 12 rows with 6 K\/uL/);
    expect(text).not.toMatch(/recorded twice/);
    expect(text).not.toMatch(/x10\^3/);
    expect(text).toMatch(/labelled with the source "manual"/);
    expect(text).toMatch(/no single value has\s+been selected as the measurement, none has been averaged, and nothing in the record has been changed/);
  });

  it("qualifies the same-day automated flags by the conflict instead of presenting them as findings", () => {
    renderOverview();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/automated flags on that date \(low wbc, critical wbc suppression\)/);
    expect(text).toMatch(/qualified by the same unresolved conflict and are not a confirmed finding/);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderOverview();
    // Milestone 7.8: SectionCard no longer renders `<header role="button">`, so
    // `aria-allowed-role` is no longer excluded. Every rule is on.
    await expectNoA11yViolations(container);
  });

  it("header states observation age and labels the date figure as an observation", () => {
    render(
      <MemoryRouter>
        <Overview52Header
          report={REPORT}
          patientId="P001"
          rangedSymptoms={REPORT.symptoms ?? []}
          rangedLabHistory={REPORT.lab_history ?? []}
          latestLabDate="2026-05-17"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Your monitoring record" })).toBeInTheDocument();
    expect(screen.getByText(/Your newest observation is from/)).toBeInTheDocument();
    expect(screen.getByText("newest observation")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Log how you feel|Ask about your record/ })
      .every((a) => a.getAttribute("href") === "/patient/chat")).toBe(true);
  });
});
