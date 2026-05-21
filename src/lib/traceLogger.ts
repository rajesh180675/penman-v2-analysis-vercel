/**
 * TraceLogger — Always-on structured event tracing for the entire app.
 *
 * Captures every workflow step: parsing, pipeline, valuation, fetch, UI.
 * Persists to localStorage (ring buffer, 2MB cap). Exportable from Debug tab.
 *
 * Usage:
 *   import { trace } from "@/lib/traceLogger";
 *   trace("valuation", "justifiedPB", { roe: 0.19, ke: 0.13 }, { fairPB: 1.76 });
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type TraceCategory =
  | "parse"       // ZIP load, file detection, row counts, header detection
  | "pipeline"    // Recast entry/exit, period key values, anomaly flags
  | "bank"        // Subtype detection, metric computation, null reasons
  | "valuation"   // Each lens input/output, fade factors, triangulation
  | "quality"     // Sidecar load, field density, ECL/CRAR/NPA values
  | "sidecar"     // LGD parse, RBI NHB parse, subsidiary data
  | "mapping"     // Key resolution, misses, spec matches
  | "ui"          // Tab switches, company selection, config changes
  | "fetch"       // NSE proxy, blob fetches, sidecar loads
  | "scope"       // Classification signals, family routing
  | "config"      // Engine config changes, overrides
  | "export";     // Excel/PDF export events

export interface TraceEvent {
  /** ISO timestamp */
  ts: string;
  /** Category for filtering */
  cat: TraceCategory;
  /** Operation name (e.g. "justifiedPB", "parseZip", "fetchNSE") */
  op: string;
  /** Input data / context (kept compact — no huge arrays) */
  input?: Record<string, unknown>;
  /** Output / result */
  output?: Record<string, unknown>;
  /** Duration in ms (when measured) */
  duration_ms?: number;
  /** Optional severity for warnings/errors */
  level?: "info" | "warn" | "error";
  /** Optional human-readable message */
  msg?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "penman_trace_log";
const MAX_EVENTS = 5000;
const MAX_STORAGE_BYTES = 2 * 1024 * 1024; // 2MB localStorage cap
const FLUSH_INTERVAL_MS = 3000; // Flush to localStorage every 3s

// ─── Singleton ──────────────────────────────────────────────────────────────

class TraceLoggerImpl {
  private buffer: TraceEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private sessionStart: string;

  constructor() {
    this.sessionStart = new Date().toISOString();
    this.loadFromStorage();
    this.startFlushTimer();
  }

  /** Record a trace event. */
  log(
    cat: TraceCategory,
    op: string,
    input?: Record<string, unknown> | null,
    output?: Record<string, unknown> | null,
    opts?: { duration_ms?: number; level?: "info" | "warn" | "error"; msg?: string },
  ): void {
    const event: TraceEvent = {
      ts: new Date().toISOString(),
      cat,
      op,
    };
    if (input) event.input = input;
    if (output) event.output = output;
    if (opts?.duration_ms != null) event.duration_ms = opts.duration_ms;
    if (opts?.level) event.level = opts.level;
    if (opts?.msg) event.msg = opts.msg;

    this.buffer.push(event);

    // Ring buffer: trim oldest when exceeding max
    if (this.buffer.length > MAX_EVENTS) {
      this.buffer = this.buffer.slice(-MAX_EVENTS);
    }
  }

  /** Get all events (optionally filtered). */
  getEvents(filter?: { cat?: TraceCategory; level?: "warn" | "error" }): TraceEvent[] {
    let events = this.buffer;
    if (filter?.cat) events = events.filter(e => e.cat === filter.cat);
    if (filter?.level) events = events.filter(e => e.level === filter.level);
    return events;
  }

  /** Get event count by category. */
  getCategoryCounts(): Record<TraceCategory, number> {
    const counts: Record<string, number> = {};
    for (const e of this.buffer) {
      counts[e.cat] = (counts[e.cat] ?? 0) + 1;
    }
    return counts as Record<TraceCategory, number>;
  }

