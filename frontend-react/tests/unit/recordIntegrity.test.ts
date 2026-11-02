import { describe, it, expect } from "vitest";
import {
  summariseRecords, describeRecords, indistinguishableNote, consolidateText,
} from "../../src/lib/recordIntegrity";

/**
 * The dataset these tests are built on is the real one.
 *
 * `/me/patient-report/core` for P001 returns 39 symptom rows that reduce to 8
 * distinct records, 38 lab rows that reduce to 17, and 17 discussion prompts
 * that reduce to 7 - all of the duplication sitting on the seed date
 * 2026-01-01, and some of it contradictory (the same day carries WBC 6.0 and
 * WBC 1.5, and fatigue at 0, 3 and 10). The counts below are taken from that
 * payload, so a regression shows up as a number that stops matching the API.
 */

/** The 2026-01-01 block exactly as the API returns it. */
const SEED_DAY = [
  ...Array.from({ length: 12 }, () => ({ date: "2026-01-01", symptom: "fatigue", severity: 3, notes: null })),
  ...Array.from({ length: 11 }, () => ({ date: "2026-01-01", symptom: "fatigue", severity: 0, notes: null })),
  ...Array.from({ length: 11 }, () => ({ date: "2026-01-01", symptom: "fatigue", severity: 10, notes: null })),
];
const LATER_DAYS = [
  { date: "2026-01-12", symptom: "nausea", severity: 5, notes: null },
  { date: "2026-01-30", symptom: "fatigue", severity: 6, notes: null },
  { date: "2026-02-12", symptom: "mouth sores", severity: 7, notes: null },
  { date: "2026-03-10", symptom: "neuropathy", severity: 4, notes: null },
  { date: "2026-03-24", symptom: "fatigue", severity: 5, notes: null },
];
const SYMPTOMS = [...SEED_DAY, ...LATER_DAYS];

