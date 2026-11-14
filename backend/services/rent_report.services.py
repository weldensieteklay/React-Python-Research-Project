"""
Local market reports for the paid version: what recent news and published reports say is driving
rents in one county, in the same JSON format as SAMPLE_REPORTS in RentDriversSection.jsx.

OFF BY DEFAULT. Nothing here runs, and no API is called, until RENT_REPORTS_ENABLED=true.

Two interchangeable producers:
  * "claude"     Claude API with the web search and web fetch server tools (Anthropic SDK)
  * "perplexity" Perplexity Sonar chat completions API (search built in)

Settings (environment variables):
  RENT_REPORTS_ENABLED          "true" to switch reports on                     default false
  RENT_REPORT_PROVIDER          "claude" or "perplexity"                       default claude
  ANTHROPIC_API_KEY             key for the Claude provider
  RENT_REPORT_CLAUDE_MODEL      Claude model                                  default claude-opus-5-5
                                (claude-haiku-5-5 is much cheaper; test quality before switching)
  PERPLEXITY_API_KEY            key for the Perplexity provider
  RENT_REPORT_PERPLEXITY_MODEL  Sonar model                                    default sonar-pro
  PERPLEXITY_API_URL            Sonar endpoint             default https://api.perplexity.ai/chat/completions
  RENT_REPORT_MONTHLY_LIMIT     max new reports generated per calendar month    default 50
  RENT_REPORT_TTL_DAYS          days a saved report is reused                   default 30

pip install anthropic httpx
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)


def _flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


ENABLED = _flag("RENT_REPORTS_ENABLED")
PROVIDER = os.getenv("RENT_REPORT_PROVIDER", "claude").strip().lower()
CLAUDE_MODEL = os.getenv("RENT_REPORT_CLAUDE_MODEL", "claude-opus-5-5")
PERPLEXITY_MODEL = os.getenv("RENT_REPORT_PERPLEXITY_MODEL", "sonar-pro")
PERPLEXITY_URL = os.getenv("PERPLEXITY_API_URL", "https://api.perplexity.ai/chat/completions")
MONTHLY_LIMIT = int(os.getenv("RENT_REPORT_MONTHLY_LIMIT", "50"))
TTL_SECONDS = int(os.getenv("RENT_REPORT_TTL_DAYS", "30")) * 24 * 3600

REPORT_DIR = Path("data/rent_reports")
USAGE_FILE = REPORT_DIR / "_usage.json"
MIN_REFERENCES = 5
MIN_DRIVERS = 3

DRIVER_IDS = ["new_supply", "concessions", "population", "jobs", "jobs_population", "urban_core", "schools",
              "health", "transit", "home_buying", "policy", "other"]


class ReportError(RuntimeError):
    """A provider failed or returned a report that didn't pass validation."""


# ---------------------------------------------------------------------------
# Report format: the same shape as SAMPLE_REPORTS in RentDriversSection.jsx
# (strict JSON schema: every field required; "" for an unknown optional value)
# ---------------------------------------------------------------------------
_POINT = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "refs": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["text", "refs"],
    "additionalProperties": False,
}
REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "overall": {"type": "string"},
        "drivers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "enum": DRIVER_IDS},
                    "name": {"type": "string"},
                    "direction": {"type": "string", "enum": ["up", "down", "mixed"]},
                    "strength": {"type": "string"},
                    "points": {"type": "array", "items": _POINT},
                },
                "required": ["id", "name", "direction", "strength", "points"],
                "additionalProperties": False,
            },
        },
        "rents": {"type": "array", "items": _POINT},
        "references": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "publisher": {"type": "string"},
                    "title": {"type": "string"},
                    "type": {"type": "string"},
                    "published": {"type": "string"},
                    "covers": {"type": "string"},
                    "url": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["id", "publisher", "title", "type", "published", "covers", "url", "note"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["overall", "drivers", "rents", "references"],
    "additionalProperties": False,
}

