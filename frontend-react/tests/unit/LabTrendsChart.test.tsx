import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LabTrendsChart } from "../../src/components/charts/LabTrendsChart";
import {
  buildLabSeries, findGaps, toChartPoints, computeDomain,
  GAP_MIN_DAYS,
} from "../../src/components/charts/labSeries";
import { LAB_REFERENCE_RANGES } from "../../src/lib/clinical-constants";
import type { LabHistoryPoint } from "../../src/types/api";
import { expectNoA11yViolations } from "../a11y";

/**
 * These guard the integrity of what the chart claims, not its pixels.
 *
 * The previous implementation drew all three analytes against one unlabelled
 * axis and multiplied platelets by 0.1 so they would fit. The assertions below
 * are written so that re-introducing any shared scale, any interpolation across
 * a missing result, or any drift between a value and its unit fails here.
 *
 * Recharts renders into a zero-sized container under jsdom, so the SVG itself
 * is not asserted on. The data projection is tested directly through
 * `buildLabSeries`, and everything a screen reader or a keyboard user reaches -
 * headings, units, the table - is tested through the DOM.
 */

const HISTORY: LabHistoryPoint[] = [
  { date: "2026-01-12", wbc: 3.4, hemoglobin: 10.9, platelets: 178 },
  { date: "2026-02-19", wbc: 4.7, hemoglobin: 11.1, platelets: 214 },
  { date: "2026-03-29", wbc: 5.1, hemoglobin: 11.8, platelets: 232 },
];

describe("buildLabSeries", () => {
  it("copies every measurement through untransformed", () => {
    const series = buildLabSeries(HISTORY);
    const byKey = Object.fromEntries(series.map((s) => [s.key, s]));

    expect(byKey.wbc.points.map((p) => p.value)).toEqual([3.4, 4.7, 5.1]);
    expect(byKey.hemoglobin.points.map((p) => p.value)).toEqual([10.9, 11.1, 11.8]);
    // The regression that mattered: platelets used to arrive here as 17.8 etc.
    expect(byKey.platelets.points.map((p) => p.value)).toEqual([178, 214, 232]);
  });

  it("never rescales one analyte to fit another's range", () => {
    const series = buildLabSeries(HISTORY);
    for (const s of series) {
      for (let i = 0; i < HISTORY.length; i += 1) {
        expect(s.points[i].value).toBe(HISTORY[i][s.key]);
      }
    }
  });

  it("takes each label and unit from the shared clinical constants", () => {
    const series = buildLabSeries(HISTORY);
    for (const s of series) {
      expect(s.label).toBe(LAB_REFERENCE_RANGES[s.key].label);
      expect(s.unit).toBe(LAB_REFERENCE_RANGES[s.key].unit);
    }
    // Units genuinely differ between analytes, which is why one axis cannot
    // serve all three.
    const units = new Set(series.map((s) => s.unit));
    expect(units.size).toBeGreaterThan(1);
  });

  it("keeps missing results as null rather than dropping or filling them", () => {
    const gapped: LabHistoryPoint[] = [
      { date: "2026-01-12", wbc: 3.4, hemoglobin: 10.9, platelets: 178 },
      { date: "2026-02-19", wbc: null, hemoglobin: 11.1, platelets: null },
      { date: "2026-03-29", wbc: 5.1, hemoglobin: null, platelets: 232 },
    ];
    const byKey = Object.fromEntries(buildLabSeries(gapped).map((s) => [s.key, s]));

    expect(byKey.wbc.points.map((p) => p.value)).toEqual([3.4, null, 5.1]);
    expect(byKey.wbc.points).toHaveLength(3);
    expect(byKey.wbc.observed).toBe(2);
    expect(byKey.platelets.observed).toBe(2);
    // No value was invented for the middle date.
    expect(byKey.wbc.points[1].value).toBeNull();
  });

  it("preserves the supplied date on every point and orders by time", () => {
    const unordered: LabHistoryPoint[] = [
      { date: "2026-03-29", wbc: 5.1, hemoglobin: 11.8, platelets: 232 },
      { date: "2026-01-12", wbc: 3.4, hemoglobin: 10.9, platelets: 178 },
    ];
    const series = buildLabSeries(unordered);
    for (const s of series) {
      expect(s.points.map((p) => p.date)).toEqual(["2026-01-12", "2026-03-29"]);
      expect(s.points[0].t).toBeLessThan(s.points[1].t);
    }
  });

  it("reports zero observations for an analyte that was never measured", () => {
    const series = buildLabSeries([
      { date: "2026-01-12", wbc: null, hemoglobin: 10.9, platelets: null },
    ]);
    const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
    expect(byKey.wbc.observed).toBe(0);
    expect(byKey.hemoglobin.observed).toBe(1);
  });
});

