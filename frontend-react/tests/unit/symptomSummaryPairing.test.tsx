import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { SymptomsTable } from "../../src/pages/patient/SymptomsTable";
import type { Symptom } from "../../src/types/api";

/**
 * The Symptom Log summary took its name from the newest row and its score from
 * the maximum across every symptom and date, so "nausea 9" could describe a
 * nausea rating of 2 beside a mouth-sores rating of 9. Each name, score and date
 * shown together must now come from one record.
 */
const rec = (date: string, symptom: string, severity: number, notes = ""): Symptom => ({ date, symptom, severity, notes });

function facts() {
  const list = document.querySelector("dl.symptom-facts") as HTMLElement | null;
  if (!list) return [];
  return [...list.querySelectorAll<HTMLElement>(":scope > div")].map((fact) => ({
    label: fact.querySelector("dt")?.textContent ?? "",
    text: (fact.querySelector("dd")?.textContent ?? "").replace(/\s+/g, " "),
  }));
}
const fact = (label: RegExp) => facts().find((f) => label.test(f.label))?.text ?? "";

const LATEST = /^Latest recorded symptom$/;
const HIGHEST = /^Highest recorded severity$/;

describe("name, severity and date come from one record", () => {
  it("latest symptom milder than an earlier, different symptom", () => {
    render(<SymptomsTable symptoms={[
      rec("2026-02-12", "mouth sores", 9),
      rec("2026-05-01", "nausea", 2),
    ]} />);
    const latest = fact(LATEST);
    expect(latest).toContain("nausea");
    expect(latest).toContain("2026-05-01");
    expect(latest).toMatch(/Severity 2 out of 10/);
    expect(latest).not.toContain("9");

    const highest = fact(HIGHEST);
    expect(highest).toContain("mouth sores");
    expect(highest).toContain("2026-02-12");
    expect(highest).toMatch(/Severity 9 out of 10/);
    expect(highest).not.toContain("nausea");
  });

  it("one entry when the latest record is also the highest", () => {
    render(<SymptomsTable symptoms={[rec("2026-01-01", "nausea", 3), rec("2026-05-01", "fatigue", 8)]} />);
    expect(facts()).toHaveLength(1);
    expect(facts()[0].label).toBe("Latest recorded symptom and highest recorded severity");
    expect(facts()[0].text).toContain("fatigue");
    expect(facts()[0].text).toMatch(/Severity 8 out of 10/);
  });

  it("several symptoms on the newest date: says the record cannot order them", () => {
    render(<SymptomsTable symptoms={[
      rec("2026-05-01", "nausea", 2),
      rec("2026-05-01", "fatigue", 7),
      rec("2026-04-01", "neuropathy", 4),
    ]} />);
    expect(fact(LATEST)).toContain("nausea");
    expect(fact(LATEST)).toMatch(/One of 2 ratings recorded on this date/);
    expect(fact(HIGHEST)).toContain("fatigue");
    expect(fact(HIGHEST)).toContain("2026-05-01");
  });

  it("one symptom repeated at different severities", () => {
    render(<SymptomsTable symptoms={[
      rec("2026-01-30", "fatigue", 10),
      rec("2026-03-24", "fatigue", 5),
    ]} />);
    expect(fact(LATEST)).toContain("2026-03-24");
    expect(fact(LATEST)).toMatch(/Severity 5 out of 10/);
    expect(fact(HIGHEST)).toContain("2026-01-30");
    expect(fact(HIGHEST)).toMatch(/Severity 10 out of 10/);
  });

  it("identical rows are one rating, and the row count is still disclosed", () => {
    const row = rec("2026-03-24", "fatigue", 5);
    render(<SymptomsTable symptoms={[row, { ...row }, { ...row }]} />);
    expect(facts()).toHaveLength(1);
    expect(facts()[0].text).not.toMatch(/One of/);
    expect(document.querySelector(".symptom-summary")?.textContent).toMatch(/1 distinct rating from 3 rows/);
  });
});