RESEARCH_PROMPT = """Research what is driving residential rents in {county}, {state} (part of the {metro} metro).

Search for sources from roughly the last 12 months: apartment market reports (CoStar, RealPage, Yardi Matrix,
Cushman & Wakefield, Transwestern, Matthews, Northmarq), Federal Reserve Bank research, U.S. Census estimates,
state agencies (school accountability ratings), hospital and transit agency announcements, city council and
zoning news, and established local news outlets.

Cover, where sources exist: new apartment construction and vacancy, move-in concessions, population and jobs
(including major employers arriving or leaving), schools, hospitals and health care, transit, the cost of buying
a home, and local or state housing policy. Also find current rent levels for the county or its main cities.

Rules:
- Only state what a source says. Give numbers exactly as the source gives them, with the month or quarter.
- Say which area each figure covers (the county, a city, an apartment submarket, the metro or the state).
- Note where sources disagree.
- No forecasts of your own and no investment advice.
"""

STRUCTURE_PROMPT = """Turn the research notes below into the JSON report format.

- "overall": 2-3 plain sentences: which forces push rents up, which push them down, and the net effect.
- "drivers": 4-9 drivers, each with direction "up", "down" or "mixed", an optional short "strength" label
  (e.g. "Strongest driver", "Longer-term effect", "Shown for context"; "" if none) and 1-4 short points.
- Every point that states a fact or number cites at least one reference id in "refs".
- "rents": 1-3 points on current rent levels, with refs.
- "references": number them 1, 2, 3...; use ONLY URLs from the SOURCES list below, copied exactly.
  "covers" says which area the source describes; "note" flags caveats ("" if none); "published" is a date
  or quarter if known, else "".
- Use plain language a renter understands. Do not add facts that are not in the notes.

RESEARCH NOTES:
{notes}

SOURCES (the only URLs you may cite):
{sources}
"""


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
def _sources_text(sources: list[dict]) -> str:
    return "\n".join(f"- {s['url']} | {s.get('title') or ''} | {s.get('date') or ''}" for s in sources)


class ClaudeProvider:
    """Claude API: one research call with the web search / web fetch server tools, then one call
    with structured outputs that turns the notes into the report JSON."""

    name = "claude"

    def __init__(self):
        import anthropic  # imported here so the app runs without the package while reports are off
        self._anthropic = anthropic
        self.client = anthropic.AsyncAnthropic()   # reads ANTHROPIC_API_KEY

    async def _create(self, **kwargs):
        # Server-side refusal fallback: if this model declines, the API retries on a fallback model
        return await self.client.beta.messages.create(
            model=CLAUDE_MODEL,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            **kwargs,
        )

    async def research(self, county: str, state: str, metro: str) -> tuple[str, list[dict], dict]:
        messages = [{"role": "user", "content": RESEARCH_PROMPT.format(county=county, state=state, metro=metro)}]
        tools = [
            {"type": "web_search_20260209", "name": "web_search", "max_uses": 10,
             "user_location": {"type": "approximate", "country": "US", "region": state}},
            {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 6},
        ]
        content, usage = [], {"input_tokens": 0, "output_tokens": 0}
        for _ in range(5):   # a long search turn can pause; send it back to continue (bounded)
            resp = await self._create(max_tokens=16000, tools=tools, messages=messages,
                                      output_config={"effort": "medium"})
            usage["input_tokens"] += resp.usage.input_tokens
            usage["output_tokens"] += resp.usage.output_tokens
            content.extend(resp.content)
            if resp.stop_reason == "refusal":
                raise ReportError("The model declined the research request.")
            if resp.stop_reason != "pause_turn":
                break
            messages.append({"role": "assistant", "content": resp.content})
        else:
            raise ReportError("Research did not finish within the allowed number of turns.")

        notes, sources = [], {}
        for block in content:
            btype = getattr(block, "type", "")
            if btype == "web_search_tool_result" and isinstance(block.content, list):   # errors are an object
                for r in block.content:
                    if getattr(r, "url", None):
                        sources.setdefault(r.url, {"url": r.url, "title": getattr(r, "title", ""),
                                                   "date": getattr(r, "page_age", "") or ""})
            elif btype == "text":
                notes.append(block.text)
                for c in getattr(block, "citations", None) or []:
                    url = getattr(c, "url", None)
                    if url:
                        sources.setdefault(url, {"url": url, "title": getattr(c, "title", ""), "date": ""})
        return "".join(notes).strip(), list(sources.values()), usage

    async def structure(self, notes: str, sources: list[dict], feedback: str = "") -> tuple[dict, dict]:
        prompt = STRUCTURE_PROMPT.format(notes=notes, sources=_sources_text(sources))
        if feedback:
            prompt += f"\n\nA previous attempt failed these checks; fix them:\n{feedback}"
        resp = await self._create(
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": REPORT_SCHEMA}},
        )
        if resp.stop_reason == "refusal":
            raise ReportError("The model declined to write the report.")
        if resp.stop_reason == "max_tokens":
            raise ReportError("The report was cut off at the token limit.")
        text = next((b.text for b in resp.content if getattr(b, "type", "") == "text"), "")
        return json.loads(text), {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}

    async def generate(self, county: str, state: str, metro: str, feedback: str = "", cache: dict | None = None):
        if cache is None or "notes" not in cache:
            notes, sources, u1 = await self.research(county, state, metro)
            if cache is not None:
                cache.update(notes=notes, sources=sources)
        else:
            notes, sources, u1 = cache["notes"], cache["sources"], {"input_tokens": 0, "output_tokens": 0}
        report, u2 = await self.structure(notes, sources, feedback)
        usage = {k: u1[k] + u2[k] for k in u1}
        return report, sources, usage


