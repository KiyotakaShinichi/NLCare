import { Dna, ShieldCheck } from "lucide-react";
import { SectionCard } from "../../components/ui/SectionCard";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyPane } from "../../components/ui/Spinner";
import {
  addMyBiomarkerRecord,
  addMyFamilyHistory,
  addMyGeneticTestRecord,
  addMyTumorMarkerRecord,
} from "../../api/client";
import type { GeneticCounselingReadiness } from "../../types/api";
import { useDraftOperation, useDraftState, type OperationStatus } from "../../lib/draftStore";
import "../../styles/genetics-form.css";

interface GeneticCounselingPanelProps {
  readiness?: GeneticCounselingReadiness | null;
  onSaved?: () => void;
  /** Default-collapse the body so the dashboard isn't a long form page.
   *  The readiness summary is still visible in the section header. */
  defaultCollapsed?: boolean;
}

export function GeneticCounselingPanel({ readiness, onSaved, defaultCollapsed = false }: GeneticCounselingPanelProps) {
  // Where each form's save stands lives in the patient-scoped draft store, not
  // in this component, so it survives leaving the page and coming back.
  const familyOp = useDraftOperation("genetics.family");
  const geneticOp = useDraftOperation("genetics.test");
  const biomarkerOp = useDraftOperation("genetics.biomarker");
  const markerOp = useDraftOperation("genetics.marker");
  const [family, setFamily] = useDraftState("genetics.family", {
    relationship: "mother",
    family_side: "maternal",
    cancer_type: "breast",
    age_at_diagnosis: "",
    notes: "",
  });
  const [genetic, setGenetic] = useDraftState("genetics.test", {
    test_type: "germline",
    sample_type: "blood",
    gene: "BRCA1",
    classification: "unknown",
    report_date: "",
    notes: "",
  });
  const [biomarker, setBiomarker] = useDraftState("genetics.biomarker", {
    source: "biopsy",
    er_status: "unknown",
    pr_status: "unknown",
    her2_status: "unknown",
    ki67_percent: "",
    report_date: "",
    report_text: "",
  });
  const [marker, setMarker] = useDraftState("genetics.marker", {
    marker: "CA 15-3",
    value: "",
    unit: "U/mL",
    date_collected: "",
    notes: "",
  });

  const summary = [
    { label: "Family history", value: (readiness?.family_history?.length ?? 0) > 0 },
    { label: "Genetic test record", value: (readiness?.genetic_test_records?.length ?? 0) > 0 },
    { label: "Biomarker/pathology", value: (readiness?.biomarker_records?.length ?? 0) > 0 },
    { label: "Tumor marker trends", value: (readiness?.tumor_marker_records?.length ?? 0) > 0 },
  ];

  type Op = ReturnType<typeof useDraftOperation>;

  /**
   * Sends one form. A second submission is refused while one is pending for the
   * same form, even if the panel was left and re-entered meanwhile. A failure is
   * recorded in the store and shown on that form, with the draft kept. On success
   * `reset` runs against the stored draft and clears only fields that have not
   * been edited since submission, so typing during a slow save is never lost. If
   * the patient signed out or changed, the store has dropped the operation and
   * the response is ignored.
   */
  async function submit<T>(op: Op, send: () => Promise<unknown>, reset: (current: T) => T) {
    const id = op.begin();
    if (id === null) return;
    try {
      await send();
      if (op.complete<T>(id, reset)) onSaved?.();
    } catch {
      op.fail(id);
    }
  }

  /** Clear a field only if it still holds exactly what was sent. */
  const unlessEdited = (now: string, sent: string): string => (now === sent ? "" : now);

  function saveFamily() {
    const sent = family;
    return submit<typeof family>(familyOp, () => addMyFamilyHistory({
      ...sent,
      age_at_diagnosis: sent.age_at_diagnosis ? Number(sent.age_at_diagnosis) : null,
      relative_status: "unknown",
      multiple_relatives_affected: "unknown",
      male_breast_cancer: "unknown",
      known_familial_mutation: "unknown",
    }), (f) => ({
      ...f,
      age_at_diagnosis: unlessEdited(f.age_at_diagnosis, sent.age_at_diagnosis),
      notes: unlessEdited(f.notes, sent.notes),
    }));
  }

  function saveGenetic() {
    const sent = genetic;
    return submit<typeof genetic>(geneticOp, () => addMyGeneticTestRecord({
      ...sent,
      report_date: sent.report_date || null,
      reviewed_by_genetic_counselor: "unknown",
    }), (g) => ({
      ...g,
      report_date: unlessEdited(g.report_date, sent.report_date),
      notes: unlessEdited(g.notes, sent.notes),
    }));
  }

  function saveBiomarker() {
    const sent = biomarker;
    return submit<typeof biomarker>(biomarkerOp, () => addMyBiomarkerRecord({
      ...sent,
      ki67_percent: sent.ki67_percent ? Number(sent.ki67_percent) : null,
      report_date: sent.report_date || null,
    }), (b) => ({
      ...b,
      ki67_percent: unlessEdited(b.ki67_percent, sent.ki67_percent),
      report_date: unlessEdited(b.report_date, sent.report_date),
      report_text: unlessEdited(b.report_text, sent.report_text),
    }));
  }

  function saveMarker() {
    const sent = marker;
    return submit<typeof marker>(markerOp, () => addMyTumorMarkerRecord({
      ...sent,
      value: Number(sent.value),
      date_collected: sent.date_collected || null,
      trend_direction: "unknown",
    }), (m) => ({
      ...m,
      value: unlessEdited(m.value, sent.value),
      date_collected: unlessEdited(m.date_collected, sent.date_collected),
      notes: unlessEdited(m.notes, sent.notes),
    }));
  }

  const loadingOf = (s: OperationStatus) => s === "pending";
  const failedOf = (s: OperationStatus) => s === "failed";

  return (
    <SectionCard
      title="Family and genetic counseling"
      icon={Dna}
      meta={readiness?.readiness_status?.replaceAll("_", " ") ?? "organize records"}
      collapsible
      collapseId="patient-genetic-counseling"
      defaultOpen={!defaultCollapsed}
      footer="This organizes family history, genetic-test, biomarker, and tumor-marker records. It is not genetic counseling, diagnosis, or treatment advice."
    >
      <div className="genetics-panel">
        <div className="genetics-summary-grid">
          {summary.map((item) => (
            <div className="genetics-summary-card" key={item.label}>
              <span>{item.label}</span>
              <Badge variant={item.value ? "green" : "muted"}>{item.value ? "recorded" : "not recorded"}</Badge>
            </div>
          ))}
        </div>

        {(readiness?.flags?.length ?? 0) > 0 && (
          <div className="genetics-callout">
            <ShieldCheck size={16} />
            <div>
              <strong>Review flags</strong>
              <p>{readiness!.flags.map((flag) => flag.replaceAll("_", " ")).join("; ")}</p>
            </div>
          </div>
        )}

        <div className="genetics-form-grid">
          <MiniForm title="Add family history" onSubmit={saveFamily} loading={loadingOf(familyOp.status)} error={failedOf(familyOp.status)}>
            <Select label="Relative" value={family.relationship} onChange={(v) => setFamily({ ...family, relationship: v })} options={["mother", "father", "sibling", "aunt", "uncle", "grandmother", "grandfather", "cousin", "other"]} />
            <Select label="Side" value={family.family_side} onChange={(v) => setFamily({ ...family, family_side: v })} options={["maternal", "paternal", "unknown"]} />
            <Select label="Cancer type" value={family.cancer_type} onChange={(v) => setFamily({ ...family, cancer_type: v })} options={["breast", "ovarian", "pancreatic", "prostate", "colon", "melanoma", "other", "unknown"]} />
            <Input label="Age at diagnosis" type="number" value={family.age_at_diagnosis} onChange={(v) => setFamily({ ...family, age_at_diagnosis: v })} />
            <Textarea label="Notes" value={family.notes} onChange={(v) => setFamily({ ...family, notes: v })} />
          </MiniForm>

          <MiniForm title="Add genetic test record" onSubmit={saveGenetic} loading={loadingOf(geneticOp.status)} error={failedOf(geneticOp.status)}>
            <Select label="Test type" value={genetic.test_type} onChange={(v) => setGenetic({ ...genetic, test_type: v })} options={["germline", "somatic", "tumor sequencing", "multigene panel", "BRCA-only", "unknown"]} />
            <Select label="Sample" value={genetic.sample_type} onChange={(v) => setGenetic({ ...genetic, sample_type: v })} options={["blood", "saliva", "tumor tissue", "unknown"]} />
            <Select label="Gene" value={genetic.gene} onChange={(v) => setGenetic({ ...genetic, gene: v })} options={["BRCA1", "BRCA2", "PALB2", "TP53", "PTEN", "CHEK2", "ATM", "other", "unknown"]} />
            <Select label="Classification" value={genetic.classification} onChange={(v) => setGenetic({ ...genetic, classification: v })} options={["pathogenic", "likely pathogenic", "VUS", "likely benign", "benign", "unknown"]} />
            <Input label="Report date" type="date" value={genetic.report_date} onChange={(v) => setGenetic({ ...genetic, report_date: v })} />
          </MiniForm>

          <MiniForm title="Add biomarker/pathology" onSubmit={saveBiomarker} loading={loadingOf(biomarkerOp.status)} error={failedOf(biomarkerOp.status)}>
            <Select label="Source" value={biomarker.source} onChange={(v) => setBiomarker({ ...biomarker, source: v })} options={["biopsy", "surgery pathology", "tumor sequencing", "liquid biopsy", "unknown"]} />
            <Select label="ER" value={biomarker.er_status} onChange={(v) => setBiomarker({ ...biomarker, er_status: v })} options={["positive", "negative", "low positive", "unknown"]} />
            <Select label="PR" value={biomarker.pr_status} onChange={(v) => setBiomarker({ ...biomarker, pr_status: v })} options={["positive", "negative", "low positive", "unknown"]} />
            <Select label="HER2" value={biomarker.her2_status} onChange={(v) => setBiomarker({ ...biomarker, her2_status: v })} options={["positive", "negative", "equivocal", "IHC 0", "IHC 1+", "IHC 2+", "IHC 3+", "FISH amplified", "FISH not amplified", "unknown"]} />
            <Input label="Ki-67 %" type="number" value={biomarker.ki67_percent} onChange={(v) => setBiomarker({ ...biomarker, ki67_percent: v })} />
          </MiniForm>

          <MiniForm title="Add tumor marker" onSubmit={saveMarker} loading={loadingOf(markerOp.status)} error={failedOf(markerOp.status)} disabled={!marker.value}>
            <Select label="Marker" value={marker.marker} onChange={(v) => setMarker({ ...marker, marker: v })} options={["CA 15-3", "CA 27.29", "CEA", "other"]} />
            <Input label="Value" type="number" value={marker.value} onChange={(v) => setMarker({ ...marker, value: v })} />
            <Input label="Unit" value={marker.unit} onChange={(v) => setMarker({ ...marker, unit: v })} />
            <Input label="Date collected" type="date" value={marker.date_collected} onChange={(v) => setMarker({ ...marker, date_collected: v })} />
            <Textarea label="Notes" value={marker.notes} onChange={(v) => setMarker({ ...marker, notes: v })} />
          </MiniForm>
        </div>

        <div className="genetics-lists">
          <RecordList
            title="Questions to ask your care team"
            items={readiness?.questions_to_ask ?? []}
            empty="No suggested questions yet."
          />
          <RecordList
            title="Missing data"
            items={readiness?.missing_data ?? []}
            empty="No missing-data warnings."
          />
        </div>
      </div>
    </SectionCard>
  );
}

function MiniForm({
  title,
  children,
  onSubmit,
  loading,
  disabled,
  error,
}: {
  title: string;
  children: React.ReactNode;
  onSubmit: () => Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  /** True when the last save of this form failed. */
  error?: boolean;
}) {
  return (
    <form
      className="genetics-mini-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <h3>{title}</h3>
      {children}
      {error && (
        <p role="alert" className="genetics-form-error">
          We couldn't save this entry. Your draft is kept, so nothing you typed is lost. Check the values and try again.
        </p>
      )}
      <Button size="sm" variant="primary" loading={loading} disabled={disabled}>
        Save entry
      </Button>
    </form>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="genetics-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="genetics-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="genetics-field genetics-field-wide">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={2} />
    </label>
  );
}

function RecordList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="genetics-record-list">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <EmptyPane label={empty} />
      ) : (
        <ul>
          {items.slice(0, 6).map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}
