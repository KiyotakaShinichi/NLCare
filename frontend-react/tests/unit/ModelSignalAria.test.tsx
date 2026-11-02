import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelSignalPanel } from "../../src/pages/patient/ModelSignalPanel";
import type { PatientReport } from "../../src/types/api";
import { expectNoA11yViolations } from "../a11y";

/**
 * Three elements carried `aria-label` on a plain `<div>`, which is invalid:
 * the attribute is not allowed on a div with no role, so the name was simply
 * discarded and axe reported `aria-prohibited-attr`.
 *
 * The fix was semantic rather than a role added to silence the rule. Both
 * explanation envelopes already contained a visible heading naming them, so
 * they became `<section aria-labelledby>` pointing at it - the accessible name
 * now matches the visible text. (The third, the score bar in
 * HybridPredictionCard, duplicates a number printed beside it and is hidden
 * instead; that one is covered by its own card's tests.)
 */

// Only the fields ModelSignalPanel reads. Cast because PatientReport is a wide
// API type and spelling all of it out here would test the fixture, not the code.
const REPORT = {
  record_change_explanation: {
    headline: "Two confirmed records changed",
    patient_summary: "Your latest counts were added to the record.",
    observations: ["WBC recorded 2026-03-29"],
    missing_or_not_comparable: [],
    comparison_basis: "Compared against the previous confirmed record.",
    safe_next_steps: ["Discuss anything concerning with your care team."],
  },
  xai_explanation_envelope: {
    status: "available_synthetic_signal",
    output: { meaning: "Grouped with favorable synthetic examples", calculation: "65/35 blend" },
    evidence: { inputs_used: ["cbc"], inputs_missing: [], abstain_reason: null },
    uncertainty: { explanation: "Synthetic band only." },
    safe_next_steps: ["Discuss anything concerning with your care team."],
  },
  synthetic_model_prediction: { hybrid_mle_signal: { hybrid_score: 57 } },
  synthetic_model_explanation: { positive_contributions: [], negative_contributions: [] },
} as unknown as PatientReport;

describe("model signal explanation envelopes", () => {
  it("names each envelope with the heading already visible inside it", () => {
    render(<ModelSignalPanel report={REPORT} />);

    const changed = screen.getByRole("region", { name: /what changed in confirmed records/i });
    expect(changed).toBeInTheDocument();
    const howTo = screen.getByRole("region", { name: /how to read this output/i });
    expect(howTo).toBeInTheDocument();
  });

  it("uses real headings rather than bold text for those names", () => {
    render(<ModelSignalPanel report={REPORT} />);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());
    expect(headings).toContain("What changed in confirmed records");
    expect(headings).toContain("How to read this output");
  });

  it("leaves no aria-label on an element that cannot carry one", () => {
    const { container } = render(<ModelSignalPanel report={REPORT} />);
    const invalid = container.querySelectorAll("div[aria-label]:not([role])");
    expect(invalid).toHaveLength(0);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<ModelSignalPanel report={REPORT} />);
    await expectNoA11yViolations(container);
  });
});
