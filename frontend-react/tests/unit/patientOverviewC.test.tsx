import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

import PatientOverviewC from "../../src/pages/patient/overviewC/PatientOverviewC";
import { RecordCoverage } from "../../src/pages/patient/overviewC/RecordCoverage";
import { ReviewItems } from "../../src/pages/patient/overviewC/ReviewItems";
import { AppShell } from "../../src/components/layout/AppShell";
import { useAllowedQueryParam, useKeepQueryParam } from "../../src/hooks/useQueryParam";
import { resolvePatientOverviewC } from "../../src/lib/featureFlags";
import {
  AUTOMATIC_PROMPT_NOTE, MONITORING_BOUNDARY, RESEARCH_MODEL_ABSENCE, RESEARCH_MODEL_LEDE,
} from "../../src/lib/patientLanguage";
import type { PatientReport } from "../../src/types/api";

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ clearSession: vi.fn(), role: "patient", patientId: "P001" }),
}));

const URGENT_WORDED = "WBC fell below 2.0 x10^3/uL. Oncology review is recommended, especially during active chemotherapy.";
const STANDARD_WORDED = "Hemoglobin reached 10.5 g/dL, suggesting possible anemia. Continue monitoring and review in clinical context.";

/** Every model field populated, so leaving them out cannot pass by accident. */
const MODEL_FIELDS = {
  hybrid_prediction: {
    classification: { decision: "favorable_pattern", probability: 0.973, raw_probability: 0.973, calibrated: false, confidence: "high", evidence: null, model_version: "v", question: "q" },
    claim_boundary: "boundary",
  },
  evidence_aware_prediction: { decision: "favorable_pattern", probability: 0.973, calibrated: false, confidence: "high" },
  synthetic_model_prediction: { hybrid_mle_signal: { hybrid_score: 97, classification_probability: 0.973 } },
  synthetic_model_explanation: { summary: "model says favorable" },
  monitoring_score: 0.973,
};
const MODEL_WORDING =
  /favou?rable|unfavou?rable|concerning signal|class probability|synthetic class|confidence:\s*(?:high|medium|low)|calibrated classifier|hybrid score|hybrid monitoring|monitoring model|response score|model signal|97\.3|0\.973|\b97\s?%/i;

const SYMPTOMS = [
  { date: "2026-02-12", symptom: "mouth sores", severity: 9, notes: "" },
  { date: "2026-03-10", symptom: "fatigue", severity: 5, notes: "" },
  { date: "2026-05-01", symptom: "nausea", severity: 2, notes: "" },
];
const COVERAGE = {
  status: "missing",
  patient_friendly_summary: "Some parts of your record are incomplete.",
  items: [
    { name: "CBC trend", status: "missing", detail: "0 CBC row(s) available.", next_step: "CBC trends need at least two timepoints to compare direction." },
    { name: "Treatment-cycle alignment", status: "insufficient_data", detail: "0 aligned.", next_step: "Add treatment dates." },
    { name: "Symptoms", status: "available", detail: "39 symptom report(s) available.", next_step: "Symptoms are optional." },
    { name: "Model signal", status: "available", detail: "Response signal is available from imaging_report_nlp.", next_step: "A missing model signal should fall back." },
  ],
};

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    patient_id: "P001", patient_name: "Patient P001", diagnosis: "Breast cancer",
    symptoms: SYMPTOMS, lab_history: [], latest_labs: null, timeline: [], medication_logs: [],
    ai_summary: { patient_explanation: "Counts are tracked.", clinical_summary: "", review_reasons: [] },
    genetic_counseling_readiness: null,
    data_availability: COVERAGE,
    multimodal_assessment: null,
    ...MODEL_FIELDS,
    ...overrides,
  } as unknown as PatientReport;
}

function mount(report: PatientReport) {
  return render(
    <MemoryRouter>
      <PatientOverviewC
        report={report} patientId="P001"
        rangedSymptoms={report.symptoms ?? []} rangedLabHistory={report.lab_history ?? []}
        latestLabDate={null} range="12m" onRangeChange={() => {}} reportFetchedAt={null}
        enrichmentStatus="success" chatMessages={[]} onSaved={() => {}}
      />
    </MemoryRouter>,
  );
}
const textOf = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => window.history.replaceState(null, "", "/patient"));

