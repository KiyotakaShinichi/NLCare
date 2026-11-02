import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthProvider } from "../../src/context/AuthContext";
import { useAuth } from "../../src/hooks/useAuth";
import { GeneticCounselingPanel } from "../../src/pages/patient/GeneticCounselingPanel";
import {
  beginOperation, clearAllDrafts, completeOperation, failOperation, readDraft, readOperation, writeDraft,
} from "../../src/lib/draftStore";

/**
 * Milestone 7.5, Priority 4. The reviewer found two navigation cases: leaving
 * the form during a save and returning before it succeeded showed the
 * just-submitted text again, and a failure while away left no message. The save
 * lifecycle now lives in the patient-scoped in-memory store, not in the panel
 * instance, so it survives unmount and remount.
 *
 * None of this is idempotency. It stops this browser tab submitting the same
 * form twice while a request is outstanding; the server still has to deduplicate.
 */
const saveFamilyApi = vi.fn();
vi.mock("../../src/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client")>()),
  addMyFamilyHistory: (...a: unknown[]) => saveFamilyApi(...a),
  addMyGeneticTestRecord: vi.fn(),
  addMyBiomarkerRecord: vi.fn(),
  addMyTumorMarkerRecord: vi.fn(),
}));

const authRef: { current: ReturnType<typeof useAuth> | null } = { current: null };
function Probe() { const c = useAuth(); useEffect(() => { authRef.current = c; }); return null; }
const onSaved = vi.fn();
function Host() {
  const [show, setShow] = useState(true);
  return (
    <AuthProvider>
      <Probe />
      <button type="button" onClick={() => setShow((s) => !s)}>toggle panel</button>
      {show && <GeneticCounselingPanel readiness={null} onSaved={onSaved} />}
    </AuthProvider>
  );
}
const SECRET = "mother diagnosed at 41, BRCA1 carrier";
const notes = () => screen.getAllByLabelText("Notes")[0] as HTMLTextAreaElement;
const age = () => screen.getByLabelText("Age at diagnosis") as HTMLInputElement;
const saveBtn = () => screen.getAllByRole("button", { name: /Save entry|Saving/ })[0];
async function enter(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) { await user.click(el); await user.paste(text); }
const toggle = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "toggle panel" }));
const FAMILY = "genetics.family";

describe("operation lifecycle in the store (unit)", () => {
  beforeEach(() => clearAllDrafts());

  it("refuses a second operation for the same form while one is pending", () => {
    const first = beginOperation("P001", FAMILY);
    expect(first).not.toBeNull();
    expect(beginOperation("P001", FAMILY)).toBeNull();
    expect(beginOperation("P001", "genetics.test")).not.toBeNull();   // a different form is independent
    expect(beginOperation("P002", FAMILY)).not.toBeNull();            // so is another patient
  });

  it("completes only a known, pending operation, and clears only the submitted version", () => {
    writeDraft("P001", FAMILY, { notes: "typed later", age: "41" });
    const id = beginOperation("P001", FAMILY)!;
    expect(completeOperation<{ notes: string; age: string }>("P001", FAMILY, id + 99, (d) => d)).toBe(false);
    expect(completeOperation<{ notes: string; age: string }>("P001", FAMILY, id, (d) => ({ ...d, age: "" }))).toBe(true);
    expect(readDraft("P001", FAMILY)).toEqual({ notes: "typed later", age: "" });
    expect(readOperation("P001", FAMILY)).toBeUndefined();
    expect(completeOperation("P001", FAMILY, id, (d) => d)).toBe(false);   // not twice
  });

  it("a failure is kept, with the draft, until the next attempt", () => {
    writeDraft("P001", FAMILY, { notes: SECRET });
    const id = beginOperation("P001", FAMILY)!;
    expect(failOperation("P001", FAMILY, id)).toBe(true);
    expect(readOperation("P001", FAMILY)?.status).toBe("failed");
    expect(readDraft("P001", FAMILY)).toEqual({ notes: SECRET });
    expect(beginOperation("P001", FAMILY)).not.toBeNull();             // retry allowed
  });

  it("sign-out or sign-in discards operations, so a late response is ignored", () => {
    writeDraft("P001", FAMILY, { notes: SECRET });
    const id = beginOperation("P001", FAMILY)!;
    clearAllDrafts();
    expect(completeOperation("P001", FAMILY, id, () => ({ notes: "" }))).toBe(false);
    expect(failOperation("P001", FAMILY, id)).toBe(false);
    expect(readDraft("P001", FAMILY)).toBeUndefined();
    expect(readOperation("P001", FAMILY)).toBeUndefined();
  });
});

