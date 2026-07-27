/** @vitest-environment jsdom (locale persists to browser storage) */
/* ================================================================
   Plan 7 PR-7.2 — i18n contract tests.
================================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import { t, setLocale, getLocale, getSupportedLocales } from "../i18n";

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  setLocale("en");
});

describe("i18n (Plan 7 PR-7.2)", () => {
  it("getSupportedLocales returns en/hi/ta/bn", () => {
    expect(getSupportedLocales()).toEqual(["en", "hi", "ta", "bn"]);
  });

  it("default locale is 'en'", () => {
    expect(getLocale()).toBe("en");
  });

  it("setLocale persists to localStorage", () => {
    setLocale("hi");
    expect(getLocale()).toBe("hi");
    expect(localStorage.getItem("penman.locale")).toBe("hi");
  });

  it("t() returns the English string by default", () => {
    expect(t("nav.valuation")).toBe("Valuation");
  });

  it("t() returns the locale-specific string when set", () => {
    setLocale("hi");
    expect(t("nav.valuation")).toBe("मूल्यांकन");
  });

  it("t() falls back to English when locale missing the key", () => {
    setLocale("hi");
    // 'rigor.syntacticallyValid' is only in English — falls back
    expect(t("rigor.syntacticallyValid")).toBe("Syntactically Valid");
  });

  it("t() returns the keyPath when both locale and English miss", () => {
    expect(t("nonexistent.deeply.nested.key")).toBe("nonexistent.deeply.nested.key");
  });

  it("t() with explicit locale arg overrides active locale", () => {
    setLocale("en");
    expect(t("nav.valuation", "ta")).toBe("மதிப்பீடு");
    expect(getLocale()).toBe("en"); // unchanged
  });

  it("All 4 locales translate 'common.save'", () => {
    expect(t("common.save", "en")).toBe("Save");
    expect(t("common.save", "hi")).toBe("सहेजें");
    expect(t("common.save", "ta")).toBe("சேமி");
    expect(t("common.save", "bn")).toBe("সংরক্ষণ");
  });

  it("All 4 locales translate the navigation labels", () => {
    for (const locale of getSupportedLocales()) {
      const label = t("nav.valuation", locale);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("nav.");
    }
  });
});
