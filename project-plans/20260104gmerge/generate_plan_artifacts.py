from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLAN_DIR = ROOT / "project-plans/20260104gmerge"
DATA_PATH = PLAN_DIR / "upstream-0.10.0..0.11.3.json"
GEN_PATH = PLAN_DIR / "generate_cherries.py"


@dataclass
class Commit:
    sha: str
    short: str
    date: str
    subject: str
    files: list[str]
    areas: list[str]
    is_merge: bool


BT = "`"

def code(text: str) -> str:
    return f"{BT}{text}{BT}"


def load_sets() -> tuple[set[str], set[str], dict[str, str]]:
    namespace: dict[str, object] = {"__file__": str(GEN_PATH)}
    exec(GEN_PATH.read_text(encoding="utf-8"), namespace)
    picks = set(namespace["PICKS"])
    reimpl = set(namespace["REIMPL"])
    rationale = dict(namespace["RATIONALE"])
    return picks, reimpl, rationale


def build_batches(commits: list[Commit], picks: set[str], reimpl: set[str]) -> list[dict]:
    solo_picks = {
        "3a1d3769",
        "2ef38065",
        "23e52f0f",
        "847c6e7f",
        "ce40a653",
    }

    batches: list[dict] = []
    current: list[Commit] = []

    for commit in commits:
        if commit.short in picks:
            if commit.short in solo_picks:
                if current:
                    batches.append({"type": "PICK", "commits": current})
                    current = []
                batches.append({"type": "PICK", "commits": [commit]})
            else:
                current.append(commit)
                if len(current) == 5:
                    batches.append({"type": "PICK", "commits": current})
                    current = []
        elif commit.short in reimpl:
            if current:
                batches.append({"type": "PICK", "commits": current})
                current = []
            batches.append({"type": "REIMPLEMENT", "commits": [commit]})

    if current:
        batches.append({"type": "PICK", "commits": current})

    return batches


def collect_missing_files(commits: list[Commit], reimpl: set[str]) -> dict[str, list[str]]:
    missing: dict[str, list[str]] = {}
    for commit in commits:
        if commit.short not in reimpl:
            continue
        for file in commit.files:
            if not (ROOT / file).exists():
                missing.setdefault(file, []).append(commit.short)
    return missing


