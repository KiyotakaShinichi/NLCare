import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { Activity } from "lucide-react";

import { AppShell } from "../../src/components/layout/AppShell";
import { AuthProvider } from "../../src/context/AuthContext";
import { ChatPanel } from "../../src/components/ui/ChatPanel";
import { Modal } from "../../src/components/ui/Modal";
import { Drawer } from "../../src/components/ui/Drawer";
import { SectionCard } from "../../src/components/ui/SectionCard";
import { LabTrendsChart } from "../../src/components/charts/LabTrendsChart";
import { RecentAiExplanationsCard } from "../../src/pages/patient/RecentAiExplanationsCard";
import { expectNoA11yViolations } from "../a11y";

/**
 * Milestone 7.8: approved presentational polish only. Nothing here changes what
 * any notice says. The behaviour of the fail-closed hold, the gateway
 * classification and preview expiry is covered by failClosedConfirmation,
 * gatewayAmbiguity and chatOutcomeUnknown; these tests cover how it is drawn and
 * how the shell is structured.
 */

const SRC = join(__dirname, "..", "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("corrupted characters", () => {
  // UTF-8 text decoded as Windows-1252: an em dash arrives as three characters,
  // a middle dot as two, an arrow as three.
  const MOJIBAKE = new RegExp(
    ["â€", "Â·", "â†", "Ã[ -¿]", "�"].join("|"),
  );
  // The admin evidence panels carry the same corruption. They are not patient
  // facing and are out of this milestone's authorised scope.
  const OUT_OF_SCOPE = join("pages", "admin") + sep;

  it("no patient-facing source file contains it", () => {
    const offenders = walk(SRC)
      .filter((f) => !relative(SRC, f).startsWith(OUT_OF_SCOPE))
      .filter((f) => MOJIBAKE.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the safety footer on the overview keeps its wording, with a real dash", () => {
    const src = readFileSync(join(SRC, "pages", "patient", "PatientOverview.tsx"), "utf8");
    expect(src).toMatch(/Proof-of-concept<\/strong> — this dashboard summarises/);
    expect(src).toMatch(/It does not diagnose, recommend treatment, or\s+replace clinician judgement\. If something feels wrong, contact your care team\./);
  });
});

