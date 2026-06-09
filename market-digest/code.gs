// ══════════════════════════════════════════════════════════════
//  Intelligence Digest — Google Apps Script
//  Busca RSS de múltiplas fontes, sumariza com Gemini (decisão +
//  análise crítica + links extras), publica feed.json na raiz do
//  repo via GitHub API. Trigger: diariamente às 6h BRT (UTC-3).
//
//  SETUP:
//  1. script.google.com → New Project → cole este código
//  2. Project Settings → Script Properties:
//       GEMINI_API_KEY  = <chave do AI Studio>
//       GITHUB_TOKEN    = <seu PAT>
//       GITHUB_OWNER    = amanda340
//       GITHUB_REPO     = intelligence-digest
//       GITHUB_BRANCH   = main
//  3. Execute setupTrigger() UMA VEZ para criar o gatilho diário
//  4. Para forçar execução manual: runAll()
// ══════════════════════════════════════════════════════════════

/* ─── Configurações ────────────────────────────────────────── */
const PROPS       = PropertiesService.getScriptProperties();
const MAX_PER_FEED = 5;
const MAX_TOTAL    = 80;

/* ─── Fontes por track ─────────────────────────────────────── */
const FEEDS = [
  // Salesforce (releases + general)
  { url:"https://developer.salesforce.com/blogs/feed",            track:"summer26", category:"Salesforce Dev",         tags:["Agentforce","Headless"] },
  { url:"https://www.salesforce.com/news/feed/",                  track:"summer26", category:"Salesforce News",        tags:["Salesforce"] },
  // Releases Salesforce — notas de versão RSS (fallback rss)
  { url:"https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&type=5&release=250&language=en_US", track:"releases", category:"SF Release Notes", tags:["Release","Summer 26"] },
  // Status / incidentes
  { url:"https://status.salesforce.com/history.rss",              track:"issues",   category:"Salesforce Status",      tags:["Issue","Incidente"] },
  { url:"https://status.openai.com/history.rss",                  track:"issues",   category:"OpenAI Status",          tags:["Issue","OpenAI"] },
  { url:"https://status.anthropic.com/history.rss",               track:"issues",   category:"Anthropic Status",       tags:["Issue","Anthropic"] },
  { url:"https://status.langfuse.com/history.rss",                track:"issues",   category:"Langfuse Status",        tags:["Issue","Langfuse"] },
  // Agent Fabric + arquitetura
  { url:"https://architect.salesforce.com/feed",                  track:"fabric",   category:"SF Architect",           tags:["Agent Fabric","MCP"] },
  // Agnóstico / mercado
  { url:"https://blog.google/technology/ai/rss/",                 track:"agnostic", category:"Google AI Blog",         tags:["Google","Gemini"] },
  { url:"https://aws.amazon.com/blogs/machine-learning/feed/",    track:"agnostic", category:"AWS ML Blog",            tags:["AWS","Bedrock"] },
  { url:"https://techcrunch.com/category/artificial-intelligence/feed/", track:"agnostic", category:"TechCrunch AI", tags:["Mercado"] },
  { url:"https://venturebeat.com/category/ai/feed/",              track:"agnostic", category:"VentureBeat AI",         tags:["Enterprise","Mercado"] },
  { url:"https://anthropic.com/rss.xml",                          track:"agnostic", category:"Anthropic Blog",         tags:["Anthropic","Claude"] },
  { url:"https://openai.com/blog/rss.xml",                        track:"rivals",   category:"OpenAI Blog",            tags:["OpenAI"] },
  // MCP / A2A / arquitetura
  { url:"https://modelcontextprotocol.io/blog/rss.xml",           track:"arch",     category:"MCP Official",           tags:["MCP","Padrão"] },
  { url:"https://langchain.com/blog/rss.xml",                     track:"tools",    category:"LangChain Blog",         tags:["LangGraph","Frameworks"] },
  { url:"https://langfuse.com/blog/rss",                          track:"tools",    category:"Langfuse Blog",          tags:["Langfuse","LLMOps"] },
  // Skills & carreira
  { url:"https://trailhead.salesforce.com/today/feed/",           track:"skills",   category:"Trailhead",              tags:["Skill","Cert"] },
  // Social / debates (Reddit RSS, HN, Dev.to)
  { url:"https://www.reddit.com/r/salesforce/new/.rss",           track:"social",   category:"Reddit r/salesforce",    tags:["Comunidade","Reddit"] },
  { url:"https://www.reddit.com/r/MachineLearning/new/.rss",      track:"social",   category:"Reddit r/ML",            tags:["Comunidade","Reddit"] },
  { url:"https://www.reddit.com/r/LocalLLaMA/new/.rss",           track:"social",   category:"Reddit r/LocalLLaMA",    tags:["LLMs","Reddit"] },
  { url:"https://hnrss.org/newest?q=Agentforce&count=10",         track:"social",   category:"Hacker News",            tags:["HN","Salesforce"] },
  { url:"https://hnrss.org/newest?q=MCP+protocol&count=10",       track:"social",   category:"Hacker News",            tags:["HN","MCP"] },
  { url:"https://hnrss.org/newest?q=AI+agent+enterprise&count=10",track:"social",   category:"Hacker News",            tags:["HN","Mercado"] },
  { url:"https://dev.to/feed/tag/ai",                             track:"social",   category:"Dev.to AI",              tags:["Dev.to","LLMs"] },
];

