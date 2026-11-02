import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { AUTOMATIC_PROMPT_NOTE, toPatientReason, toPatientReasons } from "../../src/lib/patientLanguage";
import { ReviewWithCareTeamCard } from "../../src/pages/patient/ReviewWithCareTeamCard";
import { deriveReviewItems } from "../../src/pages/patient/nextReviewItems";
import PatientOverview52 from "../../src/pages/patient/PatientOverview52";
import { reviewStatusSentence } from "../../src/lib/recordReview";
import type { PatientReport } from "../../src/types/api";

/**
 * The patient payload carries no field recording that anyone viewed, reviewed,
 * was notified of, received or acknowledged anything. So the frontend may not
 * assert either direction: "nobody has been told" is as unsupported as "your
 * team has been alerted".
 *
 * These patterns describe the *shape* of an unsupported claim rather than one
 * previously-seen sentence, so a rewording ("No one has been alerted", "has not
 * yet been looked at") is caught too.
 */
const WHO = String.raw`(?:no\s*one|nobody|no\s+(?:clinician|doctor|nurse|care\s+team)|nothing|none\s+of\s+(?:it|this|them)|your\s+(?:care\s+)?team|a\s+clinician|clinicians?|anyone|someone)`;
const ACT = String.raw`(?:seen|reviewed|notified|told|informed|alerted|contacted|sent|delivered|read|looked\s+at|acknowledged|approved|escalated)`;
const CLAIMS: RegExp[] = [
  new RegExp(String.raw`\b${WHO}\b[^.]{0,40}\b(?:has|have|had|was|were|is|are|been|not|never|yet)\b[^.]{0,30}\b${ACT}\b`, "i"),
  new RegExp(String.raw`\b(?:has|have|had)\s+(?:not|never|yet\s+to)\b[^.]{0,20}\b(?:been\s+)?${ACT}\b`, "i"),
  /\bunreviewed\b|\bnot\s+(?:yet\s+)?reviewed\b|\bawaiting\s+clinician\b/i,
  /\bnotification\s+(?:was|has been)\s+(?:sent|delivered|received)\b/i,
];
/**
 * Milestone 7.4 additions. The first set only caught "<who> has <verb>". These
 * cover other word orders and tenses: passive routing ("Shared with your care
 * team"), the future ("will be notified"), perfect aspect with the actor first
 * or omitted, labels that promise a destination ("Save for review"), and
 * purpose clauses ("so your care team can review").
 */
