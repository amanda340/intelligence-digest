// ══════════════════════════════════════════════════════════════
//  Market Digest — Google Apps Script
//  Roda no Google Apps Script. Busca RSS de múltiplas fontes,
//  sumariza com Gemini e publica em feed.json no repositório
//  via GitHub API.
//
//  SETUP:
//  1. Abra https://script.google.com → New Project
//  2. Cole este código
//  3. Em Project Settings → Script Properties adicione:
//       GEMINI_API_KEY  = <sua chave>
//       GITHUB_TOKEN    = ghp_xxx
//       GITHUB_OWNER    = amanda340
//       GITHUB_REPO     = intelligence-digest
//       GITHUB_BRANCH   = main
//  4. Execute runAll() uma vez para autorizar
//  5. Configure trigger: Editar → Gatilhos → runAll → A cada 6 horas
// ══════════════════════════════════════════════════════════════

// ─── Fontes RSS curadas ───────────────────────────────────────
const RSS_FEEDS = [
  // AI Geral
  { url: "https://blog.google/technology/ai/rss/",           category: "Google AI",       tags: ["Google", "Gemini"] },
  { url: "https://anthropic.com/rss.xml",                    category: "Anthropic",       tags: ["Claude", "Anthropic"] },
  { url: "https://openai.com/blog/rss.xml",                  category: "OpenAI",          tags: ["OpenAI", "GPT"] },
  { url: "https://aws.amazon.com/blogs/machine-learning/feed/", category: "AWS AI",       tags: ["AWS", "Bedrock"] },
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", category: "TechCrunch AI", tags: ["Mercado"] },
  { url: "https://venturebeat.com/category/ai/feed/",        category: "VentureBeat AI",  tags: ["Mercado", "Enterprise"] },
  // Salesforce
  { url: "https://developer.salesforce.com/blogs/feed",      category: "Salesforce Dev",  tags: ["Salesforce", "Agentforce"] },
  { url: "https://www.salesforce.com/news/feed/",            category: "Salesforce News", tags: ["Salesforce"] },
  // MCP / Agentes
  { url: "https://modelcontextprotocol.io/blog/rss.xml",     category: "MCP",             tags: ["MCP", "Padrão"] },
  { url: "https://langchain.com/blog/rss.xml",               category: "LangChain",       tags: ["LangGraph", "Frameworks"] },
  // LLMOps
  { url: "https://langfuse.com/blog/rss",                    category: "Langfuse",        tags: ["LLMOps", "Observab"] },
  // Hacker News AI
  { url: "https://hnrss.org/newest?q=LLM+agent&count=15",   category: "HN · Agentes",    tags: ["Comunidade"] },
  { url: "https://hnrss.org/newest?q=MCP+protocol&count=10",category: "HN · MCP",        tags: ["MCP"] },
];

// ─── Mapeamento de categorias para tracks do digest ──────────
const CATEGORY_TO_TRACK = {
  "Google AI": "agnostic", "Anthropic": "agnostic", "OpenAI": "rivals",
  "AWS AI": "agnostic", "TechCrunch AI": "agnostic", "VentureBeat AI": "agnostic",
  "Salesforce Dev": "salesforce", "Salesforce News": "salesforce",
  "MCP": "arch", "LangChain": "tools", "Langfuse": "tools",
  "HN · Agentes": "agnostic", "HN · MCP": "arch",
};

// ─── Config ──────────────────────────────────────────────────
const PROPS = PropertiesService.getScriptProperties();
const MAX_ITEMS_PER_FEED = 5;
const MAX_TOTAL_ITEMS    = 60;

// ─── Entry point ─────────────────────────────────────────────
function runAll() {
  const items = [];
  RSS_FEEDS.forEach(feed => {
    try {
      const fetched = fetchRss(feed);
      items.push(...fetched);
    } catch (e) {
      Logger.log(`Erro no feed ${feed.url}: ${e}`);
    }
  });

  const deduped   = deduplicateByUrl(items);
  const enriched  = enrichWithGemini(deduped.slice(0, MAX_TOTAL_ITEMS));
  const output    = buildOutput(enriched);

  publishToGitHub(output);
  Logger.log(`✅ Publicados ${enriched.length} itens.`);
}

