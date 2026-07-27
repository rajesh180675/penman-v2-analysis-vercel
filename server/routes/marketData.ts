import { Router, Request, Response } from "express";
import { resolveNseSymbol } from "../../src/engine/nseSymbolRegistry";
import { marketCachePath, readJson, writeJson, listFiles } from "../store/fsStore";

const NSE_BASE = "https://www.nseindia.com";
const NSE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

let nseCookieCache: { cookie: string | null; ts: number } = { cookie: null, ts: 0 };

async function getNseCookie(): Promise<string> {
  if (nseCookieCache.cookie && Date.now() - nseCookieCache.ts < 240_000) {
    return nseCookieCache.cookie;
  }
  const res = await fetch(NSE_BASE, { headers: NSE_HEADERS, redirect: "follow" });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookies = setCookie
    .split(",")
    .map(c => c.split(";")[0]!.trim())
    .filter(c => c.includes("="))
    .join("; ");
  nseCookieCache = { cookie: cookies, ts: Date.now() };
  return cookies;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computePercentileRank(current: number | null, series: (number | null)[]): number | null {
  if (current == null || !Number.isFinite(current)) return null;
  const cleaned = series.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!cleaned.length) return null;
  const lessOrEqual = cleaned.filter(v => v <= current).length;
  return lessOrEqual / cleaned.length;
}

/**
 * The third-party JSON shapes this route reads. Declared rather than left as
 * `any` because `any` makes the *reads* unchecked too: `priceInfo.lastPrice`
 * typechecks as a number even when NSE served an HTML block page, which is how
 * this file has produced silent numeric defects before.
 *
 * Every leaf stays `unknown` on purpose. These payloads are unversioned and
 * outside our control, so a renamed or absent key must be forced through
 * `toNumber` rather than trusted. The assertions below are unchecked — what
 * they buy is checked reads, not a validated payload.
 */
interface NseQuotePriceInfo {
  readonly lastPrice?: unknown;
  readonly close?: unknown;
  readonly previousClose?: unknown;
}

interface NseQuoteInfo {
  readonly totalMarketCap?: unknown;
  readonly issuedSize?: unknown;
}

interface NseQuotePayload {
  readonly priceInfo?: NseQuotePriceInfo;
  readonly info?: NseQuoteInfo;
}

interface NseHistoryRow {
  readonly CH_TIMESTAMP?: unknown;
  readonly TIMESTAMP?: unknown;
  readonly CH_CLOSING_PRICE?: unknown;
  readonly CLOSE_PRICE?: unknown;
}

interface YahooChartPayload {
  readonly chart?: {
    readonly result?: readonly {
      readonly meta?: {
        readonly regularMarketPrice?: unknown;
        readonly chartPreviousClose?: unknown;
      };
    }[];
  };
}

/** One close observation, after both leaves have been narrowed. */
interface HistoryPoint {
  readonly date: string;
  readonly close: number | null;
}

