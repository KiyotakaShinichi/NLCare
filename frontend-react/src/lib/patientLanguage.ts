import { consolidateText, type RepeatedText } from "./recordIntegrity";
import type { PatientReport } from "../types/api";

/**
 * Putting clinician-written text into a patient surface without lying to them.
 *
 * `ai_summary.review_reasons` is written for a clinician reading a chart. It
 * says things like "Medical review is recommended", "Oncology review is
 * recommended, especially during active chemotherapy" and "Clinical review may
 * be needed". Rendered verbatim on the patient's own page those read as the
 * outcome of a review process, directly above a banner stating that no
 * clinician has looked at any of it. The two cannot both be true for the
 * reader, and the one that sounds authoritative wins.
 *
 * This module does not suppress anything and does not soften what was flagged.
 * Every reason is shown, the measurement in it is left exactly as written, and
 * the item is never dropped. What changes is the frame: the clinician-directed
 * instruction clause is separated from the observation, restated as something
 * the patient can act on (raise it with your team), and marked as automatic.
 *
 * Nothing here asserts that anyone has or has not reviewed, been told of or
 * been sent an item. The patient payload carries no such field, so the wording
 * is scoped to the view: "This view does not provide notification status."
 *
 * Escalation is untouched. This is presentation of text the backend already
 * decided to emit; it changes no backend safety decision, no threshold and no
 * routing. Where a reason carries urgent wording, that urgency is kept and made
 * more actionable, not less.
 */

export type ReasonUrgency = "urgent" | "standard";

export interface PatientReason {
  /** The observation, with its measurement, as the backend wrote it. */
  observation: string;
  /** What the patient can do, in the second person. Never a claim about review. */
  suggestion: string;
  /** Kept so the original wording is always recoverable and auditable. */
  source: string;
  urgency: ReasonUrgency;
  /** How many times the backend emitted this exact sentence. */
  occurrences: number;
}

/**
 * Clauses that assert a clinical review process. Each is removed from the
 * observation and answered by an explicit suggestion instead, so nothing is
 * lost - the instruction is restated for the person actually reading it.
 */
const REVIEW_CLAUSES: { pattern: RegExp; urgency: ReasonUrgency }[] = [
  { pattern: /\s*Oncology review is recommended[^.]*\./i, urgency: "urgent" },
  { pattern: /\s*Urgent (?:clinical |medical )?review[^.]*\./i, urgency: "urgent" },
  { pattern: /\s*Medical review is recommended[^.]*\./i, urgency: "standard" },
  { pattern: /\s*Clinical review (?:may be|is) needed[^.]*\./i, urgency: "standard" },
  { pattern: /\s*Continue monitoring and review in clinical context\.?/i, urgency: "standard" },
  { pattern: /\s*This should be reviewed with the treatment timeline\.?/i, urgency: "standard" },
  { pattern: /\s*(?:Please )?consult(?: with)? your (?:doctor|clinician|care team)[^.]*\./i, urgency: "standard" },
];

const SUGGESTION = {
  urgent:
    "This one is worth raising with your care team soon rather than waiting for your next " +
    "appointment. This view does not provide notification status.",
  standard:
    "Worth bringing up at your next appointment. This view does not provide notification status.",
} as const;

/**
 * Split one backend reason into an observation and a patient-facing suggestion.
 *
 * A reason with no review clause keeps its full text as the observation and
 * still gets a suggestion, because the heading promises something to raise.
 */
export function toPatientReason(source: string, occurrences = 1): PatientReason {
  let observation = String(source).trim();
  let urgency: ReasonUrgency = "standard";
  let matched = false;

  for (const { pattern, urgency: level } of REVIEW_CLAUSES) {
    if (pattern.test(observation)) {
      observation = observation.replace(pattern, "").trim();
      matched = true;
      if (level === "urgent") urgency = "urgent";
    }
  }
  // A reason that was only an instruction leaves nothing behind; keep the
  // original rather than render an empty row.
  if (!observation) observation = String(source).trim();
  if (!matched) observation = String(source).trim();

  return {
    observation: observation.replace(/\s{2,}/g, " "),
    suggestion: SUGGESTION[urgency],
    source: String(source).trim(),
    urgency,
    occurrences,
  };
}

/**
 * The full set for a patient surface: identical sentences consolidated for
 * display, each reframed, urgent ones first so ordering never buries them.
 */
export function toPatientReasons(reasons: readonly string[]): PatientReason[] {
  const consolidated: RepeatedText[] = consolidateText(reasons);
  const mapped = consolidated.map((r) => toPatientReason(r.text, r.occurrences));
  const rank = (r: PatientReason) => (r.urgency === "urgent" ? 0 : 1);
  return [...mapped].sort((a, b) => rank(a) - rank(b));
}

