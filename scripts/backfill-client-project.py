#!/usr/bin/env python3
"""
Give every client scope exactly one project named after it (bd startsim-qbgng).

A project is a `scope` row with kind='project' (see src/lib/projects.ts). For
each ACTIVE client scope that has no project under it, this creates one at
<client path>/<client slug>, e.g. /ogmc -> /ogmc/ogmc named "OGMC". With
--restamp it also moves every topic and draft whose scope_path is exactly the
client's path onto that project; rows already under a project are left alone.

IDEMPOTENT: a client that already has a project child is skipped, a row already
on the project path is skipped, so re-running changes nothing.

It does nothing to the tenant unless --apply is passed. NOT RUN against any
production tenant by the author of this change.

  TENANT_URL=http://localhost:4014 TENANT_TOKEN=$(./local-stack/up.sh token) \\
    python3 scripts/backfill-client-project.py [--apply] [--restamp]
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request

BASE = os.environ.get("TENANT_URL", "").rstrip("/")
TOKEN = os.environ.get("TENANT_TOKEN", "")
STAMPED_TYPES = ("topic", "draft")


def call(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE}/api/v1/{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as res:
        return json.load(res)


def list_all(type_, **filters):
    page, out = 1, []
    while True:
        qs = urllib.parse.urlencode({"type": type_, "page": page, "page_size": 200, **filters})
        res = call("GET", f"entities/?{qs}")
        out += res["results"]
        if not res.get("next"):
            return out
        page += 1


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "project"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write; without it, only report")
    ap.add_argument("--restamp", action="store_true", help="move client-level topics/drafts onto the project")
    args = ap.parse_args()
    if not BASE or not TOKEN:
        sys.exit("set TENANT_URL and TENANT_TOKEN")

    scopes = list_all("scope")
    paths = {s["data"].get("path") for s in scopes}
    clients = [s for s in scopes if s["data"].get("kind") == "client" and s["data"].get("active", True)]
    for client in clients:
        cpath, cname = client["data"]["path"], client["data"].get("name") or client["name"]
        has_project = any(
            s["data"].get("kind") == "project" and s["data"].get("parent") == cpath for s in scopes
        )
        ppath = f"{cpath}/{slug(cname)}"
        if has_project:
            existing = [s["data"]["path"] for s in scopes if s["data"].get("kind") == "project" and s["data"].get("parent") == cpath]
            print(f"skip   {cpath}: already has {existing}")
            ppath = existing[0] if len(existing) == 1 else None
        elif ppath in paths:
            print(f"skip   {cpath}: {ppath} is taken by a non-project scope")
            continue
        else:
            print(f"create {ppath} ({cname})")
            if args.apply:
                call("POST", "entities/", {
                    "entity_type": "scope",
                    "name": cname,
                    "external_id": f"scope:{ppath}",
                    "data": {"name": cname, "kind": "project", "path": ppath, "parent": cpath, "active": True},
                })
        if not (args.restamp and ppath):
            continue
        for type_ in STAMPED_TYPES:
            rows = list_all(type_, **{"attr.scope_path": cpath})
            print(f"  {type_}: {len(rows)} at {cpath} -> {ppath}")
            if args.apply:
                for row in rows:
                    call("PATCH", f"entities/{row['id']}/", {"data": {**row["data"], "scope_path": ppath}})


if __name__ == "__main__":
    main()
