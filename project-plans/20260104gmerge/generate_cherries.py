#!/usr/bin/env python3
"""
Generate cherry-pick decision tables for gemini-cli v0.10.0 → v0.11.3.

Inputs:
  - project-plans/20260104gmerge/upstream-0.10.0..0.11.3.json

Outputs:
  - project-plans/20260104gmerge/CHERRIES.md
  - project-plans/20260104gmerge/SUMMARY.md
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, TypedDict


Decision = Literal["PICK", "SKIP", "REIMPLEMENT"]


class Commit(TypedDict):
    sha: str
    short: str
    date: str
    subject: str
    files: list[str]
    areas: list[str]
    is_merge: bool


ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "project-plans/20260104gmerge/upstream-0.10.0..0.11.3.json"
OUT_CHERRIES = ROOT / "project-plans/20260104gmerge/CHERRIES.md"
OUT_SUMMARY = ROOT / "project-plans/20260104gmerge/SUMMARY.md"

PICKS = {
    "4f17eae5",
    "d38ab079",
    "2e6d69c9",
    "47f69317",
    "8c1656bf",
    "cfaa95a2",
    "60420e52",
    "a9083b9d",
    "b734723d",
    "c71b7491",
    "991bd373",
    "a4403339",
    "22f725eb",
    "406f0baa",
    "d42da871",
    "3a1d3769",
    "2ef38065",
    "23e52f0f",
    "f3ffaf09",
    "0ded546a",
    "659b0557",
    "4a0fcd05",
    "2b61ac53",
    "8da47db1",
    "7c086fe5",
    "e4226b8a",
    "4d2a1111",
    "426d3614",
    "b4a405c6",
    "d3bdbc69",
    "21163a16",
    "cedf0235",
    "dd42893d",
    "d065c3ca",
    "0fd9ff0f",
    "518a9ca3",
    "d0ab6e99",
    "397e52da",
    "61a71c4f",
    "d5a06d3c",
    "31f58a1f",
    "70a99af1",
    "72b16b3a",
    "654c5550",
    "62dc9683",
    "e72c00cf",
    "cf16d167",
    "16f5f767",
    "ccf8d0ca",
    "5b750f51",
    "ed9f714f",
    "306e12c2",
    "c7243997",
    "2940b508",
    "0d7da7ec",
    "847c6e7f",
    "ce40a653",
    "b1bbef43",
    "49bde9fc",
    "6ded45e5",
    "d2c9c5b3",
    "0658b4aa",
}

REIMPL = {
    "130f0a02",
    "9049f8f8",
    "8731309d",
    "dd3b1cb6",
    "9b9ab609",
    "f22aa72c",
    "b8df8b2a",

    "c9c633be",
    "dcf362bc",
    "937c15c6",
    "c8518d6a",
    "08e87a59",
    "f4330c9f",
    "995ae717",
    "b364f376",
    "98eef9ba",
    "7dd2d8f7",
    "bf80263b",
    "36de6862",
    "cc7e1472",
    "05930d5e",
}

SKIPS = {
    "8a937ebf",
    "47f5e73b",
    "c80352a7",
    "7bed302f",
    "ccaa7009",
    "1fc3fc0a",
    "72b2cc54",
    "e2fef41f",
    "8c74be79",
    "5aaa0e66",
    "872d2eaf",
    "b4f6c7c4",
    "c96fd828",
    "155242af",
    "ffa547ce",
    "39cc07de",
    "bec2bfca",
    "de3632af",
    "6b866d12",
    "2aa1d742",
    "01c577c3",
    "a67deae8",
    "cd0f9fe2",
    "ca3d260a",
    "b2ef6626",
    "be25e2cb",
    "795e5134",
    "67866849",
    "725b3120",
    "ff31a222",
    "aa46eb4f",
    "a788a6df",
    "d52ec522",
    "71ecc401",
    "9a4c0455",
    "a96f0659",
    "085e5b1f",
    "30d9a336",
    "3c57e76c",
    "723b8d33",
    "8aace3af",
    "fc4e10b5",
    "81772c42",
    "0e7b3951",
    "f4080b60",
    "14867c7c",
    "0ed4f980",
    "a2013f34",
    "f0eed9b2",
    "9d0177e0",
    "cb8f93ba",
    "2c93542e",
    "a74a04d1",
    "193b4bba",
    "74a77719",
    "af833c5e",
    "e49f4673",
    "34439460",
    "fb44f5ba",
    "e9e80b05",
    "465f97a5",
    "dc90c8fe",
    "0542de95",
    "9cf8b403",
    "a3947a8d",
    "c9c2e79d",
    "92f5355d",
    "d9f6cebe",
    "5213d9f3",
    "f36dec6a",
    "f4f37279",
    "e5161610",
    "5be5575d",
    "73b3211e",
    "8a725859",
    "44b3c974",
    "f5e07d94",
    "d1c913ed",
    "3acb014e",
    "0b20f88f",
    "73b1afb1",
}

RATIONALE = {
    "8a937ebf": "Upstream release/versioning",
    "b8df8b2a": "Policy/message-bus wiring diverges; port carefully into llxprt message bus + tool policy",
    "4f17eae5": "UX: prevent queued slash/shell commands",
    "d38ab079": "UX: clearer shell tool call colors",
    "47f5e73b": "Docs only",
    "c80352a7": "Docs only",
    "2e6d69c9": "Non-interactive: allowed-tools substring match parity",
    "7bed302f": "CI/workflow only",
    "47f69317": "Headless output-format stream-jsonflag support",
    "ccaa7009": "Upstream test/infra only",
    "1fc3fc0a": "A2A publishing workflow only",
    "8c1656bf": "Extensions: avoid unnecessary git clone",
    "cfaa95a2": "CLI: add yargs nargs support",
    "72b2cc54": "Lockfile churn only",
    "e2fef41f": "CI workflow only",
    "8c74be79": "Docs update only",
    "130f0a02": "Subagent legacy cleanup is upstream-only; llxprt subagent architecture diverges",
    "c9c633be": "Tool naming: web_fetch constant differs (llxprt uses google_web_fetch/direct_web_fetch)",
    "3acb014e": "Integration test not in llxprt",
    "60420e52": "UX: avoid trailing space on autocomplete",
    "a9083b9d": "MCP: show extension name in list",
    "5aaa0e66": "Codebase investigator not used in llxprt",
    "b734723d": "Extensions: install warning copy update",
    "872d2eaf": "CI/workflow only",
    "b4f6c7c4": "Docs only",
    "c96fd828": "Docs only",
    "155242af": "Emoji-free policy; upstream tips include disallowed content",
    "ffa547ce": "Docs only",
    "05930d5e": "Web fetch implementation differs; port into google_web_fetch/direct_web_fetch",
    "6ded45e5": "UI: markdown toggle (alt+m)",
    "d2c9c5b3": "Scripts: use Node.js built-ins in clean.js",
    "39cc07de": "CI/workflow only",
    "bec2bfca": "Revert of CI change",
    "937c15c6": "CLI flag removal needs review for llxprt compatibility",
    "de3632af": "Repo/workflow only",
    "6b866d12": "Repo/workflow only",
    "2aa1d742": "Integration test not in llxprt",
    "01c577c3": "Integration test only (globalSetup)",
    "02241e91": "Auth dialog differs; upstream wiring targets google-only UI",
    "c71b7491": "Permissions dialog shows folder names",
    "9a4211b6": "Todo UI changes deferred",
    "991bd373": "Deflake script improvements (scripts/deflake.js)",
    "a4403339": "Settings dialog Esc hint",
    "9049f8f8": "Telemetry flag removal conflicts with llxprt telemetry config",
    "22f725eb": "Allow editing queued messages with up arrow",
    "dcf362bc": "Tree-sitter wasm bundling + shell tool runtime fallback (needs llxprt adaptation)",
    "a67deae8": "Integration test skip only",
    "cd0f9fe2": "Ink fork dependency change reverted upstream; avoid lockfile churn",
    "406f0baa": "Fix keyboard input hang",
    "d42da871": "Accessibility: allow line wrap in screen reader mode",
    "3a1d3769": "Centralize tool names in tool-names.ts",
    "f3ffaf09": "Fix copy command delay on Linux",
    "ca3d260a": "Revert upstream dependency change",
    "b2ef6626": "Docs only",
    "be25e2cb": "Deprecated flag removals may break llxprt compatibility",
    "0ded546a": "Prompt avoidance conditional fix",
    "795e5134": "Keybinding change for /mcp commands",
    "659b0557": "Suppress slash suggestions in shell mode",
    "4a0fcd05": "Release script update (repo tooling)",
    "2b61ac53": "Dialog UI hint for Esc close",
    "8da47db1": "Enable/fix MCP command tests typechecking",
    "67866849": "Release script update (repo tooling)",
    "7c086fe5": "MCP docs/UI cleanup",
    "e4226b8a": "Update nag respects disableUpdateNag",
    "4d2a1111": "Case-insensitive @file suggestions",
    "426d3614": "Integration test fix for auth selection",
    "b4a405c6": "Slash command descriptions style cleanup",
    "d3bdbc69": "Extensions: add extension IDs",
    "08e87a59": "Telemetry logging of settings diverges from llxprt telemetry model",
    "21163a16": "Enable typechecking for ui/commands tests",
    "0b20f88f": "Integration test not in llxprt",
    "9b9ab609": "Debug logger already exists; upstream debugLogger is different",
    "f4330c9f": "Workspace extensions/migrations removal conflicts with llxprt",
    "cedf0235": "Enable typechecking for ui/components tests",
    "2ef38065": "Centralize shell tool name constant",
    "cd76b0b2": "Todo UI changes deferred",
    "725b3120": "Docs only",
    "dd42893d": "Enable typechecking for config tests",
    "ff31a222": "CI workflow only",
    "aa46eb4f": "CI workflow only",
    "f22aa72c": "Shell default/grep flags differ; needs verification",
    "d065c3ca": "Enable typechecking for more test files",
    "f425bd76": "Todo UI changes deferred",
    "98eef9ba": "web_fetch tool definition update; needs llxprt tool name mapping",
    "23e52f0f": "Centralize grep/read tool name constants",
    "0fd9ff0f": "Fix type errors in UI hooks tests",
    "c8518d6a": "Tool name refactor conflicts with llxprt tool names",
    "a788a6df": "Docs only",
    "8731309d": "Retry+abort handling differs; verify against llxprt retry flow",
    "d52ec522": "CI workflow only",
    "518a9ca3": "Fix gitignore parser for escaped chars",
    "71ecc401": "Telemetry activity monitor not used in llxprt",
    "35afab31": "Todo UI changes deferred",
    "d0ab6e99": "Fix SettingsDialog race clearing settings",
    "397e52da": "Fix theme dialog escaping resetting theme",
    "9a4c0455": "Docs only",
    "a96f0659": "Integration test skip only",
    "085e5b1f": "CI/workflow only",
    "36de6862": "A2A traceId propagation needs alignment with llxprt logging",
    "49bde9fc": "GCS path handling in a2a-server",
    "30d9a336": "CI/workflow only",
    "3c57e76c": "Release bump",
    "61a71c4f": "Testing: remove custom waitFor",
    "d5a06d3c": "Fix gitignore parser for trailing spaces",
    "995ae717": "Logging refactor (part 1) tied to telemetry/console sharing",
    "cc7e1472": "Extensions data flow differs (context files); needs adaptation",
    "31f58a1f": "Fix Windows ripgrep detection",
    "70a99af1": "Fix shell auto-approval parsing",
    "723b8d33": "Test config/tsconfig housekeeping only",
    "72b16b3a": "Fix macOS sandbox PTY spawn errors",
    "8aace3af": "Model routing change not applicable",
    "7dd2d8f7": "Tool naming consistency differs in llxprt",
    "654c5550": "Add wasm read test",
    "fc4e10b5": "Docs only",
    "81772c42": "CI workflow only",
    "0e7b3951": "Model routing feature not used",
    "f4080b60": "Integration test skip only",
    "14867c7c": "CI workflow only",
    "0ed4f980": "CI workflow only",
    "a2013f34": "Integration test skip only",
    "f0eed9b2": "CI/workflow only",
    "9d0177e0": "CI/workflow only",
    "cb8f93ba": "CI/workflow only",
    "2c93542e": "Revert of model routing change",
    "a74a04d1": "Revert of model routing change",
    "0658b4aa": "Deflake replace integration test",
    "bf80263b": "Message bus/policy engine overhaul; port carefully with llxprt tool names",
    "193b4bba": "CI workflow only",
    "74a77719": "CI workflow only",
    "af833c5e": "CI workflow only",
    "e49f4673": "Docs only",
    "34439460": "CI workflow only",
    "62dc9683": "MCP add array handling + tests",
    "e72c00cf": "Proxy agent error handling",
    "fb44f5ba": "Test re-enable only",
    "cf16d167": "Repo tooling: tsconfig linter for exclude list",
    "dd3b1cb6": "Allow continue request after disabling loop detection",
    "f5e07d94": "CI workflow only",
    "b364f376": "Logging refactor tied to debugLogger divergence",
    "c6a59896": "Extensions logging touches Clearcut; skip",
    "16f5f767": "Test: use waitFor rather than wait",
    "519bd57e": "Todo UI changes deferred",
    "ccf8d0ca": "Re-enable Ctrl+C integration test",
    "465f97a5": "CI workflow only",
    "5b750f51": "Disable CI for stable release setting (verify relevance)",
    "ed9f714f": "Non-interactive MCP prompt commands",
    "cc3904f0": "Todo UI changes deferred",
    "306e12c2": "Fix shift+tab input regression",
    "c7243997": "Fix flaky BaseSelectionList test",
    "2940b508": "Handle PTY resize errors",
    "d1c913ed": "Docs only",
    "73b1afb1": "Touches Clearcut logger + hello extension; skip",
    "0d7da7ec": "MCP OAuth path parameter handling",
    "dc90c8fe": "Lockfile churn only",
    "0542de95": "Release script only",
    "9cf8b403": "Release bump",
    "a3947a8d": "Release patch bump",
    "c9c2e79d": "Release bump",
    "92f5355d": "Release bump",
    "d9f6cebe": "Release patch bump",
    "5213d9f3": "Release bump",
    "f36dec6a": "Release patch bump",
    "f4f37279": "Release bump",
    "847c6e7f": "Refactor compression service (core structure change)",
    "5be5575d": "Compression threshold tweak superseded by later UI changes",
    "ce40a653": "Compression threshold UI/config needs alignment",
    "73b3211e": "UI footer change conflicts with llxprt layout",
    "8a725859": "Compression threshold restart requirement; depends on UI changes",
    "b1bbef43": "Loop detection respects disable flag",
    "44b3c974": "Quota error messaging is Google-specific; llxprt uses multi-provider",
    "e5161610": "Release bump",
}



def decision_for(short: str) -> Decision:
    if short in PICKS:
        return "PICK"
    if short in REIMPL:
        return "REIMPLEMENT"
    return "SKIP"


def rationale_for(short: str, decision: Decision) -> str:
    if short in RATIONALE:
        return RATIONALE[short]
    if decision == "PICK":
        return "Relevant improvement for llxprt"
    if decision == "REIMPLEMENT":
        return "Reimplement to preserve llxprt divergence"
    return "Not selected for llxprt (low value or conflicts)"


def row(idx: int, commit: Commit, decision: Decision) -> str:
    areas = ", ".join(commit["areas"])
    subject = commit["subject"].replace("|", "\\|")
    rationale = rationale_for(commit["short"], decision).replace("|", "\\|")
    sha = commit["sha"]
    short = commit["short"]
    link = f"[`{short}`](https://github.com/google-gemini/gemini-cli/commit/{sha})"
    return (
        f"| {idx} | {link} | {commit['date']} | {areas} | {decision} | "
        f"{rationale} | {subject} |"
    )


def main() -> None:
    commits: list[Commit] = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    pick_rows: list[str] = []
    skip_rows: list[str] = []
    reimpl_rows: list[str] = []

    for idx, commit in enumerate(commits, 1):
        decision = decision_for(commit["short"])
        entry = row(idx, commit, decision)
        if decision == "PICK":
            pick_rows.append(entry)
        elif decision == "REIMPLEMENT":
            reimpl_rows.append(entry)
        else:
            skip_rows.append(entry)

    counts = (len(pick_rows), len(reimpl_rows), len(skip_rows))

    cherries_lines = [
        "# gemini-cli v0.10.0 → v0.11.3 cherry-pick candidates",
        "",
        "Upstream: https://github.com/google-gemini/gemini-cli",
        "",
        f"- Range: `v0.10.0..v0.11.3` ({len(commits)} commits)",
        f"- Recommended: {counts[0]} PICK, {counts[1]} REIMPLEMENT, {counts[2]} SKIP",
        "",
        "## Decision Notes",
        "",
        "- Skip ClearcutLogger/telemetry additions (removed in llxprt).",
        "- Skip model-routing/next-speaker/emoji changes; preserve LLxprt multi-provider + emoji-free policy.",
        "- Tool-name refactors centralize constants; tool names remain aligned.",
        "- Reimplement A2A/extension logging & message-bus changes when they touch llxprt-specific tooling.",
        "",
        "## PICK (chronological)",
        "",
        "| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |",
        "|---:|:------------|:-----|:------|:---------|:----------|:--------|",
        *pick_rows,
        "",
        "## SKIP (chronological)",
        "",
        "| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |",
        "|---:|:------------|:-----|:------|:---------|:----------|:--------|",
        *skip_rows,
        "",
        "## REIMPLEMENT (chronological)",
        "",
        "| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |",
        "|---:|:------------|:-----|:------|:---------|:----------|:--------|",
        *reimpl_rows,
        "",
    ]
    OUT_CHERRIES.write_text("\n".join(cherries_lines), encoding="utf-8")

    summary_lines = [
        "# gemini-cli v0.10.0 → v0.11.3: Recommended cherry-picks",
        "",
        "Tracking issue: https://github.com/vybestack/llxprt-code/issues/708",
        "",
        f"Total commits: {len(commits)}; PICK {counts[0]}, REIMPLEMENT {counts[1]}, SKIP {counts[2]}",
        "",
        "## PICK highlights",
    ]

    for commit in [c for c in commits if c["short"] in PICKS][:20]:
        summary_lines.append(f"- {commit['short']} {commit['subject']}")

    summary_lines += [
        "",
        "## REIMPLEMENT highlights",
    ]

    for commit in [c for c in commits if c["short"] in REIMPL]:
        summary_lines.append(f"- {commit['short']} {commit['subject']}")

    summary_lines += [
        "",
        "## High-risk items",
        "- Message bus + policy engine changes (bf80263b)",
        "- Tool-name refactors centralize constants (c9c633be, 3a1d3769, 23e52f0f, 2ef38065, c8518d6a)",
        "- Tree-sitter wasm bundling + shell fallback (dcf362bc)",
        "- Logging refactors tied to telemetry divergences (9b9ab609, 995ae717, b364f376)",
        "- A2A traceId propagation and extension context flow (36de6862, cc7e1472)",
        "- Compression service refactor + UI changes (847c6e7f, ce40a653)",
        "",
        "## Notes",
        "- Waiting for human review after CHERRIES.md/SUMMARY.md before batching (per runbook).",
        "- Plan folder: project-plans/20260104gmerge/",
    ]

    OUT_SUMMARY.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