describe("record integrity", () => {
  describe("summariseRecords", () => {
    it("reduces the real 39-row symptom payload to its 8 distinct records", () => {
      const s = summariseRecords(SYMPTOMS, (r) => r.date);
      expect(SYMPTOMS).toHaveLength(39);
      expect(s.distinct).toHaveLength(8);
      expect(s.indistinguishable).toBe(31);
      expect(s.hasIndistinguishable).toBe(true);
    });

    it("never mutates or drops a raw row", () => {
      const s = summariseRecords(SYMPTOMS, (r) => r.date);
      expect(s.rows).toHaveLength(39);
      expect(s.rows).toEqual(SYMPTOMS);
      // The raw array itself is untouched, not just equal to a copy.
      expect(SYMPTOMS).toHaveLength(39);
    });

    it("keeps contradictory same-day ratings as separate records", () => {
      const s = summariseRecords(SEED_DAY, (r) => r.date);
      // 0, 3 and 10 on one day disagree with each other; none may be collapsed
      // into the others or averaged away.
      expect(s.distinct).toHaveLength(3);
      expect(s.distinct.map((r) => r.severity).sort((a, b) => a - b)).toEqual([0, 3, 10]);
    });

    it("reports the days the distinct records fall on, ascending", () => {
      const s = summariseRecords(SYMPTOMS, (r) => r.date);
      expect(s.days).toEqual([
        "2026-01-01", "2026-01-12", "2026-01-30", "2026-02-12", "2026-03-10", "2026-03-24",
      ]);
    });

    it("treats key order as irrelevant to a row's identity", () => {
      const a = { date: "2026-01-01", symptom: "fatigue", severity: 3 };
      const b = { severity: 3, symptom: "fatigue", date: "2026-01-01" };
      expect(summariseRecords([a, b], (r) => r.date).distinct).toHaveLength(1);
    });

    it("keeps rows that differ in any single field", () => {
      const rows = [
        { date: "2026-01-01", symptom: "fatigue", severity: 3, notes: null },
        { date: "2026-01-01", symptom: "fatigue", severity: 3, notes: "worse at night" },
      ];
      expect(summariseRecords(rows, (r) => r.date).distinct).toHaveLength(2);
    });

    it("reports nothing indistinguishable when every row is unique", () => {
      const s = summariseRecords(LATER_DAYS, (r) => r.date);
      expect(s.indistinguishable).toBe(0);
      expect(s.hasIndistinguishable).toBe(false);
    });

    it("handles an empty record without inventing a count", () => {
      const s = summariseRecords([], () => null);
      expect(s.distinct).toHaveLength(0);
      expect(s.days).toEqual([]);
      expect(s.hasIndistinguishable).toBe(false);
    });
  });

  describe("describeRecords", () => {
    it("says 'distinct' only when rows could not be told apart", () => {
      const dup = describeRecords(summariseRecords(SYMPTOMS, (r) => r.date), "rating", "ratings");
      expect(dup).toBe("8 distinct ratings across 6 days");

      const clean = describeRecords(summariseRecords(LATER_DAYS, (r) => r.date), "rating", "ratings");
      expect(clean).toBe("5 ratings across 5 days");
      expect(clean).not.toContain("distinct");
    });

    it("never claims a raw row count the record does not support", () => {
      const phrase = describeRecords(summariseRecords(SYMPTOMS, (r) => r.date), "rating", "ratings");
      expect(phrase).not.toContain("39");
    });

    it("uses the singular and says 'on one day' for a single record", () => {
      const one = summariseRecords([LATER_DAYS[0]], (r) => r.date);
      expect(describeRecords(one, "rating", "ratings")).toBe("1 rating on one day");
    });

    it("states an empty record plainly rather than as zero", () => {
      expect(describeRecords(summariseRecords([], () => null), "rating", "ratings"))
        .toBe("No ratings in this period");
    });
  });

  describe("indistinguishableNote", () => {
    it("discloses the rows it could not distinguish, and says why", () => {
      const note = indistinguishableNote(summariseRecords(SYMPTOMS, (r) => r.date), "ratings");
      expect(note).toContain("31");
      expect(note).toContain("kept in your record");
      // It must not assert that the extra rows are errors - that is not
      // something the frontend can know.
      expect(note).not.toMatch(/duplicate|error|mistake|wrong/i);
    });

    it("says nothing when there is nothing to disclose", () => {
      expect(indistinguishableNote(summariseRecords(LATER_DAYS, (r) => r.date), "ratings")).toBeNull();
    });
  });

  describe("consolidateText", () => {
    it("reduces the real 17 prompts to 7, keeping occurrence counts", () => {
      const raw = [
        ...Array.from({ length: 11 }, () => "Patient-reported fatigue severity was 10/10. Clinical review may be needed."),
        "WBC reached 1.5 x10^3/uL, suggesting possible treatment-related white blood cell suppression. Medical review is recommended.",
        "Platelets reached 120.0 x10^3/uL, suggesting possible thrombocytopenia. Continue monitoring and review in clinical context.",
        "Hemoglobin reached 10.5 g/dL, suggesting possible anemia. Continue monitoring and review in clinical context.",
        "WBC dropped by 75.0% from baseline. This should be reviewed with the treatment timeline.",
        "Patient-reported mouth sores severity was 7/10. Clinical review may be needed.",
        "WBC fell below 2.0 x10^3/uL. Oncology review is recommended, especially during active chemotherapy.",
      ];
      expect(raw).toHaveLength(17);
      const out = consolidateText(raw);
      expect(out).toHaveLength(7);
      expect(out[0].occurrences).toBe(11);
      expect(out[1].occurrences).toBe(1);
    });

    it("keeps first-seen order so an urgent prompt cannot be reordered away", () => {
      const out = consolidateText(["b", "a", "b", "c"]);
      expect(out.map((x) => x.text)).toEqual(["b", "a", "c"]);
    });

    it("keeps prompts that differ by a single character separate", () => {
      expect(consolidateText(["WBC is 1.5", "WBC is 1.6"])).toHaveLength(2);
    });

    it("drops only blank entries", () => {
      expect(consolidateText(["a", "", "   ", "a"])).toEqual([{ text: "a", occurrences: 2 }]);
    });
  });
});
