import { CheckCircle, Info, Activity, FlaskConical } from "lucide-react";
import { SectionCard } from "../../components/ui/SectionCard";
import { RelativeTime } from "../../components/ui/RelativeTime";
import type { AiSummary, PatientReport } from "../../types/api";
import { summariseRecords } from "../../lib/recordIntegrity";
import { PATIENT_SUMMARY_SCOPE_NOTE, monitoringAbsenceCaveat, scopeBackendClaims } from "../../lib/patientLanguage";

interface Props {
  summary: AiSummary | null;
  /** Optional report so the card can emit chips from labs/symptoms. */
  report?: PatientReport | null;
  lastFetchedAt?: number | null;
  /** Off leaves the summary sentence and its caveat, without the status chips. */
  showChips?: boolean;
}

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

type ChipTone = "good" | "watch" | "concern" | "neutral";

interface Chip {
  label: string;
  icon: typeof Activity;
  tone: ChipTone;
}

const CHIP_STYLE: Record<ChipTone, { bg: string; fg: string; border: string }> = {
  good:    { bg: "#ecfdf5",          fg: "#047857",          border: "#a7f3d0" },
  watch:   { bg: "#fffbeb",          fg: "#92400e",          border: "#fde68a" },
  concern: { bg: "#fef2f2",          fg: "#b91c1c",          border: "#fecaca" },
  neutral: { bg: "var(--surface2)",  fg: "var(--text-dim)",  border: "var(--border)" },
};

function buildChips(report: PatientReport | null | undefined): Chip[] {
  if (!report) return [];
  const chips: Chip[] = [];

  // CBC chip — lowest-of-three band.
  const labs = report.latest_labs;
  if (labs) {
    const wbcConcern = labs.wbc != null && labs.wbc < 2.0;
    const hgbConcern = labs.hemoglobin != null && labs.hemoglobin < 8.0;
    const pltConcern = labs.platelets != null && labs.platelets < 50;
    const wbcWatch   = labs.wbc != null && (labs.wbc < 4.0 || labs.wbc > 11.0);
    const hgbWatch   = labs.hemoglobin != null && labs.hemoglobin < 10.0;
    const pltWatch   = labs.platelets != null && (labs.platelets < 150 || labs.platelets > 450);
    const allMissing = labs.wbc == null && labs.hemoglobin == null && labs.platelets == null;

    if (allMissing) {
      chips.push({ label: "No CBC on file", icon: FlaskConical, tone: "neutral" });
    } else if (wbcConcern || hgbConcern || pltConcern) {
      chips.push({ label: "CBC below reference", icon: FlaskConical, tone: "concern" });
    } else if (wbcWatch || hgbWatch || pltWatch) {
      chips.push({ label: "CBC borderline", icon: FlaskConical, tone: "watch" });
    } else {
      chips.push({ label: "CBC within reference", icon: FlaskConical, tone: "good" });
    }
  }

  // Symptoms chip — top severity in the last 7d.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = (report.symptoms ?? []).filter((s) => {
    const t = Date.parse(s.date);
    return Number.isFinite(t) && t >= sevenDaysAgo;
  });
  // Distinct ratings, not rows: identical rows would otherwise be counted
  // separately in a chip the patient reads as "how much have I reported".
  const recentDistinct = summariseRecords(recent, (s) => s.date).distinct;
  if (recentDistinct.length === 0) {
    chips.push({ label: "No new symptoms", icon: Activity, tone: "good" });
  } else {
    const max = Math.max(...recentDistinct.map((s) => s.severity ?? 0));
    chips.push({
      label: `${recentDistinct.length} rating${recentDistinct.length === 1 ? "" : "s"} · top ${max}/10`,
      icon: Activity,
      tone: max >= 7 ? "concern" : max >= 4 ? "watch" : "good",
    });
  }

  // No research-model chip: "Favorable signal" / "Concerning signal" read as an
  // assessment of this patient, and the heads are not validated or calibrated.

  return chips.slice(0, 3);
}

function singleSentenceSummary(summary: AiSummary | null): string | null {
  // Backend-origin sentences such as "logged for clinician review" assert a
  // delivery this view cannot verify; scope them to what the record shows.
  const items = toArray(summary?.patient_explanation).map(scopeBackendClaims);
  if (items.length === 0) return null;
  // Take the first sentence of the first bullet so the card stays compact.
  const first = items[0];
  const sentenceEnd = first.search(/[.!?]\s|[.!?]$/);
  if (sentenceEnd > 0) return first.slice(0, sentenceEnd + 1).trim();
  return first.length > 180 ? first.slice(0, 180).trim() + "…" : first;
}

/**
 * "Today's summary" card on the patient overview.
 *
 * Compact KPI-style layout:
 *   - 2–3 signal chips (CBC band · symptoms · hybrid decision)
 *   - one-sentence patient-facing summary
 *   - timestamp + footer disclaimer
 *
 * Long paragraphs and full bullet lists do NOT live here anymore — those
 * are surfaced inside the Hybrid card and the Review queue.  This card
 * is meant to be glanceable.
 */
export function KeySignalsCard({ summary, report, lastFetchedAt, showChips = true }: Props) {
  const chips = showChips ? buildChips(report ?? null) : [];
  const sentence = singleSentenceSummary(summary);
  const caveat = monitoringAbsenceCaveat(report);
  return (
    <SectionCard
      title="Today's summary"
      icon={CheckCircle}
      meta={<RelativeTime timestamp={lastFetchedAt ?? null} prefix="updated" />}
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Info size={11} aria-hidden="true" />
          Not a diagnosis. {PATIENT_SUMMARY_SCOPE_NOTE}
        </span>
      }
    >
      {chips.length > 0 && (
        <ul className="today-summary-chips" aria-label="Signal chips">
          {chips.map((c) => {
            const Icon = c.icon;
            const style = CHIP_STYLE[c.tone];
            return (
              <li
                key={c.label}
                className="today-summary-chip"
                style={{ background: style.bg, borderColor: style.border, color: style.fg }}
              >
                <Icon size={12} aria-hidden="true" />
                <span>{c.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {sentence ? (
        <p className="today-summary-sentence">{sentence}</p>
      ) : (
        <p className="today-summary-sentence today-summary-sentence--empty">
          No AI summary yet — check back after your next clinic visit.
        </p>
      )}
      {caveat && <p className="today-summary-sentence">{caveat}</p>}
    </SectionCard>
  );
}
