#!/usr/bin/env python3
"""
Generate cherry-pick decision tables for gemini-cli v0.9.0 → v0.10.0.

Inputs:
  - project-plans/20251215gemerge/upstream-0.9.0..0.10.0.json

Outputs:
  - project-plans/20251215gemerge/CHERRIES.md
  - project-plans/20251215gemerge/SUMMARY.md
"""

from __future__ import annotations

import json
from dataclasses import dataclass
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


@dataclass(frozen=True)
class Override:
    decision: Decision
    rationale: str


ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "project-plans/20251215gemerge/upstream-0.9.0..0.10.0.json"
OUT_CHERRIES = ROOT / "project-plans/20251215gemerge/CHERRIES.md"
OUT_SUMMARY = ROOT / "project-plans/20251215gemerge/SUMMARY.md"


OVERRIDES: dict[str, Override] = {
    # Existing recommended PICKs (from initial pass)
    "b92e3bca": Override("PICK", "MCP: server removal persists to settings"),
    "1962b51d": Override(
        "PICK",
        "CLI: positional prompt args with --extensions (drop Clearcut test hunk)",
    ),
    "f2852056": Override(
        "PICK", "CLI: strip ANSI codes from extension MCP server output"
    ),
    "76b1deec": Override(
        "PICK",
        "Core: smart-edit refreshes file contents when externally modified",
    ),
    "741b57ed": Override("PICK", "Windows: spawn via shell for compatibility"),
    "06920402": Override("PICK", "Core: prevent context window overflow"),
    "a044c259": Override(
        "PICK", "UX: show /permissions hint when folder is untrusted"
    ),
    "b60c8858": Override(
        "PICK", "UX: shorten context overflow message when <50% limit"
    ),
    "cd354aeb": Override("PICK", "Perf: avoid unnecessary UI re-renders"),
    "5f96eba5": Override("PICK", "CLI: do not exit on non-fatal tool errors"),
    "971eb64e": Override(
        "PICK", "Memory: /memory refresh respects trusted filters"
    ),
    "affd3cae": Override(
        "PICK", 'Auth UX: prevent garbled input during Google OAuth prompt'
    ),
    "c6af4eaa": Override(
        "PICK", "Security: respect folder-trust flags in FileCommandLoader"
    ),
    "0a7ee677": Override(
        "PICK", "Accessibility: show notifications in screen reader mode"
    ),
    "bf0f61e6": Override(
        "PICK", "Extensions: show install path; fix isWorkspaceTrusted check"
    ),
    "265d39f3": Override("PICK", "Shell: improve execution service reliability"),
    "77162750": Override(
        "PICK", "Default: enable useSmartEdit by default (behavior change)"
    ),
    "6787d42d": Override(
        "PICK", "Perf: optimize Windows IDE process detection"
    ),
    "a3fe9279": Override(
        "PICK", "Compression: avoid summarizing too-short history"
    ),
    "249a193c": Override(
        "PICK", "Prompts: optimize shell tool command guidance"
    ),
    "3ba4ba79": Override("PICK", "Prompts: remove workflow examples"),
    "9e8c7676": Override("PICK", "Non-interactive: record tool calls"),
    "b2ba67f3": Override("PICK", "Trust dialog: Esc exits on launch"),
    "dabe161a": Override(
        "PICK", "UI: don't accept input until slash commands load"
    ),
    "467a305f": Override(
        "PICK",
        "UX: enable interactive shell by default (matches llxprt intent)",
    ),
    # Existing REIMPLEMENTs (from initial pass)
    "0cd490a9": Override(
        "REIMPLEMENT", "Gemini/GCA: add GOOGLE_CLOUD_PROJECT_ID fallback"
    ),
    "0b6c0200": Override(
        "REIMPLEMENT",
        "Core: failed-response retry via extra prompt (multi-provider turn/client changes)",
    ),
    "ada179f5": Override(
        "REIMPLEMENT",
        "Scheduler: upstream forces sequential tool calls; port carefully into llxprt batching",
    ),
    "7c1a9024": Override(
        "REIMPLEMENT",
        "Retry: merge specific fetch error retry logic into llxprt retry.ts (has custom failover)",
    ),
    "518caae6": Override(
        "REIMPLEMENT",
        "Paths: upstream centralizes '.gemini' dir; llxprt prefers '.llxprt' + compat",
    ),
    "a6e00d91": Override(
        "REIMPLEMENT",
        "Extensions: UX fixes bundled with Clearcut logging; port CLI changes without Clearcut",
    ),
    # Re-evaluated (A2A + tests + docs + renamed tools)
    "8980276b": Override(
        "PICK",
        "Extensions/A2A: align extension typings across CLI/core/a2a-server (high churn but reduces future merge pain)",
    ),
    "8ac2c684": Override(
        "REIMPLEMENT",
        "A2A: consider bundling strategy for a2a-server; our release/bundle layout differs from upstream",
    ),
    "1af3fef3": Override(
        "PICK", "Tests: disable auto-update in integration tests (reduce flake)"
    ),
    "603ec2b2": Override(
        "PICK",
        "Tests: add deflake runner script to reproduce flakes quickly",
    ),
    "118aade8": Override(
        "PICK", "Docs: small citations mention (we already support citations)"
    ),
    "8d8a2ab6": Override(
        "REIMPLEMENT",
        "Docs/Tests: add deflake docs + small deflake.js tweak; our docs structure differs (no docs/integration-tests.md)",
    ),
    "bcbcaeb8": Override(
        "REIMPLEMENT",
        "Docs: upstream updates faq/extensions docs; port relevant info into llxprt docs layout",
    ),
    "bd6bba8d": Override(
        "REIMPLEMENT",
        "Docs: deflake command doc tweak; our docs structure differs (no docs/integration-tests.md)",
    ),
    "433ca84c": Override(
        "PICK",
        "Tests: log actual output in validateModelOutput on failure (debugging flakes)",
    ),
    "6d84d4dc": Override(
        "PICK",
        "Tests: make run_shell_command integration prompt more deterministic",
    ),
    "a8379d1f": Override(
        "PICK",
        "Tests: update/enable prompt for MCP add tool integration test",
    ),
    "5e688b81": Override(
        "REIMPLEMENT",
        "Tests: upstream skips a flaky replace case; decide whether to tighten tool allowlist or follow upstream skip to reduce flake",
    ),
    "5aab793c": Override(
        "REIMPLEMENT",
        "Tests: fixes interactive FS test flake, but llxprt doesn't currently carry file-system-interactive.test.ts",
    ),
    "ed37b7c5": Override(
        "PICK", "Tests: fix isWorkspaceTrusted mocks (stability)"
    ),
    "21062dd3": Override("PICK", "Tests: clean up extension tests"),
    "c82c2c2b": Override(
        "REIMPLEMENT",
        "A2A: add a2a-server bin + server entry tweaks; port without upstream lockfile churn and with llxprt package naming",
    ),
    "558be873": Override(
        "REIMPLEMENT",
        "UI: large narrow-screen margin + full-width setting change; port selectively to avoid conflicts with llxprt UI work",
    ),
    "65b9e367": Override("PICK", "Docs: fix broken links in docs/architecture.md"),
    "249ea559": Override(
        "PICK",
        "Tests: fix flaky run_shell_command test by using date command",
    ),
    "849cd1f9": Override(
        "REIMPLEMENT",
        "Docs: upstream changelog link fix; llxprt uses different release-notes layout",
    ),
    "32db4ff6": Override(
        "REIMPLEMENT",
        "Tests: upstream disables flaky interactive tests + tweaks replace; port relevant non-skip improvements to llxprt suite",
    ),
    "a5e47c62": Override("PICK", "Docs: tos-privacy updates are relevant"),
    "ab3804d8": Override(
        "REIMPLEMENT",
        "Tools: upstream web search tool-name refactor; llxprt renamed to google-web-search/exa-web-search",
    ),
    "a64bb433": Override(
        "REIMPLEMENT",
        "Tests: simplify auth handling in interactive tests; port changes that touch files llxprt still has (ctrl-c-exit/test-helper)",
    ),
    "37678acb": Override(
        "REIMPLEMENT",
        "Docs: upstream get-started docs restructuring doesn't match llxprt docs layout; port content selectively",
    ),
    "ead8928c": Override(
        "PICK", "Tests: deflake json-output integration test"
    ),
    "cd919346": Override(
        "PICK", "Tests: clean up integration test warnings (test-helper)"
    ),
    "5dc7059b": Override(
        "REIMPLEMENT",
        "Tests: introduces InteractiveRun class but touches missing interactive test files; port scaffolding where applicable",
    ),
    "28e667bd": Override(
        "PICK",
        "Tests: add explicit failure-output instructions to json-output integration test",
    ),
    "19c1d734": Override(
        "REIMPLEMENT",
        "Docs: add bundle command info to integration-test docs; llxprt lacks docs/integration-tests.md",
    ),
    "4a5ef4d9": Override(
        "REIMPLEMENT",
        "Tests: fixes interactive FS flake and extends test-helper; llxprt missing file-system-interactive.test.ts",
    ),
    "a73b8145": Override(
        "REIMPLEMENT",
        "Tests: rename expect helpers; touches missing interactive test files but also impacts ctrl-c-exit/test-helper",
    ),
    "c4bd7594": Override(
        "REIMPLEMENT",
        "Docs: document showInDialog settings; upstream doc path differs (docs/get-started/configuration.md vs llxprt docs/cli/configuration.md)",
    ),
    "907e51ac": Override(
        "SKIP",
        "Adds .gemini command file; llxprt command/doc conventions differ (revisit if adopting upstream command packs)",
    ),
    "cfb71b9d": Override(
        "SKIP",
        "A2A publishing wiring was reverted upstream and is repo/workflow-specific; implement llxprt publishing separately if needed",
    ),
    "c23eb84b": Override(
        "PICK", "A2A: remove private flag from a2a-server package"
    ),
    "f3424844": Override(
        "SKIP",
        "Revert of upstream A2A publishing wiring; irrelevant if we skip publishing-workflow commits",
    ),
    "7b06a0be": Override(
        "PICK",
        "Tests: use rmSync instead of rm -rf in integration test helper (more portable)",
    ),
    "49b66733": Override(
        "REIMPLEMENT",
        "Tests: upstream disables ctrl-c integration test due to flake; decide whether to stabilize or disable in llxprt",
    ),
    "99c7108b": Override(
        "REIMPLEMENT",
        "Tests: substantial run_shell_command + harness fixes, but touches missing interactive test file; port changes to existing llxprt tests/harness",
    ),
    "769fe8b1": Override(
        "REIMPLEMENT",
        "Tests: upstream replaces/rewrites replace integration tests for determinism; port suite changes (llxprt replace tests diverged)",
    ),
    "6f0107e7": Override(
        "REIMPLEMENT",
        "Tools: robust URL validation for web_fetch; port into google-web-fetch/direct-web-fetch (llxprt renamed tools)",
    ),
    "4f5b3357": Override(
        "REIMPLEMENT",
        "Tests: adds cyclic-schema MCP integration test + helper updates; port new test file and adapt to llxprt",
    ),
    "a0893801": Override(
        "SKIP",
        "Docs formatting-only (very noisy). Optional if you want docs parity; llxprt already enforces 80-col Prettier.",
    ),
    "b0b1be0c": Override(
        "SKIP",
        "Tests: upstream skips flaky tests; prefer deflake tooling + targeted stabilizations over blanket skips",
    ),
    "3ea5581a": Override(
        "SKIP",
        "Tests: upstream disables flaky tests; prefer deflake tooling + targeted stabilizations over blanket disables",
    ),
    "3d245752": Override(
        "SKIP", "Tool naming refactor conflicts with llxprt toolset/renames"
    ),
    "ae02236c": Override(
        "SKIP",
        "Path-correction refactor is largely redundant with llxprt smart-edit behavior",
    ),
    "83075b28": Override(
        "SKIP",
        "Telemetry log/event refactor (high churn; limited value without upstream telemetry stack)",
    ),
    "2a7c7166": Override(
        "SKIP", "Repo-specific CI action change (not applicable to llxprt CI)"
    ),
    "061a89fc": Override(
        "SKIP",
        "Integration-test retry toggles are repo-specific; evaluate separately with llxprt deflake needs",
    ),
    "7b06a0be": Override(
        "PICK",
        "Tests: use rmSync instead of rm -rf in integration test helper (more portable)",
    ),
    "0a3e492e": Override(
        "SKIP",
        "Upstream UI flicker integration test not carried in llxprt (and depends on upstream UI metrics)",
    ),
    "fda3b543": Override(
        "SKIP",
        "Unskips an upstream interactive compression test that llxprt does not currently carry; would likely add flake",
    ),
}