describe("LabTrendsChart", () => {
  it("gives each analyte its own titled chart carrying its unit", () => {
    render(<LabTrendsChart data={HISTORY} />);
    for (const key of ["wbc", "hemoglobin", "platelets"] as const) {
      const meta = LAB_REFERENCE_RANGES[key];
      const heading = screen.getByRole("heading", { name: new RegExp(meta.label, "i") });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent(meta.unit);
    }
  });

  it("describes each chart for assistive technology with its real date span", () => {
    render(<LabTrendsChart data={HISTORY} />);
    const figures = screen.getAllByRole("img");
    expect(figures).toHaveLength(3);
    expect(figures[0]).toHaveAccessibleName(/WBC trend in K\/uL/i);
    // "measurements" counted rows; it now counts distinct results, because the
    // record can hold rows identical in every field.
    expect(figures[0]).toHaveAccessibleName(/3 distinct results/i);
  });

  it("offers a table alternative listing every value with its unit", async () => {
    const user = userEvent.setup();
    render(<LabTrendsChart data={HISTORY} />);

    await user.click(screen.getByText(/view measurements as a table/i));
    const table = screen.getByRole("table");

    expect(within(table).getByText("178")).toBeInTheDocument();
    expect(within(table).getByText("214")).toBeInTheDocument();
    expect(within(table).getByText("232")).toBeInTheDocument();

    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(headers.join(" ")).toMatch(/WBC K\/uL/);
    expect(headers.join(" ")).toMatch(/Hemoglobin g\/dL/);
    expect(headers.join(" ")).toMatch(/Platelets K\/uL/);
  });

  it("states missing results in the table instead of leaving a blank cell", async () => {
    const user = userEvent.setup();
    render(
      <LabTrendsChart
        data={[{ date: "2026-02-19", wbc: null, hemoglobin: 11.1, platelets: null }]}
      />,
    );
    await user.click(screen.getByText(/view measurements as a table/i));
    expect(screen.getAllByText("not measured")).toHaveLength(2);
  });

  it("shows a per-analyte empty state rather than an empty axis", () => {
    render(
      <LabTrendsChart
        data={[{ date: "2026-02-19", wbc: null, hemoglobin: 11.1, platelets: null }]}
      />,
    );
    expect(screen.getByText(/No WBC results have been recorded yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No Platelets results have been recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/No Hemoglobin results/i)).not.toBeInTheDocument();
  });

  it("shows one empty state when there is no history at all", () => {
    render(<LabTrendsChart data={[]} />);
    expect(screen.getByText(/no lab history recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<LabTrendsChart data={HISTORY} />);
    await expectNoA11yViolations(container);
  });
});

describe("sampling gaps", () => {
  /** Two results six months apart are two adjacent rows, not a null in between. */
  const SPARSE: LabHistoryPoint[] = [
    { date: "2025-09-01", wbc: 4.0, hemoglobin: 12.0, platelets: 200 },
    { date: "2026-03-29", wbc: 4.6, hemoglobin: 11.5, platelets: 210 },
  ];

  it("flags a long interval between consecutive observations", () => {
    const series = buildLabSeries(SPARSE);
    for (const s of series) {
      expect(s.gaps).toHaveLength(1);
      expect(s.gaps[0].fromDate).toBe("2025-09-01");
      expect(s.gaps[0].toDate).toBe("2026-03-29");
      expect(s.gaps[0].days).toBeGreaterThan(GAP_MIN_DAYS);
    }
  });

  it("breaks the drawn line across that interval instead of spanning it", () => {
    const series = buildLabSeries(SPARSE)[0];
    const drawn = toChartPoints(series);
    // A null marker separates the two real observations, so no single segment
    // is drawn across six unmonitored months.
    expect(drawn).toHaveLength(3);
    expect(drawn[1].value).toBeNull();
    expect(drawn.filter((p) => p.value != null).map((p) => p.value)).toEqual([4.0, 4.6]);
  });

  it("adds no marker and no gap when sampling is regular", () => {
    const regular: LabHistoryPoint[] = [
      { date: "2026-03-01", wbc: 4.0, hemoglobin: 12.0, platelets: 200 },
      { date: "2026-03-08", wbc: 4.2, hemoglobin: 12.1, platelets: 205 },
      { date: "2026-03-15", wbc: 4.1, hemoglobin: 12.0, platelets: 202 },
    ];
    const series = buildLabSeries(regular)[0];
    expect(series.gaps).toEqual([]);
    expect(toChartPoints(series)).toHaveLength(3);
    expect(toChartPoints(series).every((p) => p.value != null)).toBe(true);
  });

  it("does not treat a short absolute interval as a gap even if irregular", () => {
    // 1, 1 then 8 days: eight times the median, but only eight days.
    const bursty: LabHistoryPoint[] = [
      { date: "2026-03-01", wbc: 4.0, hemoglobin: 12.0, platelets: 200 },
      { date: "2026-03-02", wbc: 4.1, hemoglobin: 12.0, platelets: 201 },
      { date: "2026-03-10", wbc: 4.2, hemoglobin: 12.1, platelets: 203 },
    ];
    expect(findGaps(buildLabSeries(bursty)[0].points)).toEqual([]);
  });

  it("states the gap in words as well as breaking the line", () => {
    render(<LabTrendsChart data={SPARSE} />);
    expect(screen.getAllByText(/no recorded results/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2025-09-01 to 2026-03-29/).length).toBeGreaterThan(0);
  });
});

describe("axis domain", () => {
  it("contains every value, including an outlier", () => {
    const withOutlier: LabHistoryPoint[] = [
      { date: "2026-03-01", wbc: 4.0, hemoglobin: 12.0, platelets: 200 },
      { date: "2026-03-08", wbc: 4.2, hemoglobin: 12.1, platelets: 205 },
      { date: "2026-03-15", wbc: 19.8, hemoglobin: 12.0, platelets: 202 },
    ];
    const wbc = buildLabSeries(withOutlier)[0];
    const [lo, hi] = computeDomain(wbc.points);
    expect(lo).toBeLessThanOrEqual(4.0);
    expect(hi).toBeGreaterThanOrEqual(19.8);
  });

  it("ignores nulls and still spans a single measurement", () => {
    const [lo, hi] = computeDomain([
      { date: "2026-03-01", t: 0, value: null },
      { date: "2026-03-08", t: 1, value: 7.5 },
    ]);
    expect(lo).toBeLessThan(7.5);
    expect(hi).toBeGreaterThan(7.5);
  });
});

describe("axis bounds are round as well as inclusive", () => {
  it("produces readable bounds rather than floating-point noise", () => {
    const [lo, hi] = computeDomain([
      { date: "a", t: 1, value: 2.1 },
      { date: "b", t: 2, value: 7.5 },
    ]);
    // Inclusive...
    expect(lo).toBeLessThanOrEqual(2.1);
    expect(hi).toBeGreaterThanOrEqual(7.5);
    // ...and round: no 1.6679999999999997 reaching an axis label.
    expect(String(lo)).not.toMatch(/\d{6,}/);
    expect(String(hi)).not.toMatch(/\d{6,}/);
    expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
  });

  it("keeps bounds round for small-magnitude analytes too", () => {
    const [lo, hi] = computeDomain([
      { date: "a", t: 1, value: 10.8 },
      { date: "b", t: 2, value: 13.2 },
    ]);
    expect(lo).toBeLessThanOrEqual(10.8);
    expect(hi).toBeGreaterThanOrEqual(13.2);
    expect(String(lo)).not.toMatch(/\d{6,}/);
    expect(String(hi)).not.toMatch(/\d{6,}/);
  });
});
