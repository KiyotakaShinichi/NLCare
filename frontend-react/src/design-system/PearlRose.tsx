import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Ribbon, AlertTriangle, Info, CheckCircle, ShieldAlert } from "lucide-react";
import "./pearl-rose.css";

/**
 * The Pearl Rose component vocabulary.
 *
 * Small, reusable, and reading only the scoped tokens in `pearl-rose.css`. No
 * component here carries a hard-coded colour, size or spacing value; changing a
 * token changes every surface built from these.
 *
 * What is deliberately NOT here: charts, their data tables and the boundary
 * note. Those already exist as `LabTrendsChart`, `SymptomTrendChart` and
 * `BoundaryNote`, each with behaviour the design system has no business
 * duplicating - gap detection, tick selection, focusable scroll regions,
 * record-integrity disclosure. They are reused as-is and simply placed inside
 * `Sheet` and `ChartFigure`.
 */

export interface NavItem {
  to: string;
  label: string;
  current?: boolean;
  /**
   * Keeps a rail item inside the surface it belongs to.
   *
   * A preview whose rail links out to the production routes throws the reviewer
   * back into the old UI on the first click, which is exactly what happened
   * when Concept 5.1 was first reviewed. When `onSelect` is given the item
   * renders as a button and `to` is not navigated to.
   */
  onSelect?: () => void;
}

/** The application shell: a labelled rail that wraps to a row below 900px. */
export function Shell({
  nav, navLabel = "Primary", railFoot, children, density = "comfortable", className = "",
}: {
  nav: NavItem[];
  navLabel?: string;
  railFoot?: ReactNode;
  children: ReactNode;
  density?: "comfortable" | "compact";
  className?: string;
}) {
  return (
    <div
      className={`c4 pr-shell ${className}`.trim()}
      data-density={density === "compact" ? "compact" : undefined}
    >
      <nav className="pr-rail" aria-label={navLabel}>
        <p className="pr-brand">
          <span className="pr-brand-mark"><Ribbon size={15} aria-hidden="true" /></span>
          <span className="pr-brand-text">NLCare<small>Breast monitoring</small></span>
        </p>
        {/* A list, so the set is announced with its size and position. */}
        <ul className="pr-nav-list">
          {nav.map((n) => (
            <li key={n.label}>
              {n.onSelect ? (
                <button
                  type="button"
                  className="pr-nav-btn"
                  aria-current={n.current ? "page" : undefined}
                  onClick={n.onSelect}
                >
                  {n.label}
                </button>
              ) : (
                <Link to={n.to} aria-current={n.current ? "page" : undefined}>{n.label}</Link>
              )}
            </li>
          ))}
        </ul>
        {railFoot && <p className="pr-rail-foot">{railFoot}</p>}
      </nav>
      <main className="pr-main">
        <div className="pr-stack">{children}</div>
      </main>
    </div>
  );
}

/** A figure in the header strip: a value and a label that says what it counts. */
export interface HeaderFigure {
  value: string | number;
  label: string;
  /** Long values (a date range) set at body size instead of display size. */
  asText?: boolean;
}

/** Identity and the headline figures on one wash, so content starts early. */
export function PageHeader({
  kicker, title, titleId, facts = [], actions, figures = [],
}: {
  kicker?: string;
  title: string;
  titleId: string;
  facts?: string[];
  actions?: ReactNode;
  figures?: HeaderFigure[];
}) {
  return (
    <section className="pr-header" aria-labelledby={titleId}>
      <div className="pr-header-top">
        <div style={{ minWidth: 0 }}>
          {kicker && <p className="pr-kicker">{kicker}</p>}
          <h1 id={titleId} className="pr-title">{title}</h1>
          {facts.length > 0 && (
            <p className="pr-facts">
              {facts.map((f, i) => (
                <span key={f}>
                  {i > 0 && <span className="pr-facts-sep" aria-hidden="true">·</span>}{f}
                </span>
              ))}
            </p>
          )}
        </div>
        {actions && <div className="pr-actions">{actions}</div>}
      </div>
      {figures.length > 0 && (
        <div className="pr-figures">
          {figures.map((f) => (
            <div className="pr-figure" key={f.label}>
              <span className={`pr-figure-value${f.asText ? " pr-figure-value--text" : ""}`}>
                {f.value}
              </span>
              <span className="pr-figure-label">{f.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** A section: a rule, a label, then the thing. No card unless it needs one. */
export function Section({
  title, titleId, lede, aside, children,
}: {
  title: string;
  titleId: string;
  lede?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pr-section" aria-labelledby={titleId}>
      <div className="pr-section-head">
        <div className="pr-measure">
          <h2 id={titleId} className="pr-h2">{title}</h2>
          {lede && <p className="pr-lede">{lede}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The one raised surface. Charts and tables sit inside it. */
export function Sheet({ children }: { children: ReactNode }) {
  return <div className="pr-sheet">{children}</div>;
}

/**
 * A figure with its caption, and any notices that belong to this data.
 *
 * The caption states what the chart does not say as well as what it does; the
 * notices sit beside the data they concern rather than at the top of the page.
 */
export function ChartFigure({
  notices, caption, children,
}: {
  notices?: ReactNode;
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="pr-figure-block">
      <Sheet>{children}</Sheet>
      {notices}
      {caption && <figcaption className="pr-caption">{caption}</figcaption>}
    </figure>
  );
}

export type NoticeTone = "question" | "info" | "ok" | "critical";

const NOTICE_ICON = {
  question: AlertTriangle,
  info: Info,
  ok: CheckCircle,
  critical: ShieldAlert,
} as const;

/**
 * A status or data-quality notice.
 *
 * `question` is amber and is the tone for something unresolved - a disagreement
 * in the record that has not been shown to be an error. It is deliberately not
 * the same colour as the safety disclosure, so an open question cannot be read
 * as a clinical warning.
 */
export function Notice({
  tone = "info", title, children,
}: {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
}) {
  const Icon = NOTICE_ICON[tone];
  return (
    <p className={`pr-notice pr-notice--${tone}`}>
      <Icon size={15} aria-hidden="true" />
      <span>
        {title && <strong className="pr-notice-title">{title}</strong>}
        {children}
      </span>
    </p>
  );
}

/** A bounded selector. Pills are for sets that cannot grow with the product. */
export function PillGroup<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="pr-pills" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A row in a list of events or prompts. */
export function ListRow({
  icon, tone, title, meta,
}: {
  icon: ReactNode;
  tone?: "note";
  title: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <li>
      <span className="pr-list-icon" data-tone={tone}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <p className="pr-item-title">{title}</p>
        {meta && <p className="pr-item-meta">{meta}</p>}
      </div>
    </li>
  );
}
