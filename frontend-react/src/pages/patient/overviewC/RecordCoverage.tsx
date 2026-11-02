import { RECORD_COVERAGE_SCOPE, SAFE_NEXT_STEPS } from "../../../lib/patientLanguage";
import type { PatientReport } from "../../../types/api";

const STATUS_LABEL: Record<string, string> = {
  available: "In your record",
  missing: "Not in your record",
  insufficient_data: "Not enough records yet",
};

/**
 * Which parts of the record exist, with anything missing stated as missing. The
 * backend's row counts are not shown: they count identical rows, which the
 * figures above do not, so the two would disagree.
 *
 * The model row is left out, because a patient Overview says nothing about
 * research-model output. Matching its exact name and status is matching a
 * contract value, not interpreting wording.
 */
export function RecordCoverage({ report }: { report: PatientReport }) {
  const availability = report.data_availability;
  const items = (availability?.items ?? []).filter(
    (item) => item.name !== "Model signal" && item.status !== "model_unavailable",
  );
  const available = items.filter((item) => item.status === "available").length;

  return (
    <div className="pc-coverage">
      <h3 className="pc-h3">Record coverage</h3>
      {items.length === 0 ? (
        <p className="pc-body">Record coverage has not been assessed.</p>
      ) : (
        <>
          <p className="pc-body">
            <strong>{available} of {items.length}</strong> areas are in your record.{" "}
            {availability?.patient_friendly_summary}
          </p>
          <p className="pc-note">{RECORD_COVERAGE_SCOPE}</p>
          {/* Open when something is missing, so a gap is never folded away. */}
          <details className="pc-details" open={available < items.length}>
            <summary>Each area of your record</summary>
            <dl className="pc-coverage-list">
              {items.map((item) => (
                <div key={item.name}>
                  <dt>{item.name}</dt>
                  <dd>
                    {STATUS_LABEL[item.status] ?? item.status.replaceAll("_", " ")}
                    {item.status !== "available" && item.next_step && (
                      <span className="pc-coverage-next">{item.next_step}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}

      <h3 className="pc-h3">Safe next steps</h3>
      <ul className="pc-steps">
        {SAFE_NEXT_STEPS.map((step) => <li key={step}>{step}</li>)}
      </ul>
    </div>
  );
}
