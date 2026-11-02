import type * as Api from "../types/api";
import { ApiError, BASE, del, get, getToken, isAmbiguousHttpStatus, post, reportRequestFailure, responseError } from "./client.transport";


export const getMyReport = () => get<Api.PatientReport>("/me/patient-report");

export const getMyReportCore = () => get<Api.PatientReport>("/me/patient-report/core");

export const getMyReportEnrichment = () =>
  get<Partial<Api.PatientReport>>("/me/patient-report/enrichment");

export const getMyChatHistory = () =>
  get<{ patient_id: string; messages: import("../types/api").ChatMessage[] }>("/me/chat");

export const sendMyChat = async (message: string): Promise<Api.ChatResponse> => {
  try {
    return await post<Api.ChatResponse>("/me/chat", { message });
  } catch (error) {
    throw classifyChatFailure(error);
  }
};

export const undoMyConfirmedRecordWrite = (auditId: number) =>
  del<{ message: string; action: import("../types/api").SavedAction }>(`/me/record-write-actions/${auditId}`);

/**
 * Shown whenever a chat turn fails in a way that leaves the result unknown.
 *
 * Aborting `fetch` only disconnects this browser. The server keeps working
 * (Starlette cannot interrupt the synchronous pipeline) and a confirmed record
 * write has been observed to persist 64 s after the 45 s abort. So a timeout
 * or a dropped connection is neither "saved" nor "not saved".
 */
export const OUTCOME_UNKNOWN_MESSAGE =
  "We couldn't confirm whether this action completed. Please check your records before trying again.";

export class OutcomeUnknownError extends Error {
  readonly outcomeUnknown = true as const;

  constructor(options?: { cause?: unknown }) {
    super(OUTCOME_UNKNOWN_MESSAGE, options);
    this.name = "OutcomeUnknownError";
  }
}

export function isOutcomeUnknown(error: unknown): error is OutcomeUnknownError {
  return error instanceof OutcomeUnknownError;
}

export async function sendMyChatStream(
  message: string,
  handlers: Api.ChatStreamHandlers = {},
): Promise<Api.ChatResponse> {
  return streamChat("/me/chat/stream", message, handlers);
}