describe("ties and ordering", () => {
  it("equal highest severity: the most recent record is named", () => {
    render(<SymptomsTable symptoms={[
      rec("2026-01-10", "nausea", 8),
      rec("2026-03-10", "fatigue", 8),
      rec("2026-04-10", "neuropathy", 1),
    ]} />);
    expect(fact(HIGHEST)).toContain("fatigue");
    expect(fact(HIGHEST)).toContain("2026-03-10");
  });

  it("equal severity on one date: the first in record order is named, every time", () => {
    const rows = [rec("2026-03-10", "nausea", 8), rec("2026-03-10", "fatigue", 8), rec("2026-04-10", "neuropathy", 1)];
    render(<SymptomsTable symptoms={rows} />);
    expect(fact(HIGHEST)).toContain("nausea");
  });

  it("input order does not change which dates win, and the list stays newest first", () => {
    render(<SymptomsTable symptoms={[
      rec("2026-01-10", "a", 1), rec("2026-05-10", "b", 2), rec("2026-03-10", "c", 3),
    ]} />);
    expect(fact(LATEST)).toContain("2026-05-10");
    const names = [...document.querySelectorAll(".symptom-name")].map((n) => n.textContent);
    expect(names).toEqual(["b", "c", "a"]);
  });

  it("does not change the caller's array", () => {
    const rows = [rec("2026-01-10", "a", 1), rec("2026-05-10", "b", 2)];
    render(<SymptomsTable symptoms={rows} />);
    expect(rows.map((r) => r.symptom)).toEqual(["a", "b"]);
  });
});

describe("empty and malformed records", () => {
  it("empty records show the existing empty state and no summary", () => {
    render(<SymptomsTable symptoms={[]} />);
    expect(screen.getByText(/No symptoms recorded/)).toBeInTheDocument();
    expect(document.querySelector(".symptom-summary")).toBeNull();
  });

  it("a missing severity is never shown as a score of 0, and cannot be the highest", () => {
    const rows = [
      { date: "2026-05-01", symptom: "nausea", notes: "" },
      rec("2026-02-01", "fatigue", 0),
    ] as unknown as Symptom[];
    render(<SymptomsTable symptoms={rows} />);
    expect(fact(LATEST)).toContain("nausea");
    expect(fact(LATEST)).toMatch(/Severity not recorded/);
    expect(fact(HIGHEST)).toContain("fatigue");
    expect(fact(HIGHEST)).toMatch(/Severity 0 out of 10/);
  });

  it("non-numeric and off-scale severities are not treated as ratings", () => {
    const rows = [
      { date: "2026-05-01", symptom: "a", severity: "high", notes: "" },
      { date: "2026-04-01", symptom: "b", severity: Number.NaN, notes: "" },
      { date: "2026-03-01", symptom: "c", severity: 99, notes: "" },
      rec("2026-01-01", "d", 4),
    ] as unknown as Symptom[];
    render(<SymptomsTable symptoms={rows} />);
    expect(fact(HIGHEST)).toContain("d");
    expect(fact(HIGHEST)).toMatch(/Severity 4 out of 10/);
    expect(document.body.textContent).not.toContain("NaN");
    expect(document.body.textContent).not.toContain("99");
    // Kept in the list rather than dropped: the record exists.
    expect([...document.querySelectorAll(".symptom-name")].map((n) => n.textContent)).toEqual(["a", "b", "c", "d"]);
  });

  it("a missing or invalid date does not crash and cannot be the latest", () => {
    const rows = [
      { symptom: "no date", severity: 9, notes: "" },
      { date: "not-a-date", symptom: "bad date", severity: 1, notes: "" },
      rec("2026-01-01", "dated", 4),
    ] as unknown as Symptom[];
    render(<SymptomsTable symptoms={rows} />);
    expect(fact(LATEST)).toContain("dated");
    expect(fact(HIGHEST)).toContain("no date");
    expect(fact(HIGHEST)).toMatch(/Date not recorded/);
  });

  it("a missing name says so rather than rendering blank", () => {
    render(<SymptomsTable symptoms={[{ date: "2026-01-01", severity: 4, notes: "" } as unknown as Symptom]} />);
    expect(facts()[0].text).toMatch(/Symptom name not recorded/);
  });

  it("every record invalid: the summary claims nothing", () => {
    render(<SymptomsTable symptoms={[{ symptom: "x", notes: "" } as unknown as Symptom]} />);
    expect(facts()).toHaveLength(0);
    expect(document.querySelector(".symptom-name")?.textContent).toBe("x");
  });
});

describe("labels", () => {
  it("each fact is a named term and description a screen reader can follow", () => {
    render(<SymptomsTable symptoms={[rec("2026-02-12", "mouth sores", 9), rec("2026-05-01", "nausea", 2)]} />);
    const list = document.querySelector("dl.symptom-facts") as HTMLElement;
    expect(within(list).getByText("Latest recorded symptom").tagName).toBe("DT");
    expect(within(list).getByText("Highest recorded severity").tagName).toBe("DT");
    expect(document.body.textContent).not.toMatch(/peak severity/i);
  });
});
