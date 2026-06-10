"""
Intelligence Digest — feed generator.
Replaces the Google Apps Script (code.gs).
Runs daily at 09:00 UTC (06:00 BRT) via GitHub Actions.
Outputs: feed.json in repo root.
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree as ET

import anthropic
import requests

ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
_claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
MAX_PER_FEED = 5
MAX_TOTAL = 80

TICKERS = [
    {"ticker": "CRM",  "name": "Salesforce",       "sector": "Enterprise SaaS"},
    {"ticker": "MSFT", "name": "Microsoft",         "sector": "Cloud / AI"},
    {"ticker": "GOOGL","name": "Alphabet / Google", "sector": "Cloud / AI"},
    {"ticker": "AMZN", "name": "Amazon / AWS",      "sector": "Cloud / AI"},
    {"ticker": "NOW",  "name": "ServiceNow",        "sector": "Enterprise AI Workflow"},
    {"ticker": "SAP",  "name": "SAP SE",            "sector": "Enterprise ERP / AI"},
    {"ticker": "ORCL", "name": "Oracle Corporation","sector": "Cloud / Database / AI"},
]

ENTITY_SIGNALS = [
    {"pattern": re.compile(r"salesforce|agentforce|crm", re.I),       "stock": "CRM",  "hn": "Agentforce"},
    {"pattern": re.compile(r"microsoft|copilot|azure", re.I),         "stock": "MSFT", "hn": "Microsoft Copilot"},
    {"pattern": re.compile(r"google|gemini|gcp", re.I),               "stock": "GOOGL","hn": "Google AI"},
    {"pattern": re.compile(r"amazon|aws|bedrock", re.I),              "stock": "AMZN", "hn": "AWS Bedrock"},
    {"pattern": re.compile(r"servicenow|now platform", re.I),         "stock": "NOW",  "hn": "ServiceNow"},
    {"pattern": re.compile(r"anthropic|claude", re.I),                "stock": None,   "hn": "Anthropic Claude"},
    {"pattern": re.compile(r"langfuse|langchain|langgraph", re.I),    "stock": None,   "hn": "LangChain"},
    {"pattern": re.compile(r"mcp|model context protocol", re.I),      "stock": None,   "hn": "MCP protocol"},
    {"pattern": re.compile(r"openai|gpt", re.I),                      "stock": None,   "hn": "OpenAI"},
    {"pattern": re.compile(r"sap|joule|s/4hana", re.I),               "stock": "SAP",  "hn": "SAP AI"},
    {"pattern": re.compile(r"oracle|oci|autonomous db", re.I),        "stock": "ORCL", "hn": "Oracle Cloud"},
]

FEEDS = [
    {"url": "https://developer.salesforce.com/blogs/feed",                           "track": "summer26",      "category": "Salesforce Dev",      "tags": ["Agentforce", "Headless"]},
    {"url": "https://www.salesforce.com/news/feed/",                                 "track": "summer26",      "category": "Salesforce News",     "tags": ["Salesforce"]},
    {"url": "https://status.salesforce.com/history.rss",                             "track": "issues",        "category": "Salesforce Status",   "tags": ["Issue", "Incidente"]},
    {"url": "https://status.openai.com/history.rss",                                 "track": "issues",        "category": "OpenAI Status",       "tags": ["Issue", "OpenAI"]},
    {"url": "https://status.anthropic.com/history.rss",                              "track": "issues",        "category": "Anthropic Status",    "tags": ["Issue", "Anthropic"]},
    {"url": "https://status.langfuse.com/history.rss",                               "track": "issues",        "category": "Langfuse Status",     "tags": ["Issue", "Langfuse"]},
    {"url": "https://architect.salesforce.com/feed",                                 "track": "fabric",        "category": "SF Architect",        "tags": ["Agent Fabric", "MCP"]},
    {"url": "https://blog.google/technology/ai/rss/",                                "track": "agnostic",      "category": "Google AI Blog",      "tags": ["Google", "Gemini"]},
    {"url": "https://aws.amazon.com/blogs/machine-learning/feed/",                   "track": "agnostic",      "category": "AWS ML Blog",         "tags": ["AWS", "Bedrock"]},
    {"url": "https://techcrunch.com/category/artificial-intelligence/feed/",         "track": "agnostic",      "category": "TechCrunch AI",       "tags": ["Mercado"]},
    {"url": "https://venturebeat.com/category/ai/feed/",                             "track": "agnostic",      "category": "VentureBeat AI",      "tags": ["Enterprise", "Mercado"]},
    {"url": "https://anthropic.com/rss.xml",                                         "track": "agnostic",      "category": "Anthropic Blog",      "tags": ["Anthropic", "Claude"]},
    {"url": "https://openai.com/blog/rss.xml",                                       "track": "rivals",        "category": "OpenAI Blog",         "tags": ["OpenAI"]},
    {"url": "https://modelcontextprotocol.io/blog/rss.xml",                          "track": "arch",          "category": "MCP Official",        "tags": ["MCP", "Padrão"]},
    {"url": "https://blog.langchain.dev/rss/",                                       "track": "tools",         "category": "LangChain Blog",      "tags": ["LangGraph", "Frameworks"]},
    {"url": "https://langfuse.com/blog/rss",                                         "track": "tools",         "category": "Langfuse Blog",       "tags": ["Langfuse", "LLMOps"]},
    {"url": "https://techcrunch.com/tag/acquisitions/feed/",                         "track": "acquisitions",  "category": "TechCrunch M&A",      "tags": ["Acquisition", "M&A"]},
    {"url": "https://www.reddit.com/r/salesforce/new/.rss",                          "track": "social",        "category": "Reddit r/salesforce", "tags": ["Comunidade", "Reddit"]},
    {"url": "https://www.reddit.com/r/MachineLearning/new/.rss",                     "track": "social",        "category": "Reddit r/ML",         "tags": ["Comunidade", "Reddit"]},
    {"url": "https://www.reddit.com/r/LocalLLaMA/new/.rss",                          "track": "social",        "category": "Reddit r/LocalLLaMA", "tags": ["LLMs", "Reddit"]},
    {"url": "https://hnrss.org/newest?q=Agentforce&count=10",                        "track": "social",        "category": "Hacker News",         "tags": ["HN", "Salesforce"]},
    {"url": "https://hnrss.org/newest?q=MCP+protocol&count=10",                     "track": "social",        "category": "Hacker News",         "tags": ["HN", "MCP"]},
    {"url": "https://hnrss.org/newest?q=AI+agent+enterprise&count=10",              "track": "social",        "category": "Hacker News",         "tags": ["HN", "Mercado"]},
    {"url": "https://dev.to/feed/tag/ai",                                            "track": "social",        "category": "Dev.to AI",           "tags": ["Dev.to", "LLMs"]},
]

RADAR_DEFAULTS = {
    "adopt":  ["Agentforce", "Headless 360", "MCP", "Langfuse"],
    "trial":  ["Agent Fabric", "A2A v1.0", "Agent Script", "Claude SDK"],
    "assess": ["Agent Broker", "WebMCP", "LangGraph", "DeepEval"],
    "hold":   ["Full Autonomy", "No Observab", "Hardcoded Route", "Agent Washing"],
}


# ── RSS fetch ──────────────────────────────────────────────────────────────────

def fetch_rss(feed: Dict) -> List[Dict]:
    headers = {"User-Agent": "IntelligenceDigestBot/1.0"}
    try:
        resp = requests.get(feed["url"], headers=headers, timeout=15)
        if resp.status_code != 200:
            return []
        root = ET.fromstring(resp.text)
    except Exception as e:
        print(f"  ERRO {feed['category']}: {e}")
        return []

    ns = root.tag.split("}")[0].lstrip("{") if "}" in root.tag else ""
    ns_map = {"": ns} if ns else {}

    def find(el, tag):
        for prefix in (f"{{{ns}}}" if ns else "", ""):
            found = el.find(f"{prefix}{tag}")
            if found is not None:
                return (found.text or "").strip()
        return ""

    def get_items(root):
        for prefix in (f"{{{ns}}}" if ns else "", ""):
            ch = root.find(f"{prefix}channel")
            if ch is not None:
                items = ch.findall(f"{prefix}item") or ch.findall("item")
                if items:
                    return items
        for prefix in (f"{{{ns}}}" if ns else "", ""):
            entries = root.findall(f"{prefix}entry")
            if entries:
                return entries
        return []

    items = get_items(root)
    results = []
    seen: set = set()

    for entry in items:
        if len(results) >= MAX_PER_FEED:
            break

        title = find(entry, "title")
        link = find(entry, "link")
        if not link:
            for lel in entry:
                if "link" in lel.tag.lower():
                    link = lel.get("href") or lel.text or ""
                    if link:
                        break

        if not title or not link or link in seen:
            continue
        seen.add(link)

        raw = find(entry, "description") or find(entry, "summary") or find(entry, "content") or ""
        raw = re.sub(r"<[^>]+>", "", raw)
        raw = re.sub(r"\s+", " ", raw).strip()[:800]

        pub = find(entry, "pubDate") or find(entry, "published") or find(entry, "updated") or ""
        try:
            dt = datetime.fromisoformat(pub.replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except Exception:
            dt = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        results.append({
            "title": title,
            "url": link.strip(),
            "rawSummary": raw,
            "pubDate": dt,
            "category": feed["category"],
            "tags": feed["tags"],
            "track": feed["track"],
        })

    return results


def deduplicate(items: List[Dict]) -> List[Dict]:
    seen: set = set()
    out = []
    for i in items:
        if i["url"] not in seen:
            seen.add(i["url"])
            out.append(i)
    return out


# ── Claude ────────────────────────────────────────────────────────────────────

def call_claude(prompt: str, max_tokens: int = 700) -> str:
    msg = _claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    text = msg.content[0].text
    return re.sub(r"```json\n?|```\n?", "", text).strip()


def enrich_item(item: Dict) -> Dict:
    prompt = f"""You are a senior analyst specializing in enterprise AI platforms, Salesforce, agent architecture and the technology market.

