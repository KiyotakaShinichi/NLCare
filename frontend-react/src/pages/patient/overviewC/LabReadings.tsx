import { GapNotes, LabTrendPlot } from "../../../components/charts/LabTrendsChart";
import { buildLabSeries, type LabSeries } from "../../../components/charts/labSeries";
import { LabCard } from "../../../components/ui/LabCard";
import { EmptyPane } from "../../../components/ui/Spinner";
import { NON_DIAGNOSTIC_DISCLAIMER } from "../../../lib/clinical-constants";
import { CONFLICT_CHART_NOTE } from "../../../lib/patientLanguage";
import { describeConflict, findConflicts, summariseRecords } from "../../../lib/recordIntegrity";
import type { LabHistoryPoint, PatientReport } from "../../../types/api";

const ANALYTES = ["wbc", "hemoglobin", "platelets"] as const;
const LAB_NAMES = { wbc: <span>White blood cells (<span>WBC</span>)</span>, hemoglobin: undefined, platelets: undefined };

const fullDate = (date: string) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? date.slice(0, 10)
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/**
 * Every measurement of one test, newest first. Rows that disagree on a date are
 * all kept; only identical rows are counted together, and the last column appears
 * when that has happened.
 */
function MeasurementsTable({ series }: { series: LabSeries }) {
  const rows = new Map<string, { date: string; value: number | null; count: number }>();
  for (const point of series.points) {
    const id = `${point.date}|${point.value}`;
    const row = rows.get(id);
    if (row) row.count += 1;
    else rows.set(id, { date: point.date, value: point.value, count: 1 });
  }
  const list = [...rows.values()].reverse();
  const repeated = list.some((row) => row.count > 1);
  return (
    <details className="pc-details">
      <summary>View measurements as a table</summary>
      <div className="pc-table-scroll" tabIndex={0} role="region" aria-label={`${series.label} measurements, scrollable sideways`}>
        <table className="pc-lab-table">
          <caption className="sr-only">{series.label} results by date, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">{series.unit}</th>
              {repeated && <th scope="col">Rows recorded</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((row) => (
              <tr key={`${row.date}|${row.value}`}>
                <th scope="row">{fullDate(row.date)}</th>
                <td>{row.value ?? <span className="lab-trend-missing">not measured</span>}</td>
                {repeated && <td>{row.count}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * One card per test: its reading, its line and its table together. Readings,
 * status and ranges come from LabCard, and the line from the same plot as the
 * other Overview, so nothing is reinterpreted here.
 */
export function LabReadings({ report, history, latestLabDate }: {
  report: PatientReport;
  history: LabHistoryPoint[];
  latestLabDate: string | null;
}) {
  const series = buildLabSeries(history);
  const results = summariseRecords(history, (p) => p.date).distinct.length;

  return (
    <>
      <p className="pc-meta pc-meta--under-heading">
        {results > 0
          ? `${results} ${results === 1 ? "result" : "results"}${latestLabDate ? ` · latest sample ${fullDate(latestLabDate)}` : ""}`
          : "No results in this period"}
      </p>
      <p className="pc-meta">
        A complete blood count (CBC) measures white blood cells, hemoglobin and platelets.
        K/uL means thousands per microliter of blood.
      </p>
      <div className="pc-labs">
        {ANALYTES.map((key) => {
          const line = series.find((s) => s.key === key);
          const conflicts = line ? findConflicts(history, (p) => p.date, () => line.label, (p) => p[key]) : [];
          return (
            <LabCard
              key={key}
              labKey={key}
              label={LAB_NAMES[key]}
              value={report.latest_labs?.[key] ?? null}
              history={history.map((p) => ({ date: p.date, value: p[key] }))}
            >
              {line && line.observed > 0 && (
                <div className="pc-lab-plot">
                  <LabTrendPlot series={line} height={190} tickSize={13} tableHint="The table under this chart lists every value." />
                  {conflicts.map((c) => (
                    <details key={c.day} className="pc-details pc-question">
                      <summary>Unresolved: {c.measure} on {c.day} has conflicting values</summary>
                      <p>{describeConflict(c, line.unit)} {CONFLICT_CHART_NOTE}</p>
                    </details>
                  ))}
                  <MeasurementsTable series={line} />
                </div>
              )}
            </LabCard>
          );
        })}
      </div>
      {history.length === 0 && <EmptyPane label="No lab history recorded yet" />}
      {history.length > 0 && <GapNotes series={series} />}
      <p className="pc-meta">
        Reference ranges shown are population defaults, not personalised to you.{" "}
        {NON_DIAGNOSTIC_DISCLAIMER}
      </p>
    </>
  );
}
