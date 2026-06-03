import * as React from "react";
import { vi } from "vitest";

// Vitest/jsdom layout shims for chart-heavy component tests.
//
// Recharts' ResponsiveContainer relies on ResizeObserver / element dimensions.
// jsdom has no layout engine, so containers otherwise report -1/0 dimensions and
// every chart test emits noisy "width(-1) and height(-1)" warnings. The DOM
// shims below make ordinary measurements deterministic; the Recharts mock keeps
// chart tests on the public chart components while replacing only the layout
// container that cannot work correctly in jsdom.

const DEFAULT_TEST_WIDTH = 1024;
const DEFAULT_TEST_HEIGHT = 768;

type ResponsiveContainerTestProps = {
  children?: React.ReactNode;
  width?: number | string;
  height?: number | string;
  aspect?: number;
  className?: string;
  style?: React.CSSProperties;
  debounce?: number;
  minWidth?: number | string;
  minHeight?: number | string;
  onResize?: (width: number, height: number) => void;
};

function parsePositivePx(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toPositiveSize(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") return parsePositivePx(value) ?? fallback;
  return fallback;
}

function testElementWidth(element: Element): number {
  if (element instanceof HTMLElement) {
    return parsePositivePx(element.style.width) ?? DEFAULT_TEST_WIDTH;
  }
  return DEFAULT_TEST_WIDTH;
}

function testElementHeight(element: Element): number {
  if (element instanceof HTMLElement) {
    return parsePositivePx(element.style.height) ?? DEFAULT_TEST_HEIGHT;
  }
  return DEFAULT_TEST_HEIGHT;
}

function TestResponsiveContainer({
  children,
  width = "100%",
  height,
  aspect,
  className,
  style,
  onResize,
}: ResponsiveContainerTestProps) {
  const chartWidth = toPositiveSize(width, DEFAULT_TEST_WIDTH);
  const chartHeight = height !== undefined
    ? toPositiveSize(height, DEFAULT_TEST_HEIGHT)
    : (aspect && aspect > 0 ? Math.round(chartWidth / aspect) : DEFAULT_TEST_HEIGHT);

  onResize?.(chartWidth, chartHeight);

  const chart = React.isValidElement(children)
    ? React.cloneElement(children, { width: chartWidth, height: chartHeight } as Record<string, unknown>)
    : children;

  return React.createElement(
    "div",
    {
      className,
      "data-testid": "test-responsive-container",
      style: {
        width,
        height: height ?? chartHeight,
        ...style,
      },
    },
    chart,
  );
}

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: TestResponsiveContainer,
  };
});

class TestResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const width = testElementWidth(target);
    const height = testElementHeight(target);
    const contentRect = {
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
      toJSON: () => ({ x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0 }),
    } as DOMRectReadOnly;

    this.callback([
      {
        target,
        contentRect,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry,
    ], this as unknown as ResizeObserver);
  }

  unobserve(): void {
    // No-op: jsdom does not perform real layout observation.
  }

  disconnect(): void {
    // No-op: jsdom does not perform real layout observation.
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: TestResizeObserver,
});

if (typeof HTMLElement !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return testElementWidth(this);
    },
  });

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return testElementHeight(this);
    },
  });
}

if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
  const getComputedStyleWithoutPseudo = window.getComputedStyle.bind(window);

  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: (element: Element) => getComputedStyleWithoutPseudo(element),
  });
}

const assertWithSignalOnly = console.assert.bind(console);
console.assert = (condition?: boolean, ...args: unknown[]) => {
  const message = args[0];
  if (
    condition === false
    && typeof message === "string"
    && message.startsWith("engine invariant violated:")
  ) {
    // Several residual/distress specs intentionally build impossible synthetic
    // periods to test fail-closed gates. Keep those expected debug assertions
    // from drowning out real stderr while preserving all other console.asserts.
    return;
  }
  assertWithSignalOnly(condition, ...args);
};
