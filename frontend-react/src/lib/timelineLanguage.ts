import type { TimelineEvent } from "../types/api";

/** "Risk flag: low_platelets" -> "Automated flag: low platelets". */
export function readableEventTitle(e: TimelineEvent): string {
  const title = String(e.title ?? "");
  if (e.type === "ai_risk_flag") {
    return `Automated flag: ${title.replace(/^Risk flag:\s*/i, "").replace(/_/g, " ")}`;
  }
  return title;
}
