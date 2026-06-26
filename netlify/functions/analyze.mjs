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

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
      if (content.type === "text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
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
你是一位精通估值方法的賣方首席分析師，語氣專業犀利、數據導向、不講廢話。請先使用網路搜尋，再分析股票「${ticker}」今年目標價。

今日日期：2026-06-26。使用者在台灣，請用繁體中文。

必要步驟：
1. Auto-Anchor：搜尋該公司同業競爭者目前的 Forward P/E，至少 2-3 家可比公司，標明資料來源。
2. EPS Mining：搜尋 Morgan Stanley、高盛、JPMorgan、BofA、外資券商或可信財經媒體對該股票今年全年 EPS 預估。若無外資覆蓋，改用自建估算並明確標示低信心度。
3. Pricing：
   合理價 = 今年 EPS × 同業錨點本益比
   便宜價 = 合理價 × 0.8
   昂貴價 = 樂觀 EPS × 牛市倍數，牛市倍數通常取錨點倍數 1.3-1.5 倍，依產業判斷。

只回傳 JSON，不要 Markdown，不要多餘文字。JSON schema：
{
  "ticker": "股票代號",
  "name": "公司名稱",
  "currency": "TWD 或 USD 等",
  "price": 123.45,
  "priceDate": "現價日期與口徑",
  "cheapPrice": 100,
  "fairPrice": 125,
  "expensivePrice": 180,
  "currentZone": "便宜價以下 / 便宜至合理 / 合理至昂貴 / 昂貴價以上",
  "upsideToFairPct": 12.3,
  "epsBasis": "今年 EPS 依據，含採用值與原因",
  "peerAnchorBasis": "同業錨點依據，含採用倍數與原因",
  "confidenceNote": "資料來源信心度說明",
  "verdict": "一句話判決：現在值不值得買，主要風險在哪裡",
  "peers": [
    {"company":"公司", "relationship":"關聯性", "forwardPe":"數字或說明", "source":"來源名稱"}
  ],
  "epsSources": [
    {"institution":"機構/來源", "eps":"EPS 數字或說明", "publishedAt":"發布時間", "confidence":"高/中/低", "source":"來源名稱"}
  ],
  "sources": [
    {"title":"來源標題", "url":"https://..."}
  ]
}
`.trim();
}

async function callResponsesApi(ticker, apiKey) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: getEnv("OPENAI_MODEL") || "gpt-5.5",
      tools: [{ type: "web_search" }],
      input: buildPrompt(ticker)
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI Responses API HTTP ${response.status}`);
  return extractText(payload);
}

async function callSearchPreviewFallback(ticker, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: getEnv("OPENAI_FALLBACK_MODEL") || "gpt-4o-search-preview",
      web_search_options: { search_context_size: "medium" },
      messages: [
        { role: "system", content: "你是嚴謹的賣方首席分析師。必須先搜尋最新資料，並只輸出有效 JSON。" },
        { role: "user", content: buildPrompt(ticker) }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI Chat Completions API HTTP ${response.status}`);
  return payload.choices?.[0]?.message?.content || "";
}

async function analyzeStock(ticker, apiKey) {
  try {
    const text = await callResponsesApi(ticker, apiKey);
    return normalizeAnalysis(parseModelJson(text), ticker);
  } catch {
    const text = await callSearchPreviewFallback(ticker, apiKey);
    const data = normalizeAnalysis(parseModelJson(text), ticker);
    data.confidenceNote = `${data.confidenceNote}（備註：Responses web_search 未成功，已改用 search-preview 備援模型。）`;
    return data;
  }
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

export const config = {
  path: "/api/analyze",
  method: ["POST"]
};
