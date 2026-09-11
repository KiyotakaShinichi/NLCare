/**
 * The shared submit lifecycle behind every patient tool form.
 *
 * `useToolForm` sits under the symptom, CBC, imaging, medication, and treatment
 * note forms and had no tests. What it owns is small but load-bearing: a failed
 * save keeps the form open with the user's input, the button never stays stuck
 * on "Saving…", and a failure reaches telemetry exactly once.
 *
 * API failures are already reported by the request transport, so reporting them
 * here as well would count one failed save twice. Anything else - a file that
 * could not be encoded, a local exception before the request - never reached
 * the transport, and until now its only record was a development-only
 * `console.error`.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../src/api/client";
import { useToolForm } from "../../src/hooks/useToolForm";

const reportError = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/telemetry")>();
  return { ...actual, reportError };
});

beforeEach(() => {
  reportError.mockClear();
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useToolForm lifecycle", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useToolForm(vi.fn()));
    expect(result.current.submitting).toBe(false);
    expect(result.current.submitError).toBeNull();
  });

  it("runs the save, hands its result to onSuccess, and settles", async () => {
    const onSuccess = vi.fn();
    const submitFn = vi.fn().mockResolvedValue({ saved: 1 });
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useToolForm(submitFn, { onSuccess }));

    await act(async () => {
      await result.current.submit({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(submitFn).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ saved: 1 });
    expect(result.current.submitting).toBe(false);
    expect(result.current.submitError).toBeNull();
  });

  it("reports submitting while the save is in flight, then clears it", async () => {
    const save = deferred();
    const { result } = renderHook(() => useToolForm(() => save.promise));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.submit();
    });
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      save.resolve();
      await pending;
    });
    expect(result.current.submitting).toBe(false);
  });

  it("ignores a second submit while the first is still saving", async () => {
    const save = deferred();
    const submitFn = vi.fn(() => save.promise);
    const { result } = renderHook(() => useToolForm(submitFn));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.submit();
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(submitFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve();
      await pending;
    });
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useToolForm(vi.fn().mockRejectedValue(new ApiError("Severity must be between 0 and 10", 422)), {
        onSuccess,
      }),
    );

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.submitError).toBe("Severity must be between 0 and 10");
    expect(result.current.submitting).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    const { result } = renderHook(() => useToolForm(vi.fn().mockRejectedValue("offline")));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.submitError).toBe("Could not save. Please try again.");
  });

  it("clears the error on reset", async () => {
    const { result } = renderHook(() => useToolForm(vi.fn().mockRejectedValue(new Error("nope"))));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.submitError).toBe("nope");

    act(() => {
      result.current.reset();
    });
    expect(result.current.submitError).toBeNull();
    expect(result.current.submitting).toBe(false);
  });
});

describe("useToolForm telemetry", () => {
  it("does not re-report an API failure the transport already reported", async () => {
    const { result } = renderHook(() =>
      useToolForm(vi.fn().mockRejectedValue(new ApiError("Server error", 500))),
    );
    await act(async () => {
      await result.current.submit();
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a failure that never reached the transport, exactly once", async () => {
    const failure = new TypeError("Could not encode the selected file");
    const { result } = renderHook(() => useToolForm(vi.fn().mockRejectedValue(failure)));
    await act(async () => {
      await result.current.submit();
    });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(failure, { surface: "tool-form.submit" });
    expect(result.current.submitError).toBe("Could not encode the selected file");
  });
});