/* ─── Entry point ──────────────────────────────────────────── */
function runAll() {
  Logger.log("=== Intelligence Digest — iniciando coleta ===");
  const raw = [];
  FEEDS.forEach(feed => {
    try {
      const items = fetchRss(feed);
      Logger.log(`  ${feed.category}: ${items.length} itens`);
      raw.push(...items);
    } catch (e) {
      Logger.log(`  ERRO ${feed.category}: ${e}`);
    }
  });

  const deduped  = deduplicateByUrl(raw);
  Logger.log(`Total após dedup: ${deduped.length}`);

  const enriched = enrichWithGemini(deduped.slice(0, MAX_TOTAL));
  const output   = buildFeed(enriched);
  output.radar   = buildRadar(enriched);

  publishToGitHub(output);
  Logger.log(`✅ Concluído: ${enriched.length} itens publicados`);
}

/* ─── Cria trigger diário às 6h BRT (UTC-3 = 9h UTC) ─────── */
function setupTrigger() {
  // Remove triggers antigos para runAll
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "runAll")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("runAll")
    .timeBased()
    .atHour(9)      // 9h UTC = 6h BRT (UTC-3)
    .everyDays(1)
    .create();
  Logger.log("✅ Trigger criado: runAll diariamente às 9h UTC (6h BRT)");
}

/* ─── Fetch RSS ────────────────────────────────────────────── */
function fetchRss(feed) {
  const opts = {
    muteHttpExceptions: true,
    headers: { "User-Agent": "IntelligenceDigestBot/1.0" },
  };
  const resp = UrlFetchApp.fetch(feed.url, opts);
  if (resp.getResponseCode() !== 200) return [];

  let doc;
  try { doc = XmlService.parse(resp.getContentText()); }
  catch (_) { return []; }

  const root = doc.getRootElement();
  const ns   = root.getNamespace();

  // RSS 2.0
  const channel = root.getChild("channel", ns) || root.getChild("channel");
  const entries = channel
    ? (channel.getChildren("item", ns).concat(channel.getChildren("item")))
    : (root.getChildren("entry", ns).concat(root.getChildren("entry")));

  const unique = [];
  const seen   = new Set();
  for (const e of entries) {
    if (unique.length >= MAX_PER_FEED) break;
    const get = name => {
      const n = e.getChild(name, ns) || e.getChild(name);
      return n ? n.getText().trim() : "";
    };
    const linkAtom = () => {
      const ls = e.getChildren("link", ns).concat(e.getChildren("link"));
      for (const l of ls) {
        const href = l.getAttribute("href");
        if (href) return href.getValue();
        if (l.getText()) return l.getText().trim();
      }
      return "";
    };

    const title   = get("title");
    const url     = get("link") || linkAtom();
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);

    const raw = get("description") || get("summary") || get("content") || "";
    unique.push({
      title,
      url,
      rawSummary: raw.replace(/<[^>]+>/g, "").replace(/\s+/g," ").trim().slice(0, 800),
      pubDate:   normalizeDate(get("pubDate") || get("published") || get("updated")),
      category:  feed.category,
      tags:      feed.tags,
      track:     feed.track,
    });
  }
  return unique;
}

