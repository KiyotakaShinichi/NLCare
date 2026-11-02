import { ListChecks } from "lucide-react";
import { SectionCard } from "../../../components/ui/SectionCard";
import { AUTOMATIC_PROMPT_NOTE, NO_RULE_MATCH_CAVEAT } from "../../../lib/patientLanguage";
import { consolidateText, type RepeatedText } from "../../../lib/recordIntegrity";

/**
 * Sorted only by what a sentence is about, read from how it starts, so a long
 * list can be scanned. Nothing here reads what a sentence asks for, and a group
 * says nothing about priority. Anything unrecognised is listed under the last group.
 */
const GROUPS: { title: string; holds: (text: string) => boolean }[] = [
  { title: "Blood tests", holds: (text) => /^(WBC|Hemoglobin|Platelets|CBC)\b/.test(text) },
  { title: "Symptoms you reported", holds: (text) => /^Patient-reported\b/.test(text) },
  { title: "Other record items", holds: () => true },
];

function grouped(items: RepeatedText[]) {
  const left = [...items];
  return GROUPS.map(({ title, holds }) => {
    const mine = left.filter((item) => holds(item.text));
    for (const item of mine) left.splice(left.indexOf(item), 1);
    return { title, items: mine };
  }).filter((group) => group.items.length > 0);
}

/**
 * The review queue, as the backend wrote it.
 *
 * `toPatientReasons` is deliberately not used here. It removes each instruction
 * clause, derives urgency from the wording and reorders by it, and the backend
 * sends no structured urgency to check that against. So each sentence is shown
 * whole, which keeps whatever it asks for. Every item is listed, because no
 * ranking exists that could safely decide which ones to fold away.
 */
export function ReviewItems({ reasons }: { reasons: readonly string[] }) {
  const items = consolidateText(reasons);
  return (
    <SectionCard
      title="Review queue"
      icon={ListChecks}
      meta={items.length === 0 ? "No items" : `${items.length} ${items.length === 1 ? "item" : "items"}`}
    >
      {items.length === 0 ? (
        <>
          <p className="pc-body">No review items are listed for your record.</p>
          <p className="pc-note">{NO_RULE_MATCH_CAVEAT}</p>
        </>
      ) : (
        <>
          {grouped(items).map((group) => (
            <div key={group.title} className="pc-review-group">
              <h3 className="pc-h3">{group.title}</h3>
              <ul className="pc-review-list">
                {group.items.map((item) => (
                  <li key={item.text}>
                    {item.text}
                    {item.occurrences > 1 && (
                      <span className="pc-review-count">Flagged {item.occurrences} times in your record.</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="pc-note pc-review-note">{AUTOMATIC_PROMPT_NOTE}</p>
        </>
      )}
    </SectionCard>
  );
}
