import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, PlusCircle } from "lucide-react";
import type { PatientReport } from "../../types/api";

interface Props {
  report: PatientReport;
  patientId: string | null;
  /** Shown between the identity and the two actions. */
  children?: ReactNode;
}

/**
 * Compact identity header for the patient overview.
 *
 * Replaces the tall banner the overview used to open with: a greeting block,
 * a paragraph of explanation and a row of chips took roughly 180px before any
 * record appeared. This states who the record belongs to and offers the two
 * things a patient actually comes to do, in about 80px.
 *
 * "Ask about your record" is the page's single primary action and goes to the
 * same support chat the tab bar switches to; the tab bar remains the way back.
 */
export function OverviewHeader({ report, patientId, children }: Props) {
  // Same three facts the banner surfaced, read from the same fields.
  const profile = report.breast_cancer_profile;
  const facts = [
    report.diagnosis || null,
    profile?.cancer_stage || null,
    profile?.molecular_subtype || null,
  ].filter(Boolean) as string[];

  return (
    <header className="po-header">
      <div className="po-header-id">
        <p className="po-eyebrow">
          {/* The demo record's name is often already "Patient P001", so the id
              is only appended when it adds something. */}
          {[
            report.patient_name || (patientId ? `Patient ${patientId}` : null),
            patientId && !(report.patient_name ?? "").includes(patientId)
              ? `Patient ${patientId}`
              : null,
            "synthetic demo session",
          ].filter(Boolean).join(" · ")}
        </p>
        <h1 className="po-display">Your monitoring record</h1>
        {facts.length > 0 && (
          <div className="po-facts">
            {facts.map((f) => (
              <span className="po-fact" key={f}>{f}</span>
            ))}
          </div>
        )}
      </div>
      {children}
      <div className="po-actions">
        <Link to="/patient/chat" className="po-cta-quiet">
          <PlusCircle size={17} aria-hidden="true" />
          Log how you feel
        </Link>
        <Link to="/patient/chat" className="po-cta">
          <MessageSquare size={17} aria-hidden="true" />
          Ask about your record
        </Link>
      </div>
    </header>
  );
}
