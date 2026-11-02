import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Ribbon, ChevronLeft, LogOut, Menu, ShieldCheck } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { logout } from "../../api/client";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Label in the phone navigation. Items without one stay in the menu. */
  short?: string;
  /** Also listed in the top navigation on wide screens. */
  primary?: boolean;
}

interface AppShellProps {
  children: React.ReactNode;
  navItems: NavItem[];
  title: string;
  subtitle?: string;
  /**
   * Heading level of the topbar title. A page that supplies its own `h1` passes
   * "p" so the document keeps a single `h1`.
   */
  titleAs?: "h1" | "p";
  /** Shown in the topbar, which never scrolls away, at every screen size. */
  boundaryNote?: string;
  /**
   * Top navigation on wide screens and labelled bottom navigation on phones. The
   * sidebar becomes a menu that holds every destination and Sign out.
   */
  calmNav?: boolean;
}

export function AppShell({
  children, navItems, title, subtitle, titleAs = "h1", boundaryNote, calmNav = false,
}: AppShellProps) {
  const { clearSession, role, patientId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstNavLinkRef = useRef<HTMLAnchorElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !calmNav && (typeof window === "undefined" || window.matchMedia("(min-width: 761px)").matches),
  );

  // The menu sits before the topbar in the page, so focus has to be taken to it
  // and brought back, or a keyboard user would tab away from it.
  const menuWasOpen = useRef(false);
  useEffect(() => {
    if (!calmNav) return;
    if (sidebarOpen) firstNavLinkRef.current?.focus();
    else if (menuWasOpen.current) menuButtonRef.current?.focus();
    menuWasOpen.current = sidebarOpen;
  }, [calmNav, sidebarOpen]);

  // On the document, so Escape closes the menu wherever focus happens to be.
  useEffect(() => {
    if (!calmNav || !sidebarOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSidebarOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [calmNav, sidebarOpen]);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Clear the local token even when the backend is unavailable.
    } finally {
      clearSession();
      navigate("/login");
    }
  }

  const roleLabel =
    role === "patient" ? `Patient ${patientId ?? ""}` :
    role === "clinician" ? "Clinician" :
    role === "admin" ? "Admin / MLE" : "Workspace";

  // Active link detection. Items can be plain paths ("/patient/chat") or
  // hash anchors ("/patient#labs"). A hash item is active when its hash
  // matches the current URL; otherwise the longest pathname prefix wins.
  const currentHashKey = `${location.pathname}${location.hash}`;
  const hashItems = navItems.filter((item) => item.to.includes("#"));
  const pathItems = navItems.filter((item) => !item.to.includes("#"));
  const hashActive = hashItems.find((item) => item.to === currentHashKey)?.to;
  const pathActive = !hashActive && !location.hash
    ? [...pathItems]
        .sort((a, b) => b.to.length - a.to.length)
        .find(({ to }) => location.pathname === to || location.pathname.startsWith(`${to}/`))
        ?.to
    : undefined;
  const activePath = hashActive ?? pathActive;

  // Keyboard users otherwise tab through the sidebar on every page. The hash is
  // not left in the URL: the patient routes use it for in-page section anchors.
  function skipToMain(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <div className={clsx("app-shell", calmNav && "app-shell--calm")}>
      <a className="skip-link" href="#main-content" onClick={skipToMain}>
        Skip to main content
      </a>
      <aside className={clsx("app-sidebar", sidebarOpen ? "is-open" : "is-collapsed")}>
        <div className="app-sidebar-brand">
          <span className="app-sidebar-logo">
            <Ribbon size={22} aria-hidden="true" />
          </span>
          {sidebarOpen && (
            <div className="app-sidebar-brand-text">
              <strong>NLCare</strong>
              <span>Breast monitoring</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            className="app-sidebar-toggle"
            aria-label={sidebarOpen ? (calmNav ? "Close menu" : "Collapse sidebar") : "Expand sidebar"}
          >
            {sidebarOpen ? <ChevronLeft size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <div className="app-sidebar-profile">
          <span className="app-sidebar-avatar">{roleLabel.slice(0, 1)}</span>
          {sidebarOpen && (
            <div>
              <strong>{roleLabel}</strong>
              <span>Synthetic demo session</span>
            </div>
          )}
        </div>

        <nav className="app-sidebar-nav" aria-label="Primary navigation">
          {navItems.map(({ to, label, icon: Icon }, index) => {
            const active = activePath === to;
            return (
              <Link
                key={to}
                to={to}
                ref={index === 0 ? firstNavLinkRef : undefined}
                className={clsx("app-nav-link", active && "is-active")}
                title={!sidebarOpen ? label : undefined}
                // The open menu covers the page, so choosing a place closes it.
                onClick={calmNav ? () => setSidebarOpen(false) : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                {sidebarOpen && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          {sidebarOpen && !boundaryNote && (
            <p>
              Monitoring support only. Not for diagnosis or treatment decisions.
            </p>
          )}
          {/* The label is the button's only text and it disappears with the
              collapsed sidebar, leaving an aria-hidden icon and no accessible
              name - axe reported button-name at 320px, 390px and 200% zoom
              while desktop stayed clean. aria-label names it at every width. */}
          <button
            type="button"
            onClick={handleLogout}
            className="app-logout-button"
            aria-label="Sign out"
          >
            <LogOut size={17} aria-hidden="true" />
            {sidebarOpen && <span>Sign out</span>}
          </button>
        </div>
      </aside>
      {calmNav && sidebarOpen && (
        <div className="app-menu-scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="app-frame" inert={calmNav && sidebarOpen ? true : undefined}>
        <header className="app-topbar">
          {calmNav && (
            <button
              ref={menuButtonRef}
              type="button"
              className="app-topbar-menu"
              aria-label="Open menu"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          )}
          <div>
            {titleAs === "h1" ? <h1>{title}</h1> : <p className="app-topbar-title">{title}</p>}
            {/* Subtitle is shown only when it adds info beyond the role kicker. */}
            {subtitle && subtitle !== roleLabel && (
              <span>{subtitle}</span>
            )}
            {boundaryNote && <p className="app-topbar-note">{boundaryNote}</p>}
          </div>
          {calmNav && (
            <nav className="app-top-nav" aria-label="Main sections">
              {navItems.filter((item) => item.primary).map(({ to, label }) => (
                <Link key={to} to={to} aria-current={activePath === to ? "page" : undefined}>{label}</Link>
              ))}
            </nav>
          )}
          <div className="app-topbar-actions">
            <span className="app-safety-pill">
              <ShieldCheck size={13} aria-hidden="true" />
              PoC - not for clinical use
            </span>
          </div>
        </header>

        <main id="main-content" ref={mainRef} tabIndex={-1} className="app-main">
          {children}
        </main>

        {calmNav && (
          <nav className="app-bottom-nav" aria-label="Main sections">
            {navItems.filter((item) => item.short).map(({ to, short, icon: Icon }) => (
              <Link key={to} to={to} aria-current={activePath === to ? "page" : undefined}>
                <Icon size={20} aria-hidden="true" />
                {short}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