const TEAM = String.raw`(?:care[\s-]team|clinicians?|clinics?|doctors?|oncolog(?:ist|y\s+team|y\s+care\s+team|y\s+nurse)s?|nurses?|providers?|medical\s+team|team)`;
const ROUTED = String.raw`(?:shared|sent|forwarded|passed(?:\s+on)?|routed|escalated|reported|submitted|delivered|logged|flagged|queued|raised|notified|alerted|informed)`;
// Verbs that assert someone looked at, was told of or received something. The
// generic routing verbs (sent, shared, logged...) are NOT here: "a sample was
// sent to the clinical laboratory" is ordinary medical text. They only count
// when a care-team recipient is named (first EXTENDED pattern).
const DONE = String.raw`(?:reviewed|seen|notified|alerted|informed|acknowledged|received|made\s+aware)`;
const EXTENDED: RegExp[] = [
  new RegExp(String.raw`\b${ROUTED}\b[^.;]{0,30}\b(?:to|with|for|by)\b[^.;]{0,25}\b${TEAM}\b`, "i"),
  new RegExp(String.raw`\b${TEAM}\b[^.]{0,30}\bwill\b[^.]{0,30}\b(?:be\s+)?(?:notified|alerted|informed|told|contact|review|see|receive|look|respond|follow|get)`, "i"),
  new RegExp(String.raw`\bwill\s+be\s+(?:${ROUTED}|reviewed|seen)\b`, "i"),
  new RegExp(String.raw`(?<!\byou\s)(?<!\byou've\s)(?<!\bnothing\s)(?<!\bno\s\w+\s)\b(?:has|have|had|was|were)\s+(?:been\s+)?${DONE}\b`, "i"),
  /\b(?:save|send|submit|share|forward|flag(?:ged)?|mark(?:\s+as\s+\w+)?)\b[^.]{0,20}\bfor\s+(?:your\s+)?(?:clinician\s+|clinical\s+|care[\s-]team\s+|doctor\s+)?review\b/i,
  /\bso\s+(?:that\s+)?(?:your\s+)?(?:care\s+team|clinicians?|doctors?)\s+can\s+(?:review|see|look|check|read)\b/i,
  /(?<!\bnot\s)\bfor\s+(?:the\s+|your\s+)?(?:clinician|clinical|care\s+team)\s+review\b/i,
  // Who now knows, has or can see something.
  new RegExp(String.raw`\b${TEAM}\b[^.;]{0,25}\b(?:now\s+has|has\s+this|have\s+this|knows|now\s+know|already\s+know|is\s+aware|are\s+aware|received|got|can\s+see|sees|will\s+see|is\s+waiting|are\s+waiting)\b`, "i"),
  new RegExp(String.raw`\b(?:is|are)\s+waiting\b[^.;]{0,25}\b${TEAM}\b`, "i"),
  new RegExp(String.raw`\blet\s+(?:your\s+|the\s+)?${TEAM}\s+know\b`, "i"),
  new RegExp(String.raw`\b${TEAM}\b[^.;]{0,25}\b(?:was|were|is|been)\s+made\s+aware\b`, "i"),
  // Bare passive labels with a recipient or a review destination.
  new RegExp(String.raw`^\s*(?:sent|submitted|forwarded|escalated|reviewed|shared|delivered|flagged|notified|alerted)\b[^.]{0,40}\b(?:for\s+review|(?:to|by|with)\s+(?:the\s+|your\s+|a\s+)?${TEAM})\b`, "i"),
  // Verbs that name a recipient even when none is given.
  /\b(?:was|were|has\s+been|have\s+been)\s+(?:forwarded|escalated|submitted)\b/i,
  /\bnotifications?\s+(?:delivered|sent|received|queued)\b/i,
  // Promises of contact.
  /\b(?:someone|somebody|we|a\s+(?:nurse|clinician|doctor))\s+will\s+(?:get\s+back|contact|call|reach|follow|respond|review|look|see|be\s+in\s+touch)\b/i,
];
/** Scoped statements about the view itself are the permitted form. */
const SCOPED =
  /\b(?:this (?:view|page|preview)|the patient (?:view|record)|nothing on this page)\b[^.]{0,80}\b(?:does not|do not|cannot|can't)\b|\bnothing on this page shows whether\b|\bwhether\b/i;

/** Text with a space between adjacent elements (jsdom has no innerText). */
function spaced(root: Element): string {
  const parts: string[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = w.nextNode())) { const v = (n.nodeValue ?? "").trim(); if (v) parts.push(v); }
  return parts.join(" ");
}

function split(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x && !SCOPED.test(x));
}

/** The original claim shapes. Applies to every file. */
function unsupported(text: string): string[] {
  return split(text).filter((x) => CLAIMS.some((re) => re.test(x)));
}

/** Original plus the Milestone 7.4 shapes. Applies to patient-facing text. */
function unsupportedExtended(text: string): string[] {
  return split(text).filter((x) => CLAIMS.some((re) => re.test(x)) || EXTENDED.some((re) => re.test(x)));
}

describe("the detector itself (so a green result means something)", () => {
  it.each([
    "No clinician has seen them.",
    "Nobody has been notified.",
    "Nobody has been told about it automatically.",
    "No one has been alerted yet.",
    "Your care team has been alerted.",
    "A clinician has reviewed this.",
    "This has not yet been looked at.",
    "Everything here is unreviewed.",
    "Your team was notified on Monday.",
  ])("flags %s", (s) => expect(unsupported(s).length).toBeGreaterThan(0));

  it.each([
    "This view does not provide notification status.",
    "Nothing on this page shows whether a clinician has looked at your record.",
    "Worth bringing up at your next appointment.",
    "Contact your care team if something feels wrong.",
    "These are prompts for a conversation, not findings.",
  ])("allows %s", (s) => expect(unsupported(s)).toEqual([]));
});

