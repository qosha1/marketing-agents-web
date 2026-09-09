#!/usr/bin/env python3
"""
Restore the declared attribute names `source_1/2/3` on marketing-agents topics
(bd startsim-8hgmq.18).

WHAT WENT WRONG. The browser client's key transform is not an involution:
snake->camel uppercases the character after an underscore, and uppercasing a
DIGIT is a no-op, so `source_1` reaches a component as `source1` and comes back
as `source1`. Every surface that PATCHes the whole `data` blob therefore renamed
the declared attribute. The VALUES were never lost — only the key names — so
restoring them is a rename, not a reconstruction.

WHY IT RUNS THROUGH curl-shaped REQUESTS AND NOT THE APP. Exactly the same
reason the one hand-repair on 2026-09-09 worked: this speaks the wire directly,
so a snake key sent is a snake key stored. Anything that goes through the
camelising client would re-inflict the bug it is repairing.

THE TIE-BREAK, for a row carrying BOTH spellings. The declared value wins. That
is not a preference: JSONB orders keys by length first, so `source1` (7) always
precedes `source_1` (8) in the stored object, both collapse onto `source1` on
read, and last-write-wins hands the app the DECLARED value already. Keeping it
is what makes the repair invisible to a reader — the app shows the same thing
before and after.

MEASURED 2026-09-09, all 84 topics, AFTER the app-side fix shipped:
    51  untouched  — declared spelling only
    25  renamed    — camel spelling only
     8  both       — a renamed row n8n later re-wrote, so it carries both
    33  rows this would PATCH

AND IT IS SHRINKING WITHOUT THIS SCRIPT. The fix in lib/foundry-api.wireSafeData
repairs whatever row it writes, so the population drains as topics are worked —
the 26/50 split above was 26/50 before one live drawer save and 25/51 after it.
This script exists for the rows nobody will touch again soon.

USAGE
    MA_TOKEN=$(curl -s -X POST https://api.startsimpli.com/api/v1/auth/token/ \
        -H 'Content-Type: application/json' \
        -d '{"email":"...","password":"..."}' | jq -r .access)
    python3 scripts/repair-source-keys.py            # report only
    python3 scripts/repair-source-keys.py --apply    # write

  --apply   actually PATCH. Without it this only reports.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

TENANT = "https://marketing-agents.ai.startsimpli.com"
TYPE_KEY = "topic"


def snake_to_camel(k):
    return re.sub(r"_([a-z0-9])", lambda m: m.group(1).upper(), k)


def camel_to_snake(k):
    return re.sub(r"[A-Z]", lambda m: "_" + m.group(0).lower(), k)


def lossy(name):
    """A declared name whose camel spelling can no longer be turned back into it."""
    return camel_to_snake(snake_to_camel(name)) != name


def call(path, token, method="GET", body=None):
    req = urllib.request.Request(
        f"{TENANT}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"null")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--token", default=os.environ.get("MA_TOKEN"))
    args = ap.parse_args()
    if not args.token:
        sys.exit("need --token or MA_TOKEN")

    types = call("/api/v1/schema/types/?page_size=50", args.token)["results"]
    topic = next(t for t in types if t["key"] == TYPE_KEY)
    declared = [a["name"] for a in topic["attributes"]]
    targets = [n for n in declared if lossy(n)]
    print(f"declared lossy attributes on `{TYPE_KEY}`: {targets}")
    if not targets:
        sys.exit("nothing to repair")

    rows = call(f"/api/v1/entities/?type={TYPE_KEY}&page_size=200", args.token)
    assert not rows["next"], "paginate me"
    print(f"rows: {len(rows['results'])} of {rows['count']}\n")

    plan = []
    counts = {"clean": 0, "renamed": 0, "both": 0}
    for r in rows["results"]:
        data = r.get("data") or {}
        edits = {}
        kinds = set()
        for name in targets:
            camel = snake_to_camel(name)
            if camel not in data:
                continue
            if name in data:
                kinds.add("both")
                # Declared value wins; the stale camel twin is dropped.
                edits[name] = data[name]
            else:
                kinds.add("renamed")
                edits[name] = data[camel]
        if not edits:
            counts["clean"] += 1
            continue
        counts["both" if "both" in kinds else "renamed"] += 1
        # PATCH replaces `data`, so send the whole blob with the camel twins gone.
        nxt = {k: v for k, v in data.items() if k not in {snake_to_camel(n) for n in targets}}
        nxt.update(edits)
        plan.append((r["id"], r.get("name", "")[:52], sorted(edits), nxt, data))

    # The per-row detector from the bead: human_edited remembers the names the
    # row used to carry, so a row where it names a key `data` lacks IS a renamed
    # row — identifiable individually rather than inferred from a population.
    detected = 0
    for r in rows["results"]:
        he = (r.get("human_edited") or {}).get("data") or {}
        if any(k not in (r.get("data") or {}) for k in he):
            detected += 1

    print(f"  untouched (declared spelling only) : {counts['clean']}")
    print(f"  renamed   (camel only)             : {counts['renamed']}")
    print(f"  both spellings (stale twin to drop): {counts['both']}")
    print(f"  -> rows this migration would PATCH : {len(plan)}")
    print(f"  cross-check, human_edited detector : {detected} rows name a key data lacks\n")

    for rid, name, keys, nxt, old in plan[:5]:
        print(f"  {rid}  {name}")
        for k in keys:
            print(f"      {k} <- {str(nxt[k])[:70]}")
            twin = snake_to_camel(k)
            if twin in old and old[twin] != nxt[k]:
                print(f"      (dropping stale {twin} = {str(old[twin])[:52]})")
    if len(plan) > 5:
        print(f"  ... +{len(plan) - 5} more")

    # No value may change: this renames keys, it never edits content.
    for rid, _n, keys, nxt, old in plan:
        for k in keys:
            assert nxt[k] == old.get(k, old.get(snake_to_camel(k))), rid
    print("\n  invariant holds: every repaired value is a value the row already had")

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        return

    ok = bad = 0
    for rid, name, _keys, nxt, _old in plan:
        try:
            call(f"/api/v1/entities/{rid}/", args.token, "PATCH", {"data": nxt})
            ok += 1
        except urllib.error.HTTPError as e:
            bad += 1
            print(f"  FAILED {rid}: {e.code} {e.read()[:200]}")
    print(f"\napplied: {ok} ok, {bad} failed")


if __name__ == "__main__":
    main()
