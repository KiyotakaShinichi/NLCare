import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPanel } from "../../src/components/ui/ChatPanel";
import {
  ApiError,
  OUTCOME_UNKNOWN_MESSAGE,
  isOutcomeUnknown,
  sendMyChat,
  sendMyChatStream,
} from "../../src/api/client";
import { responseError } from "../../src/api/client.transport";
import { useChatOutcomeHold } from "../../src/pages/patient/useChatOutcomeHold";

/**
 * Milestone 7.7. A reverse proxy answering 502/503/504 says nothing about the
 * backend: the sync pipeline keeps running after the gateway gives up, and a
 * confirmed record write has been observed to commit well after the client
 * stopped waiting. Milestone 7.6 showed an HTTP 504 on a typed "Confirm save"
 * was treated as a definite refusal - no hold, a live Confirm button, and the
 * gateway's raw HTML printed into the chat.
 */
const FALSE_CLAIM = /no record was saved|nothing was saved|was not saved|not been saved|did not save|failed to save/i;
const HTML = "<html><head><title>504 Gateway Time-out</title></head><body><center><h1>504</h1></center><hr><center>nginx/1.27.0</center></body></html>";

const AMBIGUOUS = [408, 500, 501, 502, 503, 504, 507, 511, 599];
const DEFINITE = [400, 401, 403, 404, 409, 413, 422, 429];

function body(kind: "html" | "text" | "badjson" | "empty" | "structured", status: number) {
  switch (kind) {
    case "html": return new Response(HTML, { status, headers: { "Content-Type": "text/html" } });
    case "text": return new Response("upstream connect error or disconnect/reset before headers. reset reason: connection termination", { status, headers: { "Content-Type": "text/plain" } });
    case "badjson": return new Response('{"detail": "oops', { status, headers: { "Content-Type": "application/json" } });
    case "empty": return new Response("", { status });
    case "structured": return new Response(JSON.stringify({ detail: "Agent pipeline failed. Please try again." }), { status, headers: { "Content-Type": "application/json" } });
  }
}
const KINDS = ["html", "text", "badjson", "empty", "structured"] as const;

function sse(...events: [string, unknown][]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) { events.forEach(([n, d]) => c.enqueue(enc.encode(`event: ${n}\ndata: ${JSON.stringify(d)}\n\n`))); c.close(); },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

beforeEach(() => {
  sessionStorage.setItem("patientPortalAccessToken", "t");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe("transport: ambiguous HTTP statuses leave the outcome unknown", () => {
  for (const status of AMBIGUOUS) {
    for (const kind of KINDS) {
      it(`${status} / ${kind} body: unknown outcome, fixed message, no body leaked`, async () => {
        vi.stubGlobal("fetch", vi.fn(async () => body(kind, status)));
        const err = await sendMyChatStream("Confirm save").catch((e) => e);
        expect(isOutcomeUnknown(err)).toBe(true);
        expect(err.message).toBe(OUTCOME_UNKNOWN_MESSAGE);
        expect(err.message).not.toMatch(FALSE_CLAIM);
        expect(err.message).not.toMatch(/<|nginx|upstream|Gateway/i);
      });
    }
  }

  it("a 200 with no readable body is unknown, not a definite failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, body: null, text: async () => "" }) as unknown as Response));
    expect(isOutcomeUnknown(await sendMyChatStream("Confirm save").catch((e) => e))).toBe(true);
  });

  it("an error event inside the stream is unknown: the pipeline had started and may have committed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(["error", { error: "Agent pipeline failed. Please try again.", code: "pipeline_error" }])));
    const err = await sendMyChatStream("Confirm save").catch((e) => e);
    expect(isOutcomeUnknown(err)).toBe(true);
    expect(err.message).toBe(OUTCOME_UNKNOWN_MESSAGE);
  });

  it("the non-streaming chat endpoint is classified the same way", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => body("html", 504)));
    const err = await sendMyChat("Confirm save").catch((e) => e);
    expect(isOutcomeUnknown(err)).toBe(true);
  });

  it("never retries: one request per turn", async () => {
    const f = vi.fn(async () => body("html", 504));
    vi.stubGlobal("fetch", f);
    await sendMyChatStream("Confirm save").catch(() => {});
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("transport: an explicit rejection stays a definite, sanitised ApiError", () => {
  for (const status of DEFINITE) {
    it(`${status}: not unknown, status preserved, no body leaked`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => body("html", status)));
      const err = await sendMyChatStream("Confirm save").catch((e) => e);
      expect(isOutcomeUnknown(err)).toBe(false);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(status);
      expect(err.message).not.toMatch(/<|nginx|Gateway/i);
    });
  }

  it("keeps a trustworthy structured message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Your session has expired. Please sign in again." }), { status: 401 })));
    const err = await sendMyChatStream("hi").catch((e) => e);
    expect(err.message).toBe("Your session has expired. Please sign in again.");
  });
});