describe("the extended detector (word orders, tenses, delivery verbs)", () => {
  it.each([
    "Shared with your care team for review.",
    "Flagged for clinician review.",
    "Save for review",
    "Your care team will be notified.",
    "Reported symptoms have been logged for clinician review.",
    "Your doctor has seen this.",
    "It was forwarded to the clinic.",
    "We have notified your oncologist.",
    "Record a scan report so your care team can review the text.",
    "Symptom saved and flagged for review",
    "Mark as urgent for clinician review",
    "Not a diagnosis — for clinician review.",
    "A nurse will contact you.",
    "Results were sent to your provider.",
    // second pass: passive, other word orders, delivery, future
    "We have let your oncologist know.",
    "Your oncology team has been informed about these results.",
    "A nurse has been alerted.",
    "Your clinician now has this information.",
    "Your care team can see these entries.",
    "This has been passed to a doctor.",
    "The clinic received your report.",
    "Your entry is waiting in your care team's inbox.",
    "Your doctor was made aware of this value.",
    "Sent for review.",
    "Submitted to the care team.",
    "Reviewed by the oncology team.",
    "Escalated to your provider.",
    "Notification delivered.",
    "Your care team will look at this soon.",
    "Someone will get back to you.",
    "Your symptoms were forwarded.",
    "The team knows about your fever.",
    "Results will be reviewed with your care team.",
  ])("flags %s", (s) => expect(unsupportedExtended(s).length).toBeGreaterThan(0));

  it.each([
    "This view does not show whether anyone has reviewed it.",
    "This view does not provide notification status.",
    "Items for review",
    "Ask your care team which value is correct.",
    "Contact your care team if something feels wrong.",
    "You have logged fatigue three times.",
    "Worth bringing up at your next appointment.",
    "Dose or schedule changes must be agreed with your care team.",
    "Your care team makes treatment decisions.",
    "Symptom saved.",
    "Saved to your record. This view does not show whether anyone has seen it.",
    "Clinical review may be needed.",
    "This should be reviewed with your care team.",
    "Not for clinician review.",
    // negative controls: ordinary laboratory, treatment and research wording
    "A blood sample was sent to the clinical laboratory on 2026-03-25.",
    "Your biopsy slides were sent for oncology pathology review in March.",
    "The research model was trained on synthetic data only and has not been validated.",
    "Your cycle 4 infusion was given on 2026-03-02 at the treatment centre.",
    "WBC is measured in 10^3 cells per microlitre.",
    "Clinical laboratory results are usually available within two days.",
    "Platelets were 120 on 2026-03-25, below the usual range.",
    "The evaluation uses a held-out synthetic cohort.",
    "Treatment decisions are made by you and your care team.",
    "You can share this page with your care team.",
    "Chemotherapy can lower your white blood cell count.",
    "Anything your care team should know about this draw...",
    "This one is worth raising with your care team soon rather than waiting for your next appointment.",
    "Reported symptoms have been recorded.",
    "This summary is generated automatically. This view does not show whether anyone has reviewed it or been notified of anything in it.",
  ])("allows %s", (s) => expect(unsupportedExtended(s)).toEqual([]));
});

