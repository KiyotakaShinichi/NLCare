import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Activity,
  FlaskConical,
  Image as ImageIcon,
  Pill,
  Plus,
  ScanLine,
  Stethoscope,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ToolKey =
  | "symptom"
  | "cbc"
  | "imaging"
  | "medication"
  | "treatment"
  | "upload_cbc"
  | "upload_imaging"
  | "education";

type RecordKey = "symptom" | "cbc" | "imaging" | "medication" | "treatment";
type UploadKey = "upload_cbc" | "upload_imaging";

interface ToolDescriptor {
  key: RecordKey | UploadKey;
  icon: LucideIcon;
  label: string;
  description: string;
  tone: "rose" | "blue" | "amber" | "purple" | "green";
}

const RECORD_TOOLS: ToolDescriptor[] = [
  { key: "symptom",    icon: Activity,     label: "Log symptom",    description: "Severity 0–10 + notes",        tone: "amber"  },
  { key: "cbc",        icon: FlaskConical, label: "Save CBC",       description: "WBC / Hgb / platelets",        tone: "blue"   },
  { key: "imaging",    icon: ScanLine,     label: "Save imaging",   description: "MRI / CT / ultrasound",        tone: "rose"   },
  { key: "medication", icon: Pill,         label: "Log medication", description: "Drug + dose taken today",      tone: "purple" },
  { key: "treatment",  icon: Stethoscope,  label: "Treatment note", description: "Short treatment-related note", tone: "green"  },
];

const UPLOAD_TOOLS: ToolDescriptor[] = [
  { key: "upload_cbc",     icon: Upload,    label: "Upload CBC image", description: "Photo or PDF of a CBC printout",    tone: "blue" },
  { key: "upload_imaging", icon: ImageIcon, label: "Upload MRI image", description: "Photo or PDF of an imaging report", tone: "rose" },
];

const ALL_TOOLS: ToolDescriptor[] = [...RECORD_TOOLS, ...UPLOAD_TOOLS];

const TONE_STYLE: Record<ToolDescriptor["tone"], { bg: string; fg: string }> = {
  rose:    { bg: "var(--rose-pale)", fg: "var(--rose-deep)" },
  blue:    { bg: "#dbeafe",          fg: "#1e3a8a" },
  amber:   { bg: "#fef3c7",          fg: "#92400e" },
  purple:  { bg: "#ede9fe",          fg: "#5b21b6" },
  green:   { bg: "#d1fae5",          fg: "#065f46" },
};

interface Props {
  onSelect: (key: ToolKey, file?: File) => void;
}

/**
 * Composer "+" attachment button.
 *
 * Sits on the LEFT side of the chat composer, styled like a small
 * circular attachment trigger.  Clicking opens a compact popover with
 * two labelled groups (Record / Upload).  The popover floats above the
 * trigger (drop-up) because the composer lives at the bottom of the
 * workspace.
 *
 * Accessibility:
 *   - Trigger is a real button with ``aria-haspopup="menu"``,
 *     ``aria-expanded``, ``aria-controls``.
 *   - Arrow Up/Down navigate items, Home/End jump to ends, Enter/Space
 *     activate, Escape closes + returns focus to trigger.
 *   - Outside-click closes the popover.
 *   - Hidden file inputs back the two upload items so the file pickers work.
 *
 * Mobile: the popover is anchored left + capped at min(320px, 100vw - 32px)
 * so it cannot overflow the viewport horizontally.
 */