describe("flag", () => {
  it("is off unless the build sets exactly \"true\"", () => {
    expect(resolvePatientOverviewC(undefined, false, null)).toBe(false);
    expect(resolvePatientOverviewC("false", false, null)).toBe(false);
    expect(resolvePatientOverviewC("TRUE", false, null)).toBe(false);
    expect(resolvePatientOverviewC("true", false, null)).toBe(true);
  });

  it("ignores the browser override in production builds", () => {
    expect(resolvePatientOverviewC(undefined, false, "on")).toBe(false);
    expect(resolvePatientOverviewC("true", false, "off")).toBe(true);
  });
});

describe("review queue", () => {
  it("keeps each backend sentence whole, with every item listed", () => {
    const reasons = [STANDARD_WORDED, "One.", "Two.", "Three.", URGENT_WORDED];
    const { container } = render(<ReviewItems reasons={reasons} />);
    const shown = [...container.querySelectorAll(".pc-review-list li")].map((li) => li.textContent);
    expect([...shown].sort()).toEqual([...reasons].sort());
    expect(screen.queryByRole("button", { name: /view all/i })).toBeNull();
  });

  it("groups by subject, keeps backend order in each group, and never by what a sentence asks for", () => {
    const reasons = [
      "Imaging/MRI data is missing; clinician should request follow-up imaging.",
      STANDARD_WORDED,
      "Patient-reported fatigue severity was 10/10. Clinical review may be needed.",
      URGENT_WORDED,
    ];
    const { container } = render(<ReviewItems reasons={reasons} />);
    const groups = [...container.querySelectorAll(".pc-review-group")].map((g) => ({
      title: g.querySelector("h3")?.textContent,
      items: [...g.querySelectorAll("li")].map((li) => li.textContent),
    }));
    expect(groups).toEqual([
      { title: "Blood tests", items: [STANDARD_WORDED, URGENT_WORDED] },
      { title: "Symptoms you reported", items: [reasons[2]] },
      { title: "Other record items", items: [reasons[0]] },
    ]);
  });

  it("does not lose a sentence that matches no group", () => {
    const { container } = render(<ReviewItems reasons={["Something new from the backend."]} />);
    expect(container.querySelector(".pc-review-group h3")?.textContent).toBe("Other record items");
    expect(textOf(container)).toContain("Something new from the backend.");
  });

  it("adds no urgency or appointment timing of its own", () => {
    const { container } = render(<ReviewItems reasons={[STANDARD_WORDED, URGENT_WORDED]} />);
    const text = textOf(container);
    expect(text).not.toMatch(/not urgent alerts|raise soon|worth raising|next appointment|next care-team visit/i);
    expect(text).toContain(AUTOMATIC_PROMPT_NOTE);
  });

  it("says when a sentence repeats rather than listing it again", () => {
    const { container } = render(<ReviewItems reasons={["One.", "One."]} />);
    expect(container.querySelectorAll(".pc-review-list li")).toHaveLength(1);
    expect(textOf(container)).toContain("Flagged 2 times in your record.");
  });

  it("is neutral when empty, and says that is not reassurance", () => {
    const { container } = render(<ReviewItems reasons={[]} />);
    const text = textOf(container);
    expect(text).not.toMatch(/all clear|nothing flagged/i);
    expect(text).toContain("This is not reassurance about health or treatment response.");
  });
});

describe("record coverage", () => {
  it("counts and lists only record areas, never the model row", () => {
    const { container } = render(<RecordCoverage report={makeReport()} />);
    const text = textOf(container);
    expect(text).toContain("1 of 3 areas are in your record.");
    expect(text).not.toMatch(MODEL_WORDING);
    expect(text).not.toContain("imaging_report_nlp");
  });

  it("drops an unavailable model row whatever it is called", () => {
    const report = makeReport({ data_availability: { ...COVERAGE, items: [{ name: "Renamed", status: "model_unavailable", detail: "", next_step: "" }] } });
    render(<RecordCoverage report={report} />);
    expect(screen.getByText("Record coverage has not been assessed.")).toBeInTheDocument();
  });

  it("states missing areas as missing, and opens the list so they are not folded away", () => {
    const { container } = render(<RecordCoverage report={makeReport()} />);
    expect(screen.getByText(/^Not in your record/)).toBeInTheDocument();
    expect(screen.getByText(/^Not enough records yet/)).toBeInTheDocument();
    expect(container.querySelector("details")).toHaveProperty("open", true);
  });

  it("does not show raw row counts that disagree with the distinct figures", () => {
    const { container } = render(<RecordCoverage report={makeReport()} />);
    expect(textOf(container)).not.toContain("39 symptom report(s)");
  });

  it("keeps the treatment-decision caveat and what coverage does not measure", () => {
    const { container } = render(<RecordCoverage report={makeReport({ data_availability: null })} />);
    expect(textOf(container)).toContain("do not change treatment based on portal indicators");
    render(<RecordCoverage report={makeReport()} />);
    expect(screen.getByText("This does not measure health or clinical completeness.")).toBeInTheDocument();
  });
});