describe("genetics panel: save lifecycle across navigation", () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); saveFamilyApi.mockReset(); onSaved.mockReset(); });
  afterEach(() => vi.restoreAllMocks());

  it("a pending save survives leaving and returning, and cannot be submitted again", async () => {
    const user = userEvent.setup();
    saveFamilyApi.mockReturnValue(new Promise(() => {}));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveBtn());
    await toggle(user); await toggle(user);                              // Overview -> Support -> Overview
    expect(saveBtn()).toBeDisabled();                                    // still saving, after the remount
    await user.click(saveBtn());
    fireEvent.submit(saveBtn().closest("form")!);                       // and not via the keyboard either
    await new Promise((r) => setTimeout(r, 40));
    expect(saveFamilyApi).toHaveBeenCalledTimes(1);
  });

  it("success that lands while away clears the submitted text, and the returning form shows it", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    saveFamilyApi.mockReturnValue(new Promise<void>((res) => { finish = res; }));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await enter(user, age(), "41");
    await user.click(saveBtn());
    await toggle(user);                                                  // away
    await act(async () => { finish(); });
    expect(onSaved).toHaveBeenCalledTimes(1);                            // the dashboard is told even though the panel is gone
    await toggle(user);                                                  // back
    expect(notes().value).toBe("");
    expect(age().value).toBe("");
    expect(saveBtn()).toBeEnabled();
  });

  it("returning before success and then succeeding does not resurrect the submitted text", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    saveFamilyApi.mockReturnValue(new Promise<void>((res) => { finish = res; }));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveBtn());
    await toggle(user); await toggle(user);                              // back while still pending
    expect(notes().value).toBe(SECRET);                                  // honest: it has not succeeded yet
    await act(async () => { finish(); });
    await waitFor(() => expect(notes().value).toBe(""));                 // the mounted instance follows the store
  });

  it("newer edits made after returning survive an older success", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    saveFamilyApi.mockReturnValue(new Promise<void>((res) => { finish = res; }));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await enter(user, age(), "41");
    await user.click(saveBtn());
    await toggle(user); await toggle(user);
    await user.click(notes()); await user.paste(" PLUS A NEWER SENTENCE");
    await act(async () => { finish(); });
    await waitFor(() => expect(age().value).toBe(""));                   // unchanged since submission: cleared
    expect(notes().value).toBe(`${SECRET} PLUS A NEWER SENTENCE`);       // edited since: kept
  });

  it("a failure that lands while away is shown on return, with the draft intact", async () => {
    const user = userEvent.setup();
    let fail!: (e: Error) => void;
    saveFamilyApi.mockReturnValue(new Promise((_r, rej) => { fail = rej; }));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveBtn());
    await toggle(user);
    await act(async () => { fail(new Error("500")); });
    expect(onSaved).not.toHaveBeenCalled();
    await toggle(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save this entry/i);
    expect(notes().value).toBe(SECRET);
    expect(saveBtn()).toBeEnabled();                                     // can try again
  });

  it("nothing is written to durable storage through any of it", async () => {
    const user = userEvent.setup();
    let fail!: (e: Error) => void;
    saveFamilyApi.mockReturnValue(new Promise((_r, rej) => { fail = rej; }));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveBtn());
    await toggle(user); await act(async () => { fail(new Error("x")); }); await toggle(user);
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toMatch(/BRCA1|mother/);
  });
});

describe("genetics panel: identity changes with a save in flight", () => {
  beforeEach(() => { sessionStorage.clear(); saveFamilyApi.mockReset(); onSaved.mockReset(); });

  it("a late success for the previous patient changes nothing for the next one", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    saveFamilyApi.mockReturnValue(new Promise<void>((res) => { finish = res; }));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveBtn());
    act(() => authRef.current!.setSession("t2", "patient", "P002"));     // identity changes, panel stays mounted
    expect(notes().value).toBe("");
    expect(saveBtn()).toBeEnabled();                                     // P002 is not "saving"
    await enter(user, notes(), "p002 private");
    await act(async () => { finish(); });
    await new Promise((r) => setTimeout(r, 30));
    expect(notes().value).toBe("p002 private");
    expect(readDraft("P001", FAMILY)).toBeUndefined();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a late failure for the previous patient shows no error on the next one", async () => {
    const user = userEvent.setup();
    let fail!: (e: Error) => void;
    saveFamilyApi.mockReturnValue(new Promise((_r, rej) => { fail = rej; }));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveBtn());
    act(() => authRef.current!.setSession("t2", "patient", "P002"));
    await act(async () => { fail(new Error("x")); });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sign-out with a save in flight leaves nothing behind for that patient", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    saveFamilyApi.mockReturnValue(new Promise<void>((res) => { finish = res; }));
    render(<Host />);
    act(() => authRef.current!.setSession("t", "patient", "P001"));
    await enter(user, notes(), SECRET);
    await user.click(saveBtn());
    act(() => authRef.current!.clearSession());
    await toggle(user);
    await act(async () => { finish(); });
    expect(readDraft("P001", FAMILY)).toBeUndefined();
    expect(readOperation("P001", FAMILY)).toBeUndefined();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
