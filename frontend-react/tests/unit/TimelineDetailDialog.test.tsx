import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimelinePanel } from "../../src/pages/patient/TimelinePanel";
import type { TimelineEvent } from "../../src/types/api";
import { expectNoA11yViolations } from "../a11y";

/**
 * The timeline detail dialog used to be a hand-rolled `role="dialog"` that
 * bypassed the shared Modal. It had no Escape handler and never gave focus
 * back to the control that opened it, so a keyboard user who opened a detail
 * was left with no way out but Tab-hunting for the close button.
 *
 * It now renders through `components/ui/Modal`, which already implemented both.
 * These tests pin that behaviour to the panel rather than to the Modal, so
 * reverting to a bespoke dialog here fails.
 */

const EVENT: TimelineEvent = {
  date: "2026-03-29",
  type: "Lab",
  severity: "info",
  title: "CBC result",
  summary: "WBC 4.7, hemoglobin 11.1, platelets 214.",
  detail: {
    title: "CBC result",
    fields: { WBC: 4.7, Hemoglobin: 11.1, Platelets: 214 },
    findings: "Counts within the demonstration band.",
    notes: "Synthetic demo data.",
  },
};

async function openDialog() {
  const user = userEvent.setup();
  render(<TimelinePanel events={[EVENT]} lastFetchedAt={Date.now()} />);
  const trigger = screen.getByRole("button", { name: /open details for CBC result/i });
  trigger.focus();
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog");
  return { user, trigger, dialog };
}

describe("timeline detail dialog", () => {
  it("opens from the event trigger", async () => {
    const { dialog } = await openDialog();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/counts within the demonstration band/i)).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { user } = await openDialog();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("returns focus to the trigger after closing", async () => {
    const { user, trigger } = await openDialog();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes from the dialog's own close control", async () => {
    const { user } = await openDialog();
    await user.click(screen.getByRole("button", { name: /close dialog/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("names the dialog from its visible title and keeps headings sequential", async () => {
    const { dialog } = await openDialog();
    expect(dialog).toHaveAccessibleName(/CBC result/i);
    // Modal's own title is an h2, so the sections below it are h3 - no level skip.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toContain("Findings");
    expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);
  });

  it("has no detectable accessibility violations while open", async () => {
    const { dialog } = await openDialog();
    await expectNoA11yViolations(dialog);
  });
});