export function ComposerToolButton({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cbcUploadRef = useRef<HTMLInputElement>(null);
  const imagingUploadRef = useRef<HTMLInputElement>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Keep the open menu fully inside the viewport, on both axes.
  //
  // It used to be absolutely positioned against the trigger, with a horizontal
  // clamp. That left it 100-160px below the viewport at 320x568 and at 200% zoom,
  // and a vertical nudge did not fix it: the menu lives inside the dashboard's
  // scrolling container, the trigger is itself far below the fold, and opening the
  // menu focuses its first item, which scrolls that container - taking an
  // absolutely positioned menu with it. So the menu is placed against the
  // viewport (`position: fixed`), above the trigger when there is room and below
  // it otherwise, clamped 16px inside on every side, with its height capped so a
  // very short viewport scrolls inside the menu instead of clipping it.
  //
  // If an ancestor establishes its own containing block (a transform, for
  // instance) the measured position will differ from the requested one; the
  // difference is applied once. Menu semantics, arrow-key navigation, Escape and
  // focus restoration are untouched; only geometry changes.
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!open || !pop) return;
    const margin = 16;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      pop.style.position = "fixed";
      pop.style.bottom = "auto";
      pop.style.transform = "";
      pop.style.maxHeight = `${Math.max(0, window.innerHeight - 2 * margin)}px`;
      pop.style.overflowY = "auto";
      const height = pop.getBoundingClientRect().height;
      const width = pop.offsetWidth;
      const left = clamp(trigger?.left ?? margin, margin, window.innerWidth - margin - width);
      let top = (trigger?.top ?? window.innerHeight) - 8 - height;       // above the trigger
      if (top < margin && trigger) top = trigger.bottom + 8;             // no room above: below it
      top = clamp(top, margin, window.innerHeight - margin - height);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      const placed = pop.getBoundingClientRect();
      const dx = left - placed.left;
      const dy = top - placed.top;
      if (Math.abs(dx) >= 1) pop.style.left = `${left + dx}px`;
      if (Math.abs(dy) >= 1) pop.style.top = `${top + dy}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = itemRefs.current[focusIndex];
    if (node) node.focus();
  }, [focusIndex, open]);

  function handleTriggerKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex(e.key === "ArrowUp" ? ALL_TOOLS.length - 1 : 0);
      setOpen(true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => {
        if (!v) setFocusIndex(0);
        return !v;
      });
    }
  }

  function handlePopoverKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => (i + 1) % ALL_TOOLS.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => (i - 1 + ALL_TOOLS.length) % ALL_TOOLS.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusIndex(ALL_TOOLS.length - 1);
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  function activate(key: RecordKey | UploadKey) {
    if (key === "upload_cbc") {
      cbcUploadRef.current?.click();
    } else if (key === "upload_imaging") {
      imagingUploadRef.current?.click();
    } else {
      onSelect(key);
    }
    close(true);
  }

  function handleFile(key: "upload_cbc" | "upload_imaging", e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onSelect(key, file);
    e.target.value = "";
  }

  const flatIndex = (tool: ToolDescriptor) =>
    ALL_TOOLS.findIndex((t) => t.key === tool.key);

  return (
    <div className="composer-tool-root">
      <button
        ref={triggerRef}
        type="button"
        className="composer-tool-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="composer-tool-menu"
        aria-label="Add a health record"
        onClick={() => {
          setFocusIndex(0);
          setOpen((v) => !v);
        }}
        onKeyDown={handleTriggerKey}
      >
        <Plus size={16} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popRef}
          id="composer-tool-menu"
          className="composer-tool-popover"
          role="menu"
          aria-label="Add a health record"
          onKeyDown={handlePopoverKey}
        >
          <ToolGroup label="Record">
            {RECORD_TOOLS.map((t) => (
              <ToolItem
                key={t.key}
                tool={t}
                focused={focusIndex === flatIndex(t)}
                ref={(el) => { itemRefs.current[flatIndex(t)] = el; }}
                onActivate={() => activate(t.key)}
                onHover={() => setFocusIndex(flatIndex(t))}
              />
            ))}
          </ToolGroup>
          <div className="composer-tool-divider" role="separator" aria-hidden="true" />
          <ToolGroup label="Upload">
            {UPLOAD_TOOLS.map((t) => (
              <ToolItem
                key={t.key}
                tool={t}
                focused={focusIndex === flatIndex(t)}
                ref={(el) => { itemRefs.current[flatIndex(t)] = el; }}
                onActivate={() => activate(t.key)}
                onHover={() => setFocusIndex(flatIndex(t))}
              />
            ))}
          </ToolGroup>
        </div>
      )}

      <input
        ref={cbcUploadRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => handleFile("upload_cbc", e)}
      />
      <input
        ref={imagingUploadRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => handleFile("upload_imaging", e)}
      />
    </div>
  );
}

function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="composer-tool-group" role="group" aria-label={label}>
      <p className="composer-tool-group-label">{label}</p>
      {/* role="none": the menu pattern is menu > group > menuitem. A bare <ul>
          keeps list semantics, so its role="none" <li> children fail axe's
          `list` rule and hide the menuitems from `aria-required-children`. */}
      <ul className="composer-tool-list" role="none">{children}</ul>
    </div>
  );
}

interface ToolItemProps {
  tool: ToolDescriptor;
  focused: boolean;
  onActivate: () => void;
  onHover: () => void;
}

const ToolItem = forwardRef<HTMLButtonElement, ToolItemProps>(
  function ToolItem({ tool, focused, onActivate, onHover }, ref) {
    const Icon = tool.icon;
    const palette = TONE_STYLE[tool.tone];
    return (
      <li role="none">
        <button
          ref={ref}
          type="button"
          role="menuitem"
          tabIndex={focused ? 0 : -1}
          className="composer-tool-item"
          onClick={onActivate}
          onMouseEnter={onHover}
        >
          <span
            className="composer-tool-item-icon"
            style={{ background: palette.bg, color: palette.fg }}
            aria-hidden="true"
          >
            <Icon size={14} />
          </span>
          <span className="composer-tool-item-text">
            <span className="composer-tool-item-label">{tool.label}</span>
            <span className="composer-tool-item-desc">{tool.description}</span>
          </span>
        </button>
      </li>
    );
  }
);