Analyze this article and return ONLY valid JSON (no markdown, no explanations):

Title: {item['title']}
Source: {item['category']}
Track: {item['track']}
Content: {item['rawSummary']}

Exact format (all fields required):
{{
  "summary":    "<factual summary in PT-BR, 2-3 sentences, max 280 chars>",
  "summary_en": "<same in English, max 280 chars>",
  "summary_es": "<same in Spanish, max 280 chars>",
  "decision":    "<concrete action for EA/TA/architect in PT-BR, max 200 chars>",
  "decision_en": "<same in English, max 200 chars>",
  "decision_es": "<same in Spanish, max 200 chars>",
  "critical":    "<what may be wrong/overstated/limited — PT-BR, max 200 chars>",
  "critical_en": "<same in English, max 200 chars>",
  "critical_es": "<same in Spanish, max 200 chars>",
  "t_en": "<title in English, max 120 chars>",
  "t_es": "<title in Spanish, max 120 chars>",
  "alert": <true if breaking news requiring immediate action, else false>,
  "tags": ["<primary tag>", "<secondary tag>"],
  "aud": ["<EA|SA|TA|Build|SE|Exec> — list ALL relevant profiles"],
  "urls": ["{item['url']}"],
  "radar": "<adopt|trial|assess|hold>",
  "radar_name": "<short tech name for radar, max 20 chars>"
}}"""
    try:
        raw = call_claude(prompt)
        result = json.loads(raw)
        if "urls" not in result:
            result["urls"] = [item["url"]]
        elif item["url"] not in result["urls"]:
            result["urls"].insert(0, item["url"])
        return {**item, **result}
    except Exception as e:
        print(f"  Claude error '{item['title'][:50]}': {e}")
        return {**item, "summary": item["rawSummary"][:250], "decision": "", "critical": "", "alert": False, "urls": [item["url"]]}


def enrich_all(items: List[Dict]) -> List[Dict]:
    enriched = []
    for i, item in enumerate(items):
        enriched.append(enrich_item(item))
        if (i + 1) % 5 == 0:
            time.sleep(1.2)
    return enriched


# ── HN signals ────────────────────────────────────────────────────────────────

def fetch_hn_signals(query: str) -> Optional[Dict]:
    try:
        url = f"https://hn.algolia.com/api/v1/search?query={requests.utils.quote(query)}&tags=story&hitsPerPage=3"
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            return None
        hits = resp.json().get("hits", [])
        if not hits:
            return None
        top = hits[0]
        return {
            "hn_comments": top.get("num_comments", 0),
            "hn_url": f"https://news.ycombinator.com/item?id={top['objectID']}",
        }
    except Exception:
        return None


def attach_signals(items: List[Dict]) -> List[Dict]:
    hn_cache: Dict[str, Dict] = {}
    result = []
    for item in items:
        text = f"{item['title']} {item.get('rawSummary', '')}"
        match = next((e for e in ENTITY_SIGNALS if e["pattern"].search(text)), None)
        if not match:
            result.append(item)
            continue

        hn_key = match["hn"]
        if hn_key not in hn_cache:
            hn_cache[hn_key] = fetch_hn_signals(hn_key) or {}
            time.sleep(0.4)
        hn = hn_cache[hn_key]

        result.append({
            **item,
            "signals": {
                "hn_comments": hn.get("hn_comments", 0),
                "hn_url": hn.get("hn_url"),
                "reddit_posts": 0,
                "stock": match["stock"],
                "stock_change": None,
                "stock_comment": None,
            },
        })
    return result


# ── Yahoo Finance ─────────────────────────────────────────────────────────────

def fetch_stock_quote(ticker: str) -> Optional[Dict]:
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
        headers = {"User-Agent": "IntelligenceDigestBot/1.0"}
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code != 200:
            return None
        meta = resp.json()["chart"]["result"][0]["meta"]
        price = meta["regularMarketPrice"]
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        change = round((price - prev) / prev * 100, 2) if prev else 0.0
        return {"price": f"${price:.2f}", "change": change}
    except Exception as e:
        print(f"  Yahoo Finance error {ticker}: {e}")
        return None


def gemini_stock_comment(ticker: Dict, quote: Dict) -> Dict:
    direction = "subiu" if quote["change"] >= 0 else "caiu"
    prompt = f"""Você é analista de mercado sênior especializado em tecnologia enterprise e IA.
