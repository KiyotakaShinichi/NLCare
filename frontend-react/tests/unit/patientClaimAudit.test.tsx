import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PATIENT_SUMMARY_SCOPE_NOTE, scopeBackendClaims } from "../../src/lib/patientLanguage";
import templatePayload from "../fixtures/ai_summary_template.json";
import mixedPayload from "../fixtures/ai_summary_mixed.json";
import { KeySignalsCard } from "../../src/pages/patient/KeySignalsCard";
import { PatientBanner } from "../../src/pages/patient/PatientBanner";
import { savedActionDescriptor } from "../../src/components/ui/chat/savedActionPresentation";
import { GeneticCounselingPanel } from "../../src/pages/patient/GeneticCounselingPanel";
import type { PatientReport } from "../../src/types/api";

/**
 * Milestone 7.4, Priority 3. Patient-facing text may state what was saved and
 * what this view can show. It may not state, or let a button label imply, that
 * a clinician reviewed, received or was told of anything.
 */
const ASSERTS_ROUTING =
  /logged for clinician review|shared with your care team|flagged for (?:clinician )?review|(?:care team|clinician|doctor)[^.]{0,20}(?:will be|has been|have been) (?:notified|alerted|informed|told)|save for review|sent to (?:your|the) (?:care team|clinician|doctor)/i;

describe("backend-origin routing claims: narrow correction plus a standing scope note", () => {
  const TEMPLATE_SENTENCE = "Reported symptoms have been logged for clinician review.";

  it("replaces only the verified template sentence", () => {
    const out = scopeBackendClaims(`Your latest blood counts have been recorded in the system and trends are being tracked. ${TEMPLATE_SENTENCE} This system does not diagnose.`);
    expect(out).toBe("Your latest blood counts have been recorded in the system and trends are being tracked. Reported symptoms have been recorded. This system does not diagnose.");
  });

  it("is insensitive to case and spacing but not to a different sentence", () => {
    expect(scopeBackendClaims("reported  symptoms have been LOGGED for clinician review.")).toBe("Reported symptoms have been recorded.");
    for (const other of [
      "Reported symptoms have been logged for clinician review and for the tumour board.",
      "Your nurse noted that reported symptoms have been logged for clinician review.",
    ]) expect(scopeBackendClaims(other)).toBe(other);
  });

  it("does not rewrite routing language it has not verified (the scope note carries that instead)", () => {
    for (const s of [
      "Results have been sent to your care team.",
      "Your results were forwarded to the clinician.",
      "The flags were shared with your doctor.",
      "Your care team has been notified.",
    ]) expect(scopeBackendClaims(s)).toBe(s);
  });

  it.each([
    "A blood sample was sent to the clinical laboratory on 2026-03-25.",
    "Your biopsy slides were sent for oncology pathology review in March.",
    "Fever of 38.4 C was reported to the oncology team on day 3 of cycle 2.",
    "The imaging report was shared with the clinician who ordered it.",
    "Platelets were logged for clinician review in the 2026-01 cycle summary.",
    "Neutropenic fever has been escalated to the care team twice since cycle 1.",
    "WBC 1.5 x10^3/uL was drawn at the clinical laboratory.",
    "The research model has not been validated against real outcomes.",
    "Chemotherapy can lower your white blood cell count and increase infection risk.",
    "Your treatment plan was agreed with your oncology care team in January.",
    "Your latest blood counts have been recorded in the system and trends are being tracked.",
    "This system does not diagnose. Please follow up with your oncology care team for medical decisions.",
    "You have logged fatigue three times.",
  ])("leaves legitimate medical wording exactly as written: %s", (s) => expect(scopeBackendClaims(s)).toBe(s));

  it("works on the real backend payload: only the template sentence changes", () => {
    const real = String((templatePayload as { patient_explanation: string }).patient_explanation);
    expect(real).toContain(TEMPLATE_SENTENCE);
    const out = scopeBackendClaims(real);
    expect(out).not.toContain("logged for clinician review");
    expect(out).toBe(real.replace(TEMPLATE_SENTENCE, "Reported symptoms have been recorded."));
  });

  it("the real LLM-merged payload keeps the model's sentences untouched", () => {
    const real = String((mixedPayload as { patient_explanation: string }).patient_explanation);
    const out = scopeBackendClaims(real);
    expect(out).toContain("Your blood counts dipped around your last cycle and tiredness has been high.");
    expect(out).toBe(real.replace(TEMPLATE_SENTENCE, "Reported symptoms have been recorded."));
  });

  it.each([["template", templatePayload], ["LLM-merged", mixedPayload]])("the summary card shows the corrected sentence and the standing scope note (%s)", (_n, payload) => {
    const report = { patient_id: "P001", symptoms: [], lab_history: [] } as unknown as PatientReport;
    const { container } = render(<KeySignalsCard summary={payload as never} report={report} lastFetchedAt={null} />);
    expect(container.textContent).not.toMatch(/logged for clinician review/i);
    expect(container.textContent).toContain(PATIENT_SUMMARY_SCOPE_NOTE);
    expect(PATIENT_SUMMARY_SCOPE_NOTE).toMatch(/does not show whether anyone has reviewed it/i);
  });

  it("unverified routing language from a model is shown as written, beside the scope note", () => {
    const report = { patient_id: "P001", symptoms: [], lab_history: [] } as unknown as PatientReport;
    const { container } = render(
      <KeySignalsCard
        summary={{ patient_explanation: "Your results were sent to your care team.", clinical_summary: "", review_reasons: [] }}
        report={report}
        lastFetchedAt={null}
      />,
    );
    expect(container.textContent).toContain("Your results were sent to your care team.");
    expect(container.textContent).toContain(PATIENT_SUMMARY_SCOPE_NOTE);
  });
});

