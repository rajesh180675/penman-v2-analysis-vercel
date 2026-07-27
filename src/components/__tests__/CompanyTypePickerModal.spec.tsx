/** @vitest-environment jsdom (mounts through react-dom/client) */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompanyTypePickerModal, { registryTypeToDefault } from "../data-entry/CompanyTypePickerModal";

const noop = () => {};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountModal(root: Root, company: Parameters<typeof CompanyTypePickerModal>[0]["company"]) {
  return act(async () => {
    root.render(
      <CompanyTypePickerModal
        company={company}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
  });
}

describe("CompanyTypePickerModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("maps registry types to explicit analysis pipeline defaults", () => {
    expect(registryTypeToDefault("consumer")).toBe("consumer");
    expect(registryTypeToDefault("nbfc")).toBe("nbfc");
    expect(registryTypeToDefault("insurance")).toBe("insurance");
    expect(registryTypeToDefault("conglomerate")).toBe("industrial");
    expect(registryTypeToDefault("loss-maker")).toBe("industrial");
  });

  it("resets the selected pipeline when a company is picked after the null mount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await mountModal(root, null);
    expect(container.querySelector("select")).toBeNull();

    await mountModal(root, {
      folder: "Asian Paints",
      ticker: "ASIANPAINT",
      type: "consumer",
      hasStandalone: true,
    });
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("consumer");

    await mountModal(root, {
      folder: "Bajaj Finance",
      ticker: "BAJFINANCE",
      type: "nbfc",
      hasStandalone: true,
    });
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("nbfc");

    await act(async () => root.unmount());
  });
});