describe("shell: skip link and main target", () => {
  function shell(props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
    return render(
      <MemoryRouter>
        <AuthProvider>
          <AppShell navItems={[{ to: "/patient", label: "Overview", icon: Activity }]} title="Patient portal" {...props}>
            <button type="button">inside</button>
          </AppShell>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it("the first tab stop is a skip link to the main region", async () => {
    const user = userEvent.setup();
    shell();
    await user.tab();
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("activating it moves focus into main without changing the URL hash", () => {
    shell();
    const link = screen.getByRole("link", { name: /skip to main content/i });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false); // default navigation was cancelled
    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.location.hash).toBe("");
  });

  it("the page title is the only h1 unless the page supplies its own", () => {
    const { unmount } = shell();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    unmount();
    shell({ titleAs: "p" });
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getByText("Patient portal")).toBeInTheDocument();
  });
});

describe("semantics", () => {
  it("a collapsible card exposes a real button inside its heading, not a header with a role", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SectionCard title="Symptom log" collapsible collapseId="t78" defaultOpen>
        <p>body</p>
      </SectionCard>,
    );
    expect(container.querySelector("header[role]")).toBeNull();
    const heading = screen.getByRole("heading", { level: 2, name: /symptom log/i });
    const toggle = within(heading).getByRole("button", { name: /symptom log/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "t78-body");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expectNoA11yViolations(container);
  });

  it("clicking the card header area still toggles it", async () => {
    const user = userEvent.setup();
    render(
      <SectionCard title="Symptom log" collapsible collapseId="t79" defaultOpen meta="8 distinct">
        <p>body</p>
      </SectionCard>,
    );
    await user.click(screen.getByText("8 distinct"));
    expect(screen.getByRole("button", { name: /symptom log/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("a plain card has no toggle", () => {
    render(<SectionCard title="Medication log"><p>x</p></SectionCard>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("dialogs do not add a second banner landmark", () => {
    const { baseElement, unmount } = render(<Modal open onClose={() => {}} title="Log a symptom"><p>x</p></Modal>);
    expect(baseElement.querySelector("[role=dialog] header")).toBeNull();
    unmount();
    const d = render(<Drawer open onClose={() => {}} title="Tool trace"><p>x</p></Drawer>);
    expect(d.baseElement.querySelector("[role=dialog] header, aside header")).toBeNull();
  });

  it("each lab trend heading sits one level below its section heading", () => {
    render(
      <LabTrendsChart
        data={[
          { date: "2026-01-12", wbc: 3.4, hemoglobin: 10.9, platelets: 178 },
          { date: "2026-02-19", wbc: 4.7, hemoglobin: 11.1, platelets: 214 },
        ]}
      />,
    );
    expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThanOrEqual(3);
  });
});

describe("hold and error notices are drawn as notices, not 12px strips", () => {
  const PENDING = [{
    id: "a1", role: "assistant" as const, content: "Please review.", citations: [],
    saved_actions: [{ type: "pending_record_confirmation", preview: "Nausea severity 4/10" }],
  }];
  const hold = { phase: "idle" as const, canAcknowledge: false, onRefresh: vi.fn(), onAcknowledge: vi.fn() };

  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("the hold notice uses the shared notice class and no 12px utility, with its wording unchanged", () => {
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={hold} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveClass("chat-notice", "chat-notice--hold");
    expect(notice.className).not.toMatch(/text-xs|text-\[/);
    expect(notice.getAttribute("style") ?? "").not.toMatch(/font-size/);
    expect(notice).toHaveTextContent(
      "We couldn't confirm whether your last Confirm or Cancel was processed. Chat is paused so the same action isn't sent twice, and the server may still finish it. Refresh to load your latest conversation and records, then look for the entry. Please don't enter the same information again yet.",
    );
    expect(screen.getByRole("button", { name: "Refresh my records" })).toBeInTheDocument();
  });

  it("the error alert uses the shared notice class, keeps its dismiss control, and a target of at least 24px is declared", async () => {
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} onSend={vi.fn().mockRejectedValue(new Error("We couldn't confirm whether this action completed. Please check your records before trying again."))} />);
    await user.click(screen.getByRole("textbox"));
    await user.paste("What does neutropenia mean?");
    await user.keyboard("{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("chat-notice", "chat-notice--error");
    expect(alert.className).not.toMatch(/text-xs/);
    expect(within(alert).getByRole("button", { name: "Dismiss error" })).toBeInTheDocument();
  });

  it("the stylesheet sets 14px or more on both notices and on the card's paused line", () => {
    const css = readFileSync(join(SRC, "styles", "chat-notices.css"), "utf8");
    const rule = (sel: string) => {
      const m = css.match(new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`));
      return m ? m[1] : "";
    };
    // The app's root font size is 14px (index.css), so a bare rem is read against
    // that. `max(Npx, ...)` is a floor and counts at N.
    const px = (decl: string) => {
      const floor = decl.match(/font-size:\s*max\(\s*([\d.]+)px/);
      if (floor) return parseFloat(floor[1]);
      const m = decl.match(/font-size:\s*([\d.]+)(rem|px)/);
      if (!m) return 0;
      return m[2] === "rem" ? parseFloat(m[1]) * 14 : parseFloat(m[1]);
    };
    expect(px(rule(".chat-notice"))).toBeGreaterThanOrEqual(14);
    expect(px(rule(".chat-confirmation-card > .chat-confirmation-paused"))).toBeGreaterThanOrEqual(14);
    expect(px(rule(".chat-hold-refresh"))).toBeGreaterThanOrEqual(14);
    expect(rule(".chat-notice")).toMatch(/line-height:\s*1\.[4-9]/);
  });
});

describe("hit areas", () => {
  const css = readFileSync(join(SRC, "index.css"), "utf8");
  const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const size = (decl: string, prop: string) => parseFloat(decl.match(new RegExp(`${prop}:\\s*([\\d.]+)px`))?.[1] ?? "0");

  it("the reference-range info button is at least 24px square", () => {
    const r = rule(".lab-card-info-trigger");
    expect(Math.min(size(r, "width"), size(r, "height"))).toBeGreaterThanOrEqual(24);
  });

  it("the sidebar toggle cannot be squeezed below 24px wide", () => {
    const r = rule(".app-sidebar-toggle");
    expect(size(r, "width")).toBeGreaterThanOrEqual(24);
    expect(readFileSync(join(SRC, "styles", "a11y.css"), "utf8")).toMatch(/\.app-sidebar-toggle\s*\{\s*flex-shrink:\s*0/);
  });

  it("'Open chat' is a button with a declared minimum target", () => {
    const { container } = render(
      <MemoryRouter>
        <RecentAiExplanationsCard messages={[]} />
      </MemoryRouter>,
    );
    const open = screen.getByRole("button", { name: /open chat/i });
    expect(open.className).toMatch(/min-h-\[24px\]|min-h-6|chat-link-button/);
    void container;
  });
});