describe("Overview", () => {
  it("shows no model output with every model field populated, and says why", () => {
    const { container } = mount(makeReport());
    const text = textOf(container);
    expect(text).not.toMatch(MODEL_WORDING);
    expect(text).toContain(RESEARCH_MODEL_LEDE);
    expect(text).toContain(RESEARCH_MODEL_ABSENCE);
  });

  it("shows the server's caveat only for an unavailable monitoring signal", () => {
    const caveat = "No CBC trend is available, so the absence of flags cannot be interpreted as reassuring.";
    const claim = "No urgent CBC/treatment/radiology risk flags are present.";
    const unavailable = mount(makeReport({ multimodal_assessment: { signals: { clinical_monitoring: { status: "unavailable", message: caveat } } } }));
    expect(textOf(unavailable.container)).toContain(caveat);
    unavailable.unmount();
    const stable = mount(makeReport({ multimodal_assessment: { signals: { clinical_monitoring: { status: "stable_or_no_flags", message: claim } } } }));
    expect(textOf(stable.container)).not.toContain(claim);
  });

  it("keeps the empty-record caveat directly under the summary sentence, with nothing between", () => {
    const caveat = "No CBC trend is available, so the absence of flags cannot be interpreted as reassuring.";
    const { container } = mount(makeReport({
      ai_summary: { patient_explanation: "Your blood counts (CBC) are not in the record yet.", clinical_summary: "", review_reasons: [] },
      multimodal_assessment: { signals: { clinical_monitoring: { status: "unavailable", message: caveat } } },
    }));
    const sentences = [...container.querySelectorAll('[data-section="summary"] .today-summary-sentence')];
    expect(sentences.map((p) => p.textContent)).toEqual(["Your blood counts (CBC) are not in the record yet.", caveat]);
    expect(sentences[0].nextElementSibling).toBe(sentences[1]);
  });

  it("keeps that caveat with the placeholder when there is no summary yet", () => {
    const caveat = "No CBC trend is available, so the absence of flags cannot be interpreted as reassuring.";
    const { container } = mount(makeReport({
      ai_summary: null,
      multimodal_assessment: { signals: { clinical_monitoring: { status: "unavailable", message: caveat } } },
    }));
    const sentences = [...container.querySelectorAll('[data-section="summary"] .today-summary-sentence')];
    expect(sentences).toHaveLength(2);
    expect(sentences[1].textContent).toBe(caveat);
  });

  it("does not carry the reassuring labels of the other Overview", () => {
    const { container } = mount(makeReport({ symptoms: [] }));
    const text = textOf(container);
    expect(text).not.toMatch(/all clear|not urgent alerts|No new symptoms|CBC within reference/i);
    expect(container.querySelector(".today-summary-chips")).toBeNull();
  });

  it("states the monitoring boundary in the page itself", () => {
    const { container } = mount(makeReport());
    expect(textOf(container.querySelector(".pc-foot") as HTMLElement)).toContain(MONITORING_BOUNDARY);
  });

  it("keeps the latest and highest symptoms paired with their own records", () => {
    const { container } = mount(makeReport());
    const facts = [...container.querySelectorAll(".symptom-fact")].map((f) => textOf(f as HTMLElement));
    expect(facts.find((f) => f.startsWith("Latest recorded symptom"))).toMatch(/nausea.*2 out of 10.*2026-05-01/);
    expect(facts.find((f) => f.startsWith("Highest recorded severity"))).toMatch(/mouth sores.*9 out of 10.*2026-02-12/);
  });

  it("reaches every existing section", () => {
    const { container } = mount(makeReport());
    for (const id of ["summary", "review", "labs", "symptoms", "timeline", "medications", "ai-explanations", "genetics", "signals"]) {
      expect(container.querySelector(`[data-section="${id}"]`), id).not.toBeNull();
    }
    expect(screen.getByRole("link", { name: /Log how you feel/i })).toHaveAttribute("href", "/patient/chat");
    expect(screen.getByRole("link", { name: /Ask about your record/i })).toHaveAttribute("href", "/patient/chat");
  });

  it("tells a patient with no records that nothing is recorded", async () => {
    const { container } = mount(makeReport({ symptoms: [], data_availability: null }));
    expect(textOf(container)).toContain("No symptoms logged yet.");
    expect(await screen.findByText("No lab history recorded yet", {}, { timeout: 30_000 })).toBeInTheDocument();
    expect(textOf(container)).toContain("No medications recorded");
  });
});

