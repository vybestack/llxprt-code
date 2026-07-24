#!/usr/bin/env python3
"""
Fake gh CLI for assignment automation behavioral tests.

Models GitHub REST API state transitions backed by a JSON state file.
Supports: gh api <path> [--method METHOD] [--input -] [-f key=value]...
          [-F key=value]... [--paginate] [--jq EXPR]

Key behavioral modeling:
  - --paginate: outputs SEPARATE JSON documents per page (concatenated),
    exactly like real `gh api --paginate`. This is NOT one merged array.
  - -f/--field values are always STRINGS. -F/--raw-field values are JSON-typed.
    key[]=value syntax creates array entries (matching gh CLI behavior).
  - PATCH/PUT with string-typed assignees/labels is rejected (validation error),
    matching real GitHub behavior for malformed array fields.
  - State-level "page_size" overrides per_page for test-controlled pagination.
  - side_effects: mutate state on the Nth matching request (method+endpoint),
    enabling race-condition tests.
  - fail_config supports both flat {endpoint: type} and structured
    {requests: [{method, endpoint, on_nth, type}]} for targeted injection.
  - POST/DELETE targeted labels and assignees, silent dropping of configured
    unassignable logins, assignment/unassignment timeline events with request
    actor, label names with commas, and repository_url on PR cross refs.
  - /issues listing includes PRs (like real GitHub); scripts must filter with
    is:issue or pull_request checks.

This is test infrastructure (not production code). It models only GitHub API
state transitions — it does NOT duplicate business logic from the scripts
under test.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

try:
    import fcntl
except ImportError:
    fcntl = None

StateFile = os.environ.get("GH_FAKE_STATE", "")
LockFile = StateFile + ".lock" if StateFile else ""


def die(msg, code=1):
    sys.stderr.write(msg + "\n")
    sys.exit(code)


def load_state():
    if not StateFile:
        die("GH_FAKE_STATE not set")
    if not os.path.exists(StateFile):
        die(f"State file not found: {StateFile}")
    with open(StateFile) as f:
        return json.load(f)


def save_state(state):
    tmp = StateFile + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, StateFile)


def log_operation(state, method, endpoint, status):
    """Append to the operation log for strict state assertions."""
    state.setdefault("_op_log", []).append({
        "method": method,
        "endpoint": endpoint,
        "status": status,
    })


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def parse_api_args(argv):
    """Parse `gh api` arguments into a structured dict.

    Key distinction (matching real gh CLI):
      -f / --raw-field  → string value (sent as-is)
      -F / --field      → typed value (JSON magic conversion)
    Both support key[]=value syntax for array fields.
    """
    method = "GET"
    path = None
    input_file = None
    string_fields = []
    raw_fields = []
    paginate = False
    jq_filter = None
    silent = False

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("--method", "-X"):
            method = argv[i + 1].upper()
            i += 2
        elif arg == "--input":
            input_file = argv[i + 1]
            i += 2
        elif arg in ("-f", "--raw-field"):
            kv = argv[i + 1]
            if "=" in kv:
                k, v = kv.split("=", 1)
                string_fields.append((k, v))
            i += 2
        elif arg in ("-F", "--field"):
            kv = argv[i + 1]
            if "=" in kv:
                k, raw_v = kv.split("=", 1)
                parsed = _coerce_field_value(raw_v)
                raw_fields.append((k, parsed))
            i += 2
        elif arg == "--paginate":
            paginate = True
            i += 1
        elif arg == "--jq":
            jq_filter = argv[i + 1]
            i += 2
        elif arg == "-q":
            jq_filter = argv[i + 1]
            i += 2
        elif arg == "--silent":
            silent = True
            i += 1
        elif arg in ("-H", "--header"):
            i += 2
        elif arg in ("-s", "--include", "-i"):
            i += 1
        elif arg == "-h":
            die("usage: gh api <path> [flags]", 0)
        elif not arg.startswith("-") and path is None:
            path = arg
            i += 1
        else:
            i += 1

    body = None
    if input_file:
        if input_file == "-":
            raw = sys.stdin.read()
        else:
            with open(input_file) as f:
                raw = f.read()
        if raw.strip():
            body = json.loads(raw)
    elif string_fields or raw_fields:
        body = build_body_from_fields(string_fields, raw_fields)

    return {
        "method": method,
        "path": path,
        "body": body,
        "paginate": paginate,
        "jq_filter": jq_filter,
        "silent": silent,
    }


def build_body_from_fields(string_fields, raw_fields):
    """Build a dict body from -f (raw/string) and -F (typed) fields.

    Handles key[]=value array syntax: multiple key[] entries accumulate.
    For non-array keys, later values override earlier ones.
    """
    body = {}

    for key, value in string_fields:
        _add_field(body, key, value)

    for key, value in raw_fields:
        _add_field(body, key, value)

    return body


def _coerce_field_value(raw_v):
    """Mimic gh -F/--field magic type conversion.

    - literal true/false/null → JSON bool/null
    - integer numbers → int
    - starts with @ → read file content (not needed for tests)
    - everything else → string
    """
    if raw_v == "true":
        return True
    if raw_v == "false":
        return False
    if raw_v == "null":
        return None
    try:
        return int(raw_v)
    except ValueError:
        pass
    return raw_v


def _add_field(body, key, value):
    if key.endswith("[]"):
        real_key = key[:-2]
        body.setdefault(real_key, []).append(value)
    else:
        body[key] = value


# ---------------------------------------------------------------------------
# Path / query parsing
# ---------------------------------------------------------------------------

def split_path(raw_path):
    if "?" in raw_path:
        base, query = raw_path.split("?", 1)
    else:
        base, query = raw_path, ""
    params = {}
    if query:
        for pair in query.split("&"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                params[urllib.parse.unquote_plus(k)] = urllib.parse.unquote_plus(v)
            else:
                params[urllib.parse.unquote_plus(pair)] = ""
    return base, params


# ---------------------------------------------------------------------------
# Fail-config matching
# ---------------------------------------------------------------------------

def check_fail(state, method, base_path):
    """Check if a request should fail.

    Supports two formats:
      1. Flat: {"endpoint_pattern": "error"|"malformed"} — applies to ALL methods
      2. Structured: {"requests": [{"method": "POST", "endpoint": "...",
         "on_nth": 1, "type": "error"|"malformed"}]}

    For structured format, nth occurrence is tracked per (method, endpoint).
    The ordinal increments exactly once per actual endpoint request, shared
    across all matching rules.
    """
    fc = state.get("fail_config", {})

    # Check structured requests format first
    requests = fc.get("requests", [])
    matching = []
    for req in requests:
        req_method = req.get("method", "GET").upper()
        if req_method != method:
            continue
        endpoint = req.get("endpoint", "")
        if endpoint != base_path:
            regex = re.escape(endpoint).replace(r"\*", ".*")
            if not re.fullmatch(regex, base_path):
                continue
        matching.append(req)

    if matching:
        # Increment the ordinal exactly once for this (method, endpoint).
        first = matching[0]
        endpoint = first.get("endpoint", "")
        count_key = f"_fail_count_{method}_{endpoint}"
        ordinal = state.get(count_key, 0) + 1
        state[count_key] = ordinal
        save_state(state)
        # Evaluate all matching rules against the immutable ordinal.
        for req in matching:
            if ordinal == req.get("on_nth", 1):
                fail_type = req.get("type", "error")
                http_status = req.get("http_status")
                return True, {"type": fail_type, "http_status": http_status}

    # Check flat format (applies to all methods, all occurrences)
    for pattern, fail_type in fc.items():
        if pattern == "requests":
            continue
        if isinstance(fail_type, dict):
            continue
        if pattern == base_path:
            return True, {"type": fail_type, "http_status": None}
        regex = re.escape(pattern).replace(r"\*", ".*")
        if re.fullmatch(regex, base_path):
            return True, {"type": fail_type, "http_status": None}

    return False, None


# ---------------------------------------------------------------------------
# Side effects (for race-condition tests)
# ---------------------------------------------------------------------------

def apply_side_effects(state, method, base_path):
    """Mutate state on the Nth matching request, then persist.

    Supports both pre-handler effects (applied BEFORE the request is
    processed, for race simulation) and post-handler effects (applied
    AFTER the request is processed, for post-handler race simulation).

    Side effects are applied exactly once per invocation. Counting is
    per (method, endpoint). The ordinal increments exactly once per actual
    endpoint request, shared across all matching rules (pre and post).
    """
    # Collect all matching rules first.
    matching = []
    for se in state.get("side_effects", []):
        if se.get("method", "GET").upper() != method.upper():
            continue
        endpoint = se.get("endpoint", "")
        if endpoint != base_path:
            regex = re.escape(endpoint).replace(r"\*", ".*")
            if not re.fullmatch(regex, base_path):
                continue
        matching.append(se)

    if not matching:
        return

    # Increment the ordinal exactly once for this (method, endpoint).
    first = matching[0]
    endpoint = first.get("endpoint", "")
    count_key = f"_se_count_{method}_{endpoint}"
    ordinal = state.get(count_key, 0) + 1
    state[count_key] = ordinal
    save_state(state)

    # Evaluate all matching pre-effects against the immutable ordinal.
    changed = False
    for se in matching:
        if ordinal != se.get("on_nth", 1):
            continue
        timing = se.get("timing", "pre")
        if timing == "post":
            continue
        _apply_side_effect_action(state, se)
        changed = True
    if changed:
        save_state(state)


def apply_post_side_effects(state, method, base_path):
    """Apply post-handler side effects (after the request was processed).

    Shares the same ordinal as the pre-handler pass (incremented once per
    actual endpoint request in apply_side_effects).
    """
    matching = []
    for se in state.get("side_effects", []):
        if se.get("method", "GET").upper() != method.upper():
            continue
        endpoint = se.get("endpoint", "")
        if endpoint != base_path:
            regex = re.escape(endpoint).replace(r"\*", ".*")
            if not re.fullmatch(regex, base_path):
                continue
        matching.append(se)

    if not matching:
        return

    # Read the ordinal already set by apply_side_effects.
    first = matching[0]
    endpoint = first.get("endpoint", "")
    count_key = f"_se_count_{method}_{endpoint}"
    ordinal = state.get(count_key, 0)

    changed = False
    for se in matching:
        if ordinal != se.get("on_nth", 1):
            continue
        timing = se.get("timing", "pre")
        if timing != "post":
            continue
        _apply_side_effect_action(state, se)
        changed = True
    if changed:
        save_state(state)


def _apply_side_effect_action(state, se):
    action = se.get("action")
    issue = state.get("issues", {}).get(str(se.get("issue", "")))
    if action == "add_assignee" and issue is not None:
        a = se["assignee"]
        if a not in issue.get("_assignees", []):
            issue.setdefault("_assignees", []).append(a)
            _add_timeline_event(state, se.get("issue"), {
                "event": "assigned",
                "actor": {"login": se.get("actor", "concurrent-user"), "type": "User"},
                "assignee": {"login": a},
                "created_at": state.get("now", "2025-07-23T00:00:00Z"),
            })
    elif action == "readd_assignee" and issue is not None:
        a = se["assignee"]
        issue["_assignees"] = issue.get("_assignees", [])
        if a not in issue["_assignees"]:
            issue["_assignees"].append(a)
    elif action == "unassign_reassign" and issue is not None:
        a = se["assignee"]
        actor = se.get("actor", "concurrent-user")
        if a in issue.get("_assignees", []):
            issue["_assignees"] = [login for login in issue["_assignees"] if login != a]
            _add_timeline_event(state, se.get("issue"), {
                "event": "unassigned",
                "actor": {"login": actor, "type": "User"},
                "assignee": {"login": a},
                "created_at": state.get("now", "2025-07-23T00:00:00Z"),
            })
        issue.setdefault("_assignees", []).append(a)
        _add_timeline_event(state, se.get("issue"), {
            "event": "assigned",
            "actor": {"login": actor, "type": "User"},
            "assignee": {"login": a},
            "created_at": state.get("now", "2025-07-23T00:00:00Z"),
        })
    elif action == "pause":
        hook_file = se.get("hook_file")
        if hook_file:
            with open(hook_file, "w") as f:
                f.write("paused\n")
        time.sleep(float(se.get("seconds", 1)))
    elif action == "remove_label" and issue is not None:
        lbl = se["label"]
        issue["_label_names"] = [
            l for l in issue.get("_label_names", []) if l != lbl
        ]
    elif action == "add_assignee_to_search" and issue is not None:
        a = se["assignee"]
        if a not in issue.get("_assignees", []):
            issue.setdefault("_assignees", []).append(a)
    elif action == "add_label" and issue is not None:
        lbl = se["label"]
        if lbl not in issue.get("_label_names", []):
            issue.setdefault("_label_names", []).append(lbl)
    elif action == "set_state" and issue is not None:
        issue["state"] = se.get("state", "open")
    elif action == "add_cross_ref":
        issue_num = se.get("issue")
        if issue_num is not None:
            _add_timeline_event(state, issue_num, {
                "event": "cross-referenced",
                "actor": {"login": se.get("pr_author", "unknown"), "type": "User"},
                "source": {
                    "issue": {
                        "number": se.get("pr_number", 0),
                        "title": f"PR #{se.get('pr_number', 0)}",
                        "pull_request": {"url": ""},
                        "user": {
                            "login": se.get("pr_author", "unknown"),
                            "type": "User",
                        },
                        "repository_url": se.get(
                            "repo_url",
                            "https://api.github.com/repos/test/repo",
                        ),
                    }
                },
                "created_at": se.get(
                    "created_at", state.get("now", "2025-07-23T00:00:00Z")
                ),
            })
    elif action == "unassign" and issue is not None:
        a = se["assignee"]
        actor = se.get("actor", "concurrent-user")
        if a in issue.get("_assignees", []):
            issue["_assignees"] = [
                login for login in issue["_assignees"] if login != a
            ]
            _add_timeline_event(state, se.get("issue"), {
                "event": "unassigned",
                "actor": {"login": actor, "type": "User"},
                "assignee": {"login": a},
                "created_at": state.get("now", "2025-07-23T00:00:00Z"),
            })


# ---------------------------------------------------------------------------
# Timeline event helper
# ---------------------------------------------------------------------------

def _next_event_id(state):
    eid = state.get("next_event_id", 10000)
    state["next_event_id"] = eid + 1
    return eid


def _add_timeline_event(state, issue_num, event):
    """Add a timeline/event entry for an issue."""
    event = dict(event)
    event["id"] = _next_event_id(state)
    key = str(issue_num)
    state.setdefault("timeline", {}).setdefault(key, []).append(event)
    state.setdefault("events", {}).setdefault(key, []).append(event)


# ---------------------------------------------------------------------------
# Response shaping
# ---------------------------------------------------------------------------

def issue_to_api(issue, state):
    labels = []
    for name in issue.get("_label_names", []):
        lbl = state.get("labels", {}).get(name)
        if lbl:
            labels.append(dict(lbl))
        else:
            labels.append({"name": name})
    return {
        "number": issue["number"],
        "title": issue.get("title", ""),
        "body": issue.get("body", ""),
        "state": issue.get("state", "open"),
        "assignees": [{"login": l} for l in issue.get("_assignees", [])],
        "labels": labels,
        "created_at": issue.get("created_at", ""),
        "updated_at": issue.get("updated_at", ""),
        "user": issue.get("user", {"login": "reporter", "type": "User"}),
        "pull_request": issue.get("pull_request"),
    }


def pr_to_issue_api(pr, state):
    """Convert a PR to the issue-API shape (GitHub /issues includes PRs)."""
    labels = []
    for name in pr.get("_label_names", pr.get("labels", [])):
        if isinstance(name, str):
            lbl = state.get("labels", {}).get(name)
            if lbl:
                labels.append(dict(lbl))
            else:
                labels.append({"name": name})
        elif isinstance(name, dict):
            labels.append(dict(name))
    return {
        "number": pr["number"],
        "title": pr.get("title", ""),
        "body": pr.get("body", ""),
        "state": pr.get("state", "open"),
        "assignees": [{"login": l} for l in pr.get("_assignees", pr.get("assignees", []))],
        "labels": labels,
        "created_at": pr.get("created_at", ""),
        "updated_at": pr.get("updated_at", ""),
        "user": pr.get("user", {"login": "unknown", "type": "User"}),
        "pull_request": pr.get("pull_request", {"url": ""}),
        "merged_at": pr.get("merged_at"),
    }


def comment_to_api(comment):
    return {
        "id": comment["id"],
        "body": comment.get("body", ""),
        "user": comment.get("user", {"login": "unknown", "type": "User"}),
        "created_at": comment.get("created_at", ""),
        "updated_at": comment.get("updated_at", ""),
        "issue_url": f"https://api.github.com/repos/test/repo/issues/{comment.get('issue_number', 0)}",
    }


def event_to_api(event):
    out = {
        "id": event.get("id", 0),
        "event": event.get("event", ""),
        "created_at": event.get("created_at", ""),
        "actor": event.get("actor", {"login": "unknown", "type": "User"}),
    }
    if "assignee" in event:
        out["assignee"] = event["assignee"]
    if "commit_id" in event:
        out["commit_id"] = event["commit_id"]
    if "commit_url" in event:
        out["commit_url"] = event["commit_url"]
    if "label" in event:
        out["label"] = event["label"]
    if "issue" in event:
        out["issue"] = event["issue"]
    return out


def timeline_event_to_api(event):
    out = event_to_api(event)
    if "source" in event:
        out["source"] = event["source"]
    return out


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

DEFAULT_PER_PAGE = 30


def get_per_page(params, state):
    state_ps = state.get("page_size")
    if state_ps:
        return max(1, int(state_ps))
    pp = params.get("per_page")
    if pp:
        try:
            return max(1, int(pp))
        except ValueError:
            pass
    return DEFAULT_PER_PAGE


def split_pages(items, params, do_paginate, state):
    pp = get_per_page(params, state)
    page = 1
    if "page" in params:
        try:
            page = max(1, int(params["page"]))
        except ValueError:
            pass
    if do_paginate:
        pages = []
        for i in range(0, len(items), pp):
            pages.append(items[i : i + pp])
        if not pages:
            pages.append([])
        return pages
    start = (page - 1) * pp
    return [items[start : start + pp]]


# ---------------------------------------------------------------------------
# Endpoint handlers
# ---------------------------------------------------------------------------

REPO_PREFIX = r"repos/[^/]+/[^/]+"
REPO_URL = "https://api.github.com/repos/test/repo"


def handle_get(state, base_path, params, do_paginate):
    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)$", base_path)
    if m:
        num = int(m.group(1))
        issue = state.get("issues", {}).get(str(num))
        if issue is not None:
            return issue_to_api(issue, state)
        pr = state.get("prs", {}).get(str(num))
        if pr is not None:
            return pr_to_issue_api(pr, state)
        die(f"HTTP 404: Issue #{num} not found", 1)

    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/comments$", base_path)
    if m:
        num = int(m.group(1))
        return [
            comment_to_api(c)
            for c in state.get("comments", [])
            if c.get("issue_number") == num
        ]

    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/timeline$", base_path)
    if m:
        num = int(m.group(1))
        events = state.get("timeline", {}).get(str(num), [])
        return [timeline_event_to_api(e) for e in events]

    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/events$", base_path)
    if m:
        num = int(m.group(1))
        events = state.get("events", {}).get(str(num), [])
        return [event_to_api(e) for e in events]

    m = re.match(rf"^{REPO_PREFIX}/issues/events$", base_path)
    if m:
        # GitHub's repository-wide /issues/events endpoint includes events
        # for BOTH issues and PRs (PRs are issues in the API).
        all_events = []
        for num_str, issue in state.get("issues", {}).items():
            issue_events = state.get("events", {}).get(num_str, [])
            issue_api = issue_to_api(issue, state)
            for e in issue_events:
                enriched = dict(e)
                enriched["issue"] = issue_api
                all_events.append(enriched)
        for num_str, pr in state.get("prs", {}).items():
            pr_events = state.get("events", {}).get(num_str, [])
            pr_api = pr_to_issue_api(pr, state)
            for e in pr_events:
                enriched = dict(e)
                enriched["issue"] = pr_api
                all_events.append(enriched)
        return [event_to_api(e) for e in all_events]

    m = re.match(rf"^{REPO_PREFIX}/issues$", base_path)
    if m:
        # Validate state filter — must be a known value.
        state_filter = params.get("state", "open")
        valid_state_values = {"open", "closed", "all"}
        if state_filter is not None and state_filter not in valid_state_values:
            die(
                json.dumps({
                    "message": "Validation Failed",
                    "errors": [{"field": "state", "code": "invalid",
                                 "message": f"Invalid state value: {state_filter}"}],
                }),
                1,
            )
        results = []
        # GitHub defaults omitted state to "open" for /issues listing.
        state_filter = params.get("state", "open")
        assignee_filter = params.get("assignee")
        label_filter = params.get("labels")
        for _num_str, issue in state.get("issues", {}).items():
            if state_filter == "open" and issue.get("state", "open") != "open":
                continue
            if state_filter == "closed" and issue.get("state") != "closed":
                continue
            if state_filter == "all":
                pass
            if assignee_filter and assignee_filter not in issue.get("_assignees", []):
                continue
            if label_filter:
                wanted = set(label_filter.split(","))
                have = set(issue.get("_label_names", []))
                if not wanted.issubset(have):
                    continue
            results.append(issue_to_api(issue, state))
        # GitHub /issues includes PRs too (unless filtered by query)
        for _num_str, pr in state.get("prs", {}).items():
            if state_filter == "open" and pr.get("state", "open") != "open":
                continue
            if state_filter == "closed" and pr.get("state") != "closed":
                continue
            if state_filter == "all":
                pass
            if assignee_filter:
                pr_assignees = pr.get("_assignees", pr.get("assignees", []))
                if assignee_filter not in pr_assignees:
                    continue
            if label_filter:
                wanted = set(label_filter.split(","))
                have = set(pr.get("_label_names", []))
                if not wanted.issubset(have):
                    continue
            results.append(pr_to_issue_api(pr, state))
        return results

    m = re.match(rf"^{REPO_PREFIX}/issues/comments/(\d+)$", base_path)
    if m:
        cid = int(m.group(1))
        for c in state.get("comments", []):
            if c["id"] == cid:
                return comment_to_api(c)
        die(f"HTTP 404: Comment {cid} not found", 1)

    m = re.match(rf"^{REPO_PREFIX}/labels/(.+)$", base_path)
    if m:
        name = urllib.parse.unquote(m.group(1))
        lbl = state.get("labels", {}).get(name)
        if lbl is None:
            die(f"HTTP 404: Label '{name}' not found", 1)
        return dict(lbl)

    m = re.match(rf"^{REPO_PREFIX}/labels$", base_path)
    if m:
        return [dict(l) for l in state.get("labels", {}).values()]

    m = re.match(r"^search/issues$", base_path)
    if m:
        return handle_search(state, params)

    die(f"HTTP 404: Unknown GET endpoint: {base_path}", 1)


def handle_search(state, params):
    q = params.get("q", "")
    # After URL decoding (unquote_plus already converted '+' to space),
    # split on whitespace only — a literal '+' in a search term would have
    # been percent-encoded as %2B and should NOT be treated as a separator.
    terms = [t.strip() for t in re.split(r"\s+", q) if t.strip()]
    repo_filter = None
    author = None
    item_type = None
    is_merged = False
    is_open = False
    is_closed = False
    is_issue = False
    is_pr = False
    assignee = None
    state_filter = None

    for term in terms:
        if term.startswith("repo:"):
            repo_filter = term[5:]
        elif term.startswith("author:"):
            author = term[7:]
        elif term.startswith("type:"):
            item_type = term[5:]
        elif term.startswith("assignee:"):
            assignee = term[9:]
        elif term.startswith("state:"):
            state_filter = term[6:]
        elif term.startswith("is:"):
            qualifier = term[3:]
            if qualifier == "merged":
                is_merged = True
            elif qualifier == "open":
                is_open = True
            elif qualifier == "closed":
                is_closed = True
            elif qualifier == "issue":
                is_issue = True
            elif qualifier == "pr":
                is_pr = True

    # Validate type: qualifier — must be a known value.
    valid_types = {"issue", "pr"}
    if item_type is not None and item_type not in valid_types:
        die(
            json.dumps({
                "message": "Validation Failed",
                "errors": [{"field": "q", "code": "invalid",
                             "message": f"Invalid type qualifier: {item_type}"}],
            }),
            1,
        )

    # Validate is: qualifiers — must be known values.
    valid_is = {"merged", "open", "closed", "issue", "pr", "public", "private"}
    for term in terms:
        if term.startswith("is:"):
            qualifier = term[3:]
            if qualifier not in valid_is:
                die(
                    json.dumps({
                        "message": "Validation Failed",
                        "errors": [{"field": "q", "code": "invalid",
                                     "message": f"Invalid is qualifier: {qualifier}"}],
                    }),
                    1,
                )

    # Validate state: qualifier — must be a known value.
    if state_filter is not None:
        valid_states = {"open", "closed"}
        if state_filter not in valid_states:
            die(
                json.dumps({
                    "message": "Validation Failed",
                    "errors": [{"field": "q", "code": "invalid",
                                 "message": f"Invalid state qualifier: {state_filter}"}],
                }),
                1,
            )

    # repo: filter — fake models a single repo, so if repo: doesn't match the
    # configured GITHUB_REPOSITORY, return zero results.
    configured_repo = state.get("repo", "test/repo")
    if repo_filter is not None and repo_filter != configured_repo:
        return {
            "total_count": 0,
            "incomplete_results": False,
            "items": [],
        }

    # Resolve type from is: qualifiers if type: not specified
    if item_type is None:
        if is_issue:
            item_type = "issue"
        elif is_pr:
            item_type = "pr"

    # Resolve state filter
    if state_filter is None:
        if is_open:
            state_filter = "open"
        elif is_closed:
            state_filter = "closed"

    results = []

    # Include issues (unless explicitly filtering to PRs only)
    if item_type != "pr":
        for _num_str, issue in state.get("issues", {}).items():
            if assignee and assignee not in issue.get("_assignees", []):
                continue
            if author and issue.get("user", {}).get("login") != author:
                continue
            if state_filter:
                if state_filter == "open" and issue.get("state", "open") != "open":
                    continue
                if state_filter == "closed" and issue.get("state") != "closed":
                    continue
            results.append(issue_to_api(issue, state))

    # Include PRs (unless explicitly filtering to issues only)
    if item_type != "issue":
        for _num_str, pr in state.get("prs", {}).items():
            if author and pr.get("user", {}).get("login") != author:
                continue
            if is_merged and not pr.get("merged_at"):
                continue
            if state_filter:
                if state_filter == "open" and pr.get("state", "open") != "open":
                    continue
                if state_filter == "closed" and pr.get("state") != "closed":
                    continue
            if assignee:
                pr_assignees = pr.get("_assignees", pr.get("assignees", []))
                if assignee not in pr_assignees:
                    continue
            results.append(pr_to_issue_api(pr, state))

    # Final type filter
    if item_type == "pr":
        results = [r for r in results if r.get("pull_request") is not None]
    elif item_type == "issue":
        results = [r for r in results if r.get("pull_request") is None]

    return {
        "total_count": len(results),
        "incomplete_results": state.get("search_incomplete", False),
        "items": results,
    }


def handle_post(state, base_path, body):
    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/comments$", base_path)
    if m:
        num = int(m.group(1))
        cid = state.get("next_comment_id", 100)
        state["next_comment_id"] = cid + 1
        comment = {
            "id": cid,
            "issue_number": num,
            "body": body.get("body", "") if body else "",
            "user": {"login": "github-actions[bot]", "type": "Bot"},
            "created_at": state.get("now", "2025-07-23T00:00:00Z"),
            "updated_at": state.get("now", "2025-07-23T00:00:00Z"),
        }
        state.setdefault("comments", []).append(comment)
        save_state(state)
        return comment_to_api(comment)

    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/labels$", base_path)
    if m:
        num = int(m.group(1))
        issue = state.get("issues", {}).get(str(num))
        if issue is None:
            die(f"HTTP 404: Issue #{num} not found", 1)
        if body and isinstance(body, list):
            label_names = body
        elif body and "labels" in body and isinstance(body["labels"], list):
            label_names = body["labels"]
        elif body and "labels" in body:
            validate_array_field(body, "labels")
            label_names = []
        else:
            label_names = []
        for name in label_names:
            if name not in issue.get("_label_names", []):
                issue.setdefault("_label_names", []).append(name)
                _add_timeline_event(state, num, {
                    "event": "labeled",
                    "actor": {"login": "github-actions[bot]", "type": "Bot"},
                    "label": {"name": name},
                    "created_at": state.get("now", "2025-07-23T00:00:00Z"),
                })
        issue["updated_at"] = state.get("now", "2025-07-23T00:00:00Z")
        save_state(state)
        return issue_to_api(issue, state)

    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/assignees$", base_path)
    if m:
        num = int(m.group(1))
        issue = state.get("issues", {}).get(str(num))
        if issue is None:
            die(f"HTTP 404: Issue #{num} not found", 1)
        if body and "assignees" in body and isinstance(body["assignees"], list):
            logins = body["assignees"]
        elif body and isinstance(body, list):
            logins = body
        elif body and "assignees" in body:
            validate_array_field(body, "assignees")
            logins = []
        else:
            logins = []
        unassignable = state.get("unassignable_logins", [])
        for login in logins:
            if login in unassignable:
                continue
            if login not in issue.get("_assignees", []):
                issue.setdefault("_assignees", []).append(login)
                _add_timeline_event(state, num, {
                    "event": "assigned",
                    "actor": {"login": "github-actions[bot]", "type": "Bot"},
                    "assignee": {"login": login},
                    "created_at": state.get("now", "2025-07-23T00:00:00Z"),
                })
        issue["updated_at"] = state.get("now", "2025-07-23T00:00:00Z")
        save_state(state)
        return issue_to_api(issue, state)

    m = re.match(rf"^{REPO_PREFIX}/labels$", base_path)
    if m:
        name = body.get("name", "") if body else ""
        if not name:
            die(
                json.dumps(
                    {"message": "Validation Failed", "errors": [{"field": "name", "code": "missing"}]}
                ),
                1,
            )
        if len(name) > 50:
            die(
                json.dumps(
                    {
                        "message": "Validation Failed",
                        "errors": [{"field": "name", "code": "too_long",
                                     "message": "length must be <= 50"}],
                    }
                ),
                1,
            )
        if name in state.get("labels", {}):
            die(
                json.dumps(
                    {"message": "Validation Failed", "errors": [{"code": "already_exists"}]}
                ),
                1,
            )
        lbl = {
            "name": name,
            "color": body.get("color", "ededed") if body else "ededed",
            "description": body.get("description", "") if body else "",
        }
        state.setdefault("labels", {})[name] = lbl
        save_state(state)
        return dict(lbl)

    die(f"HTTP 404: Unknown POST endpoint: {base_path}", 1)


def validate_array_field(body, field_name):
    """Reject string-typed array fields (--field sends strings, not arrays)."""
    if field_name in body and not isinstance(body[field_name], list):
        die(
            json.dumps(
                {
                    "message": "Validation Failed",
                    "errors": [
                        {
                            "field": field_name,
                            "code": "invalid",
                            "message": f"Expected array, got string for '{field_name}'",
                        }
                    ],
                }
            ),
            1,
        )


def handle_patch(state, base_path, body):
    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)$", base_path)
    if m:
        num = int(m.group(1))
        issue = state.get("issues", {}).get(str(num))
        if issue is None:
            die(f"HTTP 404: Issue #{num} not found", 1)
        if body:
            validate_array_field(body, "assignees")
            validate_array_field(body, "labels")
            if "assignees" in body:
                unassignable = state.get("unassignable_logins", [])
                requested = list(body["assignees"])
                filtered = [a for a in requested if a not in unassignable]
                issue["_assignees"] = filtered
            if "labels" in body:
                issue["_label_names"] = list(body["labels"])
            if "state" in body:
                issue["state"] = body["state"]
            if "title" in body:
                issue["title"] = body["title"]
            if "body" in body:
                issue["body"] = body["body"]
            issue["updated_at"] = state.get("now", "2025-07-23T00:00:00Z")
        save_state(state)
        return issue_to_api(issue, state)

    m = re.match(rf"^{REPO_PREFIX}/issues/comments/(\d+)$", base_path)
    if m:
        cid = int(m.group(1))
        for c in state.get("comments", []):
            if c["id"] == cid:
                if body and "body" in body:
                    c["body"] = body["body"]
                    c["updated_at"] = state.get("now", "2025-07-23T00:00:00Z")
                save_state(state)
                return comment_to_api(c)
        die(f"HTTP 404: Comment {cid} not found", 1)

    die(f"HTTP 404: Unknown PATCH endpoint: {base_path}", 1)


def handle_delete(state, base_path, body):
    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/assignees$", base_path)
    if m:
        num = int(m.group(1))
        issue = state.get("issues", {}).get(str(num))
        if issue is None:
            die(f"HTTP 404: Issue #{num} not found", 1)
        logins = []
        if body and "assignees" in body and isinstance(body["assignees"], list):
            logins = body["assignees"]
        for login in logins:
            if login in issue.get("_assignees", []):
                issue["_assignees"] = [a for a in issue["_assignees"] if a != login]
                _add_timeline_event(state, num, {
                    "event": "unassigned",
                    "actor": {"login": "github-actions[bot]", "type": "Bot"},
                    "assignee": {"login": login},
                    "created_at": state.get("now", "2025-07-23T00:00:00Z"),
                })
        issue["updated_at"] = state.get("now", "2025-07-23T00:00:00Z")
        save_state(state)
        return issue_to_api(issue, state)

    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/labels/(.+)$", base_path)
    if m:
        num = int(m.group(1))
        name = urllib.parse.unquote(m.group(2))
        issue = state.get("issues", {}).get(str(num))
        if issue is None:
            die(f"HTTP 404: Issue #{num} not found", 1)
        # GitHub returns 404 for DELETE of a label not attached to the issue.
        if name not in issue.get("_label_names", []):
            die(
                json.dumps({
                    "message": "Not Found",
                    "documentation_url": "https://docs.github.com/rest/issues/labels",
                    "status": "404",
                }),
                1,
            )
        issue["_label_names"] = [l for l in issue["_label_names"] if l != name]
        _add_timeline_event(state, num, {
            "event": "unlabeled",
            "actor": {"login": "github-actions[bot]", "type": "Bot"},
            "label": {"name": name},
            "created_at": state.get("now", "2025-07-23T00:00:00Z"),
        })
        issue["updated_at"] = state.get("now", "2025-07-23T00:00:00Z")
        save_state(state)
        return issue_to_api(issue, state)

    m = re.match(rf"^{REPO_PREFIX}/issues/(\d+)/labels$", base_path)
    if m:
        num = int(m.group(1))
        issue = state.get("issues", {}).get(str(num))
        if issue is None:
            die(f"HTTP 404: Issue #{num} not found", 1)
        old_labels = list(issue.get("_label_names", []))
        issue["_label_names"] = []
        for name in old_labels:
            _add_timeline_event(state, num, {
                "event": "unlabeled",
                "actor": {"login": "github-actions[bot]", "type": "Bot"},
                "label": {"name": name},
                "created_at": state.get("now", "2025-07-23T00:00:00Z"),
            })
        issue["updated_at"] = state.get("now", "2025-07-23T00:00:00Z")
        save_state(state)
        return issue_to_api(issue, state)

    m = re.match(rf"^{REPO_PREFIX}/issues/comments/(\d+)$", base_path)
    if m:
        cid = int(m.group(1))
        comments = state.get("comments", [])
        for i, c in enumerate(comments):
            if c["id"] == cid:
                del comments[i]
                save_state(state)
                return ""
        die(f"HTTP 404: Comment {cid} not found", 1)

    die(f"HTTP 404: Unknown DELETE endpoint: {base_path}", 1)


# ---------------------------------------------------------------------------
# jq delegation
# ---------------------------------------------------------------------------

def run_jq(data_str, jq_filter):
    proc = subprocess.run(
        ["jq", "-r", jq_filter],
        input=data_str,
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


def acquire_lock():
    """Acquire an exclusive OS file lock for process-safe state access.

    Returns the lock file descriptor, or None if locking is unavailable.
    The lock file is created if it doesn't exist. The lock is exclusive
    (LOCK_EX) and blocking — callers serialize automatically.
    """
    if fcntl is None or not LockFile:
        return None
    lock_fd = os.open(LockFile, os.O_CREAT | os.O_RDWR, 0o644)
    fcntl.flock(lock_fd, fcntl.LOCK_EX)
    return lock_fd


def release_lock(lock_fd):
    """Release the file lock and close the lock file descriptor."""
    if lock_fd is None:
        return
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
    os.close(lock_fd)


# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

def main():
    argv = sys.argv[1:]

    if not argv:
        die("usage: gh api <path> [flags]")

    if argv[0] != "api":
        die(f"Fake gh only supports 'api' subcommand, got: {argv[0]}")

    parsed = parse_api_args(argv[1:])
    method = parsed["method"]
    raw_path = parsed["path"]
    body = parsed["body"]
    do_paginate = parsed["paginate"]
    jq_filter = parsed["jq_filter"]
    silent = parsed["silent"]

    if raw_path is None:
        die("error: no path specified")

    raw_path = raw_path.lstrip("/")
    base_path, params = split_path(raw_path)

    lock_fd = acquire_lock()
    try:
        _process_request(method, base_path, params, body, do_paginate, jq_filter, silent)
    finally:
        release_lock(lock_fd)


def _process_request(method, base_path, params, body, do_paginate, jq_filter, silent):
    state = load_state()

    # Apply side effects exactly once (race simulation)
    apply_side_effects(state, method, base_path)
    state = load_state()

    # Check failure injection (method + endpoint + nth aware)
    should_fail, fail_info = check_fail(state, method, base_path)
    applied_failure = False
    if should_fail:
        fail_type = fail_info.get("type", "error") if isinstance(fail_info, dict) else fail_info
        http_status = fail_info.get("http_status") if isinstance(fail_info, dict) else None
        applied_failure = fail_type == "applied_error"
    if should_fail and not applied_failure:
        log_operation(state, method, base_path, "failed")
        save_state(state)
        if fail_type == "malformed":
            raw = "not valid json {{{"
            if jq_filter:
                rc, _filtered, err = run_jq(raw, jq_filter)
                if rc != 0:
                    sys.stderr.write(err)
                    sys.exit(rc)
            if not silent:
                sys.stdout.write(raw + "\n")
            sys.exit(0)
        elif fail_type == "not_found":
            status = http_status or 404
            die(
                json.dumps({
                    "message": "Not Found",
                    "documentation_url": "",
                    "status": str(status),
                }),
                1,
            )
        else:
            status = http_status or 500
            die(
                json.dumps({
                    "message": "Server Error",
                    "documentation_url": "",
                    "status": str(status),
                }),
                1,
            )

    if method == "GET":
        result = handle_get(state, base_path, params, do_paginate)
    elif method == "POST":
        result = handle_post(state, base_path, body)
    elif method == "PATCH":
        result = handle_patch(state, base_path, body)
    elif method == "DELETE":
        result = handle_delete(state, base_path, body)
    else:
        die(f"Unsupported method: {method}", 1)

    log_operation(state, method, base_path, "ok")
    save_state(state)

    # Apply post-handler side effects (after state was mutated by this request)
    apply_post_side_effects(state, method, base_path)

    if applied_failure:
        state = load_state()
        log_operation(state, method, base_path, "failed_after_apply")
        save_state(state)
        status = http_status or 500
        die(
            json.dumps({
                "message": "Server Error",
                "documentation_url": "",
                "status": str(status),
            }),
            1,
        )

    # Emit configured stderr warnings (simulates gh CLI writing to stderr
    # while still returning valid JSON on stdout — e.g. deprecation notices).
    for warn in state.get("stderr_warnings", []):
        if warn.get("method", "GET").upper() != method:
            continue
        endpoint = warn.get("endpoint", "")
        if endpoint != base_path:
            regex = re.escape(endpoint).replace(r"\*", ".*")
            if not re.fullmatch(regex, base_path):
                continue
        sys.stderr.write(warn.get("message", "") + "\n")

    if isinstance(result, list):
        pages = split_pages(result, params, do_paginate, state)
    else:
        pages = [result]

    outputs = []
    for page in pages:
        page_json = json.dumps(page, indent=2)
        if jq_filter:
            rc, filtered, err = run_jq(page_json, jq_filter)
            if rc != 0:
                sys.stderr.write(err)
                sys.exit(rc)
            outputs.append(filtered.rstrip("\n"))
        else:
            outputs.append(page_json)

    if not silent:
        sys.stdout.write("\n".join(outputs) + "\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
