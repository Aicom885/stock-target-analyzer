function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function getEnv(name) {
  if (globalThis.Netlify?.env?.get) return Netlify.env.get(name);
  return process.env[name];
}

function parseModelJson(text) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型回傳不是 JSON。");
    return JSON.parse(match[0]);
  }
}

function normalizeAnalysis(data, fallbackTicker) {
  const result = {
    ticker: data.ticker || fallbackTicker,
    name: data.name || fallbackTicker,
    currency: data.currency || "",
    price: Number(data.price),
    priceDate: data.priceDate || "",
    cheapPrice: Number(data.cheapPrice),
    fairPrice: Number(data.fairPrice),
    expensivePrice: Number(data.expensivePrice),
    currentZone: data.currentZone || "",
    upsideToFairPct: Number(data.upsideToFairPct),
    epsBasis: data.epsBasis || "",
    peerAnchorBasis: data.peerAnchorBasis || "",
    verdict: data.verdict || "",
    confidenceNote: data.confidenceNote || "",
    peers: Array.isArray(data.peers) ? data.peers : [],
    epsSources: Array.isArray(data.epsSources) ? data.epsSources : [],
    sources: Array.isArray(data.sources) ? data.sources : []
  };

  for (const key of ["price", "cheapPrice", "fairPrice", "expensivePrice", "upsideToFairPct"]) {
    if (!Number.isFinite(result[key])) throw new Error(`模型缺少有效數字欄位：${key}`);
  }
  return result;
}

function buildPrompt(ticker) {
  return `
你是專業、犀利、數據導向的賣方首席分析師。請先網路搜尋，再用繁體中文分析股票「${ticker}」今年目標價。今日日期 2026-06-26，使用者在台灣。

必做：
1. 找同業 2-3 家以上 Forward P/E，列數字與來源。
2. 找 Morgan Stanley、高盛、JPMorgan、BofA 或可信財經媒體對今年 EPS 預估；若找不到，明確標低信心度並自估。
3. 計算：
合理價 = 今年 EPS × 同業錨點本益比
便宜價 = 合理價 × 0.8
昂貴價 = 樂觀 EPS × 牛市倍數。

只回有效 JSON，不要 Markdown。schema：
{"ticker":"","name":"","currency":"","price":0,"priceDate":"","cheapPrice":0,"fairPrice":0,"expensivePrice":0,"currentZone":"","upsideToFairPct":0,"epsBasis":"","peerAnchorBasis":"","confidenceNote":"","verdict":"","peers":[{"company":"","relationship":"","forwardPe":"","source":""}],"epsSources":[{"institution":"","eps":"","publishedAt":"","confidence":"","source":""}],"sources":[{"title":"","url":""}]}
`.trim();
}

async function analyzeStock(ticker, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: getEnv("OPENAI_MODEL") || "gpt-4o-mini-search-preview",
      web_search_options: { search_context_size: "low" },
      messages: [
        { role: "system", content: "你是嚴謹的賣方首席分析師。必須先搜尋最新資料，並只輸出有效 JSON。" },
        { role: "user", content: buildPrompt(ticker) }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI API HTTP ${response.status}`);
  return normalizeAnalysis(parseModelJson(payload.choices?.[0]?.message?.content || ""), ticker);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = getEnv("OPENAI_API_KEY");
  if (!apiKey) return json(500, { error: "Netlify 環境變數缺少 OPENAI_API_KEY。" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON 格式錯誤。" });
  }

  const ticker = String(body.ticker || "").trim();
  if (!/^[\p{L}\p{N}.\- ]{1,32}$/u.test(ticker)) {
    return json(400, { error: "請輸入有效股票代號或公司名稱。" });
  }

  try {
    return json(200, { analysis: await analyzeStock(ticker, apiKey) });
  } catch (error) {
    return json(500, { error: error.message || "分析失敗。" });
  }
};
