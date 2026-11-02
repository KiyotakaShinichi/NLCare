import type { PatientReport } from "../types/api";

/**
 * What this view can and cannot say about review and notification.
 *
 * The patient payload carries no field recording that anyone viewed the
 * record, was notified, or acknowledged anything. So the honest statement is
 * about the view, not about the world:
 *
 *   "This view does not provide notification status."
 *
 * Three earlier mistakes shaped this file:
 *   1. Concept 5.x hard-coded "No clinician has reviewed it, no one has been
 *      notified". That was a claim about events the frontend cannot see (the
 *      backend holds separate alert and delivery tables the patient payload
 *      never carries).
 *   2. Milestone 7 replaced it with a sentence derived from
 *      `genetic_counseling_readiness.review_notes[].reviewer_role`. A role
 *      string on a stored note is not a verified author, not a patient-release
 *      decision and not evidence that anyone reviewed the record, so authorship
 *      must never be read as review. Those notes are no longer used here.
 *   3. Treating the absence of a note as "nobody reviewed it" is the same
 *      error in the other direction.
 *
 * Clinician-attributed notes are deliberately not rendered on any patient
 * surface until the backend exposes an approved, server-enforced visibility
 * contract (author identity, audience, release authorisation). See
 * design-review/MILESTONE-7-1-REMEDIATION.md.
 */

export const NOTIFICATION_SCOPE_SENTENCE = "This view does not provide notification status.";

export const REVIEW_SCOPE_SENTENCE =
  "Nothing on this page shows whether a clinician has looked at your record.";

function isPending(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toLowerCase() === "pending";
}

/** Genetics entries whose own review-status field reads "pending". */
export function pendingReviewCount(report: PatientReport | null): number {
  const g = report?.genetic_counseling_readiness ?? null;
  return (
    (g?.family_history ?? []).filter((r) => isPending(r.review_status)).length +
    (g?.genetic_test_records ?? []).filter((r) => isPending(r.clinician_review_status)).length +
    (g?.biomarker_records ?? []).filter((r) => isPending(r.review_status)).length +
    (g?.tumor_marker_records ?? []).filter((r) => isPending(r.review_status)).length
  );
}

/** The "Review and notification status" statement. */
export function reviewStatusSentence(pendingCount: number): string {
  const parts = [`${REVIEW_SCOPE_SENTENCE} ${NOTIFICATION_SCOPE_SENTENCE}`];
  if (pendingCount > 0) {
    parts.push(
      `${pendingCount === 1 ? "One genetics entry has" : `${pendingCount} genetics entries have`} a review-status field that reads "pending".`,
    );
  }
  return parts.join(" ");
}