A ação {ticker['ticker']} ({ticker['name']}, setor: {ticker['sector']}) {direction} {abs(quote['change'])}% hoje.
Retorne APENAS JSON válido (sem markdown) com análise concisa (máx 200 chars por campo) explicando as prováveis causas,
considerando o contexto atual de IA enterprise (Salesforce Agentforce, Microsoft Copilot, Google Gemini, AWS Bedrock, SAP Joule, Oracle OCI):
{{"comment":"<análise em PT-BR>","comment_en":"<same in English>","comment_es":"<same in Spanish>"}}"""
    try:
        return json.loads(call_claude(prompt, max_tokens=300, temperature=0.3))
    except Exception:
        return {}


def build_stocks() -> List[Dict]:
    results = []
    for t in TICKERS:
        quote = fetch_stock_quote(t["ticker"])
        if not quote:
            print(f"  Sem cotação para {t['ticker']}, pulando")
            continue
        comment = gemini_stock_comment(t, quote)
        results.append({**t, **quote, **comment})
        time.sleep(0.5)
    return results


# ── Radar ─────────────────────────────────────────────────────────────────────

def build_radar(items: List[Dict]) -> Dict:
    radar: Dict[str, List[str]] = {"adopt": [], "trial": [], "assess": [], "hold": []}
    seen: set = set()
    for item in items:
        pos = item.get("radar", "assess")
        name = item.get("radar_name") or (item.get("tags") or [None])[0]
        if name and pos in radar and name not in seen and len(radar[pos]) < 10:
            radar[pos].append(name)
            seen.add(name)
    for k, defaults in RADAR_DEFAULTS.items():
        for name in defaults:
            if name not in seen and len(radar[k]) < 8:
                radar[k].append(name)
                seen.add(name)
    return radar


# ── Feed builder ──────────────────────────────────────────────────────────────

def infer_aud(item: Dict) -> List[str]:
    text = f"{item['title']} {item.get('rawSummary', '')}".lower()
    r = []
    if re.search(r"cto|ceo|director|exec|roi|revenue|invest|board", text):
        r.append("Exec")
    if re.search(r"enterprise architect|ea |solution architect|integration", text):
        r += ["EA", "SA"]
    if re.search(r"technical architect|ta |platform|mcp|a2a|pattern", text):
        r.append("TA")
    if re.search(r"developer|code|sdk|framework|deploy|build|cli", text):
        r.append("Build")
    if re.search(r"sales|customer|client|demo|pitch|deal|account", text):
        r.append("SE")
    return list(dict.fromkeys(r)) or ["TA"]


def format_month() -> str:
    months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
              "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    now = datetime.now(timezone.utc)
    return f"{months[now.month - 1]}/{now.year}"


def build_feed(items: List[Dict]) -> Dict:
    tracks: Dict[str, Any] = {}
    for item in items:
        t = item.get("track") or "agnostic"
        if t not in tracks:
            tracks[t] = {"u": format_month(), "d": []}
        tracks[t]["d"].append({
            "t":           item["title"],
            "t_en":        item.get("t_en", item["title"]),
            "t_es":        item.get("t_es", item["title"]),
            "s":           item.get("summary", item.get("rawSummary", "")[:250]),
            "s_en":        item.get("summary_en", item.get("summary", "")),
            "s_es":        item.get("summary_es", item.get("summary", "")),
            "d":           item.get("decision", ""),
            "d_en":        item.get("decision_en", item.get("decision", "")),
            "d_es":        item.get("decision_es", item.get("decision", "")),
            "critical":    item.get("critical", ""),
            "critical_en": item.get("critical_en", item.get("critical", "")),
            "critical_es": item.get("critical_es", item.get("critical", "")),
            "f":           item["category"],
            "dt":          item["pubDate"],
            "tag":         (item.get("tags") or [item["category"]])[0],
            "alert":       bool(item.get("alert", False)),
            "url":         item["url"],
            "urls":        item.get("urls", [item["url"]]),
            "aud":         item.get("aud") if isinstance(item.get("aud"), list) and item.get("aud") else infer_aud(item),
            "signals":     item.get("signals"),
        })
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalItems": len(items),
        "tracks": tracks,
    }


def build_acquisitions_track(items: List[Dict]) -> Dict:
    acq = [i for i in items if i.get("track") == "acquisitions"]
    return {
        "u": format_month(),
        "d": [{
            "t":           i["title"],
            "t_en":        i.get("t_en", i["title"]),
            "t_es":        i.get("t_es", i["title"]),
            "s":           i.get("summary", i.get("rawSummary", "")[:250]),
            "s_en":        i.get("summary_en", i.get("summary", "")),
            "s_es":        i.get("summary_es", i.get("summary", "")),
            "d":           i.get("decision", ""),
            "d_en":        i.get("decision_en", ""),
            "d_es":        i.get("decision_es", ""),
            "critical":    i.get("critical", ""),
            "critical_en": i.get("critical_en", ""),
            "critical_es": i.get("critical_es", ""),
            "f":           i["category"],
            "dt":          i["pubDate"],
            "tag":         "Acquisition",
            "alert":       bool(i.get("alert", False)),
            "url":         i["url"],
            "urls":        i.get("urls", [i["url"]]),
            "aud":         i.get("aud") if isinstance(i.get("aud"), list) and i.get("aud") else ["EA", "Exec"],
            "acquirer_deals":   [],
            "competitor_deals": [],
        } for i in acq],
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== Intelligence Digest — iniciando coleta ===")

    raw: List[Dict] = []
    for feed in FEEDS:
        items = fetch_rss(feed)
        print(f"  {feed['category']}: {len(items)} itens")
        raw.extend(items)

    deduped = deduplicate(raw)
    print(f"Total após dedup: {len(deduped)}")

    enriched = enrich_all(deduped[:MAX_TOTAL])
    with_signals = attach_signals(enriched)

    output = build_feed(with_signals)
    output["radar"] = build_radar(with_signals)
    output["stocks"] = build_stocks()
    output["acquisitions"] = build_acquisitions_track(with_signals)

    out_path = "feed.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"✅ Concluído: {len(enriched)} itens → {out_path}")


if __name__ == "__main__":
    main()