class PerplexityProvider:
    """Perplexity Sonar: one chat-completions call that searches the web and returns the report JSON
    (response_format json_schema), plus the list of sources it used.

    Check Perplexity's current API docs before switching this on: field names, models and the
    structured-output option may have changed, and Perplexity has announced newer APIs. The URL and
    model are settings, so most changes don't need code edits."""

    name = "perplexity"

    def __init__(self):
        self.key = os.getenv("PERPLEXITY_API_KEY", "")
        if not self.key:
            raise ReportError("PERPLEXITY_API_KEY is not set.")

    async def generate(self, county: str, state: str, metro: str, feedback: str = "", cache: dict | None = None):
        instructions = RESEARCH_PROMPT.format(county=county, state=state, metro=metro) + "\n" + (
            STRUCTURE_PROMPT.split("RESEARCH NOTES:")[0]
            .replace("use ONLY URLs from the SOURCES list below, copied exactly",
                     "use only URLs of pages you actually used, copied exactly"))
        if feedback:
            instructions += f"\nA previous attempt failed these checks; fix them:\n{feedback}"
        payload = {
            "model": PERPLEXITY_MODEL,
            "messages": [
                {"role": "system", "content": "You are a careful housing-market researcher. Cite every fact."},
                {"role": "user", "content": instructions},
            ],
            "search_recency_filter": "year",
            "response_format": {"type": "json_schema", "json_schema": {"schema": REPORT_SCHEMA}},
        }
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(PERPLEXITY_URL, json=payload,
                                  headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"})
        if r.status_code >= 400:
            raise ReportError(f"Perplexity API error {r.status_code}: {r.text[:300]}")
        data = r.json()
        text = data["choices"][0]["message"]["content"]
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())   # tolerate a fenced reply
        report = json.loads(text)
        sources = [{"url": s.get("url"), "title": s.get("title", ""), "date": s.get("date", "") or ""}
                   for s in data.get("search_results") or [] if s.get("url")]
        if not sources:   # older responses list bare URLs in "citations"
            sources = [{"url": u, "title": "", "date": ""} for u in data.get("citations") or []]
        usage = data.get("usage", {})
        return report, sources, {"input_tokens": usage.get("prompt_tokens", 0),
                                 "output_tokens": usage.get("completion_tokens", 0)}


def get_provider():
    if PROVIDER == "perplexity":
        return PerplexityProvider()
    if PROVIDER == "claude":
        return ClaudeProvider()
    raise ReportError(f"Unknown RENT_REPORT_PROVIDER: {PROVIDER!r}")


# ---------------------------------------------------------------------------
# Validation: nothing reaches users unless every check passes
# ---------------------------------------------------------------------------
def _norm_url(u: str) -> str:
    p = urlparse(u.strip())
    return f"{p.netloc.lower().removeprefix('www.')}{p.path.rstrip('/')}"


