"""List OpenRouter models that are free (prompt and completion price = 0)."""
import json
import os
import sys
import urllib.request

URL = "https://openrouter.ai/api/v1/models"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    data = fetch(URL)
    models = data.get("data", [])
    free = []
    for m in models:
        pr = m.get("pricing", {}) or {}
        p = str(pr.get("prompt", "x"))
        c = str(pr.get("completion", "x"))
        if p in ("0", "0.0") and c in ("0", "0.0"):
            free.append(m)
    free.sort(key=lambda m: (-(m.get("context_length") or 0)))
    print(f"free models: {len(free)} / total {len(models)}")
    for m in free:
        arch = m.get("architecture", {}) or {}
        mods = ",".join(arch.get("input_modalities", []) or [])
        ctx = m.get("context_length") or 0
        mid = m.get("id", "?")
        print(f"{mid:60s} ctx={ctx:>8} in={mods}")


if __name__ == "__main__":
    main()