async function streamChat(
  path: string,
  message: string,
  handlers: Api.ChatStreamHandlers,
): Promise<Api.ChatResponse> {
  const token = getToken();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-NLCare-Data-Class": "synthetic",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw await responseError(res);
    }
    // Accepted, but nothing to read: the server may still be running the turn.
    if (!res.body) throw new OutcomeUnknownError();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalAnswer: Api.ChatResponse | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const eventBlock of events) {
        const event = parseSseEvent(eventBlock);
        if (!event) continue;
        if (event.name === "pipeline_stage") {
          handlers.onStage?.(String(event.data?.label ?? ""));
        } else if (event.name === "answer_delta") {
          handlers.onDelta?.(String(event.data?.text ?? ""));
        } else if (event.name === "answer") {
          finalAnswer = {
            reply: String(event.data?.reply ?? ""),
            saved_actions: Array.isArray(event.data?.saved_actions) ? event.data.saved_actions : [],
            citations: normalizeCitationLabels(event.data?.citations),
            assistant_message_id:
              typeof event.data?.assistant_message_id === "string" || typeof event.data?.assistant_message_id === "number"
                ? event.data.assistant_message_id
                : undefined,
          };
        } else if (event.name === "error") {
          // The pipeline had started - it may have committed a write before
          // failing - so this is not a refusal. The server's wording is kept
          // as the cause for telemetry only.
          throw new OutcomeUnknownError({ cause: new Error(String(event.data?.error ?? "Streaming chat failed")) });
        }
      }
    }

    if (!finalAnswer) {
      // The server accepted the request and then closed without a final
      // answer. It may still have finished the work.
      throw new OutcomeUnknownError();
    }
    return finalAnswer;
  } catch (error) {
    const failure = classifyChatFailure(error);
    // The stream bypasses `request`, so it reports for itself. The chat
    // message is a patient's own words and is never attached.
    // Telemetry records the HTTP status that actually came back, not the fixed
    // message the patient is shown in its place.
    const cause = failure instanceof OutcomeUnknownError ? failure.cause : undefined;
    reportRequestFailure(cause instanceof ApiError ? cause : failure, { method: "POST", path, surface: "api.stream" });
    throw failure;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Decide what a failed chat turn proves.
 *
 * A 4xx is the server declining the request before it did anything: it passes
 * through as a definite, sanitised `ApiError`. Everything else leaves the
 * outcome open, because the backend runs the turn synchronously and keeps going
 * after a client or a reverse proxy has given up on it:
 *
 *  - 408 and any 5xx. A proxy's 502/503/504 only says the proxy stopped
 *    waiting; even a 500 from the application can be raised after the write was
 *    committed (cache invalidation, logging).
 *  - an abort, a failed or dropped connection.
 *
 * None of these may be shown as "not saved", retried, or answered with another
 * Confirm.
 */
function classifyChatFailure(error: unknown): unknown {
  if (error instanceof OutcomeUnknownError) return error;
  if (error instanceof ApiError) {
    return isAmbiguousHttpStatus(error.status) ? new OutcomeUnknownError({ cause: error }) : error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new OutcomeUnknownError({ cause: error });
  }
  if (error instanceof TypeError) return new OutcomeUnknownError({ cause: error });
  return error;
}

function parseSseEvent(block: string): { name: string; data: Record<string, unknown> } | null {
  const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
  const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
  if (!eventLine || !dataLine) return null;
  try {
    return {
      name: eventLine.replace("event:", "").trim(),
      data: JSON.parse(dataLine.replace("data:", "").trim()),
    };
  } catch {
    return null;
  }
}

function normalizeCitationLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const source = item as { title?: unknown; source_name?: unknown; id?: unknown };
        return String(source.title ?? source.source_name ?? source.id ?? "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

export const submitFeedback = (payload: {
  chat_message_id?: string;
  rating: number;
  thumbs_up: boolean;
  feedback_text: string;
}) => post<{ message: string }>("/me/agent-feedback", payload);

export const uploadFile = (payload: {
  upload_type: string;
  file_name: string;
  content_type: string;
  content_base64: string;
  notes: string;
  scan_date?: string;
}) => post<{ message: string; upload: unknown }>("/me/uploads", payload);

/**
 * Patient-scoped symptom save (manual-entry form).  Mirrors POST /me/symptoms
 * on the backend.  Date is yyyy-mm-dd.  ``urgent_flag`` is the explicit
 * patient-set checkbox; the backend folds it into the notes column with an
 * `[urgent flag]` tag so the existing review queue picks it up — it does
 * NOT auto-trigger any safety routing on its own.
 */
export interface AddMySymptomPayload {
  date: string;
  symptom: string;
  severity: number;
  notes?: string;
  duration?: string;
  urgent_flag?: boolean;
}

export interface AddMySymptomResponse {
  message: string;
  symptom_id: number;
  validation_warnings: { field: string; level: string; message: string }[];
  urgent_flag: boolean;
  ctcae_review_hint?: {
    schema_version: string;
    patient_severity: number;
    patient_severity_bucket: string;
    ctcae_hint: string;
    urgent_review: boolean;
    red_flag_terms: string[];
    review_focus: string[];
    claim_boundary: string;
  };
  safety_note: string;
}

export const addMySymptom = (payload: AddMySymptomPayload) =>
  post<AddMySymptomResponse>("/me/symptoms", payload);

// ─── Patient-scoped tool saves ───────────────────────────────────────────────

export interface AddMyLabPayload {
  date: string;
  wbc: number;
  hemoglobin: number;
  platelets: number;
  anc?: number;
  lab_source?: string;
  notes?: string;
}

export interface AddMyLabResponse {
  message: string;
  lab_id: number;
  validation_warnings: { field: string; level: string; message: string }[];
  reference_context?: {
    schema_version: string;
    demographics_used: Record<string, unknown>;
    context_type: string;
    labs: Record<string, {
      value: number;
      unit: string;
      reference_range: { low: number; high: number };
      status: string;
      range_source: string;
    }>;
    limitations: string[];
    claim_boundary: string;
  };
  safety_note: string;
}

export const addMyLab = (payload: AddMyLabPayload) =>
  post<AddMyLabResponse>("/me/labs", payload);

export interface AddMyImagingReportPayload {
  date: string;
  modality: string;          // MRI / CT / Ultrasound / Mammogram / Other
  report_type?: string;
  body_site?: string;
  findings?: string;
  impression?: string;
  notes?: string;
}

export interface AddMyImagingReportResponse {
  message: string;
  imaging_report_id: number;
  modality: string;
  validation_warnings: { field: string; level: string; message: string }[];
  safety_note: string;
}

export const addMyImagingReport = (payload: AddMyImagingReportPayload) =>
  post<AddMyImagingReportResponse>("/me/imaging-reports", payload);

export interface AddMyMedicationPayload {
  medication: string;
  dose?: string;
  frequency?: string;
  date: string;
  side_effects?: string;
  notes?: string;
}

export interface AddMyMedicationResponse {
  message: string;
  medication_id: number;
  safety_note: string;
  interaction_check?: {
    checker_version: string;
    status: string;
    flags: Array<{
      rule_id: string;
      severity: string;
      message: string;
      clinician_action: string;
      matched_trigger_terms?: string[];
      matched_context_terms?: string[];
    }>;
    claim_boundary: string;
  };
}

export const addMyMedication = (payload: AddMyMedicationPayload) =>
  post<AddMyMedicationResponse>("/me/medications", payload);

export interface AddMyTreatmentPayload {
  date: string;
  drug: string;
  cycle?: number;
  notes?: string;
}

export interface AddMyTreatmentResponse {
  message: string;
  treatment_id: number;
  validation_warnings: { field: string; level: string; message: string }[];
  safety_note: string;
}

export const addMyTreatment = (payload: AddMyTreatmentPayload) =>
  post<AddMyTreatmentResponse>("/me/treatments", payload);

export const getMyGeneticCounselingReadiness = () =>
  get<Api.GeneticCounselingReadiness>("/me/genetic-counseling-readiness");

export const addMyFamilyHistory = (payload: {
  relationship: string;
  family_side: string;
  cancer_type: string;
  age_at_diagnosis?: number | null;
  relative_status?: string | null;
  multiple_relatives_affected?: string | null;
  male_breast_cancer?: string | null;
  known_familial_mutation?: string | null;
  bilateral_breast_cancer?: string | null;
  multiple_primary_cancers?: string | null;
  ancestry_ethnicity?: string | null;
  prior_breast_biopsy_atypia?: string | null;
  relation_degree?: string | null;
  notes?: string | null;
}) => post<{ message: string; record: unknown; boundary_note: string }>("/me/family-history", payload);

export const addMyGeneticTestRecord = (payload: {
  test_type: string;
  sample_type: string;
  gene?: string | null;
  variant_text?: string | null;
  classification?: string | null;
  report_date?: string | null;
  lab_provider?: string | null;
  upload_reference?: string | null;
  reviewed_by_genetic_counselor?: string | null;
  notes?: string | null;
}) => post<{ message: string; record: unknown; boundary_note: string }>("/me/genetic-test-records", payload);

export const addMyBiomarkerRecord = (payload: {
  source: string;
  er_status?: string | null;
  pr_status?: string | null;
  her2_status?: string | null;
  ki67_percent?: number | null;
  grade?: string | null;
  stage?: string | null;
  report_date?: string | null;
  report_text?: string | null;
  upload_reference?: string | null;
}) => post<{ message: string; record: unknown; boundary_note: string }>("/me/biomarker-records", payload);

export const addMyTumorMarkerRecord = (payload: {
  marker: string;
  value: number;
  unit?: string | null;
  reference_range?: string | null;
  date_collected?: string | null;
  trend_direction?: string | null;
  notes?: string | null;
}) => post<{ message: string; record: unknown; boundary_note: string }>("/me/tumor-marker-records", payload);

// Clinician