describe("other patient-facing strings", () => {
  it("the banner no longer says the record is shared with the care team for review", () => {
    const report = { patient_id: "P001", patient_name: "Ana", diagnosis: "x" } as unknown as PatientReport;
    const { container } = render(<MemoryRouter><PatientBanner report={report} compact /></MemoryRouter>);
    expect(container.textContent).not.toMatch(ASSERTS_ROUTING);
    expect(container.textContent).toMatch(/does not show whether anyone on your care team has seen it/i);
  });

  it("the genetics save button names the action, not a destination", () => {
    const { getAllByRole } = render(<GeneticCounselingPanel readiness={null} onSaved={() => {}} />);
    const labels = getAllByRole("button", { name: /save/i }).map((b) => b.textContent?.trim());
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).not.toMatch(/review/i);
  });

  it("a saved review-flag action is worded as something to raise, not as a flag raised with someone", () => {
    const { label } = savedActionDescriptor({ type: "possible_metastatic_indicator" } as never);
    expect(label).not.toMatch(/flag added|flagged/i);
    expect(label).toMatch(/care team/i);
  });

  it("save toasts state what was saved and do not claim a flag reached anyone", () => {
    const src = readFileSync(resolve(__dirname, "../../src/pages/patient/PatientDashboard.tsx"), "utf8");
    expect(src).not.toMatch(/Flagged for clinician review|and flagged for review|values flagged for review/);
    expect(src).toMatch(/Symptom saved with an urgent mark/);
  });

  it("form descriptions do not promise the care team will read an entry", () => {
    for (const f of ["SymptomForm", "ImagingForm", "MedicationForm"]) {
      const src = readFileSync(resolve(__dirname, `../../src/pages/patient/tools/${f}.tsx`), "utf8");
      expect(src, f).not.toMatch(/so your care team can review/i);
    }
    const sym = readFileSync(resolve(__dirname, "../../src/pages/patient/tools/SymptomForm.tsx"), "utf8");
    expect(sym).not.toMatch(/Mark as urgent for clinician review|Tags this entry for the review queue/);
    expect(sym).toMatch(/does not contact anyone/);
  });
});