/** Message from an unknown throw, matching this repo's narrowing convention. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchNseQuote(symbol: string): Promise<NseQuotePayload | null> {
  const cookie = await getNseCookie();
  const url = `${NSE_BASE}/api/quote-equity?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: { ...NSE_HEADERS, Cookie: cookie, Referer: `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` },
  });
  if (!res.ok) throw new Error(`NSE quote API returned ${res.status}`);
  return await res.json() as NseQuotePayload | null;
}

async function fetchNseHistory(symbol: string) {
  const cookie = await getNseCookie();
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  const url = `${NSE_BASE}/api/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&from=${fmt(oneYearAgo)}&to=${fmt(today)}`;
  try {
    const res = await fetch(url, {
      headers: { ...NSE_HEADERS, Cookie: cookie, Referer: `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` },
    });
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return []; // NSE sometimes returns HTML (rate-limit/block)
    const payload = await res.json() as { readonly data?: unknown } | null;
    const data = payload?.data;
    const rows: readonly NseHistoryRow[] = Array.isArray(data) ? data as NseHistoryRow[] : [];
    return rows
      .map((row): { date: unknown; close: number | null } => ({
        date: row.CH_TIMESTAMP ?? row.TIMESTAMP,
        close: toNumber(row.CH_CLOSING_PRICE ?? row.CLOSE_PRICE),
      }))
      // The string check is what makes the sort below safe, not a cosmetic
      // narrowing: `date` arrives as `unknown` and `localeCompare` is a string
      // method. Under the previous `any` a numeric timestamp typechecked here
      // and threw at sort time, which the outer catch swallowed into an empty
      // history — so a partial payload lost every point, silently.
      .filter((point): point is HistoryPoint => typeof point.date === "string" && point.date !== "" && point.close != null)
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return []; // Gracefully handle any parse/network error
  }
}

function summarizeHistory(points: readonly HistoryPoint[], currentPrice: number | null) {
  if (!points.length) return null;
  const closes = points.map(p => p.close).filter((v): v is number => v != null && Number.isFinite(v));
  if (!closes.length) return null;
  const trailing = closes.slice(0, 260);
  const low52 = trailing.length ? Math.min(...trailing) : null;
  const high52 = trailing.length ? Math.max(...trailing) : null;
  return {
    points: points.slice(0, 260),
    currentPricePercentile: computePercentileRank(currentPrice, closes),
    low52Week: low52,
    high52Week: high52,
    distanceFrom52WeekLowPct: currentPrice != null && low52 != null && low52 > 0 ? (currentPrice - low52) / low52 : null,
    drawdownFrom52WeekHighPct: currentPrice != null && high52 != null && high52 > 0 ? (currentPrice - high52) / high52 : null,
  };
}

function yahooSymbol(symbol: string): string {
  return symbol.includes(".") ? symbol : `${symbol}.NS`;
}

async function fetchYahooSnapshot(symbol: string) {
  const sym = yahooSymbol(symbol);
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
  const yahooRes = await fetch(yahooUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!yahooRes.ok) throw new Error(`Yahoo returned ${yahooRes.status}`);
  const yahooData = await yahooRes.json() as YahooChartPayload | null;
  const meta = yahooData?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("Yahoo returned no data.");
  const price = toNumber(meta.regularMarketPrice);
  const previousClose = toNumber(meta.chartPreviousClose);
  return { price, previousClose, symbol: sym };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function cacheSnapshot(symbol: string, snapshot: unknown) {
  try {
    await writeJson(marketCachePath(symbol, todayKey()), snapshot);
  } catch {
    // Caching is best-effort; don't fail the request.
  }
}

async function readOfflineSnapshot(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const dir = marketCachePath(symbol, todayKey()).replace(/[\\/][^\\/]+$/, "");
    const files = await listFiles(dir, ".json");
    const matching = files
      .filter(f => f.includes(`${symbol}-`))
      .sort((a, b) => b.localeCompare(a));
    if (!matching.length) return null;
    const cached = await readJson<Record<string, unknown>>(matching[0]!);
    if (!cached) return null;
    return {
      ...cached,
      freshness: "offline",
      provider: `${cached.provider ?? "Unknown"} (offline cache)`,
      sourceSummary: `Serving cached market snapshot because live fetch failed.`,
    };
  } catch {
    return null;
  }
}

/**
 * Apply ticker parity check: registry tickers can drift from the actual
 * NSE/Yahoo symbol. resolveNseSymbol is the single source of truth.
 */
function normalizeSymbol(raw: string, warnings: string[]): string {
  const canonical = resolveNseSymbol(raw);
  if (canonical && canonical !== raw) {
    warnings.push(`Ticker parity: requested ${raw}, resolved to ${canonical}.`);
    return canonical;
  }
  return raw;
}

/**
 * Every snapshot value must ship with its own pinned as-of date.
 *
 * The AnalysisRun request-validation gate rejects a snapshot that carries a
 * price or risk-free rate without one (MARKET_PRICE_DATE_REQUIRED /
 * MARKET_RATE_DATE_REQUIRED). That rejection blocks the run *before* the
 * pipeline runs, so the UI projection gets no pipelineResult, recastData comes
 * back empty, and every data-gated tab (dashboard, statements, ratios, quality,
 * valuation, report) disappears. Branches below default riskFreeRate to 0.07,
 * so they must pin rateAsOf too — the Vercel handler already does.
 */
function pinAsOfDates<T extends Record<string, unknown>>(snapshot: T): T {
  // Prefer the snapshot's own fetch time so a cached entry keeps honest
  // provenance instead of being restamped as if it were just fetched.
  const asOf = typeof snapshot.fetchedAt === "string" ? snapshot.fetchedAt : new Date().toISOString();
  return {
    ...snapshot,
    priceAsOf: snapshot.price != null ? (snapshot.priceAsOf ?? asOf) : null,
    rateAsOf: snapshot.riskFreeRate != null ? (snapshot.rateAsOf ?? asOf) : null,
  };
}

