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
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model did not return valid JSON.");
    return JSON.parse(match[0]);
  }
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`模型回傳無效數值：${field}`);
  }
  return number;
}

function roundPrice(value) {
  if (value >= 1000) return Math.round(value);
  if (value >= 100) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function classifyPrice(price, cheapPrice, fairPrice, expensivePrice) {
  if (price < cheapPrice) return "便宜價以下";
  if (price < fairPrice) return "便宜至合理";
  if (price < expensivePrice) return "合理至昂貴";
  return "昂貴價以上";
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeAnalysis(data, fallbackTicker) {
  if (data.error) throw new Error(String(data.error));

  const peers = Array.isArray(data.peers) ? data.peers : [];
  const validPeerPes = peers
    .map((peer) => Number(peer.forwardPe))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (validPeerPes.length < 2) throw new Error("同業 Forward P/E 資料不足");

  const price = positiveNumber(data.price, "price");
  const annualEps = positiveNumber(data.annualEps, "annualEps");
  const optimisticEps = positiveNumber(data.optimisticEps, "optimisticEps");
  const peerAnchorPe = Math.round(median(validPeerPes) * 100) / 100;
  const bullPe = positiveNumber(data.bullPe, "bullPe");
  const bullMultiplier = bullPe / peerAnchorPe;
  if (bullMultiplier < 1.3 || bullMultiplier > 1.5) {
    throw new Error("牛市倍數必須是同業錨點的 1.3 至 1.5 倍");
  }

  const fairPrice = roundPrice(annualEps * peerAnchorPe);
  const cheapPrice = roundPrice(fairPrice * 0.8);
  const expensivePrice = roundPrice(optimisticEps * bullPe);

  if (expensivePrice <= fairPrice) {
    throw new Error("樂觀情境估值不得低於合理價");
  }

  const result = {
    ticker: data.ticker || fallbackTicker,
    name: data.name || fallbackTicker,
    currency: data.currency || "",
    price,
    priceDate: data.priceDate || "",
    cheapPrice,
    fairPrice,
    expensivePrice,
    currentZone: classifyPrice(price, cheapPrice, fairPrice, expensivePrice),
    upsideToFairPct: Math.round(((fairPrice / price) - 1) * 1000) / 10,
    annualEps,
    optimisticEps,
    peerAnchorPe,
    bullPe,
    epsBasis: data.epsBasis || "",
    peerAnchorBasis: data.peerAnchorBasis || "",
    verdict: data.verdict || "",
    confidenceNote: data.confidenceNote || "",
    peers,
    epsSources: Array.isArray(data.epsSources) ? data.epsSources : [],
    sources: Array.isArray(data.sources) ? data.sources : []
  };

  if (!result.priceDate) throw new Error("模型未提供現價日期");
  if (!result.currency) throw new Error("模型未提供交易幣別");
  if (result.epsSources.length < 1) throw new Error("今年 EPS 來源不足");
  if (result.sources.length < 2) throw new Error("可核對的網路來源不足");

  return result;
}

function normalizeTicker(raw) {
  const ticker = String(raw || "").trim();
  const digitsOnly = ticker.replace(/\D/g, "");
  const isTaiwanCode = /^\d{4}$/.test(digitsOnly);
  return {
    input: ticker,
    searchHint: isTaiwanCode
      ? `${digitsOnly} Taiwan stock, ${digitsOnly}.TW or ${digitsOnly}.TWO, Traditional Chinese financial news`
      : ticker
  };
}

function buildPrompt(ticker) {
  const { input, searchHint } = normalizeTicker(ticker);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  return `
你是一位精通估值方法的賣方首席分析師，語氣專業犀利、數據導向、不講廢話。
使用者會給你一個股票代號或公司名稱，執行以下三步驟，產出今年目標價分析。

使用者輸入：${input}
搜尋提示：${searchHint}
執行日期：${today}

步驟一・錨點搜尋（Auto-Anchor）：
網路搜尋該公司所屬產業同業競爭者目前的「預估本益比」（Forward P/E），
列出至少 2-3 家可比公司的數字與資料來源。

步驟二・獲利探勘（EPS Mining）：
網路搜尋外資投行（Morgan Stanley、高盛、摩根大通、瑞銀、美銀、花旗等）
對該股票今年全年 EPS 的預估值，標明來源機構與發布時間。
若覆蓋稀薄或無外資覆蓋，必須明確說明並改用自建估算，同時標註資料可信度較低。
自建估算必須以最新一季財報、公司財測或可信的市場共識為依據，不得憑空推測。

步驟三・定價計算（The Pricing）：
以最新一季財報檢驗今年 EPS 預估的合理性，再套用以下公式：
合理價（法人共識）＝今年 EPS × 同業錨點本益比
便宜價（Burry 防線）＝合理價 × 0.8（20% 安全邊際折價）
昂貴價（瘋狂價）＝樂觀 EPS（共識上緣或自估）× 牛市倍數
牛市倍數通常取同業錨點倍數的 1.3-1.5 倍，依產業循環、成長率與獲利能見度判斷。

輸出要求：
1. 清楚列出股票代號／名稱、現價（註明日期）、便宜價、合理價、昂貴價、
   EPS 依據、同業錨點依據。
2. 明確標註目前股價落在哪個區間：便宜價以下／便宜至合理／合理至昂貴／昂貴價以上。
3. 計算距合理價的百分比。
4. 結尾一句話判決：直接講清楚這檔股票現在值不值得買，風險在哪裡。
5. 資料來源信心度不一時要明確標註，尤其要區分有無外資覆蓋。

全部使用繁體中文，必須先完成網路搜尋再回答，不要用舊資料硬猜本益比或 EPS。
這套流程適用於任何有效股票代號或公司名稱，不限於網站上的快捷範例。

資料與計算規則：
- 先確認正確公司、交易所、幣別、最新可取得的現價及現價日期。
- Forward P/E 必須是預估本益比，不得拿歷史本益比或過去十二個月本益比替代。
- peers 至少要有 2 筆有效 Forward P/E；後端會取有效數字的中位數作為同業錨點。
- annualEps 是今年全年 EPS 基準值；optimisticEps 是共識上緣或有依據的樂觀自估值。
- EPS、現價與目標價必須使用相同幣別及每股基礎；ADR 必須處理換股比例。
- bullPe 必須是同業 Forward P/E 中位數的 1.3-1.5 倍。
- 不得假冒投行報告、發布日期、數字或網址；無法公開核實就標示低信心或改用自建估算。
- 所有數字欄位必須是 JSON number，不得輸出 0、空字串、倍數符號或千分位。
- 若無法核實現價、今年 EPS，或至少兩家同業 Forward P/E，只回傳：
  {"error":"資料不足：無法核實現價、今年 EPS 或至少兩家同業 Forward P/E，拒絕硬猜。"}

網頁只能接收 JSON。不要輸出 Markdown、表格語法、引言或 JSON 之外的文字。
請嚴格依照下列 JSON 結構回傳：
{
  "ticker": "string",
  "name": "string",
  "currency": "TWD/USD/etc",
  "price": 123.45,
  "priceDate": "YYYY-MM-DD",
  "annualEps": 8.5,
  "optimisticEps": 9.2,
  "bullPe": 25.0,
  "epsBasis": "今年 EPS 年度、基準值、樂觀值、來源與估算方法",
  "peerAnchorBasis": "同業錨點及牛市倍數的選擇理由",
  "confidenceNote": "外資覆蓋狀況及整體資料信心度",
  "verdict": "一句話講清楚是否值得買及主要風險",
  "peers": [
    {
      "company":"string",
      "relationship":"string",
      "forwardPe":18.5,
      "source":"來源名稱及資料日期"
    }
  ],
  "epsSources": [
    {
      "institution":"string",
      "eps":"幣別 8.50（FY2026）",
      "publishedAt":"YYYY-MM-DD",
      "confidence":"高/中/低",
      "source":"來源名稱"
    }
  ],
  "sources": [
    {"title":"string","url":"https://..."}
  ]
}
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
      web_search_options: { search_context_size: "medium" },
      messages: [
        {
          role: "system",
          content: "You are a rigorous equity analyst. You must search the web and return valid JSON only."
        },
        { role: "user", content: buildPrompt(ticker) }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI API HTTP ${response.status}`);

  const content = payload.choices?.[0]?.message?.content || "";
  return normalizeAnalysis(parseModelJson(content), ticker);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = getEnv("OPENAI_API_KEY");
  if (!apiKey) return json(500, { error: "Netlify environment variable OPENAI_API_KEY is missing." });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON request body." });
  }

  const ticker = String(body.ticker || "").trim();
  if (!/^[\p{L}\p{N}.\- ]{1,32}$/u.test(ticker)) {
    return json(400, { error: "Please enter a valid stock ticker or company name." });
  }

  try {
    return json(200, { analysis: await analyzeStock(ticker, apiKey) });
  } catch (error) {
    return json(500, { error: error.message || "Analysis failed." });
  }
};
