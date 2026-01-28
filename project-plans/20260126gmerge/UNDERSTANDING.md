# Cherry-Picking Process Understanding (v0.13.0 → v0.14.0)

This document outlines my understanding of the cherry-picking process for syncing LLxprt Code with upstream gemini-cli, specifically for the v0.13.0 to v0.14.0 range.

---

## Overview

LLxprt Code is a fork of google-gemini/gemini-cli that adds:
- **Multi-provider support** (OpenAI, Anthropic, etc.) 
- **Privacy-first design** (no Google telemetry/ClearcutLogger)
- **Enhanced parallel tool batching** (superior to upstream's serial processing)
- **Custom branding** (@vybestack/llxprt-code-core vs @google/gemini-cli-core)

The cherry-picking process brings valuable upstream improvements while preserving LLxprt's unique architecture.

---

## Required Artifacts

For this sync (`project-plans/20260126gmerge/`), we need to create:

| File | Purpose |
|------|---------|
| `CHERRIES.md` | Decision tables (PICK/SKIP/REIMPLEMENT) for every upstream commit |
| `SUMMARY.md` | Overview, counts, high-risk items |
| `PLAN.md` | Executable batch schedule with verification cadence |
| `PROGRESS.md` | Batch completion checklist with LLxprt commit hashes |
| `NOTES.md` | Running notes during execution (conflicts, deviations) |
| `AUDIT.md` | Post-implementation reconciliation (upstream SHA → outcome) |
| `<sha>-plan.md` | Per-commit playbook for each REIMPLEMENT decision |

---

## Decision Framework

### PICK (cherry-pick as-is or with trivial conflicts)
- Bug fixes
- Performance improvements
- New features compatible with multi-provider support
- Tool improvements
- UI/UX enhancements
- IDE integration features (LLxprt has full IDE support)
- Security fixes and permission improvements
- MCP improvements (with matching docs)

### SKIP (do not apply)
- `gemini-automated-issue-triage.yml` (gemini-cli specific workflow)
- Changes breaking multi-provider support
- Branding changes overwriting LLxprt branding
- Auth changes assuming Google-only auth
- **NextSpeakerChecker** functionality (permanently disabled)
- **Tool scheduler queue changes** (LLxprt has superior parallel batching)
- **ClearcutLogger/Google telemetry** (completely removed)
- **Smart Edit** (`smart_edit`, `useSmartEdit`) - LLxprt uses deterministic `replace` + fuzzy edit
- **FlashFallback** - disabled/slated for removal
- Gemini-specific release commits
- **Emoji-related commits** (LLxprt is emoji-free)
- CLI argument removals (preserve backward compatibility)

### REIMPLEMENT (desired behavior, but too divergent to cherry-pick)
- Features needing significant adaptation for multi-provider architecture
- Features requiring LLxprt-specific implementation approach
- Examples: Conversation logging (privacy-first), tool scheduler (parallel batching)

---

## Tool Name Divergence

| Upstream | LLxprt |
|----------|--------|
| `web_fetch` | `google_web_fetch` / `direct_web_fetch` |
| `write_todos` | `todo_write` (and `todo_read` / `todo_pause`) |

**Aliases** (not divergence - just input normalization):
| Alias | Canonical Name |
|-------|----------------|
| `ls` | `list_directory` |
| `grep` | `search_file_content` |
| `edit` | `replace` |

---

## Batch Execution Rules

1. **Chronological order** - oldest upstream commit first
2. **PICK batches** - group up to 5 commits; high-risk = solo batch
3. **REIMPLEMENT batches** - always solo (batch size 1)
4. **SKIP** - not executed, just documented

### Verification Cadence

| After | Action |
|-------|--------|
| Every batch | Quick verify: `npm run lint && npm run typecheck` |
| Every 2nd batch | Full verify: lint → typecheck → test → format → build → smoke test |

### Commit Rules
- Every batch produces a commit
- Follow-up fixes get separate commits (before next batch)
- Message templates:
  - PICK: `cherry-pick: upstream <from>..<to> batch NN`
  - REIMPLEMENT: `reimplement: <subject> (upstream <sha>)`
  - Fix: `fix: post-batch NN verification`

---

## Branding Substitutions (Required)

When cherry-picking, always translate:
- `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`
- `AuthType.USE_GEMINI` → `AuthType.USE_PROVIDER`
- Gemini-specific branding → LLxprt branding

---

## Phase Workflow

### Phase 0 — Setup [OK]
```bash
git checkout -b 20260126gmerge  # Done
mkdir -p project-plans/20260126gmerge  # Done
git fetch upstream --tags
```

### Phase 1 — Upstream Commit Inventory
```bash
git log --reverse --date=short --format="%H %ad %s" v0.13.0..v0.14.0 > /tmp/upstream-range.txt
```

### Phase 2 — Decisioning
- Review each commit
- Classify as PICK/SKIP/REIMPLEMENT
- Write `CHERRIES.md` with three tables (in order: PICK, SKIP, REIMPLEMENT)
- Write `SUMMARY.md`
- **STOP for human review before Phase 3**

### Phase 3 — Batch Execution Plan
- Create `PLAN.md` with full batch schedule
- Create `<sha>-plan.md` for each REIMPLEMENT
- Include file existence pre-checks
- Include branding substitutions section
- Include failure recovery section

### Phase 4 — Execution & Tracking
- Execute batches per plan
- Update `PROGRESS.md` after each batch
- Append to `NOTES.md` for conflicts/deviations
- Update `AUDIT.md` continuously

### Phase 5 — PR Creation
- Reference tracking issue
- Link to CHERRIES.md and AUDIT.md
- Summarize major changes and intentional SKIPs

---

## Non-Negotiables (Never Violate)

1. **Multi-provider architecture** must be preserved
2. **No Google telemetry** (ClearcutLogger completely removed)
3. **LLxprt's parallel tool batching** over upstream's serial queue
4. **LLxprt branding** in all user-facing and import paths
5. **A2A server stays private** (do not make publishable)
6. **NextSpeakerChecker stays disabled** (causes token waste and loops)
7. **No Smart Edit** (LLxprt uses deterministic replace + fuzzy edit)
8. **Emoji-free design** preserved

---

## Quality Gates (Required Order)

```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

## Next Steps

To proceed with this sync:

1. Confirm the upstream range: `v0.13.0..v0.14.0`
2. Confirm current LLxprt parity (what we already match)
3. Confirm tracking issue number
4. Run Phase 1 to get commit inventory
5. Execute Phase 2 to create CHERRIES.md and SUMMARY.md
6. Stop for review before Phase 3
