/**
 * Backend calls that cannot go through `request` still report their failures.
 *
 * The transport's `request` reports every failed call once, at the network
 * boundary. Two paths need a raw `fetch` instead - streamed chat reads a
 * `ReadableStream`, and authenticated previews read a `Blob` - and neither
 * reported anything. A failed patient chat turn, the product's central flow,
 * reached no telemetry sink in production, and a failed artifact preview was
 * swallowed by `TimelinePanel` into "Preview unavailable".
 *
 * Both now report through the transport's own helper, so classification (4xx
 * expected, anything else unexpected) and route redaction match every other
 * request, and the request body - a patient's chat message - is never attached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, getAuthenticatedObjectUrl, sendMyChatStream } from "../../src/api/client";
import { redactUrlPath } from "../../src/lib/telemetry";

const reportError = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/telemetry")>();
  return { ...actual, reportError };
});

const CHAT_PATH = "/me/chat/stream";
const MESSAGE = "my private description of a symptom";

function sse(...events: Array<[string, unknown]>): Response {
  const body = events
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function jsonError(status: number, detail: string): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function theOnlyReport(): unknown[] {
  expect(reportError).toHaveBeenCalledTimes(1);
  return reportError.mock.calls[0];
}

beforeEach(() => {
  reportError.mockClear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamed chat", () => {
  it("does not report a turn that completes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(["answer", { reply: "Hello" }])));
    await expect(sendMyChatStream(MESSAGE)).resolves.toMatchObject({ reply: "Hello" });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a server fault once, as unexpected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonError(503, "Support is unavailable")));
    await expect(sendMyChatStream(MESSAGE)).rejects.toMatchObject({ status: 503 });

    const [error, context] = theOnlyReport();
    expect(error).toBeInstanceOf(ApiError);
    expect(context).toEqual({
      surface: "api.stream",
      kind: "unexpected",
      detail: { method: "POST", route: redactUrlPath(CHAT_PATH), status: 503 },
    });
  });

  it("reports a rejected request as an expected product state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonError(401, "Session expired")));
    await expect(sendMyChatStream(MESSAGE)).rejects.toMatchObject({ status: 401 });
    expect(theOnlyReport()[1]).toMatchObject({ surface: "api.stream", kind: "expected" });
  });

  it("reports an error event emitted by the stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(["error", { error: "Pipeline failed" }])));
    await expect(sendMyChatStream(MESSAGE)).rejects.toThrow("Pipeline failed");
    expect(theOnlyReport()[1]).toMatchObject({
      surface: "api.stream",
      kind: "unexpected",
      detail: { status: undefined },
    });
  });

  it("reports a stream that ends without an answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sse(["pipeline_stage", { label: "Retrieving" }])),
    );
    await expect(sendMyChatStream(MESSAGE)).rejects.toThrow("ended without an answer");
    theOnlyReport();
  });

  it("reports a timed-out turn with the message the user is shown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(sendMyChatStream(MESSAGE)).rejects.toThrow("timed out");
    const [error] = theOnlyReport();
    expect((error as Error).message).toMatch(/timed out/);
  });

  it("never attaches the patient's message to the report", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonError(500, "Internal error")));
    await expect(sendMyChatStream(MESSAGE)).rejects.toBeInstanceOf(ApiError);
    expect(JSON.stringify(reportError.mock.calls)).not.toContain(MESSAGE);
  });
});

describe("authenticated object URLs", () => {
  const ARTIFACT_PATH = "/me/timeline/artifacts/42";
  const original = URL.createObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
  });

  afterEach(() => {
    URL.createObjectURL = original;
  });

  it("does not report a preview that loads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("image-bytes", { status: 200 })));
    await expect(getAuthenticatedObjectUrl(ARTIFACT_PATH)).resolves.toBe("blob:preview");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a missing artifact once, as expected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonError(404, "Artifact not found")));
    await expect(getAuthenticatedObjectUrl(ARTIFACT_PATH)).rejects.toMatchObject({ status: 404 });
    expect(theOnlyReport()[1]).toEqual({
      surface: "api.object-url",
      kind: "expected",
      detail: { method: "GET", route: redactUrlPath(ARTIFACT_PATH), status: 404 },
    });
  });

  it("reports a network failure as unexpected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(getAuthenticatedObjectUrl(ARTIFACT_PATH)).rejects.toBeInstanceOf(TypeError);
    expect(theOnlyReport()[1]).toMatchObject({ surface: "api.object-url", kind: "unexpected" });
  });
});
