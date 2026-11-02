import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthProvider } from "../../src/context/AuthContext";
import { useAuth } from "../../src/hooks/useAuth";
import { GeneticCounselingPanel } from "../../src/pages/patient/GeneticCounselingPanel";
import { readDraft } from "../../src/lib/draftStore";

/**
 * Milestone 7.4, Priority 5. A failed genetics save used to surface only as an
 * unhandled promise rejection: nothing on screen, no way to know the entry was
 * not saved. A successful save used to reset the whole form even if the patient
 * had kept typing while it was in flight. A panel that stayed mounted across a
 * change of authenticated patient kept showing the previous patient's draft.
 */
const addFamily = vi.fn();
vi.mock("../../src/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client")>()),
  addMyFamilyHistory: (...a: unknown[]) => addFamily(...a),
  addMyGeneticTestRecord: vi.fn(),
  addMyBiomarkerRecord: vi.fn(),
  addMyTumorMarkerRecord: vi.fn(),
}));

const authRef: { current: ReturnType<typeof useAuth> | null } = { current: null };
function Probe() {
  const ctx = useAuth();
  useEffect(() => { authRef.current = ctx; });
  return null;
}
const onSaved = vi.fn();
function Harness() {
  return (
    <AuthProvider>
      <Probe />
      <GeneticCounselingPanel readiness={null} onSaved={onSaved} />
    </AuthProvider>
  );
}
const SECRET = "mother diagnosed at 41, BRCA1 carrier";
const notes = () => screen.getAllByLabelText("Notes")[0] as HTMLTextAreaElement;
const age = () => screen.getByLabelText("Age at diagnosis") as HTMLInputElement;
/** Paste instead of typing key by key: same state path, and fast enough to survive a loaded CI run. */
async function enter(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) {
  await user.click(el);
  await user.paste(text);
}
const saveFamily = () => screen.getAllByRole("button", { name: "Save entry" })[0];

describe("a failed genetics save", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown) => { unhandled.push(r); };
  beforeEach(() => {
    sessionStorage.clear(); localStorage.clear(); addFamily.mockReset(); onSaved.mockReset(); unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => { process.off("unhandledRejection", onUnhandled); });

  it("says so on screen, accessibly, and keeps everything the patient typed", async () => {
    const user = userEvent.setup();
    addFamily.mockRejectedValue(new Error("Request failed (500)"));
    render(<Harness />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await enter(user, age(), "41");
    await user.click(saveFamily());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't save this entry/i);
    expect(alert).toHaveTextContent(/draft is kept/i);
    expect(notes().value).toBe(SECRET);
    expect(age().value).toBe("41");
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveFamily()).toBeEnabled();                    // can try again
    await new Promise((r) => setTimeout(r, 30));
    expect(unhandled).toEqual([]);
  });

  it("is attached to the form that failed, not to the others", async () => {
    const user = userEvent.setup();
    addFamily.mockRejectedValue(new Error("boom"));
    render(<Harness />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveFamily());
    const alert = await screen.findByRole("alert");
    expect(alert.closest("form")?.textContent).toMatch(/Add family history/);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("clears the message when a retry succeeds", async () => {
    const user = userEvent.setup();
    addFamily.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({});
    render(<Harness />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveFamily());
    await screen.findByRole("alert");
    await user.click(saveFamily());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(notes().value).toBe(""));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("never writes the draft or the failure to durable storage", async () => {
    const user = userEvent.setup();
    addFamily.mockRejectedValue(new Error("x"));
    render(<Harness />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveFamily());
    await screen.findByRole("alert");
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain("BRCA1");
  });
});

describe("edits made while a save is pending", () => {
  beforeEach(() => { sessionStorage.clear(); addFamily.mockReset(); onSaved.mockReset(); });

  it("a successful save resets only what was submitted, never newer typing", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    addFamily.mockReturnValue(new Promise<void>((res) => { finish = res; }));
    render(<Harness />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await enter(user, age(), "41");
    await user.click(saveFamily());
    await waitFor(() => expect(addFamily).toHaveBeenCalledTimes(1));
    await enter(user, notes(), " AND A NEWER SENTENCE");     // typed after submitting
    await act(async () => { finish(); });
    await waitFor(() => expect(age().value).toBe(""));       // unchanged since submit -> reset
    expect(notes().value).toBe(`${SECRET} AND A NEWER SENTENCE`); // changed since submit -> kept
    expect(readDraft<{ notes: string }>("P001", "genetics.family")?.notes).toBe(`${SECRET} AND A NEWER SENTENCE`);
  });
});

describe("a change of authenticated patient while the panel stays mounted", () => {
  beforeEach(() => { sessionStorage.clear(); addFamily.mockReset(); });

  it("never shows, edits or saves the previous patient's draft", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await enter(user, notes(), SECRET);
    expect(notes().value).toBe(SECRET);

    act(() => authRef.current!.setSession("tok2", "patient", "P002"));
    expect(notes().value).toBe("");                          // not P001's text
    await enter(user, notes(), "p002 text");
    expect(readDraft("P002", "genetics.family")).toMatchObject({ notes: "p002 text" });
    expect(readDraft("P001", "genetics.family")).toBeUndefined();
  });

  it("a save that was started for the previous patient cannot reset the new patient's form", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    addFamily.mockReturnValue(new Promise<void>((res) => { finish = res; }));
    render(<Harness />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveFamily());
    await waitFor(() => expect(addFamily).toHaveBeenCalledTimes(1));
    act(() => authRef.current!.setSession("tok2", "patient", "P002"));
    await enter(user, notes(), "p002 text");
    await act(async () => { finish(); });
    await new Promise((r) => setTimeout(r, 30));
    expect(notes().value).toBe("p002 text");
    expect(readDraft("P001", "genetics.family")).toBeUndefined();
  });
});

describe("success when the dashboard unmounts the panel to refetch", () => {
  beforeEach(() => { sessionStorage.clear(); addFamily.mockReset(); });

  /**
   * The real dashboard swaps the page for a skeleton while it refetches the
   * report, so the panel unmounts in the same tick as the successful save. The
   * reset has to reach the draft store regardless, or the saved text reappears
   * on remount and invites a duplicate submission.
   */
  it("the submitted draft does not come back after the remount", async () => {
    const user = userEvent.setup();
    addFamily.mockResolvedValue({});
    function Dash() {
      const [show, set] = useState(true);
      return (
        <AuthProvider>
          <Probe />
          <button type="button" onClick={() => set(true)}>remount panel</button>
          {show && <GeneticCounselingPanel readiness={null} onSaved={() => set(false)} />}
        </AuthProvider>
      );
    }
    render(<Dash />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await enter(user, age(), "41");
    await user.click(saveFamily());
    await waitFor(() => expect(screen.queryAllByLabelText("Notes")).toHaveLength(0)); // unmounted by onSaved
    expect(readDraft<{ notes: string; age_at_diagnosis: string }>("P001", "genetics.family")).toMatchObject({ notes: "", age_at_diagnosis: "" });
    await user.click(screen.getByRole("button", { name: "remount panel" }));
    expect(notes().value).toBe("");
    expect(age().value).toBe("");
  });
});
