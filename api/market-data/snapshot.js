import { enforceAuditRateLimit, requireAuditReadAuth } from "../audit/_lib.js";
import { NSE_SYMBOL_REGISTRY } from "./symbolRegistry.js";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function sanitizeSymbol(value) {
  const normalized = sanitizeText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function sanitizeProvider(value) {
  const normalized = sanitizeText(value);
  if (normalized === "manual" || normalized === "upstox-readonly" || normalized === "alphavantage" || normalized === "nse" || normalized === "yahoo" || normalized === "disabled") {
    return normalized;
  }
  return null;
}

async function readJson(url, init = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Market data provider failed with ${response.status}`);
  }
  return await response.json();
}

function computePercentileRank(current, series) {
  if (current == null || !Number.isFinite(current)) return null;
  const cleaned = series.filter((value) => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!cleaned.length) return null;
  const lessOrEqual = cleaned.filter((value) => value <= current).length;
  return lessOrEqual / cleaned.length;
}

function summarizeHistoricalPrices(points, currentPrice) {
  if (!Array.isArray(points) || !points.length) return null;
  const closes = points.map((point) => point.close).filter((value) => Number.isFinite(value));
  if (!closes.length) return null;
  const trailing52Week = points.slice(0, Math.min(points.length, 260));
  const trailingCloses = trailing52Week.map((point) => point.close).filter((value) => Number.isFinite(value));
  const low52Week = trailingCloses.length ? Math.min(...trailingCloses) : null;
  const high52Week = trailingCloses.length ? Math.max(...trailingCloses) : null;
  return {
    points,
    currentPricePercentile: computePercentileRank(currentPrice, closes),
    low52Week,
    high52Week,
    distanceFrom52WeekLowPct: currentPrice != null && low52Week != null && low52Week > 0 ? (currentPrice - low52Week) / low52Week : null,
    drawdownFrom52WeekHighPct: currentPrice != null && high52Week != null && high52Week > 0 ? (currentPrice - high52Week) / high52Week : null,
  };
}

function buildFallbackSnapshot({
  provider,
  symbol,
  instrumentKey,
  fallbackPrice,
  fallbackRiskFreeRate,
  warnings,
  fetchedAt,
  sourceSummary,
}) {
  const freshness = fallbackPrice == null && fallbackRiskFreeRate == null ? "missing" : "fallback";
  return {
    symbol,
    instrumentKey,
    provider,
    fetchedAt,
    price: fallbackPrice,
    previousClose: null,
    changePct: null,
    marketCap: null,
    enterpriseValue: null,
    sharesOutstanding: null,
    riskFreeRate: fallbackRiskFreeRate,
    priceAsOf: null,
    rateAsOf: null,
    freshness,
    sourceSummary,
    warnings,
    history: null,
  };
}

function pickLatestTreasuryYield(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const latest = data.find((entry) => entry?.value != null) ?? null;
  return {
    rate: latest ? toNumber(latest.value) : null,
    asOf: latest?.date ?? null,
  };
}

function parseAlphaVantageQuote(payload) {
  const quote = payload?.["Global Quote"] ?? null;
  if (!quote || typeof quote !== "object") return null;
  return {
    price: toNumber(quote["05. price"]),
    previousClose: toNumber(quote["08. previous close"]),
    changePct: (() => {
      const raw = typeof quote["10. change percent"] === "string" ? quote["10. change percent"].replace("%", "") : null;
      const parsed = toNumber(raw);
      return parsed != null ? parsed / 100 : null;
    })(),
    asOf: new Date().toISOString(),
  };
}

function parseAlphaVantageHistory(payload) {
  const series = payload?.["Time Series (Daily)"] ?? payload?.["Time Series (Daily Adjusted)"] ?? null;
  if (!series || typeof series !== "object") return [];
  return Object.entries(series)
    .map(([date, value]) => ({
      date,
      close: toNumber(value?.["5. adjusted close"] ?? value?.["4. close"]),
    }))
    .filter((entry) => entry.close != null)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 1260);
}

function parseUpstoxQuote(payload, instrumentKey) {
  const data = payload?.data ?? null;
  if (!data || typeof data !== "object") return null;
  const key = instrumentKey && data[instrumentKey] ? instrumentKey : Object.keys(data)[0];
  const quote = key ? data[key] : null;
  if (!quote || typeof quote !== "object") return null;
  const lastPrice = toNumber(quote.last_price ?? quote.lastPrice ?? quote.ltp);
  const prevClose = toNumber(quote.prev_close ?? quote.prevClose ?? quote.ohlc?.close);
  return {
    price: lastPrice,
    previousClose: prevClose,
    changePct: lastPrice != null && prevClose != null && prevClose > 0 ? (lastPrice - prevClose) / prevClose : null,
    asOf: new Date().toISOString(),
    rawSymbol: quote.trading_symbol ?? quote.symbol ?? null,
  };
}

async function fetchAlphaVantageSnapshot({ symbol, fallbackPrice, fallbackRiskFreeRate, warnings, fetchedAt }) {
  const alphaKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!alphaKey) {
    warnings.push("ALPHAVANTAGE_API_KEY is not configured.");
    return buildFallbackSnapshot({
      provider: "Alpha Vantage (fallback)",
      symbol,
      instrumentKey: null,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Using manual/config fallback because Alpha Vantage is not configured.",
    });
  }
  if (!symbol) {
    warnings.push("No market symbol is configured for Alpha Vantage mode.");
    return buildFallbackSnapshot({
      provider: "Alpha Vantage (fallback)",
      symbol,
      instrumentKey: null,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Using manual/config fallback because no Alpha Vantage symbol is configured.",
    });
  }

  try {
    const [quotePayload, treasuryPayload, historyPayload] = await Promise.all([
      readJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(alphaKey)}`),
      readJson(`https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${encodeURIComponent(alphaKey)}`),
      readJson(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&outputsize=full&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(alphaKey)}`),
    ]);
    if (quotePayload?.Note || treasuryPayload?.Note || historyPayload?.Note) {
      warnings.push("Alpha Vantage rate limit response received. Falling back where needed.");
    }
    const quote = parseAlphaVantageQuote(quotePayload);
    const treasury = pickLatestTreasuryYield(treasuryPayload);
    const historyPoints = parseAlphaVantageHistory(historyPayload);
    const price = quote?.price ?? fallbackPrice ?? null;
    const riskFreeRate = treasury.rate != null ? treasury.rate / 100 : fallbackRiskFreeRate ?? null;
    return {
      symbol,
      instrumentKey: null,
      provider: "Alpha Vantage",
      fetchedAt,
      price,
      previousClose: quote?.previousClose ?? null,
      changePct: quote?.changePct ?? null,
      marketCap: null,
      enterpriseValue: null,
      sharesOutstanding: null,
      riskFreeRate,
      priceAsOf: quote?.asOf ?? null,
      rateAsOf: treasury.asOf ?? null,
      freshness: quote?.price != null ? "live" : (price == null && riskFreeRate == null ? "missing" : "fallback"),
      sourceSummary: quote?.price != null
        ? "Alpha Vantage quote feed with Treasury Yield overlay."
        : "Alpha Vantage did not return a live quote; using fallback config where available.",
      warnings,
      history: summarizeHistoricalPrices(historyPoints, price),
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    return buildFallbackSnapshot({
      provider: "Alpha Vantage (fallback)",
      symbol,
      instrumentKey: null,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Using manual/config fallback because Alpha Vantage request failed.",
    });
  }
}

async function fetchUpstoxReadonlySnapshot({ symbol, instrumentKey, fallbackPrice, fallbackRiskFreeRate, warnings, fetchedAt }) {
  const accessToken = process.env.UPSTOX_ACCESS_TOKEN;
  if (!accessToken) {
    warnings.push("UPSTOX_ACCESS_TOKEN is not configured.");
    return buildFallbackSnapshot({
      provider: "Upstox Read-only (fallback)",
      symbol,
      instrumentKey,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Using manual/config fallback because Upstox read-only auth is not configured.",
    });
  }
  if (!instrumentKey) {
    warnings.push("No Upstox instrument key is configured.");
    return buildFallbackSnapshot({
      provider: "Upstox Read-only (fallback)",
      symbol,
      instrumentKey,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Using manual/config fallback because no Upstox instrument key is configured.",
    });
  }

  try {
    const payload = await readJson(
      `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKey)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    const quote = parseUpstoxQuote(payload, instrumentKey);
    const price = quote?.price ?? fallbackPrice ?? null;
    return {
      symbol: symbol ?? quote?.rawSymbol ?? null,
      instrumentKey,
      provider: "Upstox Read-only",
      fetchedAt,
      price,
      previousClose: quote?.previousClose ?? null,
      changePct: quote?.changePct ?? null,
      marketCap: null,
      enterpriseValue: null,
      sharesOutstanding: null,
      riskFreeRate: fallbackRiskFreeRate ?? null,
      priceAsOf: quote?.asOf ?? null,
      rateAsOf: null,
      freshness: quote?.price != null ? "live" : (price == null && fallbackRiskFreeRate == null ? "missing" : "fallback"),
      sourceSummary: quote?.price != null
        ? "Upstox read-only quote feed with manual/config rate fallback."
        : "Upstox did not return a quote; using fallback config where available.",
      warnings: quote?.price != null
        ? [...warnings, "Risk-free rate remains manual/config-driven in Upstox mode."]
        : warnings,
      history: null,
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    return buildFallbackSnapshot({
      provider: "Upstox Read-only (fallback)",
      symbol,
      instrumentKey,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Using manual/config fallback because the Upstox read-only request failed.",
    });
  }
}

