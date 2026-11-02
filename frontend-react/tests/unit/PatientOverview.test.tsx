import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OverviewHeader } from "../../src/pages/patient/OverviewHeader";
import { OverviewGlance } from "../../src/pages/patient/OverviewGlance";
import {
  OVERVIEW_RANGES, latestRecordTime, rangeCutoff,
} from "../../src/pages/patient/overviewRange";
import type { PatientReport } from "../../src/types/api";
import { expectNoA11yViolations } from "../a11y";

/**
 * The Pearl Rose overview, in the parts that carry meaning rather than style.
 *
 * Two things here are clinical-honesty requirements rather than design taste:
 * the range windows must describe the records that exist, and the discussion
 * topics must not read as if a clinician has been told anything.
 */

const REPORT = {
  patient_name: "Ana Reyes",
  diagnosis: "Breast cancer, doctor-confirmed",
  breast_cancer_profile: { cancer_stage: "Stage II", molecular_subtype: "HR+/HER2-" },
  symptoms: [
    { date: "2026-01-12", symptom: "nausea", severity: 5, notes: "" },
    { date: "2026-03-24", symptom: "fatigue", severity: 7, notes: "" },
  ],
  lab_history: [
    { date: "2026-01-04", wbc: 4.0, hemoglobin: 13.0, platelets: 260 },
    { date: "2026-03-29", wbc: 4.7, hemoglobin: 11.1, platelets: 214 },
  ],
} as unknown as PatientReport;

function renderGlance(range: "3m" | "6m" | "12m" = "6m", onChange = vi.fn()) {
  const utils = render(
    <OverviewGlance
      report={REPORT}
      range={range}
      onRangeChange={onChange}
      symptomCount={2}
      labCount={2}
      topicCount={3}
      latestLabDate="2026-03-29"
    />,
  );
  return { ...utils, onChange };
}

describe("overview range window", () => {
  it("anchors to the newest record rather than the wall clock", () => {
    // The demo data ends in March 2026. Measuring "the last six months" from
    // today would show an empty chart for a record that plainly has data.
    const anchor = latestRecordTime(REPORT);
    expect(new Date(anchor).toISOString().slice(0, 10)).toBe("2026-03-29");
    expect(anchor).toBeLessThan(Date.now());
  });

  it("moves the cutoff earlier as the window widens", () => {
    const three = rangeCutoff(REPORT, "3m");
    const twelve = rangeCutoff(REPORT, "12m");
    expect(twelve).toBeLessThan(three);
    expect(latestRecordTime(REPORT) - three).toBe(92 * 86_400_000);
  });

  it("returns a usable cutoff when the record is empty", () => {
    expect(latestRecordTime(null)).toBe(0);
    expect(Number.isFinite(rangeCutoff(null, "6m"))).toBe(true);
  });

  it("states the window as real dates, not just a label", () => {
    renderGlance("6m");
    // Six months back from 29 Mar 2026 lands in Sep/Oct 2025.
    expect(screen.getByText(/Covering .*2025 to .*Mar.*2026/i)).toBeInTheDocument();
  });

  it("offers every range as a pressable control and reports the active one", async () => {
    const user = userEvent.setup();
    const { onChange } = renderGlance("6m");
    const group = screen.getByRole("group", { name: /time range/i });
    for (const r of OVERVIEW_RANGES) {
      expect(within(group).getByRole("button", { name: r.label })).toBeInTheDocument();
    }
    expect(within(group).getByRole("button", { name: "6 months" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "12 months" }));
    expect(onChange).toHaveBeenCalledWith("12m");
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderGlance();
    await expectNoA11yViolations(container);
  });
});

describe("overview header", () => {
  it("keeps the patient's name and their diagnosis facts visible", () => {
    render(
      <MemoryRouter>
        <OverviewHeader report={REPORT} patientId="P001" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Ana Reyes/)).toBeInTheDocument();
    expect(screen.getByText("Breast cancer, doctor-confirmed")).toBeInTheDocument();
    expect(screen.getByText("Stage II")).toBeInTheDocument();
    expect(screen.getByText("HR+/HER2-")).toBeInTheDocument();
  });

  it("says plainly that the session is synthetic", () => {
    render(
      <MemoryRouter>
        <OverviewHeader report={REPORT} patientId="P001" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/synthetic demo session/i)).toBeInTheDocument();
  });

  it("offers both patient actions as links to the support chat", () => {
    render(
      <MemoryRouter>
        <OverviewHeader report={REPORT} patientId="P001" />
      </MemoryRouter>,
    );
    for (const name of [/ask about your record/i, /log how you feel/i]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/patient/chat");
    }
  });

  it("renders without a profile or a patient id", () => {
    render(
      <MemoryRouter>
        <OverviewHeader report={{ patient_name: "Ana Reyes" } as unknown as PatientReport} patientId={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Ana Reyes/)).toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <MemoryRouter>
        <OverviewHeader report={REPORT} patientId="P001" />
      </MemoryRouter>,
    );
    await expectNoA11yViolations(container);
  });
});
