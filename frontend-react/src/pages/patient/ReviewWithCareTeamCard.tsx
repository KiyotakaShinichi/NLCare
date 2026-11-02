import { AlertTriangle, Activity, FlaskConical, Brain, ListChecks } from "lucide-react";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { SectionCard } from "../../components/ui/SectionCard";
import type { AiSummary, PatientReport } from "../../types/api";
import { toPatientReasons, AUTOMATIC_PROMPT_NOTE, NO_RULE_MATCH_CAVEAT } from "../../lib/patientLanguage";

interface Props {
  summary: AiSummary | null;
  /** Optional report — reserved for future categorisation that needs lab/symptom
   *  context.  Currently only the AI summary's review_reasons are rendered, but
   *  the prop is part of the API so the dashboard can stop passing it later. */
  report?: PatientReport | null;
}

type Category = "labs" | "symptoms" | "ai_flag" | "general";

const CATEGORY_META: Record<Category, { label: string; icon: LucideIcon; tone: { bg: string; fg: string } }> = {
  labs:      { label: "labs",     icon: FlaskConical, tone: { bg: "#dbeafe",         fg: "#1e3a8a" } },
  symptoms:  { label: "symptoms", icon: Activity,     tone: { bg: "#fef3c7",         fg: "#92400e" } },
  ai_flag:   { label: "AI flag",  icon: Brain,        tone: { bg: "var(--rose-pale)",fg: "var(--rose-deep)" } },
  general:   { label: "review",   icon: AlertTriangle,tone: { bg: "var(--surface2)", fg: "var(--text-dim)" } },
};

function categorise(reason: string): Category {
  const r = reason.toLowerCase();
  if (/wbc|hgb|hemoglobin|platelet|cbc|lab|count|neutroph/i.test(r)) return "labs";
  if (/symptom|fever|pain|nausea|fatigue|mouth sore|severity/i.test(r)) return "symptoms";
  if (/ai|model|signal|hybrid|prediction|score|response/i.test(r)) return "ai_flag";
  return "general";
}

/**
 * The queue is read by the patient, so the text is reframed for them.
 *
 * The backend writes these for a clinician - "Medical review is recommended",
 * "Oncology review is recommended, especially during active chemotherapy" -
 * and rendering them verbatim on a patient's own page reads as the outcome of
 * a review that has not happened, directly under a banner saying no clinician
 * has seen any of it. `toPatientReasons` keeps every item and every
 * measurement, separates the instruction clause from the observation, and
 * restates it as something the reader can act on. Nothing is suppressed and
 * urgent items sort first.
 */
export function ReviewWithCareTeamCard({ summary }: Props) {
  const reasons = toPatientReasons(summary?.review_reasons ?? []);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? reasons : reasons.slice(0, 3);
  const hiddenCount = Math.max(0, reasons.length - visible.length);

  // Distinct category chips that appear in the queue, in stable order.
  const categoriesUsed: Category[] = [];
  for (const r of reasons) {
    const c = categorise(r.source);
    if (!categoriesUsed.includes(c)) categoriesUsed.push(c);
  }

  return (
    <SectionCard
      title="Review queue"
      icon={ListChecks}
      meta={reasons.length > 0 ? `${reasons.length} item${reasons.length === 1 ? "" : "s"}` : "all clear"}
      footer={
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle size={11} aria-hidden="true" />
          For your next care-team visit — not urgent alerts.
        </span>
      }
    >
      {reasons.length === 0 ? (
        <>
          <p className="review-empty">Nothing flagged today.</p>
          <p className="review-automatic-note">{NO_RULE_MATCH_CAVEAT}</p>
        </>
      ) : (
        <>
          {categoriesUsed.length > 0 && (
            <ul className="review-categories" aria-label="Categories in queue">
              {categoriesUsed.map((c) => {
                const meta = CATEGORY_META[c];
                const Icon = meta.icon;
                return (
                  <li
                    key={c}
                    className="review-category"
                    style={{ background: meta.tone.bg, color: meta.tone.fg }}
                  >
                    <Icon size={11} aria-hidden="true" />
                    <span>{meta.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <ul className="review-list">
            {visible.map((r, i) => {
              const meta = CATEGORY_META[categorise(r.source)];
              return (
                <li key={r.source} className="review-list-row">
                  <span
                    className="review-list-index"
                    aria-hidden="true"
                    style={{ background: meta.tone.bg, color: meta.tone.fg }}
                  >
                    {i + 1}
                  </span>
                  <span className="review-list-text">
                    {r.observation}
                    <span className="review-list-suggestion">
                      {r.suggestion}
                      {r.occurrences > 1 && ` Flagged ${r.occurrences} times in your record.`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="review-automatic-note">{AUTOMATIC_PROMPT_NOTE}</p>
          {(hiddenCount > 0 || expanded) && (
            <button
              type="button"
              className="review-view-all"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? "Show top 3 only" : `View all ${reasons.length} items`}
            </button>
          )}
        </>
      )}
    </SectionCard>
  );
}
