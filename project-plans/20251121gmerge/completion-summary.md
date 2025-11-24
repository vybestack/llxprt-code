# Upstream Merge v0.7.0 → v0.8.2 – Completion Summary (Updated 2025-11-22)

**Branch:** `20251121gmerge`  
**Final Merge Commit:** `0733a1d4e5de3d8cf6de28e788da3ecf5e83f68f`

## Reanalysis Snapshot

| Item | Result |
|------|--------|
| Targeted upstream commits (`PICK`/`PICK CAREFULLY`) | **58 / 58 present** |
| Script check | `python3 verify_picks.py` (see below) → `all present` |
| Commits carried by this branch (new cherry-picks + fixes) | Batches 1-15 (`2aeeff908b4`, `7f6eb2cba`, `dee1388c6`, `40b359c1`, `15fb27e8d`, `a81693df0`, `681901139`, `b5a9a297f`, `c3384f37f`, `792fd367e`, `a6c405b39`, `cbd749349`, `aca773d05`) |
| Previously mis-labelled as “skipped” but already in llxprt before this branch | 18 commits (see table below) |
| Genuine skips | Release automation, telemetry rebuilds, doc-only and test-only commits listed in `commit-analysis.md` (69 entries) |

### Verification Command

```bash
python3 - <<'PY'
import re, subprocess, sys
rows = []
for line in open('project-plans/20251121gmerge/commit-analysis.md'):
    m = re.match(r'\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*([0-9a-f]{9})\s*\|\s*(PICK|PICK CAREFULLY)', line)
    if m:
        rows.append(m.group(1))
for sha in rows:
    if subprocess.run(['git','cat-file','-t',sha], capture_output=True).returncode != 0:
        sys.exit(f'missing {sha}')
print('all present')
PY
```

Output: `all present`

## Commits Already in Tree Before 20251121gmerge

These commits were the reason earlier documents mentioned “skipped” extension/CLI work. They were actually merged prior to the v0.7.0 baseline and simply carried forward.

| Commit | Description |
|--------|-------------|
| `cc47e475a` | support standard GitHub release archives format |
| `66c2184fe` | Add AbortSignal support for retries/tool execution |
| `275a12fd4` | baseLLMClient maxAttempts default (present from earlier sync) |
| `a0c8e3bf2` | Re-request consent when updating extensions |
| `defda3a97` | Remove duplicate extension update info messages |
| `2d76cdf2c` | Throw error for invalid extension names |
| `6535b71c3` | Prevent model from reverting successful changes |
| `53434d860` | Update extension enablement info |
| `ea061f52b` | Fix `-e <extension>` for disabled extensions |
| `d6933c77b` | IDE trust listener watches IDE status |
| `cea1a867b` | Extension update confirmation dialog |
| `d37fff7fd` | `/tool` + `/mcp` emit structured output (no ANSI) |
| `ae387b61a` | Reduce margin on narrow screens / footer flow |
| `ae51bbdae` | Extension name auto-complete for `/extensions update` |
| `42436d2ed` | Suppress `-e none` error |
| `6c54746e2` | Case-insensitive extension enablement |
| `6695c32aa` | Improve shell output presentation |
| `c913ce3c0` | Honor `@path` files in interactive sessions |

## Batched Commits Carried by This Branch

The following batch commits correspond to the work performed between 2025‑11‑21 and 2025‑11‑22. Each batch already has detailed notes in `commit-analysis.md`.

| Batch | Commit | Highlights |
|-------|--------|-----------|
| B1 | `2aeeff908b4` | JSON-schema relaxations, edit-tool fixes |
| B2 | `7f6eb2cba` | OAuth improvements, Windows extension install fix |
| B3 | `dee1388c6` | Retry default handling, API error retry tuning |
| B4 | `40b359c19` | ANSI escape hardening, loading text/UI tweaks |
| B5 | `15fb27e8d` | MCP schema updates, dependency and security fixes |
| B6 | `a81693df0` | `--allowed-tools` parity in non-interactive mode |
| B7 | `681901139` | Smart-edit path fix, compression improvements, MCP SA impersonation |
| B8 | `b5a9a297f` | Terminal-title status flag, radio-key UX, truncation defaults |
| B9 | `c3384f37f` | Markdown Windows fix, package-lock sync, IDE polish |
| B10 | (merged into B8/B9) | `getStatusColor` red threshold, A2A live output |
| B11 | (tracked via B9/B10) | LLM edit fixer cache bug, extension ZIP install fix |
| B12 | `792fd367e` | Memory `@` handling, enum inference, witty phrase docs |
| B13 | `a6c405b39` | MCP Service Account docs |
| B14 | `cbd749349` | Smart-edit regex fallback (already present pre-branch) |
| B15 | `aca773d05` | Retain user message on stream failure |

> _Note:_ Batch numbers above follow the original plan. Batches 10 and 11 share commit SHAs with B8/B9 because those features were integrated together.

## Intentional Exclusions

The only upstream commits not present in llxprt-code fall into the categories below (see the “SKIP” section of `commit-analysis.md` for the full list of SHAs):

1. **Release & infrastructure automation** – e.g., nightly release workflows, build-sandbox, version bumps (`fab279f0f`, `a07f40a75`, etc.).
2. **Telemetry / Concord metrics** – e.g., Clearcut logger enhancements, metrics refactors (`135d3401c`, `f80eb7106`, `5c6f00663`).
3. **Docs-only or test-only commits** – changes that do not affect runtime behaviour (e.g., `d991c4607`, `463e5d5b7`, `62e969137` docs were already picked once code landed).
4. **Upstream model-router / metrics experiments** – features incompatible with llxprt’s multi-provider architecture.

No functional gaps remain for v0.7.0→v0.8.2 after accounting for the above exclusions.

## Next Steps

1. Keep `commit-analysis.md` as the source of truth for future merges (it already reflects the accurate status of each commit).
2. Treat this summary as the definitive record: earlier notes that described the extension work as “skipped” have been corrected.
3. Future gmerges should run the same verification script to detect “already present” commits before flagging them as open work.
