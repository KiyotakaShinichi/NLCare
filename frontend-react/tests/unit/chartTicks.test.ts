import { describe, it, expect } from "vitest";
import {
  timeTicks, tickCountForWidth, timeDomain, TICK_PX_PER_LABEL, MIN_TICKS, MAX_TICKS,
} from "../../src/components/charts/labSeries";

/**
 * The axis defect, held shut.
 *
 * Measured on the rendered SVG before this fix: 39 x-axis labels inside a
 * 180px chart, with 37 of 38 adjacent pairs overlapping. Recharts was choosing
 * its own ticks and `minTickGap={24}` never fired, because it spaces ticks
 * that already exist rather than limiting how many are generated.
 *
 * These tests pin the replacement: the count comes from the available width,
 * the values are real points inside the domain, and the ends are the domain's
 * ends so the axis cannot imply the series runs past its data.
 */

const DAY = 86_400_000;
const JAN_1 = Date.UTC(2026, 0, 1);
const MAY_17 = Date.UTC(2026, 4, 17);

describe("chart axis ticks", () => {
  describe("tickCountForWidth", () => {
    it("never exceeds what the width can hold", () => {
      for (const w of [120, 180, 240, 360, 480, 646, 900, 1400]) {
        expect(tickCountForWidth(w)).toBeLessThanOrEqual(Math.max(MIN_TICKS, Math.floor(w / TICK_PX_PER_LABEL)));
      }
    });

    it("gives the 180px chart that overlapped 37 times only two labels", () => {
      expect(tickCountForWidth(180)).toBe(2);
    });

    it("stays within its own bounds at every width", () => {
      for (const w of [0, 1, 50, 180, 400, 1000, 4000]) {
        const n = tickCountForWidth(w);
        expect(n).toBeGreaterThanOrEqual(MIN_TICKS);
        expect(n).toBeLessThanOrEqual(MAX_TICKS);
      }
    });

    it("falls back to the floor for an unmeasured container", () => {
      expect(tickCountForWidth(0)).toBe(MIN_TICKS);
      expect(tickCountForWidth(Number.NaN)).toBe(MIN_TICKS);
      expect(tickCountForWidth(-100)).toBe(MIN_TICKS);
    });
  });

  describe("timeTicks", () => {
    it("produces far fewer labels than data points", () => {
      // 38 lab results across the real span, in the real 180px small multiple.
      const ticks = timeTicks([JAN_1, MAY_17], 180);
      expect(ticks.length).toBeLessThanOrEqual(MAX_TICKS);
      expect(ticks.length).toBeLessThan(38);
    });

    it("gives every label room at the width it was chosen for", () => {
      for (const w of [180, 320, 390, 646, 1060, 1400]) {
        const ticks = timeTicks([JAN_1, MAY_17], w);
        if (ticks.length < 2) continue;
        const spacing = w / (ticks.length - 1);
        expect(spacing).toBeGreaterThanOrEqual(TICK_PX_PER_LABEL - 1);
      }
    });

    it("pins the first and last tick to the domain bounds", () => {
      for (const w of [180, 390, 1400]) {
        const ticks = timeTicks([JAN_1, MAY_17], w);
        expect(ticks[0]).toBe(JAN_1);
        expect(ticks[ticks.length - 1]).toBe(MAY_17);
      }
    });

    it("keeps every tick inside the domain, so no label names a point off the axis", () => {
      const ticks = timeTicks([JAN_1, MAY_17], 1400);
      for (const t of ticks) {
        expect(t).toBeGreaterThanOrEqual(JAN_1);
        expect(t).toBeLessThanOrEqual(MAY_17);
      }
    });

    it("returns ticks in ascending order with no repeats", () => {
      const ticks = timeTicks([JAN_1, MAY_17], 1400);
      expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
      expect(new Set(ticks).size).toBe(ticks.length);
    });

    it("handles a single-day domain without dividing by zero", () => {
      expect(timeTicks([JAN_1, JAN_1], 400)).toEqual([JAN_1]);
    });

    it("handles a two-day domain", () => {
      const ticks = timeTicks([JAN_1, JAN_1 + DAY], 400);
      expect(ticks[0]).toBe(JAN_1);
      expect(ticks[ticks.length - 1]).toBe(JAN_1 + DAY);
    });

    it("returns nothing for a domain that is not finite", () => {
      expect(timeTicks([Number.NaN, MAY_17], 400)).toEqual([]);
    });
  });

  describe("timeDomain", () => {
    it("spans only the observations, ignoring the null break markers", () => {
      const points = [
        { date: "2026-01-01", t: JAN_1, value: 6 },
        { date: "gap", t: JAN_1 + 1, value: null },
        { date: "2026-05-17", t: MAY_17, value: 3.1 },
      ];
      expect(timeDomain(points)).toEqual([JAN_1, MAY_17]);
    });

    it("returns a zero span when nothing was observed", () => {
      expect(timeDomain([{ date: "x", t: JAN_1, value: null }])).toEqual([0, 0]);
    });
  });
});