def write_plan(batches: list[dict], missing_files: dict[str, list[str]]) -> None:
    lines: list[str] = []
    lines.append("# gemini-cli v0.10.0 → v0.11.3: Batch Plan")
    lines.append("")
    lines.append("References:")
    lines.append(f"- {code('dev-docs/cherrypicking-runbook.md')}")
    lines.append(f"- {code('dev-docs/cherrypicking.md')}")
    lines.append(f"- {code('project-plans/20260104gmerge/CHERRIES.md')}")
    lines.append(f"- {code('project-plans/20260104gmerge/SUMMARY.md')}")
    lines.append("- Tracking issue: https://github.com/vybestack/llxprt-code/issues/708")
    lines.append("")
    lines.append("## Non-negotiables")
    lines.append("- Keep LLxprt multi-provider architecture; avoid Google-only auth changes.")
    lines.append("- Do not reintroduce ClearcutLogger/Google telemetry.")
    lines.append("- Keep A2A server private (no publishable changes).")
    lines.append(
        "- Preserve LLxprt tool names (replace/search_file_content/list_directory/google_web_fetch/direct_web_fetch).",
    )
    lines.append("- Maintain emoji-free policy and skip next-speaker checks.")
    lines.append("")
    lines.append("## File Existence Pre-Check")
    if missing_files:
        lines.append(
            "The following upstream files are missing in LLxprt. If still missing during execution, follow playbook SKIP/NO_OP guidance and record in AUDIT.md.",
        )
        lines.append("")
        lines.append("| File | Upstream SHAs |")
        lines.append("|---|---|")
        for file, shas in sorted(missing_files.items()):
            lines.append(f"| {code(file)} | {', '.join(sorted(shas))} |")
    else:
        lines.append("No missing files detected for REIMPLEMENT commits (as of plan generation).")
    lines.append("")
    lines.append("## Branding Substitutions")
    lines.append("- Use @vybestack/llxprt-code-* packages, .llxprt config dir, LLXPRT.md, and LLXPRT_CODE_* env vars.")
    lines.append("- Keep llxprt CLI naming instead of gemini where applicable.")
    lines.append("- Canonical tool names: list_directory, search_file_content, replace, google_web_search, google_web_fetch, direct_web_fetch.")
    lines.append("")
    lines.append("## Verification Cadence")
    lines.append(f"- After every batch (Quick): {code('npm run lint')}, {code('npm run typecheck')}")
    lines.append(
        "- After every 2nd batch (Full): "
        f"{code('npm run lint')}, {code('npm run typecheck')}, {code('npm run test')}, "
        f"{code('npm run format')}, {code('npm run build')}, "
        f"{code('node scripts/start.js --profile-load synthetic --prompt "write me a haiku"')}",
    )
    lines.append("- If npm run format modifies files during full verify, commit those changes without rerunning checks.")
    lines.append("")
    lines.append("## Batch Schedule")
    lines.append("")
    lines.append("| Batch | Type | Upstream SHA(s) | Command / Playbook | Commit Message | Verify |")
    lines.append("|---:|:---|:---|:---|:---|:---|")

    for idx, batch in enumerate(batches, 1):
        batch_type = batch["type"]
        shas = [c.short for c in batch["commits"]]
        verify = "FULL" if idx % 2 == 0 else "QUICK"
        if batch_type == "PICK":
            cmd = code(f"git cherry-pick {' '.join(shas)}")
            commit_msg = code(f"cherry-pick: upstream {shas[0]}..{shas[-1]} batch {idx:02d}")
        else:
            cmd = code(f"project-plans/20260104gmerge/{shas[0]}-plan.md")
            subject = batch["commits"][0].subject
            commit_msg = code(f"reimplement: {subject} (upstream {shas[0]})")
        lines.append(f"| {idx:02d} | {batch_type} | {code(', '.join(shas))} | {cmd} | {commit_msg} | {verify} |")

    lines.append("")
    lines.append("## Failure Recovery")
    lines.append(f"- Abort a conflicted cherry-pick: {code('git cherry-pick --abort')}.")
    lines.append(f"- After resolving conflicts, continue with {code('git cherry-pick --continue')}.")
    lines.append(f"- If verification fails, fix immediately and add {code('fix: post-batch NN verification')} commit before next batch.")
    lines.append("")
    lines.append("## Note-taking Requirement")
    lines.append("- After each batch, update PROGRESS.md, append NOTES.md, and update AUDIT.md with LLxprt commit hashes.")

    (PLAN_DIR / "PLAN.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_progress(batches: list[dict]) -> None:
    lines: list[str] = []
    lines.append("Use this checklist to track batch execution progress.")
    lines.append("")
    lines.append("## Current Status")
    lines.append("")
    lines.append("| Field | Value |")
    lines.append("|---|---|")
    lines.append("| **Last Completed** | — |")
    lines.append("| **In Progress** | — |")
    lines.append("| **Next Up** | Batch 01 |")
    lines.append(f"| **Progress** | 0/{len(batches)} (0%) |")
    lines.append(f"| **Last Updated** | {datetime.now().date()} |")
    lines.append("")
    lines.append("## Preflight")
    lines.append(f"- [ ] On main: {code('git pull --ff-only')}")
    lines.append(f"- [ ] Branch exists: {code('git checkout -b 20260104gmerge')}")
    lines.append(f"- [ ] Upstream remote + tags fetched: {code('git fetch upstream --tags')}")
    lines.append(f"- [ ] Clean worktree before Batch 01: {code('git status --porcelain')} is empty")
    lines.append("- [ ] File existence pre-check run (see PLAN.md)")
    lines.append("")
    lines.append("## Batch Checklist")
    lines.append("")
    for idx, batch in enumerate(batches, 1):
        batch_type = batch["type"]
        shas = [c.short for c in batch["commits"]]
        subjects = " / ".join(c.subject for c in batch["commits"])
        verify = "FULL" if idx % 2 == 0 else "QUICK"
        lines.append(
            f"- [ ] Batch {idx:02d} — {verify} — {batch_type} — {code(', '.join(shas))} — {subjects}",
        )

    (PLAN_DIR / "PROGRESS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_notes() -> None:
    lines: list[str] = []
    lines.append("Keep this as a running log while executing batches.")
    lines.append("")
    lines.append("## Rules")
    lines.append("- Add a complete entry after every batch (PICK or REIMPLEMENT).")
    lines.append("- Include actual command output (no summaries).")
    lines.append("- Document deviations from plan and follow-ups.")
    lines.append("")
    lines.append("## Record Template")
    lines.append("")
    lines.append("### Selection Record")
    lines.append("")
    lines.append("```")
    lines.append("Batch: NN")
    lines.append("Type: PICK | REIMPLEMENT")
    lines.append("Upstream SHA(s): <sha(s)>")
    lines.append("Subject: <subject>")
    lines.append("Playbook: <path if REIMPLEMENT, N/A for PICK>")
    lines.append("Prerequisites Checked:")
    lines.append("  - Previous batch record exists: YES | NO | N/A")
    lines.append("  - Previous batch verification: PASS | FAIL | N/A")
    lines.append("  - Previous batch pushed: YES | NO | N/A")
    lines.append("  - Special dependencies: <list or None>")
    lines.append("Ready to Execute: YES | NO")
    lines.append("```")
    lines.append("")
    lines.append("### Execution Record")
    lines.append("")
    lines.append("```")
    lines.append("$ git cherry-pick <sha...>")
    lines.append("<output>")
    lines.append("```")
    lines.append("")
    lines.append("### Verification Record")
    lines.append("")
    lines.append("```")
    lines.append("$ npm run lint")
    lines.append("<output>")
    lines.append("$ npm run typecheck")
    lines.append("<output>")
    lines.append("```")
    lines.append("")
    lines.append("### Feature Landing Verification")
    lines.append("")
    lines.append("```")
    lines.append("<evidence: git show / grep / diff>")
    lines.append("```")
    lines.append("")
    lines.append("### Commit/Push Record")
    lines.append("")
    lines.append("```")
    lines.append("$ git status --porcelain")
    lines.append("<output>")
    lines.append("$ git commit -m \"...\"")
    lines.append("<output>")
    lines.append("$ git push")
    lines.append("<output>")
    lines.append("```")

    (PLAN_DIR / "NOTES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_audit(commits: list[Commit], picks: set[str], reimpl: set[str]) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines: list[str] = []
    lines.append(f"- Generated: {code(now)}")
    lines.append("- Branch: `20260104gmerge`")
    lines.append("- Upstream range: `v0.10.0..v0.11.3` (`172` commits)")
    lines.append("")
    lines.append("## Status Counts (Against CHERRIES.md)")
    lines.append("")
    lines.append("| Status | Count |")
    lines.append("|---|---:|")
    lines.append("| PICKED | 0 |")
    lines.append("| REIMPLEMENTED | 0 |")
    lines.append("| SKIP | 0 |")
    lines.append("| NO_OP | 0 |")
    lines.append("| ALREADY_PRESENT | 0 |")
    lines.append("| DIVERGED | 0 |")
    lines.append("| MISSING | 0 |")
    lines.append("")
    lines.append("## Full Upstream Table (Chronological)")
    lines.append("")
    lines.append("| # | Upstream | Decision | Status | Local | Subject | Notes |")
    lines.append("|---:|:--|:--|:--|:--|:--|:--|")

    for idx, commit in enumerate(commits, 1):
        if commit.short in picks:
            decision = "PICK"
        elif commit.short in reimpl:
            decision = "REIMPLEMENT"
        else:
            decision = "SKIP"
        subject = commit.subject.replace("|", "\\|")
        lines.append(
            f"| {idx} | {code(commit.short)} | {decision} |  |  | {subject} |  |",
        )

    (PLAN_DIR / "AUDIT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_playbooks(
    commits: list[Commit],
    reimpl: set[str],
    rationale: dict[str, str],
) -> None:
    header = [
        "# Reimplementation Playbooks",
        "",
        "This directory contains per-commit playbooks for REIMPLEMENT decisions.",
        "Each playbook should be executed as a solo batch.",
    ]
    (PLAN_DIR / "PLAYBOOKS.md").write_text("\n".join(header) + "\n", encoding="utf-8")

    for commit in commits:
        if commit.short not in reimpl:
            continue
        rationale_text = rationale.get(commit.short, "Reimplement to preserve LLxprt divergence")
        lines: list[str] = []
        lines.append(f"# Reimplement {commit.short} — {commit.subject}")
        lines.append("")
        lines.append(f"Upstream: https://github.com/google-gemini/gemini-cli/commit/{commit.sha}")
        lines.append(f"Areas: {', '.join(commit.areas)}")
        lines.append(f"Rationale: {rationale_text}")
        lines.append("")
        lines.append("## Upstream Files")
        if commit.files:
            for file in commit.files:
                exists = "YES" if (ROOT / file).exists() else "NO"
                lines.append(f"- {code(file)} (exists: {exists})")
        else:
            lines.append("- (No files listed in inventory)")
        lines.append("")
        lines.append("## Implementation Steps")
        lines.append(f"1. Inspect upstream diff: {code(f'git show {commit.short} --stat')}.")
        lines.append(f"2. Review each touched file: {code(f'git show {commit.short} -- <file>')}.")
        lines.append("3. Apply equivalent changes in LLxprt, adjusting for:")
        lines.append("   - Multi-provider architecture (no Google-only auth paths).")
        lines.append("   - No Clearcut telemetry; keep llxprt logging model.")
        lines.append("   - Canonical tool names and policy files per dev-docs/cherrypicking.md.")
        lines.append("   - A2A server remains private.")
        lines.append("4. If a referenced file is missing in LLxprt, document NO_OP in AUDIT.md and explain in NOTES.md.")
        lines.append(f"5. Run quick verify after implementation: {code('npm run lint')} and {code('npm run typecheck')}.")
        lines.append(
            f"6. Commit with: {code(f'reimplement: {commit.subject} (upstream {commit.short})')}.",
        )
        lines.append("7. Update PROGRESS.md, append NOTES.md, and record in AUDIT.md.")
        lines.append("")

        (PLAN_DIR / f"{commit.short}-plan.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    commits = [Commit(**c) for c in json.loads(DATA_PATH.read_text(encoding="utf-8"))]
    picks, reimpl, rationale = load_sets()
    batches = build_batches(commits, picks, reimpl)
    missing_files = collect_missing_files(commits, reimpl)
    write_plan(batches, missing_files)
    write_progress(batches)
    write_notes()
    write_audit(commits, picks, reimpl)
    write_playbooks(commits, reimpl, rationale)
    print(f"Generated PLAN/PROGRESS/NOTES/AUDIT and {len(reimpl)} playbooks.")


if __name__ == "__main__":
    main()
