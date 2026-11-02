import {
  LayoutDashboard, FlaskConical, Activity, Clock, MessageSquare, Dna } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/layout/AppShell";
import { useApi } from "../../hooks/useApi";
import { useReportEnrichment } from "../../hooks/useReportEnrichment";
import { readFileAsBase64 } from "../../lib/fileEncoding";
import { useChatOutcomeHold } from "./useChatOutcomeHold";
import { getMyReportCore, sendMyChat, sendMyChatStream, getMyChatHistory, undoMyConfirmedRecordWrite, uploadFile } from "../../api/client";
import { ErrorPane } from "../../components/ui/Spinner";
import { SkeletonDashboard } from "../../components/ui/Skeleton";
import { PatientBanner } from "./PatientBanner";
import { PatientOverview } from "./PatientOverview";
import { OverviewHeader } from "./OverviewHeader";
import { OVERVIEW_RANGES, rangeCutoff, type OverviewRangeId } from "./overviewRange";
import "../../styles/pearl.css";
import { touchesPatientReport } from "./savedActions";
import { ChatPanel } from "../../components/ui/ChatPanel";
import { describeSavedAction } from "../../components/ui/chat/savedActionPresentation";
import { ToolTraceDrawer } from "../../components/ui/ToolTraceDrawer";
import { useToast } from "../../components/ui/Toast";
import { SymptomForm } from "./tools/SymptomForm";
import { CBCForm } from "./tools/CBCForm";
import { ImagingForm } from "./tools/ImagingForm";
import { MedicationForm } from "./tools/MedicationForm";
import { TreatmentNoteForm } from "./tools/TreatmentNoteForm";
import { ComposerToolButton, type ToolKey } from "./tools/ComposerToolButton";
import { useAuth } from "../../hooks/useAuth";
import { ClinicalBoundaryBanner } from "../../components/ui/ClinicalBoundaryBanner";
import type { ChatMessage, SavedAction } from "../../types/api";
import { PATIENT_OVERVIEW_52, PATIENT_OVERVIEW_C } from "../../lib/featureFlags";
import { MONITORING_BOUNDARY, OWN_RECORD_NOTE } from "../../lib/patientLanguage";
import { useAllowedQueryParam } from "../../hooks/useQueryParam";
import { NAV_C } from "./overviewC/nav";

/*
 * Concept 5.2 Overview, behind PATIENT_OVERVIEW_52 (off by default).
 *
 * Lazy so that with the flag off neither the module nor its stylesheet is ever
 * requested: the off state is the existing dashboard, byte for byte. Only the
 * Overview presentation is swapped - the shell, tab bar, data fetches, tool
 * forms, chat, upload and undo below are shared by both states.
 */
const PatientOverview52 = lazy(() => import("./PatientOverview52"));
const Overview52Header = lazy(() =>
  import("./PatientOverview52").then((m) => ({ default: m.Overview52Header })),
);

/*
 * Design C Overview, behind PATIENT_OVERVIEW_C (off by default) and lazy for the
 * same reason. Its stylesheet also dresses the shell, so it loads for both tabs.
 */
const PatientOverviewC = lazy(() => import("./overviewC/PatientOverviewC"));
if (PATIENT_OVERVIEW_C) void import("../../styles/patient-overview-c.css");
const USE_OVERVIEW_52 = PATIENT_OVERVIEW_52 && !PATIENT_OVERVIEW_C;
const RANGE_IDS = OVERVIEW_RANGES.map((r) => r.id);

const NAV = [
  { to: "/patient",          label: "Overview",  icon: LayoutDashboard },
  { to: "/patient#labs",     label: "Labs",      icon: FlaskConical },
  { to: "/patient#signals",  label: "Signals",   icon: Activity },
  { to: "/patient#timeline", label: "Timeline",  icon: Clock },
  { to: "/patient#genetics", label: "Family & Genetics", icon: Dna },
  { to: "/patient/chat",     label: "Support",   icon: MessageSquare },
];

type Tab = "overview" | "chat";