// ─── Busca RSS ────────────────────────────────────────────────
function fetchRss(feed) {
  const resp = UrlFetchApp.fetch(feed.url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return [];

  const xml  = resp.getContentText();
  const doc  = XmlService.parse(xml);
  const root = doc.getRootElement();
  const ns   = root.getNamespace();

  // suporta RSS 2.0 e Atom
  let entries = root.getChild("channel", ns)
    ? root.getChild("channel", ns).getChildren("item", ns)
    : root.getChildren("entry", ns);

  if (!entries || entries.length === 0) {
    // tenta sem namespace
    const ch = root.getChild("channel");
    entries  = ch ? ch.getChildren("item") : root.getChildren("entry");
  }

  return (entries || []).slice(0, MAX_ITEMS_PER_FEED).map(e => {
    const get = (name) => {
      let n = e.getChild(name, ns) || e.getChild(name);
      return n ? n.getText().trim() : "";
    };
    const getLinkAtom = () => {
      const links = e.getChildren("link", ns).concat(e.getChildren("link"));
      for (const l of links) {
        const href = l.getAttribute("href");
        if (href) return href.getValue();
        if (l.getText()) return l.getText().trim();
      }
      return "";
    };

    const title   = get("title");
    const url     = get("link") || getLinkAtom();
    const summary = get("description") || get("summary") || get("content") || "";
    const pubDate = get("pubDate") || get("published") || get("updated") || "";

    if (!title || !url) return null;

    return {
      title,
      url,
      rawSummary: summary.replace(/<[^>]+>/g, "").slice(0, 600),
      pubDate: parsePubDate(pubDate),
      category:  feed.category,
      tags:      feed.tags,
      track:     CATEGORY_TO_TRACK[feed.category] || "agnostic",
    };
  }).filter(Boolean);
}

// ─── Normaliza data ───────────────────────────────────────────
function parsePubDate(str) {
  if (!str) return new Date().toISOString().slice(0, 10);
  try {
    return new Date(str).toISOString().slice(0, 10);
  } catch (_) {
    return str.slice(0, 10);
  }
}

// ─── Deduplica por URL ────────────────────────────────────────
function deduplicateByUrl(items) {
  const seen = new Set();
  return items.filter(i => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

// ─── Enriquece com Gemini ─────────────────────────────────────
function enrichWithGemini(items) {
  const apiKey = PROPS.getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    Logger.log("GEMINI_API_KEY não configurada — pulando sumarização");
    return items.map(i => ({ ...i, summary: i.rawSummary.slice(0, 200), decision: "", alert: false }));
  }

  // Chama Gemini em batch de 5 para economizar cota
  const enriched = [];
  for (let i = 0; i < items.length; i += 5) {
    const batch = items.slice(i, i + 5);
    batch.forEach(item => {
      try {
        const result = callGemini(apiKey, item);
        enriched.push({ ...item, ...result });
      } catch (e) {
        Logger.log(`Gemini erro em "${item.title}": ${e}`);
        enriched.push({ ...item, summary: item.rawSummary.slice(0, 200), decision: "", alert: false });
      }
    });
    if (i + 5 < items.length) Utilities.sleep(1000); // rate limit
  }
  return enriched;
}

function callGemini(apiKey, item) {
  const prompt = `Você é um analista sênior de IA e arquitetura de software. Analise este artigo e responda em JSON válido:

Título: ${item.title}
Conteúdo: ${item.rawSummary}
Categoria: ${item.category}

Responda APENAS com JSON no formato:
{
  "summary": "<resumo em português, 1-2 frases, máx 200 chars>",
  "decision": "<insight arquitetural ou de negócio para o leitor agir, máx 150 chars>",
  "alert": <true se for notícia urgente/breaking, false caso contrário>,
  "tags": ["<tag1>", "<tag2>"]
}`;

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
  });

  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: body,
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error(`HTTP ${resp.getResponseCode()}`);
  }

  const data   = JSON.parse(resp.getContentText());
  const text   = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const clean  = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch (_) {
    return { summary: item.rawSummary.slice(0, 200), decision: "", alert: false };
  }
}

// ─── Monta JSON de saída ─────────────────────────────────────
function buildOutput(items) {
  const byTrack = {};
  items.forEach(item => {
    const t = item.track || "agnostic";
    if (!byTrack[t]) byTrack[t] = [];
    byTrack[t].push({
      t: item.title,
      s: item.summary || item.rawSummary.slice(0, 200),
      d: item.decision || "",
      f: item.category,
      dt: item.pubDate,
      tag: (item.tags || [])[0] || item.category,
      alert: !!item.alert,
      url: item.url,
      aud: inferAudience(item),
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    totalItems: items.length,
    tracks: byTrack,
  };
}

function inferAudience(item) {
  const text  = (item.title + " " + item.rawSummary).toLowerCase();
  const roles = [];
  if (/cto|ceo|director|executive|roi|revenue|invest/.test(text))   roles.push("Exec");
  if (/architect|integration|api|platform|design|pattern/.test(text)) roles.push("TA");
  if (/developer|code|sdk|framework|deploy|build/.test(text))        roles.push("Build");
  if (/sales|customer|client|demo|pitch|deal/.test(text))            roles.push("SE");
  return roles.length > 0 ? roles : ["TA"];
}

// ─── Publica feed.json no GitHub ─────────────────────────────
function publishToGitHub(data) {
  const token  = PROPS.getProperty("GITHUB_TOKEN");
  const owner  = PROPS.getProperty("GITHUB_OWNER") || "amanda340";
  const repo   = PROPS.getProperty("GITHUB_REPO")  || "intelligence-digest";
  const branch = PROPS.getProperty("GITHUB_BRANCH") || "main";
  const path   = "market-digest/feed.json";

  if (!token) {
    Logger.log("GITHUB_TOKEN não configurada — salvando localmente");
    Logger.log(JSON.stringify(data, null, 2).slice(0, 500));
    return;
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `token ${token}`,
    Accept:        "application/vnd.github.v3+json",
  };

  // Pega SHA do arquivo atual (para update)
  let sha = null;
  try {
    const getResp = UrlFetchApp.fetch(apiBase + `?ref=${branch}`, { headers, muteHttpExceptions: true });
    if (getResp.getResponseCode() === 200) {
      sha = JSON.parse(getResp.getContentText()).sha;
    }
  } catch (_) {}

  const content = Utilities.base64Encode(JSON.stringify(data, null, 2), Utilities.Charset.UTF_8);
  const body    = {
    message: `chore: atualiza feed.json — ${new Date().toISOString().slice(0, 10)}`,
    content,
    branch,
    ...(sha ? { sha } : {}),
  };

  const putResp = UrlFetchApp.fetch(apiBase, {
    method:      "put",
    contentType: "application/json",
    headers,
    payload:     JSON.stringify(body),
    muteHttpExceptions: true,
  });

  if (putResp.getResponseCode() !== 200 && putResp.getResponseCode() !== 201) {
    throw new Error(`GitHub API erro: ${putResp.getResponseCode()} — ${putResp.getContentText().slice(0, 200)}`);
  }

  Logger.log(`✅ feed.json publicado: ${putResp.getResponseCode()}`);
}