/** Shown when the review list is empty, so an empty list is not read as good news. */
export const NO_RULE_MATCH_CAVEAT =
  "No current record item matched the portal's review rules. This is not reassurance about health or treatment response.";

/**
 * The server's own sentence for a monitoring signal it could not produce. Read
 * from the status field, not the wording, and only for "unavailable": other
 * statuses carry statements such as "No urgent ... flags are present".
 */
export function monitoringAbsenceCaveat(report: PatientReport | null | undefined): string | null {
  const signal = report?.multimodal_assessment?.signals?.clinical_monitoring;
  return signal?.status === "unavailable" && signal.message ? signal.message : null;
}

/** The standing sentence under any list of automatic prompts. */
export const AUTOMATIC_PROMPT_NOTE =
  "These were picked out automatically from the measurements in your record. They are prompts " +
  "for a conversation, not findings, and none of them is an assessment of your condition. This " +
  "view does not show whether anyone has reviewed them or been notified.";

/**
 * Backend-origin sentences that assert routing or delivery.
 *
 * `ai_summary.patient_explanation` is built by `_build_patient_explanation`
 * (backend/processing/clinical_summary.py). One of its fixed sentences says
 * "Reported symptoms have been logged for clinician review." The patient
 * payload has no field showing that anything was logged for, sent to or seen by
 * a clinician, so on a patient surface that one sentence is restated as what the
 * record supports: the symptoms were recorded.
 *
 * Deliberately narrow. This does NOT pattern-match routing language in general:
 * the same field can carry LLM-written text, and a broad rewrite of arbitrary
 * clinical wording ("sent to the clinical laboratory") corrupts its meaning. Only
 * the verified template sentences below are replaced, by exact match. Anything
 * else is left as written, and the surface carries a standing scope note
 * (`PATIENT_SUMMARY_SCOPE_NOTE`) saying this view cannot show who has seen it.
 *
 * Presentation only. The authoritative fix is in the backend template. Clinician
 * surfaces must not use this; they show the text as written.
 */
const VERIFIED_UNSUPPORTED_TEMPLATES: ReadonlyArray<{ sentence: string; replacement: string }> = [
  {
    sentence: "Reported symptoms have been logged for clinician review.",
    replacement: "Reported symptoms have been recorded.",
  },
];

const normalise = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

export function scopeBackendClaims(text: string): string {
  let out = String(text);
  for (const { sentence, replacement } of VERIFIED_UNSUPPORTED_TEMPLATES) {
    // Anchored to a sentence boundary so a clause at the end of a longer sentence is never touched.
    const body = sentence.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const pattern = new RegExp(`(?<=^|[.!?]\\s+)${body}`, "gi");
    out = out.replace(pattern, (m) => (normalise(m) === normalise(sentence) ? replacement : m));
  }
  return out;
}

/** Standing note under an automatic summary shown to a patient. */
export const PATIENT_SUMMARY_SCOPE_NOTE =
  "This summary is generated automatically. This view does not show whether anyone has reviewed it or been notified of anything in it.";

/** The shell's monitoring-only statement, as the sidebar has always worded it. */
export const MONITORING_BOUNDARY = "Monitoring support only. Not for diagnosis or treatment decisions.";

/** Who has seen this record: nothing on the page can say. */
export const OWN_RECORD_NOTE =
  "This is your own record. This page does not show whether anyone on your care team has seen it.";

/** Shared with the Concept 5.2 Overview: how a chart treats rows that disagree. */
export const CONFLICT_CHART_NOTE =
  "The chart draws every row, so that date shows all of the values together; no single value has been selected as the measurement, none has been averaged, and nothing in the record has been changed. Ask your care team which value is correct.";

export const REPEATED_RATINGS_NOTE = "Every rating is plotted. None has been averaged away or removed.";

/** What record coverage is, and is not. */
export const RECORD_COVERAGE_SCOPE = "This does not measure health or clinical completeness.";

/** The portal's existing next steps, including its caveat on treatment decisions. */
export const SAFE_NEXT_STEPS = [
  "Check that recent symptoms, CBC values, medications, and imaging dates are complete.",
  "Review the queue and prepare questions about its record items for your care team.",
  "Use NLCare to add missing records; do not change treatment based on portal indicators.",
] as const;

/**
 * Why a patient Overview shows no research-model output, and what the absence
 * does not mean. Shared by both Overview variants so they cannot drift apart.
 */
export const RESEARCH_MODEL_LEDE =
  "NLCare includes synthetic research models. They have not been validated, and their scores are not calibrated against real outcomes, so nothing they produce is a finding about you. This view does not show them.";

export const RESEARCH_MODEL_ABSENCE =
  "Model outputs are kept out of this view. Not seeing a score here does not mean there is no risk, and your record above is unaffected by whether a model has run. If something feels wrong, contact your care team.";
