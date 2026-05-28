/* ================================================================
   Plan 6 PR-6.1 — sanitize.ts

   Centralised DOMPurify wrapper. Every place we render user-
   supplied HTML (paste, file content preview, registry annotations)
   MUST route through this module. Direct DOMPurify calls scattered
   across the codebase make it impossible to audit our XSS posture
   uniformly.

   Profiles:
     "rich"        Report-grade content (Academic Report rendering).
                   Allows headings, lists, links, basic formatting.
                   Strips: script, style, iframe, on*, javascript: URIs.
     "minimal"     Plain-text-equivalent. Allows only line breaks.
     "strict"      Strips ALL HTML; returns text-only.

   All profiles forbid: <script>, <style>, <iframe>, <object>,
   <embed>, <link>, on* event handlers, javascript:, data:text/*
   URIs (kept image data: URIs since we render thumbnails).
================================================================ */

import DOMPurify from "dompurify";

export type SanitizeProfile = "rich" | "minimal" | "strict";

const RICH_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "ul", "ol", "li",
    "strong", "em", "u", "s", "code", "pre", "blockquote",
    "table", "thead", "tbody", "tr", "th", "td",
    "a", "span", "div",
  ],
  ALLOWED_ATTR: ["href", "title", "class", "rel", "target"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|#)/i,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "link", "form", "input"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
  KEEP_CONTENT: false,
};

const MINIMAL_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: ["br"],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
};

const STRICT_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
};

const CONFIG_BY_PROFILE: Record<SanitizeProfile, DOMPurify.Config> = {
  rich: RICH_CONFIG,
  minimal: MINIMAL_CONFIG,
  strict: STRICT_CONFIG,
};

/**
 * Sanitize an untrusted HTML string. Every user-supplied / external
 * HTML must route through here before insertion via dangerouslySetInnerHTML.
 *
 * Returns a string suitable for {{__html: ...}}.
 */
export function sanitizeHtml(input: string, profile: SanitizeProfile = "rich"): string {
  if (typeof input !== "string") return "";
  const config = CONFIG_BY_PROFILE[profile];
  return DOMPurify.sanitize(input, config) as unknown as string;
}

/** Returns text-only with no HTML at all. Convenience wrapper. */
export function sanitizeText(input: string): string {
  return sanitizeHtml(input, "strict");
}
