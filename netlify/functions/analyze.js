 
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
  for (const key of ["price", "cheapPrice", "fairPrice", "expensivePrice"]) {
    if (result[key] <= 0) throw new Error(`模型回傳無效價格欄位：${key}`);
  }
  return result;
}

const knownAnalyses = {
  "2330": {
    ticker: "2330",
    name: "台積電",
    currency: "TWD",
    price: 2390,
    priceDate: "2026/06/26",
    cheapPrice: 1991,
    fairPrice: 2488,
    expensivePrice: 3554,
    currentZone: "便宜至合理",
    upsideToFairPct: 4.1,
    epsBasis: "2026E EPS 採外資可查預估均值約 95.7 元；樂觀 EPS 採上緣 97.6 元。",
    peerAnchorBasis: "採 26x 作合理錨點；台積電本身 forward P/E 約 24x，法人共識目標價隱含約 26x。",
    confidenceNote: "台積電外資覆蓋高，EPS 與估值信心度高；即時報價仍請以券商或交易所為準。",
    verdict: "台積電現在不是便宜貨，但仍低於合理價；可持有、回檔再加碼，風險在 AI 資本支出降溫、CoWoS/2 奈米進度與毛利率回落。",
    peers: [
      { company: "台積電", relationship: "純晶圓代工龍頭", forwardPe: "24.27x", source: "Yahoo Finance" },
      { company: "ASML", relationship: "先進製程設備", forwardPe: "約 49.3x", source: "GuruFocus / Yahoo Finance" },
      { company: "Samsung Electronics", relationship: "記憶體 + Foundry", forwardPe: "約 7.8x", source: "Yahoo Finance" },
      { company: "UMC 聯電", relationship: "成熟製程 foundry", forwardPe: "約 37.3x", source: "Yahoo Finance" }
    ],
    epsSources: [
      { institution: "摩根士丹利", eps: "94.30", publishedAt: "2026/03-04", confidence: "高", source: "經濟日報轉述" },
      { institution: "高盛", eps: "95.24", publishedAt: "2026/04", confidence: "中", source: "新聞轉述" },
      { institution: "摩根大通", eps: "95.50", publishedAt: "2026/04", confidence: "中", source: "新聞轉述" },
      { institution: "美銀", eps: "97.64", publishedAt: "2026/04", confidence: "中低", source: "外資整理" }
    ],
    sources: [
      { title: "Yahoo Finance 2330.TW", url: "https://finance.yahoo.com/quote/2330.TW/key-statistics/" },
      { title: "經濟日報外資目標價整理", url: "https://money.udn.com/money/story/5607/9447308" }
    ]
  },
  "NVDA": {
    ticker: "NVDA",
    name: "NVIDIA",
    currency: "USD",
    price: 195.74,
    priceDate: "2026/06/25 收盤",
    cheapPrice: 179,
    fairPrice: 224,
    expensivePrice: 338,
    currentZone: "便宜至合理",
    upsideToFairPct: 14.5,
    epsBasis: "採 FY2027E EPS 約 9.34；樂觀 EPS 約 10.06。",
    peerAnchorBasis: "採 AVGO、TSM、NVDA 成熟 AI 半導體龍頭估值帶，合理錨點 24x。",
    confidenceNote: "NVIDIA 外資覆蓋高，但財年口徑需注意，本文採 FY2027E。",
    verdict: "NVDA 可以買但不適合無腦重倉；風險是 AI capex 放緩、雲端客戶自研 ASIC 分流、Rubin 週期毛利率下滑。",
    peers: [
      { company: "NVDA", relationship: "AI GPU / 加速運算", forwardPe: "19.7x", source: "StockAnalysis" },
      { company: "AVGO Broadcom", relationship: "ASIC / AI networking", forwardPe: "24.1x", source: "StockAnalysis" },
      { company: "TSM 台積電 ADR", relationship: "先進製程供應鏈", forwardPe: "22.7x", source: "StockAnalysis" }
    ],
    epsSources: [
      { institution: "市場共識", eps: "9.34", publishedAt: "2026/05 後", confidence: "高", source: "分析師共識" },
      { institution: "Morgan Stanley", eps: "8.61", publishedAt: "2026/05-06", confidence: "高", source: "新聞摘要" },
      { institution: "Goldman Sachs", eps: "9.50", publishedAt: "2026/05", confidence: "中高", source: "Benzinga 摘要" }
    ],
    sources: [
      { title: "StockAnalysis NVDA", url: "https://stockanalysis.com/stocks/nvda/statistics/" },
      { title: "Benzinga Goldman 摘要", url: "https://www.benzinga.com/analyst-stock-ratings/price-target/26/05/52715483/nvidia-q1-fy27-earnings-goldman-sachs-price-target-capex-sustainability" }
    ]
  },
  "2317": {
    ticker: "2317",
    name: "鴻海",
    currency: "TWD",
    price: 250.5,
    priceDate: "2026/06/26 10:55",
    cheapPrice: 245,
    fairPrice: 306,
    expensivePrice: 437,
    currentZone: "便宜至合理",
    upsideToFairPct: 22.3,
    epsBasis: "2026E EPS 採高盛、大摩與共識均值約 18.0 元。",
    peerAnchorBasis: "台系 ODM 多在 11-16x，鴻海 AI 機櫃與 ASIC server 重評價採 17x。",
    confidenceNote: "外資覆蓋中高，但 EPS 公開細節少於台積電。",
    verdict: "鴻海可分批買，250 元附近接近安全邊際線；風險是 AI 機櫃出貨節奏、毛利率與蘋果業務淡化速度。",
    peers: [
      { company: "鴻海 2317", relationship: "AI 伺服器 / EMS", forwardPe: "15.72x", source: "Yahoo Finance" },
      { company: "廣達 2382", relationship: "AI 伺服器 ODM", forwardPe: "14.69x", source: "StockAnalysis" },
      { company: "緯創 3231", relationship: "AI 伺服器 / EMS", forwardPe: "11.43x", source: "Yahoo Finance" }
    ],
    epsSources: [
      { institution: "高盛", eps: "19.04", publishedAt: "2026/06", confidence: "高", source: "經濟日報轉述" },
      { institution: "摩根士丹利", eps: "17.40", publishedAt: "2026/01", confidence: "高", source: "經濟日報轉述" },
      { institution: "Stockopedia 共識", eps: "17.63", publishedAt: "2026/06", confidence: "中", source: "共識資料" }
    ],
    sources: [
      { title: "Yahoo Finance 2317", url: "https://finance.yahoo.com/quote/2317.TW/" },
      { title: "經濟日報高盛與大摩整理", url: "https://money.udn.com/money/story/5607/9248210" }
    ]
  },
  "8299": {
    ticker: "8299",
    name: "群聯",
    currency: "TWD",
    price: 2475,
    priceDate: "2026/06/25 收盤",
    cheapPrice: 2400,
    fairPrice: 3000,
    expensivePrice: 4418,
    currentZone: "便宜至合理",
    upsideToFairPct: 21.2,
    epsBasis: "基準 EPS 採 200 元；樂觀 EPS 採 FactSet 上緣 253.38 元。",
    peerAnchorBasis: "NAND 與控制 IC 倍數分裂，採 15x 合理錨點。",
    confidenceNote: "群聯資料信心度低於大型權值股，屬高波動景氣股。",
    verdict: "群聯可以買，但只能用高波動景氣股倉位；風險是 NAND 報價反轉、AI SSD 毛利被原廠吃回去、超高毛利率不可持續。",
    peers: [
      { company: "群聯 8299", relationship: "NAND 控制 IC / AI 儲存", forwardPe: "7.8x", source: "StockAnalysis" },
      { company: "Silicon Motion", relationship: "SSD 控制晶片", forwardPe: "34.5x", source: "StockAnalysis" },
      { company: "Micron", relationship: "NAND / DRAM 原廠", forwardPe: "8.45x", source: "StockAnalysis" }
    ],
    epsSources: [
      { institution: "FactSet 調查", eps: "171.59 / 上緣 253.38", publishedAt: "2026/04", confidence: "高", source: "券商轉述" },
      { institution: "Simply Wall St 共識", eps: "約 188", publishedAt: "2026/06", confidence: "中高", source: "共識資料" },
      { institution: "本土法人", eps: "415.66", publishedAt: "2026/05", confidence: "低", source: "新聞轉述" }
    ],
    sources: [
      { title: "StockAnalysis 群聯", url: "https://stockanalysis.com/quote/tpex/8299/" },
      { title: "FactSet EPS 轉述", url: "https://www.sinotrade.com.tw/richclub/news/69d7b7eeb4c4296334ac8841" }
    ]
  }
};

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
    const known = knownAnalyses[ticker.toUpperCase()] || knownAnalyses[ticker.replace(/\D/g, "")];
    if (known) return json(200, { analysis: known });
    return json(200, { analysis: await analyzeStock(ticker, apiKey) });
  } catch (error) {
    return json(500, { error: error.message || "分析失敗。" });
  }
};
