"""OpenRouter chat client: one model behind a config switch, every answer cached by prompt hash,
token usage appended to data/llm/usage.jsonl so real spend can be checked against the $10 budget.

Config (env vars, or a gitignored .env in the repo root):
    OPENROUTER_API_KEY   required for live calls
    TINYATLAS_MODEL      OpenRouter model slug (default below; verify the slug on openrouter.ai)
"""
import hashlib
import json
import os
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "llm"
URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash"


class LLMUnavailable(RuntimeError):
    """No API key, or the call failed. Callers fall back to extractive answers."""


def _env(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name and v.strip():
                return v.strip().strip('"').strip("'")
    return None


def model(task: str | None = None) -> str:
    """The model for a task: TINYATLAS_MODEL_<TASK> (e.g. _PLANNER, _EXTRACT) if set, else TINYATLAS_MODEL."""
    return (task and _env(f"TINYATLAS_MODEL_{task.upper()}")) or _env("TINYATLAS_MODEL") or DEFAULT_MODEL


def available() -> bool:
    return bool(_env("OPENROUTER_API_KEY"))


def complete(messages: list[dict], max_tokens: int = 500, temperature: float = 0.2,
             client: httpx.Client | None = None, task: str | None = None) -> str:
    key = _env("OPENROUTER_API_KEY")
    m = model(task)
    digest = hashlib.sha256(json.dumps([m, messages, max_tokens, temperature], sort_keys=True).encode()).hexdigest()[:24]
    path = CACHE / f"{digest}.json"
    if path.exists():
        cached = json.loads(path.read_text(encoding="utf-8")).get("text", "")
        if cached.strip():                    # an empty completion is never a valid answer, so never serve one
            return cached
    if not key:
        raise LLMUnavailable("OPENROUTER_API_KEY not set")
    c = client or httpx
    body = {"model": m, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if task:        # structured tasks: reasoning models must not spend the whole budget thinking
        body |= {"max_tokens": max_tokens + 3000, "reasoning": {"effort": "low"}}
    for attempt in range(2):                  # empty replies and hiccups happen; one retry, then give up
        try:
            r = c.post(URL, timeout=90, headers={"Authorization": f"Bearer {key}", "X-Title": "Tiny Atlas"}, json=body)
            r.raise_for_status()
            data = r.json()
            text = (data["choices"][0]["message"].get("content") or "").strip()
            if not text:
                raise ValueError("the model returned an empty answer")
            break
        except Exception as exc:
            if attempt:
                raise LLMUnavailable(f"OpenRouter call failed: {exc}") from exc
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"text": text, "model": m}), encoding="utf-8")
    with (CACHE / "usage.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"t": int(time.time()), "model": m, "usage": data.get("usage", {})}) + "\n")
    return text


def parse_json(text: str):
    """The first JSON object or array in a model's reply (models like to wrap JSON in prose or code fences)."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    for opener, closer in (("{", "}"), ("[", "]")):
        i, j = text.find(opener), text.rfind(closer)
        if i != -1 and j > i:
            try:
                return json.loads(text[i:j + 1])
            except ValueError:
                continue
    raise ValueError("no JSON in the model's reply")


def complete_json(messages: list[dict], max_tokens: int = 1500, task: str | None = None, client=None):
    """complete(), parsed as JSON; one retry with a nudge when the reply isn't valid JSON."""
    text = complete(messages, max_tokens=max_tokens, temperature=0.1, client=client, task=task)
    try:
        return parse_json(text)
    except ValueError:
        again = messages + [{"role": "assistant", "content": text},
                            {"role": "user", "content": "Reply again with only the JSON, nothing else."}]
        try:
            return parse_json(complete(again, max_tokens=max_tokens, temperature=0.0, client=client, task=task))
        except ValueError as exc:
            raise LLMUnavailable(f"the model did not return JSON: {exc}") from exc


def usage_totals() -> dict:
    p = CACHE / "usage.jsonl"
    tot = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0}
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            u = json.loads(line).get("usage", {})
            tot["calls"] += 1
            tot["prompt_tokens"] += u.get("prompt_tokens", 0)
            tot["completion_tokens"] += u.get("completion_tokens", 0)
    return tot