describe("responseError: error bodies are never rendered raw", () => {
  const make = (raw: string, status: number, type = "text/plain") => responseError(new Response(raw, { status, headers: { "Content-Type": type } }));

  it("HTML gateway page", async () => {
    const e = await make(HTML, 504, "text/html");
    expect(e.message).not.toMatch(/[<>]|nginx|Gateway Time-out/);
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.status).toBe(504);
  });
  it("plain-text proxy error", async () => {
    const e = await make("upstream connect error or disconnect/reset before headers", 503);
    expect(e.message).not.toMatch(/upstream|reset/);
  });
  it("invalid JSON", async () => expect((await make('{"detail": "x', 502, "application/json")).message).not.toMatch(/detail|\{/));
  it("empty body", async () => {
    const e = await make("", 500);
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.status).toBe(500);
  });
  it("JSON without a usable message, and FastAPI validation arrays", async () => {
    expect((await make('{"errors":[1]}', 500)).message).not.toMatch(/errors|\[/);
    expect((await make('{"detail":[{"loc":["body","message"],"msg":"field required","type":"missing"}]}', 422)).message).not.toMatch(/loc|body|type|missing/);
  });
  it("structured detail and message are kept", async () => {
    expect((await make('{"detail":"Patient not found"}', 404)).message).toBe("Patient not found");
    expect((await make('{"message":"Slow down a little."}', 429)).message).toBe("Slow down a little.");
  });
  it("a structured field that is itself markup, or enormous, is not trusted", async () => {
    expect((await make(JSON.stringify({ detail: "<html><body>proxy</body></html>" }), 502)).message).not.toMatch(/</);
    expect((await make(JSON.stringify({ detail: "x".repeat(2000) }), 500)).message.length).toBeLessThan(300);
  });
  it("a 4xx with an unusable body is still a short fixed sentence", async () => {
    const e = await make(HTML, 404, "text/html");
    expect(e.message).not.toMatch(/[<>]/);
    expect(e.isExpected).toBe(true);
  });
});

/** The real chat flow: ChatPanel + the production stream client + the production hold hook. */
const PENDING = [{
  id: "a1", role: "assistant" as const, content: "Please review this extraction.", citations: [],
  saved_actions: [{ type: "pending_record_confirmation", preview: "Nausea severity 4/10" }],
}];

function Harness() {
  const { hold, quarantined, begin } = useChatOutcomeHold({ loadHistory: async () => {}, onRefreshed: () => {} });
  return (
    <ChatPanel
      messages={PENDING}
      onSend={vi.fn()}
      onSendStream={(m, h) => sendMyChatStream(m, h)}
      onOutcomeUnknown={(i) => begin(i.pendingMessageIds)}
      confirmationHold={hold}
      quarantinedMessageIds={quarantined}
    />
  );
}