export default function PatientDashboard() {
  const { patientId } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const tab: Tab = location.pathname.includes("/chat") ? "chat" : "overview";
  const {
    data: coreReport,
    status,
    error,
    refetch: refetchCoreReport,
    lastFetchedAt: coreFetchedAt,
  } = useApi(getMyReportCore, [patientId]);

  // The slow half of the report arrives via a background job; the polling
  // state machine lives in its own hook so it is testable in isolation.
  const {
    enrichment,
    status: enrichmentStatus,
    fetchedAt: enrichmentFetchedAt,
    start: loadEnrichment,
    reset: resetEnrichment,
  } = useReportEnrichment<Partial<NonNullable<typeof coreReport>>>();

  const { data: chatData, refetch: refetchChat } = useApi(getMyChatHistory, [patientId]);
  const report = useMemo(
    () => coreReport ? { ...coreReport, ...(enrichment ?? {}) } : null,
    [coreReport, enrichment],
  );
  const reportFetchedAt = enrichmentFetchedAt ?? coreFetchedAt;

  const refetchReport = useCallback(() => {
    resetEnrichment();
    refetchCoreReport();
  }, [refetchCoreReport, resetEnrichment]);

  const chatMessages = chatData?.messages ?? report?.chat_history ?? [];

  // After a chat turn that could have confirmed or cancelled a record preview
  // ends with an unknown outcome, the chat is held until the patient has looked
  // at refreshed records and says so. A changed history is never evidence. See
  // useChatOutcomeHold for what this contains and what it cannot.
  const onOutcomeRefreshed = useCallback(() => {
    refetchChat();
    refetchReport();
  }, [refetchChat, refetchReport]);
  const { hold: confirmationHold, quarantined, begin: beginOutcomeHold } = useChatOutcomeHold({
    loadHistory: getMyChatHistory,
    onRefreshed: onOutcomeRefreshed,
  });
  const chatKey = buildChatKey(patientId ?? "patient", chatMessages);

  // Tool tray modal state. One key at a time — opening a new tool closes
  // any other open form so the user never sees two modals stacked.
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const rangeFromUrl = useAllowedQueryParam<OverviewRangeId>("range", "6m", RANGE_IDS);
  const [overviewRange, setOverviewRange] = useState<OverviewRangeId>(PATIENT_OVERVIEW_C ? rangeFromUrl : "6m");
  const closeTool = () => setActiveTool(null);

  async function handleToolSelect(key: ToolKey, file?: File) {
    if (key === "education") {
      // Just route the user into the chat surface; the chat composer is
      // the right place for free-form questions and the agent's RAG layer
      // already handles education intent.  No new endpoint needed.
      navigate("/patient/chat");
      toast.push({
        tone: "info",
        title: "Ask away",
        description: "Type your question in the chat below — the assistant will cite sources where it can.",
      });
      return;
    }

    if (key === "upload_cbc" || key === "upload_imaging") {
      if (!file) return;
      const uploadType = key === "upload_cbc" ? "lab_report" : "imaging_report";
      const labelForToast = key === "upload_cbc" ? "CBC image" : "Imaging file";
      try {
        const base64 = await readFileAsBase64(file);
        await uploadFile({
          upload_type: uploadType,
          file_name: file.name,
          content_type: file.type || "application/octet-stream",
          content_base64: base64,
          notes: `Patient-uploaded ${labelForToast.toLowerCase()} via tool tray.`,
        });
        toast.push({
          tone: "success",
          title: `${labelForToast} uploaded`,
          description: file.name,
        });
        refetchReport();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not upload the file.";
        toast.push({
          tone: "warning",
          title: "Upload failed",
          description: message,
        });
      }
      return;
    }

    setActiveTool(key);
  }

  async function handleUndoAction(auditId: number) {
    try {
      const result = await undoMyConfirmedRecordWrite(auditId);
      refetchReport();
      refetchChat();
      toast.push({
        tone: "info",
        title: "Portal entry removed",
        description: result.message,
      });
    } catch (err) {
      toast.push({
        tone: "warning",
        title: "Undo failed",
        description: err instanceof Error ? err.message : "The entry could not be removed.",
      });
      throw err;
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "chat",     label: "Support chat" },
  ];

  useEffect(() => {
    if (tab === "overview" && status === "success" && enrichmentStatus === "idle") {
      loadEnrichment();
    }
  }, [enrichmentStatus, loadEnrichment, status, tab]);

  useEffect(() => {
    if (location.pathname !== "/patient") return;
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      const main = document.querySelector(".app-main");
      if (main) main.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const id = location.hash.slice(1);
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-section="${id}"]`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.hash, tab]);

  // Range-filtered views for the overview. Filtering here rather than inside
  // each panel keeps one window definition for the whole page.
  const overviewCutoff = useMemo(
    () => rangeCutoff(report, overviewRange), [report, overviewRange],
  );
  const rangedSymptoms = useMemo(
    () => (report?.symptoms ?? []).filter((s) => new Date(s.date).getTime() >= overviewCutoff),
    [report, overviewCutoff],
  );
  const rangedLabHistory = useMemo(
    () => (report?.lab_history ?? []).filter((p) => new Date(p.date).getTime() >= overviewCutoff),
    [report, overviewCutoff],
  );
  const rangedReport = useMemo(
    () => (report ? { ...report, lab_history: rangedLabHistory } : null),
    [report, rangedLabHistory],
  );
  const latestLabDate = rangedLabHistory.length
    ? rangedLabHistory[rangedLabHistory.length - 1].date
    : null;

  return (
    <AppShell
      navItems={PATIENT_OVERVIEW_C ? NAV_C : NAV}
      boundaryNote={PATIENT_OVERVIEW_C ? MONITORING_BOUNDARY : undefined}
      calmNav={PATIENT_OVERVIEW_C}
      title={PATIENT_OVERVIEW_C ? "NLCare" : "Patient portal"}
      // The overview supplies its own page heading ("Your monitoring record").
      titleAs={tab === "overview" && status === "success" && report ? "p" : "h1"}
      subtitle={report?.patient_name ?? patientId ?? ""}
    >
      {/* Design C carries this in the page's opening section instead. */}
      {!(PATIENT_OVERVIEW_C && tab === "overview" && status === "success") && (
        <div className="dashboard-content patient-boundary-strip">
          <ClinicalBoundaryBanner />
        </div>
      )}
      {status === "loading" && <SkeletonDashboard label="Loading your records..." />}
      {status === "error"   && <ErrorPane message={error ?? "Failed to load"} onRetry={refetchReport} />}
      {status === "success" && report && (
        <div className="dashboard-page">
          {tab === "chat"
            ? PATIENT_OVERVIEW_C ? <p className="pc-chat-note">{OWN_RECORD_NOTE}</p> : <PatientBanner report={report} compact />
            : PATIENT_OVERVIEW_C
              ? null
            : USE_OVERVIEW_52
              ? <div className="dashboard-content">
                  <Suspense fallback={null}>
                    <Overview52Header
                      report={report}
                      patientId={patientId ?? null}
                      rangedSymptoms={rangedSymptoms}
                      rangedLabHistory={rangedLabHistory}
                      latestLabDate={latestLabDate}
                    />
                  </Suspense>
                </div>
              : <div className="po-surface-ground"><div className="po-page po-page--header">
                  <OverviewHeader report={report} patientId={patientId ?? null} />
                </div></div>}

          {!PATIENT_OVERVIEW_C && <div className="dashboard-tabbar">
            <div className="dashboard-tabbar-inner">
              {tabs.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => navigate(id === "chat" ? "/patient/chat" : "/patient")}
                  className={tab === id ? "is-active" : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>}

          {tab === "overview" && report && PATIENT_OVERVIEW_C && (
            <Suspense fallback={<SkeletonDashboard label="Loading your records..." />}>
              <PatientOverviewC
                report={report}
                patientId={patientId ?? null}
                rangedSymptoms={rangedSymptoms}
                rangedLabHistory={rangedLabHistory}
                latestLabDate={latestLabDate}
                range={overviewRange}
                onRangeChange={setOverviewRange}
                reportFetchedAt={reportFetchedAt}
                enrichmentStatus={enrichmentStatus}
                chatMessages={chatMessages}
                onSaved={refetchReport}
              />
            </Suspense>
          )}

          {tab === "overview" && report && USE_OVERVIEW_52 && (
            <div className="dashboard-content">
              <Suspense fallback={<SkeletonDashboard label="Loading your records..." />}>
                <PatientOverview52
                  report={report}
                  rangedReport={rangedReport}
                  rangedSymptoms={rangedSymptoms}
                  rangedLabHistory={rangedLabHistory}
                  latestLabDate={latestLabDate}
                  range={overviewRange}
                  onRangeChange={setOverviewRange}
                  reportFetchedAt={reportFetchedAt}
                  enrichmentStatus={enrichmentStatus}
                  onSaved={refetchReport}
                />
              </Suspense>
            </div>
          )}

          {tab === "overview" && report && !PATIENT_OVERVIEW_52 && !PATIENT_OVERVIEW_C && (
            <PatientOverview
              report={report}
              rangedReport={rangedReport}
              rangedSymptoms={rangedSymptoms}
              rangedLabHistory={rangedLabHistory}
              latestLabDate={latestLabDate}
              range={overviewRange}
              onRangeChange={setOverviewRange}
              reportFetchedAt={reportFetchedAt}
              enrichmentStatus={enrichmentStatus}
              chatMessages={chatMessages}
              onSaved={refetchReport}
            />
          )}

          {tab === "chat" && (
            <div className="dashboard-content chat-workspace">
              {/* "+" attachment trigger now lives INSIDE the chat composer
                  (passed via composerLeading below).  Layout:
                    [ + ] [ textarea ] [ send ]
                  No more top-right tool toolbar. */}
              <div className="chat-card-shell">
                <ChatPanel
                  key={chatKey}
                  messages={chatMessages}
                  scrollRegionLabel="Conversation with the support assistant"
                  confirmationHold={confirmationHold}
                  quarantinedMessageIds={quarantined}
                  onOutcomeUnknown={({ pendingMessageIds }) => beginOutcomeHold(pendingMessageIds)}
                  composerLeading={<ComposerToolButton onSelect={handleToolSelect} />}
                  onSend={async (text) => {
                    const res = await sendMyChat(text);
                    return {
                      reply: res.reply,
                      saved_actions: res.saved_actions,
                      citations: res.citations,
                    };
                  }}
                  onSendStream={async (text, handlers) => {
                    const res = await sendMyChatStream(text, handlers);
                    return {
                      reply: res.reply,
                      saved_actions: res.saved_actions,
                      citations: res.citations,
                    };
                  }}
                  onSavedActions={(actions: SavedAction[]) => {
                    // A write to the clinical record must refetch, or the
                    // patient is told "saved" while still looking at pre-save data.
                    if (touchesPatientReport(actions)) refetchReport();
                    refetchChat();

                    // Surface a toast per save action with the right tone +
                    // human-readable label.  "possible_metastatic_indicator"
                    // becomes a warning toast, not a success.
                    for (const action of actions) {
                      const { label, tone } = describeSavedAction(action);
                      toast.push({
                        tone,
                        title: tone === "warning" ? label : `${label}.`,
                        description:
                          tone === "warning"
                            ? "Noted in the saved text. Worth raising with your care team."
                            : "Patient record refreshed.",
                      });
                    }
                  }}
                  onUndoAction={handleUndoAction}
                />
                <ToolTraceDrawer messages={chatMessages} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* All five tool forms are mounted at the dashboard level so opening
          one never remounts the chat or its in-flight stream. */}
      <SymptomForm
        open={activeTool === "symptom"}
        onClose={closeTool}
        onSaved={({ symptom, severity, urgent_flag }) => {
          refetchReport();
          toast.push({
            tone: urgent_flag ? "warning" : "success",
            title: urgent_flag ? "Symptom saved with an urgent mark" : "Symptom saved",
            description: `${symptom} · severity ${severity}/10`,
          });
        }}
      />
      <CBCForm
        open={activeTool === "cbc"}
        onClose={closeTool}
        onSaved={({ hasAbnormal }) => {
          refetchReport();
          toast.push({
            tone: hasAbnormal ? "warning" : "success",
            title: hasAbnormal ? "CBC saved. Some values are outside the usual range." : "CBC saved",
            description: "Lab card updated",
          });
        }}
      />
      <ImagingForm
        open={activeTool === "imaging"}
        onClose={closeTool}
        onSaved={({ modality }) => {
          refetchReport();
          toast.push({
            tone: "success",
            title: `${modality} report saved`,
            description: "Timeline updated",
          });
        }}
      />
      <MedicationForm
        open={activeTool === "medication"}
        onClose={closeTool}
        onSaved={({ medication }) => {
          refetchReport();
          toast.push({
            tone: "success",
            title: "Medication logged",
            description: medication,
          });
        }}
      />
      <TreatmentNoteForm
        open={activeTool === "treatment"}
        onClose={closeTool}
        onSaved={({ drug }) => {
          refetchReport();
          toast.push({
            tone: "success",
            title: "Treatment note saved",
            description: drug,
          });
        }}
      />
    </AppShell>
  );
}

/**
 * Stable chat key — keyed only on the patient id, NOT on the message list.
 *
 * The previous implementation embedded `messages.length` and the last
 * message's content, which forced ChatPanel to remount every time a message
 * was sent or the history was refetched.  That remount dropped in-flight
 * streaming state (the optimistic assistant bubble + its streamId), and
 * combined with React StrictMode it caused the streaming setMessages
 * updater to read a stale closure index and crash with
 * `Cannot read properties of undefined (reading 'message')`.
 *
 * ChatPanel now syncs from props internally (only when not sending), so
 * we never need to remount the panel just because the message list changed.
 */
function buildChatKey(scope: string, _messages: ChatMessage[]) {
  void _messages; // intentionally unused — keyed only on patient/session scope
  return `chat:${scope}`;
}