describe("symptoms and labs", () => {
  it("keeps the symptom table behind a disclosure under the chart", () => {
    const { container } = mount(makeReport());
    const summary = screen.getByText("View reports as a table");
    expect(summary.closest("details")).not.toBeNull();
    expect(within(summary.closest("details") as HTMLElement).getByRole("region", { name: /Symptom ratings table/, hidden: true })).toBeInTheDocument();
    expect(container.querySelector(".po-seg")).not.toBeNull();
  });

  it("gives each symptom its own marker", () => {
    const { container } = mount(makeReport());
    const markers = [...container.querySelectorAll(".po-legend-item")].map((el) => el.getAttribute("data-marker"));
    expect(new Set(markers).size).toBe(3);
  });

  it("gives each lab a table that keeps rows disagreeing on a date, newest first", () => {
    const labs = [
      { date: "2026-01-01", wbc: 6, hemoglobin: 12, platelets: 200 },
      { date: "2026-01-01", wbc: 1.5, hemoglobin: 12, platelets: 200 },
      { date: "2026-01-01", wbc: 1.5, hemoglobin: 12, platelets: 200 },
      { date: "2026-02-01", wbc: 3, hemoglobin: null, platelets: 210 },
    ];
    const { container } = mount(makeReport({ lab_history: labs }));
    const tables = [...container.querySelectorAll(".pc-lab-table")];
    expect(tables).toHaveLength(3);
    const wbc = [...tables[0].querySelectorAll("tbody tr")].map((row) => textOf(row as HTMLElement));
    expect(wbc[0]).toContain("3");
    expect(wbc.some((row) => row.startsWith("Jan 1, 2026") && row.includes("6"))).toBe(true);
    expect(wbc.some((row) => row.includes("1.5") && row.endsWith("2"))).toBe(true);
    expect(textOf(tables[1] as HTMLElement)).toContain("not measured");
  });
});

describe("view state in the URL", () => {
  const RANGES = ["3m", "6m", "12m"] as const;

  function Probe({ value }: { value: (typeof RANGES)[number] }) {
    const read = useAllowedQueryParam("range", "6m", RANGES);
    useKeepQueryParam("range", value, "6m");
    const { search, hash } = useLocation();
    return <output data-testid="probe">{`${read}|${search}|${hash}`}</output>;
  }
  const probe = (entry: string, value: (typeof RANGES)[number]) => render(
    <MemoryRouter initialEntries={[entry]}><Probe value={value} /></MemoryRouter>,
  );

  it("reads an allowed value and refuses any other", () => {
    probe("/patient?range=12m", "12m");
    expect(screen.getByTestId("probe").textContent).toBe("12m|?range=12m|");
  });

  it("falls back on a value it has no rendering for", () => {
    probe("/patient?range=https://example.test", "6m");
    expect(screen.getByTestId("probe").textContent?.startsWith("6m|")).toBe(true);
  });

  it("puts the value back after a section link dropped it, keeping the section", () => {
    probe("/patient#labs", "12m");
    expect(screen.getByTestId("probe").textContent).toBe("12m|?range=12m|#labs");
  });

  it("leaves the default out of the URL and keeps other parameters", () => {
    probe("/patient?range=12m&other=1", "6m");
    expect(screen.getByTestId("probe").textContent).toBe("6m|?other=1|");
  });
});

describe("readability", () => {
  it("names white blood cells in full and keeps the abbreviation", () => {
    const { container } = mount(makeReport());
    expect(textOf(container)).toContain("White blood cells (WBC)");
  });

  it("explains a chart's conflicting values, in words and without choosing one", () => {
    const labs = [
      { date: "2026-01-01", wbc: 6, hemoglobin: 12, platelets: 200 },
      { date: "2026-01-01", wbc: 1.5, hemoglobin: 12, platelets: 200 },
    ];
    const { container } = mount(makeReport({ lab_history: labs }));
    const notes = [...container.querySelectorAll('[data-section="labs"] .pc-question')];
    expect(notes).toHaveLength(1);
    const text = textOf(notes[0] as HTMLElement);
    expect(text).toContain("Unresolved: WBC on 2026-01-01 has conflicting values");
    expect(text).toContain("1 row with 1.5 K/uL and 1 row with 6 K/uL");
    expect(text).toContain("Ask your care team which value is correct.");
  });

  it("describes repeated ratings as a range, not a conflict", () => {
    const symptoms = [
      { date: "2026-01-01", symptom: "fatigue", severity: 0, notes: "" },
      { date: "2026-01-01", symptom: "fatigue", severity: 10, notes: "" },
    ];
    const { container } = mount(makeReport({ symptoms }));
    const note = textOf(container.querySelector('[data-section="symptoms"] .pc-question') as HTMLElement);
    expect(note).toContain("You rated fatigue 2 times on 2026-01-01, from 0 to 10 out of 10.");
    expect(note).not.toMatch(/conflict|unresolved/i);
  });

  it("puts rule-flag titles in plain words and keeps the source line", () => {
    const timeline = [{
      date: "2026-05-17", type: "ai_risk_flag", title: "Risk flag: low_platelets", summary: "Platelets reached 120.",
      ai_generated: true, source: "deterministic risk engine", model_version: "risk_engine v1.1.0",
    }];
    const { container } = mount(makeReport({ timeline }));
    const text = textOf(container.querySelector('[data-section="timeline"]') as HTMLElement);
    expect(text).toContain("Automated flag: low platelets");
    expect(text).not.toContain("low_platelets");
    expect(text).toContain("Platelets reached 120.");
    expect(screen.getByRole("button", { name: "Open details for Automated flag: low platelets" })).toBeInTheDocument();
  });
});

