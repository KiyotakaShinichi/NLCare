/**
 * Frontend feature flags.
 *
 * Deliberately small: two flags, resolved once at module load, with no network
 * dependency and no persistence that could outlive a rollback.
 *
 * `patientOverview52` swaps the patient Overview presentation for Concept 5.2.
 * It is OFF unless the build sets `VITE_PATIENT_OVERVIEW_52=true`.
 *
 * Rollback: unset the variable (or set it to anything other than "true") and
 * restart the dev server or rebuild. With the flag off the Concept 5.2 module
 * is never imported, so none of its JavaScript or CSS reaches the page.
 *
 * Development override: in a dev build only, `localStorage` key
 * `nlcare.flag.patientOverview52` set to "on" or "off" wins over the build
 * value after a reload. It exists so both states can be exercised against one
 * running server. Production builds ignore it entirely, so a patient cannot
 * switch the flag from their own browser.
 *
 * `patientOverviewC` swaps the patient Overview for Design C, the same way, under
 * `VITE_PATIENT_OVERVIEW_C` and `nlcare.flag.patientOverviewC`. It is also OFF
 * unless set, and it takes precedence if both flags are on.
 */

export const PATIENT_OVERVIEW_52_STORAGE_KEY = "nlcare.flag.patientOverview52";
export const PATIENT_OVERVIEW_C_STORAGE_KEY = "nlcare.flag.patientOverviewC";

/**
 * Pure resolution, exported for tests.
 *
 * @param buildValue   the raw `VITE_PATIENT_OVERVIEW_52` value
 * @param isDev        whether this is a development build
 * @param override     the raw localStorage override, if any
 */
export function resolvePatientOverview52(
  buildValue: string | undefined,
  isDev: boolean,
  override: string | null,
): boolean {
  if (isDev) {
    if (override === "on") return true;
    if (override === "off") return false;
  }
  return buildValue === "true";
}

/** The same rule for Design C: `VITE_PATIENT_OVERVIEW_C`, dev override included. */
export const resolvePatientOverviewC = resolvePatientOverview52;

function readOverride(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode or blocked storage: no override, fall back to the build.
    return null;
  }
}

/** Resolved once. Changing it requires a reload, which is what makes it safe. */
export const PATIENT_OVERVIEW_52: boolean = resolvePatientOverview52(
  import.meta.env.VITE_PATIENT_OVERVIEW_52,
  Boolean(import.meta.env.DEV),
  typeof window === "undefined" ? null : readOverride(PATIENT_OVERVIEW_52_STORAGE_KEY),
);

export const PATIENT_OVERVIEW_C: boolean = resolvePatientOverviewC(
  import.meta.env.VITE_PATIENT_OVERVIEW_C,
  Boolean(import.meta.env.DEV),
  typeof window === "undefined" ? null : readOverride(PATIENT_OVERVIEW_C_STORAGE_KEY),
);
