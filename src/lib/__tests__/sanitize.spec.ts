/* ================================================================
   Plan 6 PR-6.1 — sanitize contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { sanitizeHtml, sanitizeText } from "../sanitize";

describe("sanitizeHtml (Plan 6 PR-6.1)", () => {
  it("allows safe HTML tags through 'rich' profile", () => {
    const out = sanitizeHtml("<p>Hello <strong>world</strong></p>");
    expect(out).toContain("<p>");
    expect(out).toContain("<strong>");
  });

  it("strips <script> always", () => {
    const out = sanitizeHtml("<p>safe content</p><script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("alert(1)");
  });

  it("strips <iframe> always", () => {
    const out = sanitizeHtml("<iframe src='evil.com'></iframe>");
    expect(out).not.toContain("<iframe");
  });

  it("strips on* event handlers", () => {
    const out = sanitizeHtml('<p onclick="alert(1)">x</p>');
    expect(out).not.toContain("onclick");
  });

  it("strips javascript: URIs in href", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("preserves https: hrefs", () => {
    const out = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
  });

  it("'minimal' profile strips all tags except <br>", () => {
    const out = sanitizeHtml("<p>line one</p><br/><strong>bold</strong>", "minimal");
    expect(out).not.toContain("<p>");
    expect(out).not.toContain("<strong>");
    expect(out).toContain("<br>");
  });

  it("'strict' profile returns text only", () => {
    const out = sanitizeHtml("<p>Hello <strong>world</strong></p>", "strict");
    expect(out).toBe("Hello world");
  });

  it("non-string input returns empty string", () => {
    expect(sanitizeHtml(null as unknown as string)).toBe("");
    expect(sanitizeHtml(undefined as unknown as string)).toBe("");
    expect(sanitizeHtml(123 as unknown as string)).toBe("");
  });

  it("sanitizeText strips all HTML", () => {
    expect(sanitizeText("<p><strong>x</strong></p>")).toBe("x");
  });

  it("preserves table structure in rich profile", () => {
    const out = sanitizeHtml("<table><tr><td>x</td></tr></table>");
    expect(out).toContain("<table>");
    expect(out).toContain("<td>");
  });

  it("strips <style> always (CSS injection vector)", () => {
    const out = sanitizeHtml("<style>body{display:none}</style><p>x</p>");
    expect(out).not.toContain("<style>");
  });
});
