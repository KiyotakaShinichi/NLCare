import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import PatientOverview52 from "../../src/pages/patient/PatientOverview52";
import type { PatientReport } from "../../src/types/api";

/**
 * The "0.917" investigation.
 *
 * A reviewer's automated check searched `document.body.textContent` for
 * /0\.9\d{2}/ and reported 0.917 on the flag-ON Overview. It is not a model
 * output. The curated 2026-03-25 lab row is WBC 3.4, hemoglobin 10.9, platelets
 * 178, and the "View measurements as a table" disclosure renders those as
 * adjacent <td> cells. `textContent` joins cells with no separator, so
 * "...3.4" "10.9" "178" "1" reads as "3.410.91781", which contains "0.917".
 * Reading the page as a person does (cells separated), the token is absent.
 *
 * This test pins both halves: the artefact is real and reproducible, and no
 * research-model value reaches the Overview even when the enrichment payload is
 * present and holds exactly that number.
 */
const REPORT = {
  patient_id: "P001", patient_name: "T", diagnosis: "x", symptoms: [], timeline: [],
  medication_logs: [], ai_summary: { review_reasons: [], patient_explanation: "", clinical_summary: "" },
  lab_history: [
    { date: "2026-03-15", wbc: 4.6, hemoglobin: 11.4, platelets: 205, source: "curated_synthetic_demo_journey" },
    { date: "2026-03-25", wbc: 3.4, hemoglobin: 10.9, platelets: 178, source: "curated_synthetic_demo_journey" },
    { date: "2026-03-29", wbc: 4.7, hemoglobin: 11.1, platelets: 214, source: "curated_synthetic_demo_journey" },
  ],
  genetic_counseling_readiness: null,
  // Enrichment-only fields, merged into the report once enrichment completes.
  hybrid_prediction: {
    classification: { decision: "favorable_pattern", probability: 0.917, raw_probability: 0.917, calibrated: false, confidence: "high" },
  },
  evidence_aware_prediction: { decision: "favorable_pattern", probability: 0.917, calibrated: false, confidence: "high" },
  monitoring_score: 0.917,
  synthetic_model_prediction: { probability: 0.917 },
} as unknown as PatientReport;

function spaced(root: Element): string {
  const parts: string[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = w.nextNode())) { const v = (n.nodeValue ?? "").trim(); if (v) parts.push(v); }
  return parts.join(" ");
}

function renderOverview() {
  return render(
    <MemoryRouter>
      <PatientOverview52
        report={REPORT} rangedReport={REPORT} rangedSymptoms={[]} rangedLabHistory={REPORT.lab_history ?? []}
        latestLabDate="2026-03-29" range="12m" onRangeChange={() => {}} reportFetchedAt={null}
        enrichmentStatus="success" onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("0.917 on the flag-ON Overview", () => {
  it("the match is a textContent artefact of adjacent lab-table cells, not a rendered value", () => {
    const { container } = renderOverview();
    const raw = container.textContent ?? "";
    expect(raw).toMatch(/3\.410\.91781/);           // adjacent cells: WBC 3.4, Hb 10.9, plt 178, 1 row
    expect(raw).toMatch(/0\.917/);                  // so the naive pattern matches...
    const cells = [...container.querySelectorAll("td")].map((c) => c.textContent?.trim());
    expect(cells).not.toContain("0.917");           // ...but no cell, element or token holds it
    expect(cells).toEqual(expect.arrayContaining(["3.4", "10.9", "178"]));
  });

  it("renders no standalone 0.917 or model figure when the enrichment holds exactly that value", () => {
    const { container } = renderOverview();
    const text = spaced(container);
    expect(text).not.toMatch(/(?<![\d.])0?\.917/);
    expect(text).not.toMatch(/favou?rable|favorable_pattern|probabilit|raw_probability|monitoring score/i);
    expect(text).not.toMatch(/\b91\.7\b|\b92\s?%/);
  });
});