def validate_report(report: dict, sources: list[dict]) -> list[str]:
    """Problems found (empty list = the report can be published)."""
    problems = []
    allowed = {_norm_url(s["url"]) for s in sources if s.get("url")}
    refs = report.get("references") or []
    ids = [r.get("id") for r in refs]
    if len(refs) < MIN_REFERENCES:
        problems.append(f"Only {len(refs)} references; at least {MIN_REFERENCES} are required.")
    if len(set(ids)) != len(ids):
        problems.append("Reference ids are not unique.")
    for r in refs:
        if not str(r.get("url", "")).startswith(("http://", "https://")):
            problems.append(f"Reference {r.get('id')} has no valid URL.")
        elif allowed and _norm_url(r["url"]) not in allowed:
            problems.append(f"Reference {r.get('id')} URL was not among the pages searched: {r['url']}")
    drivers = report.get("drivers") or []
    if len(drivers) < MIN_DRIVERS:
        problems.append(f"Only {len(drivers)} drivers; at least {MIN_DRIVERS} are required.")
    cited = set()
    for d in drivers:
        for p in d.get("points") or []:
            cited.update(p.get("refs") or [])
            if re.search(r"\d", p.get("text", "")) and not p.get("refs"):
                problems.append(f"A point under '{d.get('name')}' states a figure without a reference.")
    for p in report.get("rents") or []:
        cited.update(p.get("refs") or [])
        if not p.get("refs"):
            problems.append("A rent figure has no reference.")
    missing = sorted(c for c in cited if c not in set(ids))
    if missing:
        problems.append(f"Points cite reference ids that don't exist: {missing}.")
    return problems


# ---------------------------------------------------------------------------
# Storage, caching and the monthly limit
# ---------------------------------------------------------------------------
def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def report_path(metro: str, county: str) -> Path:
    return REPORT_DIR / _slug(metro) / f"{_slug(county)}.json"


def read_saved(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)   # never leave a half-written file


def _month() -> str:
    return date.today().strftime("%Y-%m")


def _usage() -> dict:
    u = read_saved(USAGE_FILE) or {}
    return u if u.get("month") == _month() else {"month": _month(), "reports": 0, "input_tokens": 0, "output_tokens": 0}


def _record_usage(tokens: dict) -> None:
    u = _usage()
    u["reports"] += 1
    u["input_tokens"] += tokens.get("input_tokens", 0)
    u["output_tokens"] += tokens.get("output_tokens", 0)
    _write(USAGE_FILE, u)


def under_monthly_limit() -> bool:
    return _usage()["reports"] < MONTHLY_LIMIT


# ---------------------------------------------------------------------------
# One report, end to end
# ---------------------------------------------------------------------------
async def build_report(county: str, state_name: str, metro: str) -> dict:
    """Research, write and validate one county report (one retry with the validation problems).
    Saves it and returns the saved record; raises ReportError if it can't pass validation."""
    provider = get_provider()
    cache: dict = {}   # the Claude provider reuses its research on the retry
    feedback = ""
    total = {"input_tokens": 0, "output_tokens": 0}
    for attempt in range(2):
        report, sources, usage = await provider.generate(county, state_name, metro, feedback, cache)
        for k in total:
            total[k] += usage.get(k, 0)
        problems = validate_report(report, sources)
        if not problems:
            break
        feedback = "\n".join(f"- {p}" for p in problems)
        log.warning("rent report for %s failed validation (attempt %d): %s", county, attempt + 1, problems)
    _record_usage(total)
    if problems:
        raise ReportError("The report didn't pass validation: " + "; ".join(problems[:3]))

    record = {
        "metro": metro,
        "county": county,
        "provider": provider.name,
        "model": CLAUDE_MODEL if provider.name == "claude" else PERPLEXITY_MODEL,
        "reviewed": False,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "usage": total,
        "report": {
            "id": _slug(county),
            "county": county,
            "metro": metro,
            "place": f"{county}, {metro.split(',')[0]}, {state_name}",
            "as_of": date.today().isoformat(),
            **report,
        },
    }
    _write(report_path(metro, county), record)
    return record


def is_fresh(path: Path) -> bool:
    return path.exists() and time.time() - path.stat().st_mtime < TTL_SECONDS


_STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def state_name_for(metro: str) -> str:
    """'Dallas-Fort Worth-Arlington, TX' -> 'Texas' (first state of a multi-state metro)."""
    m = re.search(r",\s*([A-Z]{2})", metro)
    return _STATE_NAMES.get(m[1], m[1]) if m else ""
