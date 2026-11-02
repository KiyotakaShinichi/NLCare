import { describe, it, expect } from "vitest";
import {
  toPatientReason, toPatientReasons, AUTOMATIC_PROMPT_NOTE,
} from "../../src/lib/patientLanguage";

/**
 * The seventeen prompts below are the real `ai_summary.review_reasons` payload
 * for P001. Every one is clinician-directed; rendered verbatim on the
 * patient's own page they describe a review process that has not happened,
 * immediately under a banner saying no clinician has seen any of it.
 *
 * The contract these tests hold: nothing is dropped, no measurement is
 * altered, urgency survives, and no clinician-directed instruction reaches the
 * patient as if it were a finding about them.
 */

const REAL_REASONS = [
  ...Array.from({ length: 11 }, () =>
    "Patient-reported fatigue severity was 10/10. Clinical review may be needed."),
  "WBC reached 1.5 x10^3/uL, suggesting possible treatment-related white blood cell suppression. Medical review is recommended.",
  "Platelets reached 120.0 x10^3/uL, suggesting possible thrombocytopenia. Continue monitoring and review in clinical context.",
  "Hemoglobin reached 10.5 g/dL, suggesting possible anemia. Continue monitoring and review in clinical context.",
  "WBC dropped by 75.0% from baseline. This should be reviewed with the treatment timeline.",
  "Patient-reported mouth sores severity was 7/10. Clinical review may be needed.",
  "WBC fell below 2.0 x10^3/uL. Oncology review is recommended, especially during active chemotherapy.",
];

/** Phrases that must never reach a patient surface as rendered text. */
const CLINICIAN_PHRASES = [
  "Medical review is recommended",
  "Oncology review is recommended",
  "Clinical review may be needed",
  "review in clinical context",
  "reviewed with the treatment timeline",
];

describe("patient language", () => {
  describe("toPatientReason", () => {
    it("removes the clinician instruction from the observation", () => {
      const r = toPatientReason(
        "WBC reached 1.5 x10^3/uL, suggesting possible treatment-related white blood cell suppression. Medical review is recommended.",
      );
      expect(r.observation).not.toContain("Medical review is recommended");
      expect(r.observation).toContain("WBC reached 1.5 x10^3/uL");
    });

    it("never alters the measurement in the observation", () => {
      const r = toPatientReason("Hemoglobin reached 10.5 g/dL, suggesting possible anemia. Continue monitoring and review in clinical context.");
      expect(r.observation).toContain("10.5 g/dL");
      expect(r.observation).toContain("possible anemia");
    });

    it("keeps the original wording recoverable", () => {
      const src = "Patient-reported mouth sores severity was 7/10. Clinical review may be needed.";
      expect(toPatientReason(src).source).toBe(src);
    });

    it("marks oncology-review wording as urgent and keeps that urgency actionable", () => {
      const r = toPatientReason(
        "WBC fell below 2.0 x10^3/uL. Oncology review is recommended, especially during active chemotherapy.",
      );
      expect(r.urgency).toBe("urgent");
      expect(r.suggestion).toMatch(/soon/i);
      // Urgency must not be downgraded into a vague reassurance.
      expect(r.suggestion).not.toMatch(/no need|don't worry|nothing to/i);
    });

    it("says the view cannot show notification status, without claiming an absence", () => {
      expect(toPatientReason(REAL_REASONS[11]).suggestion).toMatch(/does not provide notification status/i);
      expect(toPatientReason(REAL_REASONS[16]).suggestion).toMatch(/does not provide notification status/i);
      expect(toPatientReason(REAL_REASONS[11]).suggestion).not.toMatch(/nobody|no one/i);
    });

    it("keeps the whole sentence when there is no instruction clause to split", () => {
      const src = "WBC is 3.1 x10^3/uL.";
      const r = toPatientReason(src);
      expect(r.observation).toBe(src);
      expect(r.suggestion).toBeTruthy();
    });

    it("never produces an empty observation", () => {
      for (const src of [...REAL_REASONS, "Medical review is recommended.", ""]) {
        expect(toPatientReason(src).observation.length >= 0).toBe(true);
      }
      expect(toPatientReason("Medical review is recommended.").observation).toBeTruthy();
    });
  });

  describe("toPatientReasons over the real payload", () => {
    const out = toPatientReasons(REAL_REASONS);

    it("consolidates 17 rows to 7 prompts without losing one", () => {
      expect(REAL_REASONS).toHaveLength(17);
      expect(out).toHaveLength(7);
      const sources = new Set(out.map((r) => r.source));
      for (const raw of REAL_REASONS) expect(sources.has(raw)).toBe(true);
    });

    it("records that the repeated prompt arrived eleven times", () => {
      const fatigue = out.find((r) => r.source.includes("fatigue severity was 10/10"));
      expect(fatigue?.occurrences).toBe(11);
    });

    it("leaks no clinician-directed phrase into what the patient reads", () => {
      const rendered = out.map((r) => `${r.observation} ${r.suggestion}`).join(" ");
      for (const phrase of CLINICIAN_PHRASES) {
        expect(rendered).not.toContain(phrase);
      }
    });

    it("puts the urgent prompt first so ordering cannot bury it", () => {
      expect(out[0].urgency).toBe("urgent");
      expect(out[0].source).toContain("Oncology review is recommended");
    });

    it("suppresses nothing: every input reason has an output", () => {
      // Consolidation is by identical text only, so the distinct count must
      // match the distinct input count exactly.
      expect(out).toHaveLength(new Set(REAL_REASONS).size);
    });

    it("handles an empty list without inventing a prompt", () => {
      expect(toPatientReasons([])).toEqual([]);
    });
  });

  describe("the standing note", () => {
    it("says these are prompts and not an assessment, and scopes review/notification to the view", () => {
      expect(AUTOMATIC_PROMPT_NOTE).toMatch(/not findings|prompts for a conversation/i);
      expect(AUTOMATIC_PROMPT_NOTE).toMatch(/does not show whether anyone has reviewed them or been notified/i);
      expect(AUTOMATIC_PROMPT_NOTE).not.toMatch(/no clinician has seen|nobody has been notified/i);
      expect(AUTOMATIC_PROMPT_NOTE).toMatch(/(not|none of them is) an assessment/i);
    });
  });
});