describe("through the chat UI", () => {
  for (const status of [408, 500, 502, 503, 504]) {
    it(`${status} on the card's Confirm button holds the chat, quarantines nothing falsely, and shows no gateway text`, async () => {
      const f = vi.fn(async () => body("html", status));
      vi.stubGlobal("fetch", f);
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(screen.getByRole("button", { name: /confirm save/i }));

      await waitFor(() => expect(screen.getByRole("textbox")).toBeDisabled());
      const text = document.body.textContent ?? "";
      expect(text).toMatch(/couldn't confirm whether this action completed/i);
      expect(text).not.toMatch(FALSE_CLAIM);
      expect(text).not.toMatch(/nginx|Gateway Time-out|<html|Request failed/i);
      expect(screen.queryByRole("button", { name: /confirm save|^cancel/i })).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/paused/i);
      expect(sessionStorage.getItem("nlcare.chatOutcomeHold.v1")).toContain('"held":true');
      expect(sessionStorage.getItem("nlcare.chatOutcomeHold.v1")).toContain("a1");
      expect(f).toHaveBeenCalledTimes(1);
    });
  }

  it("a typed cancel that gets a 504 holds the chat too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => body("text", 504)));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^cancel/i }));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDisabled());
  });

  it("after the hold, typing, Enter, form submit and starter prompts send nothing further", async () => {
    const f = vi.fn(async () => body("html", 504));
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /confirm save/i }));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDisabled());
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Confirm save" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.submit(box.closest("form") ?? box);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("an ordinary question that gets a 504 is a plain, truthful error and does not freeze the chat", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => body("html", 504)));
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.paste("What does neutropenia mean?");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).not.toMatch(/<|nginx|Gateway|Request failed/i);
    expect(alert).not.toMatch(FALSE_CLAIM);
    expect(alert).not.toMatch(/your records/i);
    expect(sessionStorage.getItem("nlcare.chatOutcomeHold.v1")).toBeNull();
  });

  it("an explicit 401 on a confirm turn is a definite refusal: no hold", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 })));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /confirm save/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not authenticated/i));
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(sessionStorage.getItem("nlcare.chatOutcomeHold.v1")).toBeNull();
  });

  it("the hold survives remounting (reload)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => body("html", 502)));
    const user = userEvent.setup();
    const first = render(<Harness />);
    await user.click(screen.getByRole("button", { name: /confirm save/i }));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDisabled());
    first.unmount();
    render(<Harness />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /confirm save/i })).not.toBeInTheDocument();
  });
});

describe("expired preview cards", () => {
  const card = (expires?: unknown) => [{
    id: "a1", role: "assistant" as const, content: "Please review.", citations: [],
    saved_actions: [{ type: "pending_record_confirmation", preview: "Nausea 4/10", ...(expires === undefined ? {} : { expires_at_epoch: expires }) }],
  }];
  const nowS = () => Date.now() / 1000;

  it("a future expiry keeps the buttons", () => {
    render(<ChatPanel messages={card(nowS() + 600)} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: /confirm save/i })).toBeInTheDocument();
  });

  it("a past expiry removes Confirm and Cancel and says so", () => {
    render(<ChatPanel messages={card(nowS() - 5)} onSend={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /confirm save|^cancel/i })).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: /confirm patient record preview/i });
    expect(group).toHaveTextContent(/expired/i);
    expect(group).toHaveTextContent(/ask again/i);
    expect(group).not.toHaveTextContent(/nothing is saved until you confirm/i);
  });

  it("the card expires on screen without a reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    render(<ChatPanel messages={card(Date.now() / 1000 + 5)} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: /confirm save/i })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByRole("button", { name: /confirm save/i })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /confirm patient record preview/i })).toHaveTextContent(/expired/i);
  });

  it.each([undefined, null, "soon", 0, -1, NaN, Infinity])("an absent or unusable expiry (%s) is ignored; the server stays authoritative", (v) => {
    render(<ChatPanel messages={card(v)} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: /confirm save/i })).toBeInTheDocument();
  });

  it("an expired card does not claim it was cancelled, saved or discarded", () => {
    render(<ChatPanel messages={card(nowS() - 5)} onSend={vi.fn()} />);
    expect(screen.getByRole("group")).not.toHaveTextContent(/was (cancelled|canceled|saved|discarded)|nothing was saved/i);
  });
});

describe("manual-entry guidance while the outcome is unknown", () => {
  it("asks the patient to look for the original entry first, and does not claim the check is conclusive", async () => {
    const user = userEvent.setup();
    const hold = { phase: "refreshed" as const, canAcknowledge: true, onRefresh: vi.fn(), onAcknowledge: vi.fn() };
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={hold} />);
    void user;
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/before (you )?(add|enter|type)/i);
    expect(text).toMatch(/original/i);
    expect(text).toMatch(/duplicate/i);
    expect(text).toMatch(/can't tell|does not prove|doesn't prove|not proof/i);
    expect(text).not.toMatch(/you're done|is saved|was saved|nothing was saved/i);
  });

  it("the first hold message also warns against re-entering the information straight away", () => {
    const hold = { phase: "idle" as const, canAcknowledge: false, onRefresh: vi.fn(), onAcknowledge: vi.fn() };
    render(<ChatPanel messages={PENDING} onSend={vi.fn()} confirmationHold={hold} />);
    expect(screen.getByRole("status").textContent).toMatch(/may still finish|may still be saved|server may still/i);
  });
});