/**
 * Single exit point for every snapshot response, so the value/as-of pairing
 * cannot be broken again by one branch. This also repairs snapshots read back
 * from the on-disk cache, which may have been written before this invariant
 * existed and would otherwise keep blocking runs until they aged out.
 */
function sendSnapshot(res: Response, snapshot: Record<string, unknown>) {
  return res.json({ ok: true, snapshot: pinAsOfDates(snapshot) });
}

const router = Router();

router.get("/snapshot", async (req: Request, res: Response) => {
  let symbol = (req.query.symbol as string ?? "").toUpperCase().trim();
  const provider = (req.query.provider as string ?? "manual").toLowerCase();
  const fallbackPrice = toNumber(req.query.fallbackPrice);
  const fallbackRiskFreeRate = toNumber(req.query.fallbackRiskFreeRate);
  const fetchedAt = new Date().toISOString();
  const warnings: string[] = [];

  if (provider === "manual" || provider === "disabled") {
    return sendSnapshot(res, {
      symbol, provider: "Manual / Fallback", fetchedAt,
      price: fallbackPrice, previousClose: null, changePct: null,
      marketCap: null, enterpriseValue: null, sharesOutstanding: null,
      riskFreeRate: fallbackRiskFreeRate,
      freshness: fallbackPrice != null ? "fallback" : "missing",
      sourceSummary: "Using manual/config market inputs without any vendor API call.",
      warnings, history: null,
    });
  }

  if (provider === "nse" || provider === "yahoo") {
    if (!symbol) {
      warnings.push(`No symbol configured for ${provider.toUpperCase()}.`);
      return sendSnapshot(res, {
        symbol, provider: `${provider.toUpperCase()} (fallback)`, fetchedAt,
        price: fallbackPrice, previousClose: null, changePct: null,
        marketCap: null, enterpriseValue: null, sharesOutstanding: null,
        riskFreeRate: fallbackRiskFreeRate ?? 0.07,
        freshness: fallbackPrice != null ? "fallback" : "missing",
        sourceSummary: `No symbol configured for ${provider.toUpperCase()}.`, warnings, history: null,
      });
    }

    symbol = normalizeSymbol(symbol, warnings);

    if (provider === "nse") {
      try {
        const [quotePayload, historyPoints] = await Promise.all([
          fetchNseQuote(symbol),
          // `.catch`'s reason is `any` by Promise's own typing, so `err.message`
          // typechecked here on a non-Error throw and would have pushed
          // "NSE history: undefined". `getNseCookie` is awaited outside
          // fetchNseHistory's try block, so a DNS/TLS failure does reach here.
          fetchNseHistory(symbol).catch((error: unknown) => { warnings.push(`NSE history: ${errorMessage(error)}`); return []; }),
        ]);

        // Annotated rather than inferred: `?? {}` would otherwise widen to
        // `NseQuotePriceInfo | {}` and the reads below would not typecheck.
        const priceInfo: NseQuotePriceInfo = quotePayload?.priceInfo ?? {};
        const info: NseQuoteInfo = quotePayload?.info ?? {};
        const price = toNumber(priceInfo.lastPrice) ?? toNumber(priceInfo.close) ?? fallbackPrice ?? null;
        const previousClose = toNumber(priceInfo.previousClose) ?? null;
        const changePct = price != null && previousClose != null && previousClose > 0
          ? (price - previousClose) / previousClose
          : null;

        const snapshot = {
          symbol, instrumentKey: null, provider: "NSE India", fetchedAt,
          price, previousClose, changePct,
          marketCap: toNumber(info.totalMarketCap) ?? null,
          enterpriseValue: null,
          sharesOutstanding: toNumber(info.issuedSize) ?? null,
          riskFreeRate: fallbackRiskFreeRate ?? 0.07,
          priceAsOf: fetchedAt, rateAsOf: null,
          freshness: price != null ? "live" : "fallback" as const,
          sourceSummary: price != null ? `NSE India live quote for ${symbol}.` : "NSE did not return a live quote.",
          warnings,
          // The `as any` here is gone rather than replaced: once fetchNseHistory
          // returns HistoryPoint[], this call typechecks on its own.
          history: summarizeHistory(historyPoints, price),
        };
        await cacheSnapshot(symbol, snapshot);
        return sendSnapshot(res, snapshot);
      } catch (error) {
        warnings.push(`NSE failed: ${errorMessage(error)}. Falling back to Yahoo Finance.`);
        // Cascade to Yahoo Finance as fallback
        try {
          const yahoo = await fetchYahooSnapshot(symbol);
          const price = yahoo.price ?? fallbackPrice;
          const previousClose = yahoo.previousClose;
          const changePct = price != null && previousClose != null && previousClose > 0
            ? (price - previousClose) / previousClose
            : null;
          const snapshot = {
            symbol, provider: "Yahoo Finance (NSE fallback)", fetchedAt,
            price, previousClose, changePct,
            marketCap: null, enterpriseValue: null, sharesOutstanding: null,
            riskFreeRate: fallbackRiskFreeRate ?? 0.07,
            freshness: price != null ? "live" : "fallback" as const,
            sourceSummary: `NSE blocked, used Yahoo Finance for ${yahoo.symbol}.`,
            warnings, history: null,
          };
          await cacheSnapshot(symbol, snapshot);
          return sendSnapshot(res, snapshot);
        } catch (yahooErr) {
          warnings.push(`Yahoo fallback also failed: ${errorMessage(yahooErr)}`);
          const offline = await readOfflineSnapshot(symbol);
          if (offline) {
            return sendSnapshot(res, offline);
          }
          return sendSnapshot(res, {
            symbol, provider: "NSE India (all fallbacks failed)", fetchedAt,
            price: fallbackPrice, previousClose: null, changePct: null,
            marketCap: null, enterpriseValue: null, sharesOutstanding: null,
            riskFreeRate: fallbackRiskFreeRate ?? 0.07,
            freshness: fallbackPrice != null ? "fallback" : "missing",
            sourceSummary: "Both NSE and Yahoo Finance failed.", warnings, history: null,
          });
        }
      }
    }

    // provider === "yahoo"
    try {
      const yahoo = await fetchYahooSnapshot(symbol);
      const price = yahoo.price ?? fallbackPrice;
      const previousClose = yahoo.previousClose;
      const changePct = price != null && previousClose != null && previousClose > 0
        ? (price - previousClose) / previousClose
        : null;
      const snapshot = {
        symbol, provider: "Yahoo Finance", fetchedAt,
        price, previousClose, changePct,
        marketCap: null, enterpriseValue: null, sharesOutstanding: null,
        riskFreeRate: fallbackRiskFreeRate ?? 0.07,
        freshness: price != null ? "live" : "fallback" as const,
        sourceSummary: price != null ? `Yahoo Finance quote for ${yahoo.symbol}.` : "Yahoo did not return a price.",
        warnings, history: null,
      };
      await cacheSnapshot(symbol, snapshot);
      return sendSnapshot(res, snapshot);
    } catch (error) {
      warnings.push(errorMessage(error));
      const offline = await readOfflineSnapshot(symbol);
      if (offline) {
        return sendSnapshot(res, offline);
      }
      return sendSnapshot(res, {
        symbol, provider: "Yahoo Finance (fallback)", fetchedAt,
        price: fallbackPrice, previousClose: null, changePct: null,
        marketCap: null, enterpriseValue: null, sharesOutstanding: null,
        riskFreeRate: fallbackRiskFreeRate ?? 0.07,
        freshness: fallbackPrice != null ? "fallback" : "missing",
        sourceSummary: "Yahoo Finance request failed, using fallback.", warnings, history: null,
      });
    }
  }

  // Default fallback for unsupported providers in local mode
  warnings.push(`Provider "${provider}" not supported in local mode. Use "nse" or "manual".`);
  return sendSnapshot(res, {
    symbol, provider: `${provider} (unsupported locally)`, fetchedAt,
    price: fallbackPrice, previousClose: null, changePct: null,
    marketCap: null, enterpriseValue: null, sharesOutstanding: null,
    riskFreeRate: fallbackRiskFreeRate,
    freshness: fallbackPrice != null ? "fallback" : "missing",
    sourceSummary: `Provider "${provider}" requires Vercel deployment. Use "nse" for local.`,
    warnings, history: null,
  });
});

export default router;
