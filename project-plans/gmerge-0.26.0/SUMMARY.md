# gmerge/0.26.0 — Summary

**Upstream range:** `v0.25.2..v0.26.0` (154 commits, Jan 14–28 2026)
**Branch:** `gmerge/0.26.0`
**Previous sync:** `gmerge/0.25.2`

## What's in v0.26.0

Upstream v0.26.0 is a large release focused on:

1. **Rewind feature** — New `/rewind` command allowing users to jump back to earlier conversation points and revert file changes (SKIP — LLxprt doesn't have this)
2. **Plan mode** — Experimental read-only "plan" approval mode (SKIP — LLxprt doesn't have this)
3. **Agent infrastructure** — Generalist agent, agent enable/disable, delegation improvements (SKIP — LLxprt has own subagent system)
4. **Admin controls** — Enterprise admin settings polling and command gating (SKIP — Google enterprise feature)
5. **Scheduler refactoring** — Event-driven scheduler with state manager, confirmation utility, and policy modules (SKIP — LLxprt has minimal scheduler by design)
6. **Hooks maturation** — Hook event name validation, session/model/agent hook improvements, hooksConfig schema split
7. **Skills improvements** — Frontmatter parsing hardening, conflict detection, workspace scope rename, skill-creator builtin
8. **Key bindings cleanup** — Major reorganization, paste simplification, remove dead bindings, keybinding conflict fixes
9. **MCP improvements** — Tool lookup fix, instructions refresh, client version, status hook, PKCE/OAuth fix
10. **Settings refactoring** — Non-nullable settings, disable* → enable* rename, system scope migration
11. **Platform fixes** — PTY leak, Windows pty crash, macOS /dev/tty, Homebrew detection, clipboard OSC-52
12. **Security** — A2A localhost binding, shell redirection transparency, skill installation consent
13. **Performance** — Text buffer/highlight optimization, file search OOM prevention, truncation refactoring

## Decision Breakdown (Revised 2026-03-25)

| Decision | Count | % |
|----------|------:|--:|
| PICK     |    22 | 14% |
| REIMPLEMENT | 42 | 27% |
| SKIP     |    85 | 55% |
| NO_OP    |     5 |  3% |

### Why so many SKIPs?

76 of 154 commits (49%) are skipped because:
- **GitHub automation:** 15 commits (`.github/` workflows/scripts)
- **Version bumps:** 8 commits (`chore(release)`)
- **Upstream agent system:** 7 commits (generalist agent, delegation, registry — LLxprt has own subagent architecture)
- **Plan mode:** 4 commits (new feature LLxprt doesn't have)
- **Rewind feature:** 4 commits (new feature LLxprt doesn't have)
- **Admin controls:** 3 commits (Google enterprise feature)
- **Scheduler modules:** 3 commits (LLxprt has minimal scheduler)
- **Fallback/routing:** 3 commits (not in LLxprt)
- **Evals-only:** 3 commits
- **Google telemetry:** 2 commits (ClearcutLogger removed from LLxprt)
- **Mnemoist migration:** 1 commit (LLxprt uses LruCache)
- **Skill-creator:** 2 commits (not in LLxprt)
- **Misc docs/deps:** ~21 commits (Google-specific docs, dependabot, GEMINI.md, etc.)

### What are we picking?

**34 PICK commits** (direct cherry-picks, ~22%) cover:
- **Bug fixes:** PTY shell leak, ModelInfo abort, race conditions, MCP tool lookup, Homebrew detection, Windows pty crash, external editor fallback, keyboard shortcut conflicts
- **Security:** A2A localhost binding, PKCE/OAuth fix
- **Hooks:** Event name validation, exit code tests, session start return type, rationale ordering
- **Skills:** Frontmatter parsing hardening (colons, regex)
- **MCP:** Tool registry lookup, instructions refresh, http display type
- **A2A server:** Retry/InvalidStream handling, git availability check
- **Performance:** Text buffer optimization, shell-utils timeout, truncation refactoring
- **UI:** Ellipsis fix, keyboard shortcuts link, DebugProfiler warnings, OSC-52 clipboard
- **Behavioral:** "Don't commit unless user asks" prompt improvement
- **Platform:** Home/end keybinding conflict, extension examples

### What needs reimplementation?

**41 REIMPLEMENT commits** (adapted for LLxprt, ~27%) — these are functionally valuable but can't be cleanly cherry-picked due to LLxprt architectural divergence:

**High-risk (large, many files):**
- `f7f38e2` — Non-nullable merged settings (59 files)
- `608da23` — Rename disable* → enable* settings (22+ files)
- `211d2c5` — Hooks config/event names split (large schema change)
- `cebe386` — MCP status hook refactor (new hook + event system change)

**Medium-risk (targeted but touches diverged code):**
- Key bindings chain: `09a7301` → `fb76408` → `42c26d1` → `94d5ae5` → `ce35d84`
- Skills: `c8c7b57` (workspace scope), `222b739` (conflict detection), `a81500a` (install consent), `272570c` (enabled by default)
- Hooks: `e92f60b` (migrate to HookSystem), `2a3c879` (clearContext)
- UI/UX: `645e2ec` + `aceb06a` (Ctrl+Enter/newline), `e1fd5be` (Esc-Esc clear), `8a627d6` (/dev/tty safety)
- Infra: `e77d7b2` (OOM prevention), `cfdc4cf` (scheduleToolCalls race), `ec74134` (shell redirection security)

**Lower-risk (small adaptations):**
- `203f520` — Prompts.ts git improvements
- `43846f4` + `d8e9db3` — package.ts error handling
- `b288f12` — MCP client version (package name change)
- `ee87c98` — Fast return buffer keypress flags

## Estimated Scope

- **PICK phase:** ~34 cherry-pick commands, expect ~5-10 conflicts requiring trivial resolution
- **REIMPLEMENT phase:** ~41 changes requiring manual adaptation, several are multi-file. The 4 high-risk items alone touch 100+ files.
- **Total LOC impact:** Moderate-to-large. The PIKCs are mostly small (1-50 lines each). The REIMPLEMENTs range from trivial (3-line package.ts fix) to massive (59-file settings refactor).

## Recommended Execution Strategy

1. **Batch PIKCs in groups of 5** (chronological), expect ~7 batches
2. **Solo-batch each REIMPLEMENT** in dependency order
3. **Defer the 4 high-risk REIMPLEMENTs** to the end (or to follow-up PRs if they're too large)
4. **Quick verify** after every batch; **full verify** every 2nd batch

## Human Review: COMPLETE (2026-03-25)

Human review performed. 17 decisions changed (see CHERRIES.md revision log). Issues filed:
- **#1770** — event-driven profile-aware model info display (replace polling)
- **#1675** — 3 A2A server picks deferred
- **#1648** — upstream PDF token estimation reference

Phase 3 (PLAN.md) now in progress.