def decide(commit: Commit) -> Override:
    short = commit["short"]
    subject = commit["subject"]
    files = commit["files"]
    areas = set(commit["areas"])
    lower = subject.lower()

    if short in OVERRIDES:
        return OVERRIDES[short]

    if any("clearcut-logger" in f for f in files):
        return Override("SKIP", "Touches ClearcutLogger (removed in llxprt)")

    if lower.startswith("chore(release):") or lower.startswith("fix(patch):"):
        return Override("SKIP", "Upstream release/versioning")
    if "pre releases" in lower:
        return Override("SKIP", "Upstream release/versioning")

    if lower.startswith("revert "):
        return Override("SKIP", "Upstream revert (skip unless original was picked)")

    if areas <= {"docs"}:
        return Override("SKIP", "Docs only")
    if areas <= {"github"}:
        return Override("SKIP", "CI/workflow only")
    if areas <= {"integration-tests"}:
        return Override("SKIP", "Upstream integration tests only")

    if "model routing" in lower or "fallback" in lower:
        return Override("SKIP", "Model routing/fallback not used in llxprt")
    if "codebase investigator" in lower:
        return Override("SKIP", "CodebaseInvestigator disabled in llxprt")
    if "cleanup(markdown)" in lower:
        return Override("SKIP", "Docs/format churn")
    if "a2a" in lower and ("publish" in lower or "publishing" in lower):
        return Override("SKIP", "A2A publishing/release process")

    return Override("SKIP", "Not selected for llxprt (low value or conflicts)")


