import { Activity, Clock, Dna, FlaskConical, Info, LayoutDashboard, MessageSquare, Pill } from "lucide-react";

/**
 * The menu lists everything. `primary` items are also in the top navigation, and
 * `short` items are also in the phone navigation.
 */
export const NAV_C = [
  { to: "/patient",             label: "Overview",          primary: true, short: "Overview", icon: LayoutDashboard },
  { to: "/patient#labs",        label: "Labs",              primary: true, short: "Labs",     icon: FlaskConical },
  { to: "/patient#symptoms",    label: "Symptoms",          icon: Activity },
  { to: "/patient#timeline",    label: "Timeline",          primary: true, short: "Timeline", icon: Clock },
  { to: "/patient#medications", label: "Medications",       icon: Pill },
  { to: "/patient#genetics",    label: "Family & Genetics", primary: true, icon: Dna },
  { to: "/patient#signals",     label: "Research models",   icon: Info },
  { to: "/patient/chat",        label: "Support chat",      primary: true, short: "Support chat", icon: MessageSquare },
];
