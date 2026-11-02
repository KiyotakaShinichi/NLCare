import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPanel } from "../../src/components/ui/ChatPanel";
import { OutcomeUnknownError } from "../../src/api/client.patient";
import { looksLikeConfirmationOrCancel } from "../../src/lib/chatConfirmation";
import { AuthProvider } from "../../src/context/AuthContext";
import { useAuth } from "../../src/hooks/useAuth";
import {
  OUTCOME_HOLD_STORAGE_KEY,
  useChatOutcomeHold,
} from "../../src/pages/patient/useChatOutcomeHold";

/**
 * Milestone 7.5, Priority 1. The server can finish a write after the browser
 * disconnected, and no existing endpoint reports an action's identity or
 * terminal status. So the frontend cannot resolve an unknown outcome; it can
 * only stop issuing further confirmations until the patient has looked at
 * their refreshed records and says so. A change in chat history is never taken
 * as evidence, and a typed "Confirm save" is as blocked as the card button.
 */
const PENDING = [{
  id: "a1", role: "assistant" as const, content: "Please review this extraction.", citations: [],
  saved_actions: [{ type: "pending_record_confirmation", preview: "Nausea severity 4/10" }],
}];
const HELD = { phase: "idle" as const, canAcknowledge: false, onRefresh: vi.fn(), onAcknowledge: vi.fn() };

describe("looksLikeConfirmationOrCancel", () => {
  it.each(["Confirm save", "Cancel save", "yes", "Yes please", "ok", "okay", "go ahead", "save it", "oo", "opo", "sige", "no", "cancel", "never mind", "don't save", "huwag", "Confirm."])(
    "treats %s as able to confirm or cancel a pending write", (t) => expect(looksLikeConfirmationOrCancel(t)).toBe(true),
  );
  it.each(["Hello", "What does neutropenia mean?", "no fever today", "yes my fatigue was 8 yesterday", "Please log nausea 3 out of 10", "I want to cancel my appointment next week", ""])(
    "does not treat %s as one", (t) => expect(looksLikeConfirmationOrCancel(t)).toBe(false),
  );
});

describe("composer, keyboard and quick actions are all blocked while held", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); HELD.onRefresh.mockReset(); });
  afterEach(() => vi.restoreAllMocks());

  it("disables the textarea and send button and explains why", () => {
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={HELD} />);
    const box = screen.getByRole("textbox");
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("placeholder", expect.stringMatching(/paused/i));
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("the card offers no Confirm or Cancel and says why", () => {
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={HELD} />);
    expect(screen.queryByRole("button", { name: /confirm save|^cancel/i })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /confirm patient record preview/i })).toHaveTextContent(/paused/i);
  });

  it("Enter cannot send text that was typed before the hold began (defence in depth)", async () => {
    const onSendStream = vi.fn();
    const { rerender } = render(<ChatPanel messages={PENDING} onSend={vi.fn()} onSendStream={onSendStream} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Confirm save" } });
    rerender(<ChatPanel messages={PENDING} onSend={vi.fn()} onSendStream={onSendStream} confirmationHold={HELD} />);
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.submit(box.closest("form") ?? box);
    await new Promise((r) => setTimeout(r, 30));
    expect(onSendStream).not.toHaveBeenCalled();
  });

  it("starter prompts on an empty chat send nothing while held", async () => {
    const user = userEvent.setup();
    const onSendStream = vi.fn();
    render(<ChatPanel messages={[]} onSend={vi.fn()} onSendStream={onSendStream} confirmationHold={HELD} />);
    for (const b of screen.queryAllByRole("button").filter((x) => /fatigue|symptom|blood|explain|what/i.test(x.textContent ?? ""))) {
      await user.click(b).catch(() => {});
    }
    expect(onSendStream).not.toHaveBeenCalled();
  });

  it("offers refresh; acknowledgement is unavailable until a refresh has succeeded", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={HELD} />);
    expect(screen.queryByRole("button", { name: /resume chat/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /refresh my records/i }));
    expect(HELD.onRefresh).toHaveBeenCalledTimes(1);
    const refreshed = { ...HELD, phase: "refreshed" as const, canAcknowledge: true };
    rerender(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={refreshed} />);
    expect(screen.getByRole("status")).toHaveTextContent(/can't tell whether the earlier action has finished/i);
    expect(screen.getByRole("button", { name: /resume chat/i })).toBeEnabled();
    // still blocked until the patient acknowledges
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("says a failed refresh failed and keeps the block", () => {
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={{ ...HELD, phase: "failed" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't refresh/i);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /resume chat/i })).not.toBeInTheDocument();
  });
});

describe("which timeouts hold the chat", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("a timed-out Confirm holds, and names the cards that may already have been acted on", async () => {
    const user = userEvent.setup();
    const onOutcomeUnknown = vi.fn();
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} onSendStream={vi.fn().mockRejectedValue(new OutcomeUnknownError())} onOutcomeUnknown={onOutcomeUnknown} />);
    await user.click(screen.getByRole("button", { name: /confirm save/i }));
    await waitFor(() => expect(onOutcomeUnknown).toHaveBeenCalledTimes(1));
    expect(onOutcomeUnknown).toHaveBeenCalledWith({ pendingMessageIds: ["a1"] });
  });

  it("a timed-out ordinary question gets a plain, truthful message and does not freeze the chat", async () => {
    const user = userEvent.setup();
    const onOutcomeUnknown = vi.fn();
    render(<ChatPanel messages={[]} onSend={vi.fn()} onSendStream={vi.fn().mockRejectedValue(new OutcomeUnknownError())} onOutcomeUnknown={onOutcomeUnknown} />);
    await user.click(screen.getByRole("textbox"));
    await user.paste("What does neutropenia mean?");
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/didn't get a reply/i)).toBeInTheDocument();
    expect(screen.queryByText(/your records|saved|completed/i)).not.toBeInTheDocument();
    expect(onOutcomeUnknown).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });
});