function normalizeDate(str) {
  if (!str) return new Date().toISOString().slice(0, 10);
  try { return new Date(str).toISOString().slice(0, 10); }
  catch (_) { return str.slice(0, 10); }
}

/* ─── Deduplica por URL ────────────────────────────────────── */
function deduplicateByUrl(items) {
  const seen = new Set();
  return items.filter(i => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

/* ─── Enriquece com Gemini ─────────────────────────────────── */
function enrichWithGemini(items) {
  const apiKey = PROPS.getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    Logger.log("GEMINI_API_KEY não configurada — sem sumarização");
    return items.map(i => ({
      ...i,
      summary:  i.rawSummary.slice(0, 250),
      decision: "",
      critical: "",
      alert:    false,
      urls:     [i.url],
    }));
  }

  const enriched = [];
  for (let i = 0; i < items.length; i += 5) {
    const batch = items.slice(i, i + 5);
    batch.forEach(item => {
      try {
        enriched.push({ ...item, ...callGemini(apiKey, item) });
      } catch (e) {
        Logger.log(`Gemini error "${item.title}": ${e}`);
        enriched.push({ ...item, summary: item.rawSummary.slice(0, 250), decision:"", critical:"", alert:false, urls:[item.url] });
      }
    });
    if (i + 5 < items.length) Utilities.sleep(1200);
  }
  return enriched;
}

function callGemini(apiKey, item) {
  const prompt = `You are a senior analyst specializing in enterprise AI platforms, Salesforce, agent architecture and the technology market.

Analyze this article and return ONLY valid JSON (no markdown, no explanations):

Title: ${item.title}
Source: ${item.category}
Track: ${item.track}
Content: ${item.rawSummary}

Exact format (all fields required):
{
  "summary":    "<factual summary in PT-BR, 2-3 sentences, max 280 chars>",
  "summary_en": "<same summary in English, max 280 chars>",
  "summary_es": "<same summary in Spanish, max 280 chars>",
  "decision":    "<concrete action for EA/TA/architect in PT-BR, max 200 chars>",
  "decision_en": "<same decision in English, max 200 chars>",
  "decision_es": "<same decision in Spanish, max 200 chars>",
  "critical":    "<critical analysis: what may be wrong, overstated, or limited — PT-BR, max 200 chars>",
  "critical_en": "<same critical analysis in English, max 200 chars>",
  "critical_es": "<same critical analysis in Spanish, max 200 chars>",
  "t_en": "<article title translated to English, max 120 chars>",
  "t_es": "<article title translated to Spanish, max 120 chars>",
  "alert": <true if breaking news requiring immediate action, false otherwise>,
  "tags": ["<primary tag>", "<secondary tag>"],
  "aud": ["<EA|SA|TA|Build|SE|Exec> — list ALL relevant profiles"],
  "urls": ["<original url>"],
  "radar": "<adopt|trial|assess|hold>",
  "radar_name": "<short technology name for radar, max 20 chars>"
}`;

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.25, maxOutputTokens: 700 },
  });

  const resp = UrlFetchApp.fetch(url, {
    method: "post", contentType: "application/json",
    payload: body, muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) throw new Error(`HTTP ${resp.getResponseCode()}`);

  const data  = JSON.parse(resp.getContentText());
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const clean = text.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
  try {
    const r = JSON.parse(clean);
    // garante urls sempre presente
    if (!r.urls) r.urls = [item.url];
    else if (!r.urls.includes(item.url)) r.urls.unshift(item.url);
    return r;
  } catch (_) {
    return { summary: item.rawSummary.slice(0, 250), decision:"", critical:"", alert:false, urls:[item.url] };
  }
}

/* ─── Infere audiência como fallback ───────────────────────── */
function inferAud(item) {
  const text = (item.title + " " + item.rawSummary).toLowerCase();
  const r = [];
  if (/cto|ceo|director|exec|roi|revenue|invest|board/.test(text))      r.push("Exec");
  if (/enterprise architect|ea |solution architect|integration/.test(text)) r.push("EA","SA");
  if (/technical architect|ta |platform|mcp|a2a|pattern/.test(text))    r.push("TA");
  if (/developer|code|sdk|framework|deploy|build|cli/.test(text))        r.push("Build");
  if (/sales|customer|client|demo|pitch|deal|account/.test(text))        r.push("SE");
  return r.length > 0 ? [...new Set(r)] : ["TA"];
}

