import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OUTCOME_UNKNOWN_MESSAGE,
  OutcomeUnknownError,
  isOutcomeUnknown,
  sendMyChatStream,
} from "../../src/api/client.patient";

/**
 * Milestone 7.4, Priority 2. A browser timeout proves nothing about the
 * server: it kept working and saved a symptom 64 s after the 45 s abort.
 * So after any failure that leaves the outcome unknown the UI may say neither
 * "saved" nor "not saved", must not retry, and must not leave a stale
 * Confirm button that would submit an unbound "Confirm save".
 *
 * The panel and hold behaviour moved to failClosedConfirmation.test.tsx in 7.5,
 * when the hold stopped being released by a change in chat history.
 */
const FALSE_CLAIM = /no record was saved|nothing was saved|was not saved|not been saved|did not save/i;

function sse(...events: [string, unknown][]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        events.forEach(([n, d]) => c.enqueue(enc.encode(`event: ${n}\ndata: ${JSON.stringify(d)}\n\n`)));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("transport: which failures leave the outcome unknown", () => {
  beforeEach(() => {
    sessionStorage.setItem("patientPortalAccessToken", "t");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear(); vi.restoreAllMocks(); });

  it("an abort says the outcome is unknown and never claims nothing was saved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    const err = await sendMyChatStream("Confirm save").catch((e) => e);
    expect(isOutcomeUnknown(err)).toBe(true);
    expect(err).toBeInstanceOf(OutcomeUnknownError);
    expect(err.message).toBe(OUTCOME_UNKNOWN_MESSAGE);
    expect(err.message).toMatch(/couldn't confirm whether this action completed/i);
    expect(err.message).toMatch(/check your records before trying again/i);
    expect(err.message).not.toMatch(FALSE_CLAIM);
  });

  it("a stream that ends without an answer is unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(["pipeline_stage", { label: "x" }])));
    expect(isOutcomeUnknown(await sendMyChatStream("hi").catch((e) => e))).toBe(true);
  });

  it("a connection dropped mid-stream is unknown", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode("event: pipeline_stage\ndata: {}\n\n")); c.error(new TypeError("network")); },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    expect(isOutcomeUnknown(await sendMyChatStream("hi").catch((e) => e))).toBe(true);
  });

  it("a network failure before any response is unknown for a POST that may have been sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(isOutcomeUnknown(await sendMyChatStream("hi").catch((e) => e))).toBe(true);
  });

  it("an HTTP 4xx is a definite refusal, not unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 })));
    expect(isOutcomeUnknown(await sendMyChatStream("hi").catch((e) => e))).toBe(false);
  });

  // Milestone 7.7: the pipeline had started, and may have committed a write before it failed.
  it("an explicit server error event is unknown, not a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(["error", { error: "Agent pipeline failed. Please try again." }])));
    const err = await sendMyChatStream("hi").catch((e) => e);
    expect(isOutcomeUnknown(err)).toBe(true);
    expect(err.message).toBe(OUTCOME_UNKNOWN_MESSAGE);
  });
});