describe("cards that may already have been acted on never come back", () => {
  it("a quarantined card offers no buttons even once the hold is released", () => {
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={null} quarantinedMessageIds={new Set(["a1"])} />);
    expect(screen.queryByRole("button", { name: /confirm save|^cancel/i })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /confirm patient record preview/i })).toHaveTextContent(/may already have been acted on/i);
  });

  it("a card that was not quarantined is unaffected", () => {
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={null} quarantinedMessageIds={new Set()} />);
    expect(screen.getByRole("button", { name: /confirm save/i })).toBeInTheDocument();
  });
});

describe("useChatOutcomeHold", () => {
  const history = (id: number) => ({ messages: [{ id }] });
  beforeEach(() => sessionStorage.clear());

  it("never releases because the chat history changed", async () => {
    const onRefreshed = vi.fn();
    const loadHistory = vi.fn().mockResolvedValue(history(999)); // brand-new activity
    const { result } = renderHook(() => useChatOutcomeHold({ loadHistory, onRefreshed }));
    act(() => result.current.begin(["a1"]));
    await act(async () => { await result.current.hold!.onRefresh(); });
    expect(result.current.hold).not.toBeNull();
    expect(result.current.hold?.phase).toBe("refreshed");
    expect(onRefreshed).toHaveBeenCalledTimes(1);          // views are refreshed for the patient to read
    expect(result.current.hold?.canAcknowledge).toBe(true);
  });

  it("cannot be acknowledged before a refresh has succeeded", async () => {
    const { result } = renderHook(() => useChatOutcomeHold({ loadHistory: vi.fn().mockRejectedValue(new Error("offline")), onRefreshed: vi.fn() }));
    act(() => result.current.begin(["a1"]));
    act(() => result.current.hold!.onAcknowledge());
    expect(result.current.hold).not.toBeNull();
    await act(async () => { await result.current.hold!.onRefresh(); });
    expect(result.current.hold?.phase).toBe("failed");
    expect(result.current.hold?.canAcknowledge).toBe(false);
    act(() => result.current.hold!.onAcknowledge());
    expect(result.current.hold).not.toBeNull();
  });

  it("releases only on the patient's explicit acknowledgement, and keeps the quarantine", async () => {
    const { result } = renderHook(() => useChatOutcomeHold({ loadHistory: vi.fn().mockResolvedValue(history(1)), onRefreshed: vi.fn() }));
    act(() => result.current.begin(["a1", "a3"]));
    await act(async () => { await result.current.hold!.onRefresh(); });
    act(() => result.current.hold!.onAcknowledge());
    expect(result.current.hold).toBeNull();
    expect([...result.current.quarantined].sort()).toEqual(["a1", "a3"]);
  });

  it("ignores a second refresh while one is running", async () => {
    let release!: (v: unknown) => void;
    const loadHistory = vi.fn().mockImplementation(() => new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useChatOutcomeHold({ loadHistory, onRefreshed: vi.fn() }));
    act(() => result.current.begin([]));
    let first!: Promise<void>;
    act(() => { first = result.current.hold!.onRefresh() as Promise<void>; });
    await act(async () => { void result.current.hold!.onRefresh(); });
    expect(loadHistory).toHaveBeenCalledTimes(1);
    await act(async () => { release(history(1)); await first; });
  });

  it("survives a hard reload in the same tab, and the marker holds no patient content", () => {
    const first = renderHook(() => useChatOutcomeHold({ loadHistory: vi.fn(), onRefreshed: vi.fn() }));
    act(() => first.result.current.begin(["41", "42"]));
    const raw = sessionStorage.getItem(OUTCOME_HOLD_STORAGE_KEY)!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["held", "quarantine"]);
    expect(raw).not.toMatch(/confirm|nausea|P001|save/i);
    first.unmount();
    const second = renderHook(() => useChatOutcomeHold({ loadHistory: vi.fn(), onRefreshed: vi.fn() }));
    expect(second.result.current.hold).not.toBeNull();
    expect(second.result.current.hold?.phase).toBe("idle");
    expect(second.result.current.hold?.canAcknowledge).toBe(false);   // must refresh again
    expect([...second.result.current.quarantined].sort()).toEqual(["41", "42"]);
  });

  it("ignores a corrupt or hostile stored marker instead of throwing", () => {
    sessionStorage.setItem(OUTCOME_HOLD_STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useChatOutcomeHold({ loadHistory: vi.fn(), onRefreshed: vi.fn() }));
    expect(result.current.hold).toBeNull();
  });
});

describe("sign-in and sign-out clear the marker (a held chat is never inherited by another patient)", () => {
  const ref: { current: ReturnType<typeof useAuth> | null } = { current: null };
  function Probe() { ref.current = useAuth(); return null; }

  it.each(["setSession", "clearSession"] as const)("%s removes it", (which) => {
    sessionStorage.setItem(OUTCOME_HOLD_STORAGE_KEY, JSON.stringify({ held: true, quarantine: ["1"] }));
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => { if (which === "setSession") ref.current!.setSession("t", "patient", "P002"); else ref.current!.clearSession(); });
    expect(sessionStorage.getItem(OUTCOME_HOLD_STORAGE_KEY)).toBeNull();
  });
});