describe("patient-language strings make no unsupported review or notification claim", () => {
  it("the standing note", () => expect(unsupported(AUTOMATIC_PROMPT_NOTE)).toEqual([]));

  it("every suggestion, urgent and standard", () => {
    expect(unsupported(toPatientReason("WBC fell. Oncology review is recommended.").suggestion)).toEqual([]);
    expect(unsupported(toPatientReason("Fatigue is high.").suggestion)).toEqual([]);
  });

  it("says notification status is unavailable instead of asserting an absence", () => {
    expect(AUTOMATIC_PROMPT_NOTE).toMatch(/does not (?:provide|show)/i);
    expect(toPatientReason("Fatigue is high.").suggestion).toMatch(/does not provide notification status/i);
  });

  it("keeps urgency actionable without reassurance", () => {
    const s = toPatientReason("WBC fell. Oncology review is recommended.").suggestion;
    expect(s).toMatch(/soon/i);
    expect(s).not.toMatch(/no need|don't worry|nothing to/i);
  });

  it("reviewStatusSentence", () => {
    expect(unsupported(reviewStatusSentence(0))).toEqual([]);
    expect(unsupported(reviewStatusSentence(3))).toEqual([]);
  });
});

const REASONS = [
  "WBC fell below 2.0 x10^3/uL. Oncology review is recommended, especially during active chemotherapy.",
  "Fatigue rated 8/10. Medical review is recommended.",
  "Platelets 90 K/uL.",
];
const REPORT = {
  patient_id: "P001", patient_name: "T", diagnosis: "x", symptoms: [], lab_history: [], timeline: [],
  medication_logs: [], ai_summary: { review_reasons: REASONS, patient_explanation: "", clinical_summary: "" },
  genetic_counseling_readiness: null,
} as unknown as PatientReport;

describe("rendered patient surfaces make no unsupported claim", () => {
  it("ReviewWithCareTeamCard (legacy Overview)", () => {
    const { container } = render(
      <MemoryRouter><ReviewWithCareTeamCard summary={REPORT.ai_summary ?? null} report={REPORT} /></MemoryRouter>,
    );
    expect(unsupported(spaced(container))).toEqual([]);
    expect(container.textContent).toMatch(/does not provide notification status/i);
  });

  it("next-review items", () => {
    const text = deriveReviewItems(REPORT).map((i) => `${i.title}. ${i.detail}`).join("\n");
    expect(unsupported(text)).toEqual([]);
  });

  it("Concept 5.2 Overview (flag ON)", () => {
    const { container } = render(
      <MemoryRouter>
        <PatientOverview52
          report={REPORT} rangedReport={REPORT} rangedSymptoms={[]} rangedLabHistory={[]}
          latestLabDate={null} range="12m" onRangeChange={() => {}} reportFetchedAt={null}
          enrichmentStatus="success" onSaved={() => {}}
        />
      </MemoryRouter>,
    );
    expect(unsupported(spaced(container))).toEqual([]);
  });

  it("consolidated reasons for any input", () => {
    const text = toPatientReasons(REASONS).map((r) => `${r.observation}. ${r.suggestion}`).join("\n");
    expect(unsupported(text)).toEqual([]);
  });
});

/**
 * Source scan: no rendered string literal or JSX text under src/ (design-lab
 * previews included) may contain such a claim. Comments are stripped because
 * several explain the retired wording by quoting it.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}
function literals(raw: string): string {
  // Sentences are often split across `"..." +` lines; merge them first so a
  // scoped sentence is judged as a whole, not as two fragments.
  const src = raw.replace(/(["'`])\s*\+\s*\n\s*\1/g, "");
  const out: string[] = [];
  for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n]){12,})\1/g)) out.push(m[2]);
  for (const m of src.matchAll(/>([^<>{}]{14,})</g)) out.push(m[1]);
  // Wrapped JSX text lines: join them into one sentence stream.
  const lines = src.split("\n").filter((l) => /^\s{6,}[A-Za-z][^<>{}=;()]{15,}$/.test(l)).map((l) => l.trim());
  out.push(lines.join(" "));
  return out.map((s) => s.replace(/\s+/g, " ").trim()).join("\n");
}

const VERIFIED_BACKEND_TEMPLATE = "Reported symptoms have been logged for clinician review.";

describe("source scan", () => {
  const SRC = resolve(__dirname, "../../src");
  const files = walk(SRC).filter((f) => !/[\\/]types[\\/]/.test(f) && !/generated/.test(f));

  it("scans a meaningful number of files", () => expect(files.length).toBeGreaterThan(100));

  /** Surfaces written for clinicians, admins or workspace operators. */
  const CLINICIAN_SIDE = /[\x5c/]pages[\x5c/](?:clinician|admin|workspace)[\x5c/]|client\.(?:clinician|admin|platform)\.ts$|ReviewStatusBadge\.tsx$|[\x5c/]pages[\x5c/]patient[\x5c/]AiSummaryPanel\.tsx$|[\x5c/]components[\x5c/]ui[\x5c/](?:AIGeneratedLabel|MetricInterpretation)\.tsx$|[\x5c/]lib[\x5c/]constants\.ts$|[\x5c/]design-lab[\x5c/]/;

  it("no patient-facing file contains an extended unsupported claim in rendered text", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (CLINICIAN_SIDE.test(f)) continue;
      for (const s of unsupportedExtended(literals(stripComments(readFileSync(f, "utf8"))))) {
        // The scoper has to contain the backend's exact sentence in order to find it.
        if (/patientLanguage\.ts$/.test(f) && s === VERIFIED_BACKEND_TEMPLATE) continue;
        hits.push(`${relative(SRC, f)}: ${s.slice(0, 120)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("no source file contains an unsupported review/notification claim in rendered text", () => {
    const hits: string[] = [];
    for (const f of files) {
      // Clinician review-queue label, unused on any patient surface: "no decision
      // yet" there is the clinician's own worklist state, not a patient claim.
      if (/ReviewStatusBadge\.tsx$/.test(f)) continue;
      for (const s of unsupported(literals(stripComments(readFileSync(f, "utf8"))))) {
        hits.push(`${relative(SRC, f)}: ${s.slice(0, 110)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
