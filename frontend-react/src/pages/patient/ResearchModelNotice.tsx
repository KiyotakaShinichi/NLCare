import { Info } from "lucide-react";
import { SectionCard } from "../../components/ui/SectionCard";
import { RESEARCH_MODEL_ABSENCE, RESEARCH_MODEL_LEDE } from "../../lib/patientLanguage";

/**
 * Stands where the research-model card used to be on the legacy Overview.
 *
 * The models are synthetic, not validated, and (for the toxicity head)
 * explicitly uncalibrated, so no individual score, class label or confidence is
 * shown to a patient. The notice also says what the absence does not mean, so
 * a missing card is not read as a clean bill of health. The Concept 5.2
 * Overview carries the same wording from the same constants.
 */
export function ResearchModelNotice() {
  return (
    <SectionCard title="Research model outputs" icon={Info}>
      <p className="text-[0.82rem] leading-relaxed" style={{ color: "var(--text)" }}>
        {RESEARCH_MODEL_LEDE}
      </p>
      <p className="text-[0.82rem] leading-relaxed mt-2" style={{ color: "var(--text)" }}>
        {RESEARCH_MODEL_ABSENCE}
      </p>
    </SectionCard>
  );
}
