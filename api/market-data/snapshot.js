function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function sanitizeSymbol(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized : null;
}

async function readJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Market data provider failed with ${response.status}`);
  }
  return await response.json();
}

function pickLatestTreasuryYield(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const latest = data.find((entry) => entry?.value != null) ?? null;
  return {
    rate: latest ? toNumber(latest.value) : null,
    asOf: latest?.date ?? null,
  };
}

function parseGlobalQuote(payload) {
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

function parseDailyAdjusted(payload) {
  const series = payload?.["Time Series (Daily)"] ?? null;
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

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const symbol = sanitizeSymbol(request.query?.symbol);
  const fallbackPrice = toNumber(request.query?.fallbackPrice);
  const fallbackRiskFreeRate = toNumber(request.query?.fallbackRiskFreeRate);
  const alphaKey = process.env.ALPHAVANTAGE_API_KEY;
  const provider = process.env.MARKET_DATA_PROVIDER || (alphaKey ? "alphavantage" : "disabled");
  const warnings = [];

  let quote = null;
  let treasury = null;
  let historyPoints = [];
  let freshness = "fallback";

  if (provider === "alphavantage" && alphaKey && symbol) {
    try {
      const [quotePayload, treasuryPayload, historyPayload] = await Promise.all([
        readJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(alphaKey)}`),
        readJson(`https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${encodeURIComponent(alphaKey)}`),
        readJson(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&outputsize=full&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(alphaKey)}`),
      ]);
      if (quotePayload?.Note || treasuryPayload?.Note || historyPayload?.Note) {
        warnings.push("Alpha Vantage rate limit response received. Falling back where needed.");
      }
      quote = parseGlobalQuote(quotePayload);
      treasury = pickLatestTreasuryYield(treasuryPayload);
      historyPoints = parseDailyAdjusted(historyPayload);
      if (quote?.price != null) freshness = "live";
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  } else if (provider === "alphavantage" && !alphaKey) {
    warnings.push("ALPHAVANTAGE_API_KEY is not configured; using fallback market inputs.");
  } else if (!symbol) {
    warnings.push("No market symbol is configured; using fallback market inputs.");
  }

  const price = quote?.price ?? fallbackPrice ?? null;
  const riskFreeRate = treasury?.rate != null ? treasury.rate / 100 : fallbackRiskFreeRate ?? null;
  if (price == null && riskFreeRate == null) freshness = "missing";
  else if (freshness !== "live") freshness = "fallback";

  response.status(200).json({
    ok: true,
    snapshot: {
      symbol,
      provider: provider === "alphavantage" ? "Alpha Vantage" : "Fallback",
      fetchedAt: new Date().toISOString(),
      price,
      previousClose: quote?.previousClose ?? null,
      changePct: quote?.changePct ?? null,
      marketCap: null,
      enterpriseValue: null,
      sharesOutstanding: null,
      riskFreeRate,
      priceAsOf: quote?.asOf ?? null,
      rateAsOf: treasury?.asOf ?? null,
      freshness,
      sourceSummary: freshness === "live"
        ? "Alpha Vantage quote feed with Treasury Yield overlay."
        : "Fallback to current config because live market inputs were unavailable.",
      warnings,
      history: summarizeHistoricalPrices(historyPoints, price),
    },
  });
}