/* ─── Monta feed.json ──────────────────────────────────────── */
function buildFeed(items) {
  const tracks = {};
  items.forEach(item => {
    const t = item.track || "agnostic";
    if (!tracks[t]) tracks[t] = { u: formatMonth(), d: [] };
    tracks[t].d.push({
      t:           item.title,
      t_en:        item.t_en || item.title,
      t_es:        item.t_es || item.title,
      s:           item.summary    || item.rawSummary.slice(0, 250),
      s_en:        item.summary_en || item.summary || item.rawSummary.slice(0, 250),
      s_es:        item.summary_es || item.summary || item.rawSummary.slice(0, 250),
      d:           item.decision    || "",
      d_en:        item.decision_en || item.decision || "",
      d_es:        item.decision_es || item.decision || "",
      critical:    item.critical    || "",
      critical_en: item.critical_en || item.critical || "",
      critical_es: item.critical_es || item.critical || "",
      f:           item.category,
      dt:          item.pubDate,
      tag:         (item.tags || [])[0] || item.category,
      alert:       !!item.alert,
      url:         item.url,
      urls:        item.urls || [item.url],
      aud:         Array.isArray(item.aud) && item.aud.length ? item.aud : inferAud(item),
    });
  });
  return {
    generatedAt: new Date().toISOString(),
    totalItems:  items.length,
    tracks,
  };
}

function formatMonth() {
  return new Date().toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

/* ─── Monta radar ──────────────────────────────────────────── */
function buildRadar(items) {
  const radar = { adopt:[], trial:[], assess:[], hold:[] };
  const seen  = new Set();
  items.forEach(item => {
    const pos  = item.radar || "assess";
    const name = item.radar_name || (item.tags || [])[0];
    if (name && radar[pos] && !seen.has(name) && radar[pos].length < 10) {
      radar[pos].push(name);
      seen.add(name);
    }
  });
  // fallbacks curados para quando o Gemini não preencher
  const defaults = {
    adopt:  ["Agentforce","Headless 360","MCP","Langfuse"],
    trial:  ["Agent Fabric","A2A v1.0","Agent Script","Claude SDK"],
    assess: ["Agent Broker","WebMCP","LangGraph","DeepEval"],
    hold:   ["Fully Autonomous","No Observab","Hardcoded Route"],
  };
  Object.entries(defaults).forEach(([k,v])=>{
    v.forEach(n=>{ if(!seen.has(n)&&radar[k].length<8){ radar[k].push(n); seen.add(n); } });
  });
  return radar;
}

/* ─── Publica feed.json no GitHub ──────────────────────────── */
function publishToGitHub(data) {
  const token  = PROPS.getProperty("GITHUB_TOKEN");
  const owner  = PROPS.getProperty("GITHUB_OWNER")  || "amanda340";
  const repo   = PROPS.getProperty("GITHUB_REPO")   || "intelligence-digest";
  const branch = PROPS.getProperty("GITHUB_BRANCH") || "main";
  const path   = "feed.json";

  if (!token) {
    Logger.log("GITHUB_TOKEN não configurada — publicação ignorada");
    return;
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const hdr    = { Authorization:`token ${token}`, Accept:"application/vnd.github.v3+json" };

  let sha = null;
  try {
    const r = UrlFetchApp.fetch(`${apiUrl}?ref=${branch}`, { headers:hdr, muteHttpExceptions:true });
    if (r.getResponseCode() === 200) sha = JSON.parse(r.getContentText()).sha;
  } catch (_) {}

  const body = JSON.stringify({
    message: `chore: feed ${new Date().toISOString().slice(0,10)} — ${data.totalItems} itens`,
    content: Utilities.base64Encode(JSON.stringify(data, null, 2), Utilities.Charset.UTF_8),
    branch,
    ...(sha ? { sha } : {}),
  });

  const put = UrlFetchApp.fetch(apiUrl, {
    method:"put", contentType:"application/json",
    headers:hdr, payload:body, muteHttpExceptions:true,
  });

  const code = put.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error(`GitHub ${code}: ${put.getContentText().slice(0,200)}`);
  }
  Logger.log(`✅ GitHub: ${code} — feed.json atualizado`);
}
