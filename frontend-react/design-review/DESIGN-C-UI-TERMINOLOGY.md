# Design C: UI terminology and wording status

For clinical and product reviewers. **Nothing here is clinical approval.** "Provisional" means the product owner accepted the wording for continued development on 1 November 2026, and clinical review is still required before patient use.

Design C sits behind `VITE_PATIENT_OVERVIEW_C`, which is off by default.

## Provisionally accepted interface copy

These are interface words. None of them interprets a patient's result.

| Wording | Where | Note |
|---|---|---|
| "Blood tests", "Symptoms you reported", "Other record items" | Review queue group headings | Chosen from how a sentence starts. They say nothing about priority |
| "No review items are listed for your record." | Empty review queue | Always followed by the non-reassurance caveat below |
| "No items" | Review queue item count, when empty | Replaces "all clear" |
| "A complete blood count (CBC) measures white blood cells, hemoglobin and platelets. K/uL means thousands per microliter of blood." | Lab section | Backend sentences write the same unit as `x10^3/uL` |
| "White blood cells (WBC)" | Lab card name | Hemoglobin and Platelets are unchanged |
| "Automated flag: low platelets" | Timeline, replacing `Risk flag: low_platelets` | Display only. Backend title, type and badges are unchanged |
| "In your record", "Not in your record", "Not enough records yet" | Record coverage status | Map the backend's `available`, `missing` and `insufficient_data` |
| "N of M areas are in your record." | Record coverage count | Leaves out the backend's model row |
| "Each area of your record" | Record coverage disclosure | Opens by itself when an area is missing |

## Existing safety wording that Design C must keep

| Wording | Source |
|---|---|
| "No CBC trend is available, so the absence of flags cannot be interpreted as reassuring." | Backend, shown only when the monitoring status is `unavailable`, directly under the summary sentence |
| "No current record item matched the portal's review rules. This is not reassurance about health or treatment response." | `NO_RULE_MATCH_CAVEAT` |
| "Monitoring support only. Not for diagnosis or treatment decisions." | `MONITORING_BOUNDARY`, in the top bar at every screen size |
| "Use NLCare to add missing records; do not change treatment based on portal indicators." | `SAFE_NEXT_STEPS` |
| "Not seeing a score here does not mean there is no risk" | `RESEARCH_MODEL_ABSENCE` |

## Requires clinical review

1. **Staff-directed backend sentences, shown to patients exactly as written.** Examples: "CBC data is missing; clinician should review whether labs were skipped." and "Imaging/MRI data is missing; clinician should request follow-up imaging to complete response assessment." (`backend/processing/clinical_summary.py`). These must eventually become patient-facing without changing their clinical meaning or escalation timing. That rewording belongs to the backend, because the frontend cannot prove a rewrite keeps the meaning.
2. **Review instructions shown as written**, such as "Oncology review is recommended, especially during active chemotherapy." and "Clinical review may be needed." Design C keeps them whole so that nothing is downgraded. The note above says these are automatic prompts, and that the view cannot show whether anyone has reviewed them.
3. **Lab information text.** For example, "Low values can increase bleeding risk and should be reviewed by your care team." (`clinical-constants.ts`). It appears only when the patient opens the info button.
4. **Record coverage text from the backend.** It includes technical terms such as "toxicity summaries" and "Treatment-cycle alignment", and the summary "so the portal may be less confident. Your care team can still review the information you have entered."
5. **The "Unresolved" note on conflicting lab values.** It asks the patient to "Ask your care team which value is correct." The wording is reused from the Concept 5.2 Overview and has not had clinical review.
6. **Lab status chips such as "Low".** They compare values with population-default ranges. The page says the ranges are not personalised.

## Open question: the "AI-generated" badge

Timeline flags from the risk engine show an "AI-generated" badge. Evidence suggests this may not describe them accurately:

- `backend/processing/timeline.py` sets `ai_generated: True` on these events, while the same event states `"Source": "deterministic risk engine"` and notes that "Risk flags are deterministic monitoring signals".
- The frontend's `isAiFlagEvent` shows the badge when `ai_generated` is true or the event type is a risk flag.
- In Design C the title says "Automated flag" and the badge says "AI-generated", so the two now read differently.

The badge is unchanged. Backend provenance and classification should not be altered only to change a label, so this needs a decision on what `ai_generated` means. Until then, the page repeats the value it receives.

## Deliberately not used

- **Urgency labels or rankings**, including "Raise soon". Deferred until clinical definitions and an authoritative backend contract exist.
- **Appointment timing**, such as "Worth bringing up at your next appointment". The backend does not provide it.
- **Reference bands on trend charts**, and other unapproved colour-coded judgments.
- **"all clear", "Nothing flagged today", "not urgent alerts", and the green "No new symptoms" chip** in Design C. The flag-OFF Overview still shows them, so this wording remains a known issue in the fallback.