def main() -> None:
    commits: list[Commit] = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    rows: list[tuple[int, Commit, Override]] = []
    counts: dict[Decision, int] = {"PICK": 0, "SKIP": 0, "REIMPLEMENT": 0}
    for idx, commit in enumerate(commits, 1):
        override = decide(commit)
        rows.append((idx, commit, override))
        counts[override.decision] += 1

    header = [
        "# gemini-cli v0.9.0 → v0.10.0 cherry-pick candidates",
        "",
        "Upstream: https://github.com/google-gemini/gemini-cli",
        "",
        f"- Range: `v0.9.0..v0.10.0` ({len(commits)} commits)",
        f"- Recommended: {counts['PICK']} PICK, {counts['REIMPLEMENT']} REIMPLEMENT, {counts['SKIP']} SKIP",
        "",
        "## Notes",
        "",
        "- LLxprt skips any commits that add/modify `ClearcutLogger` (telemetry to Google).",
        "- Some commits are REIMPLEMENT because llxprt renamed tools (e.g. `web_search`→`google-web-search`) or uses a different docs/test layout.",
        "",
        "## Full Commit Table (chronological)",
        "",
        "| # | Commit | Date | Areas | Decision | Rationale | Subject |",
        "|---:|:------|:-----|:------|:---------|:----------|:--------|",
    ]

    lines = list(header)
    for idx, c, d in rows:
        sha = c["sha"]
        short = c["short"]
        date = c["date"]
        areas = ", ".join(c["areas"])
        subject = c["subject"].replace("|", "\\|")
        rationale = d.rationale.replace("|", "\\|")
        link = f"[`{short}`](https://github.com/google-gemini/gemini-cli/commit/{sha})"
        lines.append(
            f"| {idx} | {link} | {date} | {areas} | {d.decision} | {rationale} | {subject} |"
        )

    OUT_CHERRIES.write_text("\n".join(lines) + "\n", encoding="utf-8")

    picks = [(c, d) for _, c, d in rows if d.decision == "PICK"]
    reimpl = [(c, d) for _, c, d in rows if d.decision == "REIMPLEMENT"]

    summary_lines: list[str] = [
        "# gemini-cli v0.9.0 → v0.10.0: Recommended cherry-picks",
        "",
        "This is a subset view of `CHERRIES.md` focusing on actionable changes.",
        "",
        "## PICK (apply as commits)",
        "",
        "| # | Commit | Date | Rationale | Subject |",
        "|---:|:------|:-----|:----------|:--------|",
    ]
    for i, (c, d) in enumerate(picks, 1):
        link = f"[`{c['short']}`](https://github.com/google-gemini/gemini-cli/commit/{c['sha']})"
        summary_lines.append(
            f"| {i} | {link} | {c['date']} | {d.rationale.replace('|', '\\\\|')} | {c['subject'].replace('|', '\\\\|')} |"
        )

    summary_lines += [
        "",
        "## REIMPLEMENT (port manually)",
        "",
        "| # | Commit | Date | Rationale | Subject |",
        "|---:|:------|:-----|:----------|:--------|",
    ]
    for i, (c, d) in enumerate(reimpl, 1):
        link = f"[`{c['short']}`](https://github.com/google-gemini/gemini-cli/commit/{c['sha']})"
        summary_lines.append(
            f"| {i} | {link} | {c['date']} | {d.rationale.replace('|', '\\\\|')} | {c['subject'].replace('|', '\\\\|')} |"
        )

    OUT_SUMMARY.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
