import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OUTCOME_UNKNOWN_MESSAGE, isOutcomeUnknown, sendMyChatStream } from "../../src/api/client.patient";

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("patient chat streaming transport", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("patientPortalAccessToken", "patient-token");
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("parses split SSE events and normalizes citation objects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([
      'event: pipeline_stage\ndata: {"label":"Checking sources"}\n\n',
      'event: answer_delta\ndata: {"text":"Source-"}\n\n',
      'event: answer_delta\ndata: {"text":"backed"}\n\n',
      'event: answer\ndata: {"reply":"Source-backed","saved_actions":[],"citations":[{"title":"NCI guide"},"ASCO"]}\n\n',
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const onStage = vi.fn();
    const onDelta = vi.fn();

    await expect(sendMyChatStream("What does this mean?", { onStage, onDelta })).resolves.toEqual({
      reply: "Source-backed",
      saved_actions: [],
      citations: ["NCI guide", "ASCO"],
      assistant_message_id: undefined,
    });
    expect(onStage).toHaveBeenCalledWith("Checking sources");
    expect(onDelta.mock.calls.flat()).toEqual(["Source-", "backed"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8017/me/chat/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "What does this mean?" }),
        headers: expect.objectContaining({ Authorization: "Bearer patient-token" }),
      }),
    );
  });

  it("ignores malformed SSE frames but requires a final answer (ending without one is an unknown outcome)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      "not-an-event\n\n",
      "event: answer\ndata: not-json\n\n",
    ])));
    const err = await sendMyChatStream("hello").catch((e) => e);
    expect(isOutcomeUnknown(err)).toBe(true);
  });

  it("treats an explicit server error event as an unknown outcome: the pipeline had started", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      'event: error\ndata: {"error":"The support service is unavailable"}\n\n',
    ])));
    await expect(sendMyChatStream("hello")).rejects.toThrow(OUTCOME_UNKNOWN_MESSAGE);
  });

  it("converts aborts into an unknown-outcome message that makes no claim about saving", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    )));

    const pending = sendMyChatStream("hello");
    const rejection = expect(pending).rejects.toThrow(OUTCOME_UNKNOWN_MESSAGE);
    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;
  });
});