const NSE_BASE = "https://www.nseindia.com";
const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

let nseCookieCache = { cookie: null, ts: 0 };

async function getNseCookie() {
  // NSE requires a session cookie from the homepage before API calls work.
  // Cache for 4 minutes (NSE sessions last ~5 min).
  if (nseCookieCache.cookie && Date.now() - nseCookieCache.ts < 240_000) {
    return nseCookieCache.cookie;
  }
  const res = await fetch(NSE_BASE, {
    headers: NSE_HEADERS,
    redirect: "follow",
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  // Extract all cookie key=value pairs
  const cookies = setCookie
    .split(",")
    .map(c => c.split(";")[0].trim())
    .filter(c => c.includes("="))
    .join("; ");
  nseCookieCache = { cookie: cookies, ts: Date.now() };
  return cookies;
}

async function fetchNseQuote(symbol) {
  const cookie = await getNseCookie();
  const url = `${NSE_BASE}/api/quote-equity?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: { ...NSE_HEADERS, Cookie: cookie, Referer: `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` },
  });
  if (!res.ok) throw new Error(`NSE quote API returned ${res.status}`);
  return await res.json();
}

async function fetchNseHistory(symbol) {
  // NSE historical data endpoint — returns ~1 year of daily OHLC
  const cookie = await getNseCookie();
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  const url = `${NSE_BASE}/api/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&from=${fmt(oneYearAgo)}&to=${fmt(today)}`;
  const res = await fetch(url, {
    headers: { ...NSE_HEADERS, Cookie: cookie, Referer: `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` },
  });
  if (!res.ok) return [];
  const payload = await res.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .map(d => ({ date: d.CH_TIMESTAMP ?? d.TIMESTAMP, close: toNumber(d.CH_CLOSING_PRICE ?? d.CLOSE_PRICE) }))
    .filter(d => d.date && d.close != null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function fetchNseSnapshot({ rawSymbol, fallbackPrice, fallbackRiskFreeRate, warnings, fetchedAt }) {
  const symbol = resolveSymbolWithParity(rawSymbol, warnings);
  if (!symbol) {
    warnings.push("No NSE symbol configured.");
    return buildFallbackSnapshot({
      provider: "NSE (fallback)",
      symbol: rawSymbol,
      instrumentKey: null,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Using manual/config fallback because no NSE symbol is configured.",
    });
  }

  try {
    const [quotePayload, historyPoints] = await Promise.all([
      fetchNseQuote(symbol),
      fetchNseHistory(symbol).catch(err => { warnings.push(`NSE history: ${err.message}`); return []; }),
    ]);

    const priceInfo = quotePayload?.priceInfo ?? {};
    const info = quotePayload?.info ?? {};
    const price = toNumber(priceInfo.lastPrice) ?? toNumber(priceInfo.close) ?? fallbackPrice ?? null;
    const previousClose = toNumber(priceInfo.previousClose) ?? null;
    const changePct = price != null && previousClose != null && previousClose > 0
      ? (price - previousClose) / previousClose
      : toNumber(priceInfo.pChange) != null ? toNumber(priceInfo.pChange) / 100 : null;

    // India 10Y G-Sec as risk-free proxy — fallback to config
    const riskFreeRate = fallbackRiskFreeRate ?? 0.07; // default 7% India 10Y

    return {
      symbol,
      instrumentKey: null,
      provider: "NSE India",
      fetchedAt,
      price,
      previousClose,
      changePct,
      marketCap: toNumber(info.totalMarketCap ?? quotePayload?.securityInfo?.totalMarketCap) ?? null,
      enterpriseValue: null,
      sharesOutstanding: toNumber(info.issuedSize ?? quotePayload?.securityInfo?.issuedSize) ?? null,
      riskFreeRate,
      priceAsOf: fetchedAt,
      rateAsOf: null,
      freshness: price != null ? "live" : (fallbackPrice != null ? "fallback" : "missing"),
      sourceSummary: price != null
        ? `NSE India live quote for ${symbol}.`
        : "NSE did not return a live quote; using fallback config where available.",
      warnings,
      history: summarizeHistoricalPrices(historyPoints, price),
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    // NSE often blocks serverless/Vercel — fall back to Yahoo Finance.
    try {
      const yahoo = await fetchYahooSnapshot(symbol);
      const price = yahoo.price ?? fallbackPrice ?? null;
      const previousClose = yahoo.previousClose ?? null;
      const changePct = price != null && previousClose != null && previousClose > 0
        ? (price - previousClose) / previousClose
        : null;
      return {
        symbol,
        instrumentKey: null,
        provider: "Yahoo Finance (NSE fallback)",
        fetchedAt,
        price,
        previousClose,
        changePct,
        marketCap: null,
        enterpriseValue: null,
        sharesOutstanding: null,
        riskFreeRate: fallbackRiskFreeRate ?? 0.07,
        priceAsOf: fetchedAt,
        rateAsOf: null,
        freshness: price != null ? "live" : (fallbackPrice != null ? "fallback" : "missing"),
        sourceSummary: `NSE blocked, used Yahoo Finance for ${yahoo.rawSymbol}.`,
        warnings,
        history: null,
      };
    } catch (yahooErr) {
      warnings.push(yahooErr instanceof Error ? yahooErr.message : String(yahooErr));
      return buildFallbackSnapshot({
        provider: "NSE India (fallback)",
        symbol,
        instrumentKey: null,
        fallbackPrice,
        fallbackRiskFreeRate,
        warnings,
        fetchedAt,
        sourceSummary: "NSE blocked and Yahoo Finance fallback also failed; using manual/config fallback.",
      });
    }
  }
}

async function fetchYahooSnapshot(symbol) {
  const yahooSymbol = symbol.includes(".") ? symbol : `${symbol}.NS`;
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`;
  const yahooRes = await fetch(yahooUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!yahooRes.ok) throw new Error(`Yahoo returned ${yahooRes.status}`);
  const yahooData = await yahooRes.json();
  const meta = yahooData?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("Yahoo returned no data.");
  return {
    price: toNumber(meta.regularMarketPrice),
    previousClose: toNumber(meta.chartPreviousClose),
    rawSymbol: yahooSymbol,
  };
}

function resolveSymbolWithParity(rawSymbol, warnings) {
  if (!rawSymbol) return null;
  const canonical = NSE_SYMBOL_REGISTRY[rawSymbol] ?? null;
  if (canonical && canonical !== rawSymbol) {
    warnings.push(`Ticker parity: requested ${rawSymbol}, resolved to ${canonical}.`);
    return canonical;
  }
  // Also try case-insensitive key match
  const lower = rawSymbol.toLowerCase();
  for (const [key, value] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (key.toLowerCase() === lower) {
      if (value !== rawSymbol) warnings.push(`Ticker parity: requested ${rawSymbol}, resolved to ${value}.`);
      return value;
    }
  }
  return rawSymbol;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const symbol = sanitizeSymbol(request.query?.symbol);
  const instrumentKey = sanitizeText(request.query?.instrumentKey);
  const fallbackPrice = toNumber(request.query?.fallbackPrice);
  const fallbackRiskFreeRate = toNumber(request.query?.fallbackRiskFreeRate);
  const provider = sanitizeProvider(request.query?.provider)
    || sanitizeProvider(process.env.MARKET_DATA_PROVIDER)
    || "manual";
  const warnings = [];
  const fetchedAt = new Date().toISOString();

  if (provider === "upstox-readonly" || provider === "alphavantage" || provider === "nse" || provider === "yahoo") {
    if (!requireAuditReadAuth(request, response)) return;
    if (!enforceAuditRateLimit(request, response, "market-data", 60)) return;
  }

  let snapshot;
  if (provider === "disabled") {
    snapshot = buildFallbackSnapshot({
      provider: "Disabled",
      symbol,
      instrumentKey,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Live market data is disabled. Using manual/config inputs only.",
    });
  } else if (provider === "manual") {
    snapshot = buildFallbackSnapshot({
      provider: "Manual / Fallback",
      symbol,
      instrumentKey,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
      sourceSummary: "Using manual/config market inputs without any vendor API call.",
    });
  } else if (provider === "upstox-readonly") {
    snapshot = await fetchUpstoxReadonlySnapshot({
      symbol,
      instrumentKey,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
    });
  } else if (provider === "nse") {
    snapshot = await fetchNseSnapshot({
      rawSymbol: symbol,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
    });
  } else if (provider === "yahoo") {
    const yahooSymbol = resolveSymbolWithParity(symbol, warnings);
    try {
      const yahoo = await fetchYahooSnapshot(yahooSymbol ?? symbol);
      const price = yahoo.price ?? fallbackPrice ?? null;
      const previousClose = yahoo.previousClose ?? null;
      const changePct = price != null && previousClose != null && previousClose > 0
        ? (price - previousClose) / previousClose
        : null;
      snapshot = {
        symbol: yahooSymbol ?? symbol,
        instrumentKey: null,
        provider: "Yahoo Finance",
        fetchedAt,
        price,
        previousClose,
        changePct,
        marketCap: null,
        enterpriseValue: null,
        sharesOutstanding: null,
        riskFreeRate: fallbackRiskFreeRate ?? 0.07,
        priceAsOf: fetchedAt,
        rateAsOf: null,
        freshness: price != null ? "live" : (fallbackPrice != null ? "fallback" : "missing"),
        sourceSummary: price != null
          ? `Yahoo Finance quote for ${yahoo.rawSymbol}.`
          : "Yahoo Finance did not return a price; using fallback config where available.",
        warnings,
        history: null,
      };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      snapshot = buildFallbackSnapshot({
        provider: "Yahoo Finance (fallback)",
        symbol: yahooSymbol ?? symbol,
        instrumentKey: null,
        fallbackPrice,
        fallbackRiskFreeRate,
        warnings,
        fetchedAt,
        sourceSummary: "Yahoo Finance request failed, using fallback.",
      });
    }
  } else {
    snapshot = await fetchAlphaVantageSnapshot({
      symbol,
      fallbackPrice,
      fallbackRiskFreeRate,
      warnings,
      fetchedAt,
    });
  }

  response.status(200).json({
    ok: true,
    snapshot,
  });
}

