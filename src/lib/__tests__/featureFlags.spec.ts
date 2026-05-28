import { afterEach, describe, expect, it, vi } from "vitest";
import { isEnabled, snapshotFlags } from "../featureFlags";

const ENV_KEY = "VITE_RIGOR_CONCEPT_IDENTITY_BLOCK";

describe("featureFlags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("defaults to enabled when env var is missing", () => {
    expect(isEnabled("rigor.conceptIdentityBlock")).toBe(true);
    expect(isEnabled("rigor.economicSanityBlock")).toBe(true);
    expect(isEnabled("rigor.terminalEligibilityBlock")).toBe(true);
    expect(isEnabled("rigor.residualScoreDowngrade")).toBe(true);
  });

  it("disables when env var is literally 'false'", () => {
    vi.stubEnv(ENV_KEY, "false");
    expect(isEnabled("rigor.conceptIdentityBlock")).toBe(false);
  });

  it("disables when env var is 'FALSE' (case-insensitive)", () => {
    vi.stubEnv(ENV_KEY, "FALSE");
    expect(isEnabled("rigor.conceptIdentityBlock")).toBe(false);
  });

  it("treats malformed values as enabled (fail-safe)", () => {
    vi.stubEnv(ENV_KEY, "yes");
    expect(isEnabled("rigor.conceptIdentityBlock")).toBe(true);
    vi.stubEnv(ENV_KEY, "0");
    expect(isEnabled("rigor.conceptIdentityBlock")).toBe(true);
    vi.stubEnv(ENV_KEY, "");
    expect(isEnabled("rigor.conceptIdentityBlock")).toBe(true);
  });

  it("treats 'true' explicitly as enabled", () => {
    vi.stubEnv(ENV_KEY, "true");
    expect(isEnabled("rigor.conceptIdentityBlock")).toBe(true);
  });

  it("snapshotFlags reports state of every flag", () => {
    vi.stubEnv(ENV_KEY, "false");
    const snap = snapshotFlags();
    expect(snap["rigor.conceptIdentityBlock"]).toBe(false);
    expect(snap["rigor.economicSanityBlock"]).toBe(true);
    expect(snap["rigor.terminalEligibilityBlock"]).toBe(true);
    expect(snap["rigor.residualScoreDowngrade"]).toBe(true);
  });
});
