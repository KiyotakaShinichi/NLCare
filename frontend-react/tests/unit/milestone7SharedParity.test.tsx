import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChatPanel } from "../../src/components/ui/ChatPanel";
import { TimelinePanel } from "../../src/pages/patient/TimelinePanel";
import type { TimelineEvent } from "../../src/types/api";

/**
 * Milestone 7 touched three shared components. Each change is opt-in, and
 * these tests pin that: a caller that passes nothing - the flag-off patient
 * Overview, the clinician chat - must render exactly as before.
 */

const AI_FLAG: TimelineEvent[] = [
  {
    date: "2026-01-01",
    type: "ai_risk_flag",
    title: "Risk flag: low_wbc",
    evidence_source: "risk_engine",
    uncertainty: { confidence_level: "high", uncertainty_reason: "all checklist items satisfied" },
  } as unknown as TimelineEvent,
];

describe("TimelinePanel hideConfidence", () => {
  it("still shows the confidence badge when the prop is not passed (existing callers)", () => {
    render(<TimelinePanel events={AI_FLAG} />);
    expect(document.body.textContent).toMatch(/confidence/i);
  });

  it("drops the confidence badge when asked", () => {
    render(<TimelinePanel events={AI_FLAG} hideConfidence />);
    expect(document.body.textContent).not.toMatch(/confidence/i);
    // The event itself is still part of the record.
    expect(document.body.textContent).toMatch(/low_wbc|low wbc/i);
  });
});

describe("ChatPanel scrollRegionLabel", () => {
  it("leaves the transcript unchanged when no label is given (clinician chat)", () => {
    const { container } = render(<ChatPanel messages={[]} onSend={vi.fn()} />);
    const scroll = container.querySelector(".chat-scroll")!;
    expect(scroll.hasAttribute("tabindex")).toBe(false);
    expect(scroll.hasAttribute("role")).toBe(false);
    expect(scroll.hasAttribute("aria-label")).toBe(false);
  });

  it("makes the transcript a focusable named region when labelled (patient chat)", () => {
    render(<ChatPanel messages={[]} onSend={vi.fn()} scrollRegionLabel="Conversation with the support assistant" />);
    const region = screen.getByRole("region", { name: "Conversation with the support assistant" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("does not become a live region, so streamed tokens are not announced one by one", () => {
    render(<ChatPanel messages={[]} onSend={vi.fn()} scrollRegionLabel="Conversation" />);
    const region = screen.getByRole("region", { name: "Conversation" });
    expect(region).not.toHaveAttribute("role", "log");
    expect(region).not.toHaveAttribute("aria-live");
  });
});

describe("ChatMessageBubble style fallbacks", () => {
  it("keeps the original size and colour unless the surface sets the variables", () => {
    render(
      <ChatPanel
        messages={[{ role: "user", content: "hello", timestamp: "2026-10-19T09:00:00Z" }] as never}
        onSend={vi.fn()}
      />,
    );
    const bubble = document.querySelector(".chat-message-bubble.is-user") as HTMLElement;
    expect(bubble.style.fontSize).toBe("var(--chat-bubble-font, 0.92rem)");
    expect(bubble.style.background).toContain("var(--chat-user-bubble, var(--rose))");
  });
});