  /** Get summary stats. */
  getSummary(): {
    totalEvents: number;
    sessionStart: string;
    categories: Record<string, number>;
    warnings: number;
    errors: number;
    oldestEvent: string | null;
    newestEvent: string | null;
  } {
    return {
      totalEvents: this.buffer.length,
      sessionStart: this.sessionStart,
      categories: this.getCategoryCounts(),
      warnings: this.buffer.filter(e => e.level === "warn").length,
      errors: this.buffer.filter(e => e.level === "error").length,
      oldestEvent: this.buffer[0]?.ts ?? null,
      newestEvent: this.buffer[this.buffer.length - 1]?.ts ?? null,
    };
  }

  /** Export full trace as JSON string. */
  exportJSON(): string {
    return JSON.stringify({
      exported_at: new Date().toISOString(),
      session_start: this.sessionStart,
      event_count: this.buffer.length,
      events: this.buffer,
    }, null, 2);
  }

  /** Clear all events. */
  clear(): void {
    this.buffer = [];
    this.sessionStart = new Date().toISOString();
    this.flushToStorage();
  }

  /** Flush buffer to localStorage. */
  flushToStorage(): void {
    try {
      const json = JSON.stringify(this.buffer);
      // Check size before writing
      if (json.length > MAX_STORAGE_BYTES) {
        // Trim to fit: keep newest events
        const trimmed = this.buffer.slice(-Math.floor(MAX_EVENTS * 0.7));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } else {
        localStorage.setItem(STORAGE_KEY, json);
      }
    } catch {
      // localStorage full or unavailable — silently continue
    }
  }

  /** Load previous session's trace from localStorage. */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.buffer = parsed;
        }
      }
    } catch {
      // Corrupted data — start fresh
      this.buffer = [];
    }
  }

  /** Start periodic flush to localStorage. */
  private startFlushTimer(): void {
    if (typeof window !== "undefined") {
      this.flushTimer = setInterval(() => this.flushToStorage(), FLUSH_INTERVAL_MS);
      // Also flush on page unload
      window.addEventListener("beforeunload", () => this.flushToStorage());
    }
  }

  /** Stop the flush timer (for testing). */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// ─── Singleton instance ─────────────────────────────────────────────────────

let instance: TraceLoggerImpl | null = null;

function getInstance(): TraceLoggerImpl {
  if (!instance) {
    instance = new TraceLoggerImpl();
  }
  return instance;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Record a trace event. Always-on, no-op overhead is minimal (~1μs per call).
 *
 * @example
 *   trace("valuation", "justifiedPB", { roe: 0.19, ke: 0.13 }, { fairPB: 1.76 });
 *   trace("parse", "zipLoaded", { files: 4, periods: 12 });
 *   trace("fetch", "nsePrice", { ticker: "BAJFINANCE" }, { price: 8500 }, { duration_ms: 230 });
 */
export function trace(
  cat: TraceCategory,
  op: string,
  input?: Record<string, unknown> | null,
  output?: Record<string, unknown> | null,
  opts?: { duration_ms?: number; level?: "info" | "warn" | "error"; msg?: string },
): void {
  getInstance().log(cat, op, input, output, opts);
}

/** Convenience: trace with timing. Returns a function to call when done. */
export function traceStart(
  cat: TraceCategory,
  op: string,
  input?: Record<string, unknown> | null,
): () => void {
  const start = performance.now();
  return (output?: Record<string, unknown> | null) => {
    const duration_ms = Math.round(performance.now() - start);
    getInstance().log(cat, op, input, output ?? undefined, { duration_ms });
  };
}

/** Get the trace logger instance (for Debug panel). */
export function getTraceLogger(): TraceLoggerImpl {
  return getInstance();
}

/** Export trace as downloadable JSON. */
export function exportTraceJSON(): string {
  return getInstance().exportJSON();
}

/** Clear all trace events. */
export function clearTrace(): void {
  getInstance().clear();
}

/** Get trace summary for display. */
export function getTraceSummary() {
  return getInstance().getSummary();
}

/** Get filtered events. */
export function getTraceEvents(filter?: { cat?: TraceCategory; level?: "warn" | "error" }) {
  return getInstance().getEvents(filter);
}