describe("medication log", () => {
  it("is a table with every field and no sideways-scroll region", () => {
    const meds = [{ date: "2026-02-03", medication: "pegfilgrastim", dose: "6 mg", frequency: "once after AC cycle" }];
    mount(makeReport({ medication_logs: meds }));
    const table = screen.getByRole("table", { name: /Recorded medications/ });
    for (const value of ["2026-02-03", "pegfilgrastim", "6 mg", "once after AC cycle"]) {
      expect(within(table).getByText(value)).toBeInTheDocument();
    }
    expect(screen.queryByRole("region", { name: /Medication log, scrollable/ })).toBeNull();
    expect(screen.getByText("6 mg").getAttribute("data-label")).toBe("Dose");
  });
});

describe("shell", () => {
  const NAV = [
    { to: "/patient", label: "Overview", short: "Overview", primary: true, icon: () => null },
    { to: "/patient#genetics", label: "Family & Genetics", icon: () => null },
  ];
  const shell = (props: object) => render(
    <MemoryRouter initialEntries={["/patient"]}>
      <AppShell navItems={NAV as never} title="Patient portal" {...props}>page</AppShell>
    </MemoryRouter>,
  );

  it("keeps the boundary in the topbar, outside the scrolling page and the closable sidebar", () => {
    const { container } = shell({ boundaryNote: MONITORING_BOUNDARY, calmNav: true });
    expect(container.querySelector(".app-topbar")?.textContent).toContain(MONITORING_BOUNDARY);
    expect(container.querySelector(".app-sidebar")?.textContent).not.toContain(MONITORING_BOUNDARY);
  });

  it("lists short items at the bottom and primary items at the top, and keeps the rest in the menu", () => {
    const { container } = shell({ calmNav: true });
    for (const selector of [".app-top-nav", ".app-bottom-nav"]) {
      const nav = container.querySelector(selector) as HTMLElement;
      expect(within(nav).getAllByRole("link")).toHaveLength(1);
      expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    }
    expect(container.querySelector(".app-sidebar.is-collapsed")).not.toBeNull();
  });

  it("takes focus into the menu and returns it when closed", async () => {
    const user = userEvent.setup();
    shell({ calmNav: true });
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(document.activeElement).toBe(within(nav).getAllByRole("link")[0]);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open menu" }));
  });

  it("closes the menu on Escape even when focus has been lost", async () => {
    const user = userEvent.setup();
    const { container } = shell({ calmNav: true });
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(container.querySelector(".app-sidebar.is-collapsed")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open menu" }));
  });

  it("closes the menu from outside it, and takes the page out of reach while open", async () => {
    const user = userEvent.setup();
    const { container } = shell({ calmNav: true });
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(container.querySelector(".app-frame")?.hasAttribute("inert")).toBe(true);
    await user.click(container.querySelector(".app-menu-scrim") as HTMLElement);
    expect(container.querySelector(".app-menu-scrim")).toBeNull();
    expect(container.querySelector(".app-frame")?.hasAttribute("inert")).toBe(false);
  });

  it("is unchanged when the props are left out", () => {
    const { container } = shell({});
    expect(container.querySelector(".app-shell--calm")).toBeNull();
    expect(container.querySelector(".app-top-nav")).toBeNull();
    expect(container.querySelector(".app-bottom-nav")).toBeNull();
    expect(container.querySelector(".app-topbar-menu")).toBeNull();
    expect(container.querySelector(".app-topbar-note")).toBeNull();
  });
});
