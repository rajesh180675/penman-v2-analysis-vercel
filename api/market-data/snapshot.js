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
  if (normalized === "manual" || normalized === "upstox-readonly" || normalized === "alphavantage" || normalized === "disabled") {
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

