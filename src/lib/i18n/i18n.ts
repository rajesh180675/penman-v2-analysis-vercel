/* ================================================================
   Plan 7 PR-7.2 — i18n infrastructure.

   Lightweight dictionary lookup with English fallback. No external
   library — adding i18next costs ~30KB and a context provider for
   functionality we can do in 50 lines.

   API:
     setLocale("hi")           switch active locale (persists to
                               localStorage 'penman.locale')
     getLocale()               current locale ("en" by default)
     t("nav.valuation")        lookup with English fallback
     getSupportedLocales()     ["en", "hi", "ta", "bn"]

   Coverage policy:
     English is canonical; every key MUST exist in en.ts.
     Other locales translate what they translate; missing keys fall
     through to English. The fallback is silent — reviewers see the
     English string so the UI stays usable rather than showing a
     translation key.

   PR-7.2 ships infrastructure + nav + common labels in 4 locales.
   Valuation glossary stays in English for reviewer credibility
   until a finance-domain translator signs off (per plan note about
   reviewer-grade glossary).

   Wiring (replacing hardcoded UI strings with t() calls) is a
   follow-up — this PR ships the infrastructure so subsequent PRs
   can adopt it incrementally.
================================================================ */

import { en, type LocaleDictionary } from "./locales/en";
import { hi } from "./locales/hi";
import { ta } from "./locales/ta";
import { bn } from "./locales/bn";

export type Locale = "en" | "hi" | "ta" | "bn";

const DICTIONARIES: Record<Locale, Partial<LocaleDictionary>> = {
  en,
  hi,
  ta,
  bn,
};

const STORAGE_KEY = "penman.locale";

let activeLocale: Locale = "en";

// Hydrate from localStorage on module load (browser-only).
if (typeof localStorage !== "undefined") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (stored === "en" || stored === "hi" || stored === "ta" || stored === "bn")) {
      activeLocale = stored;
    }
  } catch {
    /* skip */
  }
}

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(locale: Locale): void {
  activeLocale = locale;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* skip */
    }
  }
}

export function getSupportedLocales(): Locale[] {
  return ["en", "hi", "ta", "bn"];
}

/**
 * Lookup a key path like "nav.valuation". Falls back to English
 * when the key is missing in the active locale.
 *
 * Returns the key path itself when neither locale resolves the
 * key — surfaces broken keys in dev rather than silently rendering
 * blank cells.
 */
export function t(keyPath: string, locale?: Locale): string {
  const target = locale ?? activeLocale;
  const segments = keyPath.split(".");

  const fromLocale = walk(DICTIONARIES[target] as Record<string, unknown>, segments);
  if (typeof fromLocale === "string") return fromLocale;

  // English fallback
  const fromEn = walk(en as unknown as Record<string, unknown>, segments);
  if (typeof fromEn === "string") return fromEn;

  // Last resort: surface the key so missing translations are visible
  return keyPath;
}

function walk(obj: Record<string, unknown> | undefined, segments: string[]): unknown {
  if (!obj) return undefined;
  let current: unknown = obj;
  for (const seg of segments) {
    if (typeof current !== "object" || current == null) return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}
