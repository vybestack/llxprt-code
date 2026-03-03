# gmerge-0.24.5 Summary

## Overview

Syncing LLxprt Code from upstream gemini-cli v0.23.0 → v0.24.5 (121 commits).

**Branch:** `gmerge/0.24.5`  
**Plan folder:** `project-plans/gmerge-0.24.5/`

## Counts

| Decision | Count | % |
|----------|------:|--:|
| PICK | 34 | 28% |
| SKIP | 42 | 35% |
| REIMPLEMENT | 25 | 21% |
| NO_OP | 10 | 8% |
| Deferred (need PLANs) | 10 | 8% |
| **Total** | **121** | |

## What Changed From Initial Audit

The initial audit incorrectly skipped Agent Skills (11 commits), MessageBus (3), Remote Agents (4), and Tool Scheduler refactors (2) — treating new upstream systems as "not our problem." Corrected per user feedback and deep subagent analysis:

1. **Agent Skills → PICK** (11 commits). Subagent analysis confirmed they are remarkably self-contained — zero deps on removed infrastructure, all needed LLxprt infra exists. Cherry-pick with branding changes.
2. **MessageBus → SKIP** (confirmed). LLxprt already solved this via `config.getMessageBus()` — different pattern but same effect.
3. **Remote Agents → REIMPLEMENT** (4 commits). Incompatible agent architecture. Needs a PLAN (~1500-2000 LoC).
4. **Tool Scheduler → REIMPLEMENT our own way** (2 commits). Concepts valuable, code too diverged. Needs a PLAN (~800-1200 LoC moved).
5. Many commits previously marked PICK now correctly REIMPLEMENT (hooks, extensions are reimplemented systems).

## High-Value PICKs

### Agent Skills (11 commits — star feature of this sync)
Complete Agent Skills system: SkillManager, activate_skill tool, system prompt integration, status bar, extension support, CLI commands, /skills reload, documentation. Must be picked in linear order.

### Bug Fixes (critical)
- **687ca40b**: Race condition — `void` → `await` on scheduleToolCalls. LLxprt has same bug.
- **588c1a6d**: Rationale text rendered after tool calls instead of before. Same bug.
- **0a216b28**: EIO crash in readStdin
- **21388a0a**: GitService.checkIsRepo failure handling
- **acecd80a / 8a0190ca**: Unhandled promise rejections (IDE, MCP)
- **3997c7ff**: Terminal hang on auth browser close
- **dc6dda5c**: SDK warning in logging

### MCP & Extensions
- Missing type field fix, non-fatal schema validation, resources display limit

### Terminal / Cross-Platform
- Windows paste fix, /copy Windows crash, keyboard mode cleanup on exit

### Policy
- Mode-aware policy evaluation, shell redirection detection

## REIMPLEMENTs That Need PLANs

| System | Commits | Magnitude | Priority |
|--------|---------|-----------|----------|
| Remote Agents | 4 | ~1500-2000 LoC new | High |
| Tool Scheduler Refactor | 2 | ~800-1200 LoC moved | Medium |
| Console → coreEvents | 1 (66 files) | ~1000 LoC changes | Medium |
| Hooks enhancements | 6 | ~800 LoC | High |
| Policy unification | 3 | ~500 LoC | Medium |
| Extensions UX | 4 | ~400 LoC | Low |
| Secrets sanitization | 1 | ~200 LoC new + integrations | High (security) |
| Folder trust default | 1 | ~50 LoC | High (security) |

## Deferred Items (need separate PLANs or follow-up PRs)

These 10 commits are in the "Deferred" section — they depend on reimplemented systems and should be done after the base cherry-picks:
- Hooks visual indicators, hooks.enabled setting, granular stop/block, context injection
- Settings descriptions, remote admin settings
- Console migration (biggest single REIMPLEMENT)

## Risk Areas

1. **Skills cherry-pick** — 11 commits, linear chain. Verify `getAgentRegistry().getDirectoryContext()` exists.
2. **Race condition fix** — Touches useGeminiStream.ts which is a hot file. Minor conflicts expected.
3. **REIMPLEMENT volume** — 25 commits total. Some need full PLANs.
