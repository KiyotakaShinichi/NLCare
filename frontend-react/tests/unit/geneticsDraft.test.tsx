import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthProvider } from "../../src/context/AuthContext";
import { useAuth } from "../../src/hooks/useAuth";
import { GeneticCounselingPanel } from "../../src/pages/patient/GeneticCounselingPanel";

const addFamily = vi.fn();
vi.mock("../../src/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client")>()),
  addMyFamilyHistory: (...a: unknown[]) => addFamily(...a),
  addMyGeneticTestRecord: vi.fn(),
  addMyBiomarkerRecord: vi.fn(),
  addMyTumorMarkerRecord: vi.fn(),
}));

/** Exposes the auth context so a test can sign in, switch patient and sign out. */
const authRef: { current: ReturnType<typeof useAuth> | null } = { current: null };
function Probe() {
  const ctx = useAuth();
  useEffect(() => { authRef.current = ctx; });
  return null;
}

function Harness({ show }: { show: boolean }) {
  return (
    <AuthProvider>
      <Probe />
      {show && <GeneticCounselingPanel readiness={null} onSaved={vi.fn()} />}
    </AuthProvider>
  );
}

const SECRET = "mother diagnosed at 41, BRCA1 carrier";

async function typeDraft(user: ReturnType<typeof userEvent.setup>) {
  // The first "Notes" field belongs to the family-history form.
  await user.type(screen.getAllByLabelText("Notes")[0], SECRET);
}
const familyNotes = () => (screen.getAllByLabelText("Notes")[0] as HTMLTextAreaElement).value;

describe("genetic-counselling draft survives in-app navigation", () => {
  beforeEach(() => {
    sessionStorage.clear(); localStorage.clear(); addFamily.mockReset();
  });

  it("keeps an unsaved draft when the panel unmounts and mounts again (Overview -> Support -> back)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness show />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await typeDraft(user);
    rerender(<Harness show={false} />);           // navigated to Support
    rerender(<Harness show />);                    // came back
    expect(familyNotes()).toBe(SECRET);
  });

  it("never writes the draft to durable browser storage", async () => {
    const user = userEvent.setup();
    render(<Harness show />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await typeDraft(user);
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toContain("BRCA1 carrier");
  });

  it("clears the draft on sign-out", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness show />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await typeDraft(user);
    rerender(<Harness show={false} />);
    rerender(<Harness show />);
    expect(familyNotes()).toBe(SECRET); // control: the draft is really held before sign-out
    act(() => authRef.current!.clearSession());
    rerender(<Harness show={false} />);
    act(() => authRef.current!.setSession("tok2", "patient", "P001"));
    rerender(<Harness show />);
    expect(familyNotes()).toBe("");
  });

  it("does not carry a draft to a different patient", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness show />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await typeDraft(user);
    rerender(<Harness show={false} />);
    rerender(<Harness show />);
    expect(familyNotes()).toBe(SECRET); // control: held for P001
    rerender(<Harness show={false} />);
    act(() => authRef.current!.setSession("tok2", "patient", "P002"));
    rerender(<Harness show />);
    expect(familyNotes()).toBe("");
  });

  it("resets the form after a successful save, and a later remount stays empty", async () => {
    const user = userEvent.setup();
    addFamily.mockResolvedValue({});
    const { rerender } = render(<Harness show />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await typeDraft(user);
    await user.click(screen.getAllByRole("button", { name: "Save entry" })[0]);
    await waitFor(() => expect(addFamily).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(familyNotes()).toBe(""));
    rerender(<Harness show={false} />);
    rerender(<Harness show />);
    expect(familyNotes()).toBe("");
  });

  it("keeps the draft while a save is in flight and only resets it once the save succeeds", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    addFamily.mockReturnValue(new Promise<void>((res) => { finish = res; }));
    render(<Harness show />);
    act(() => authRef.current!.setSession("tok", "patient", "P001"));
    await typeDraft(user);
    await user.click(screen.getAllByRole("button", { name: "Save entry" })[0]);
    await waitFor(() => expect(addFamily).toHaveBeenCalledTimes(1));
    expect(familyNotes()).toBe(SECRET);          // nothing is cleared before the server accepts it
    await act(async () => { finish(); });
    await waitFor(() => expect(familyNotes()).toBe(""));
  });
});
