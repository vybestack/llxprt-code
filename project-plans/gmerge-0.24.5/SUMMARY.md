# gmerge-0.24.5 Summary

## Overview

Syncing LLxprt Code from upstream gemini-cli v0.23.0 → v0.24.5 (121 commits).

**Branch:** `gmerge/0.24.5`  
**Plan folder:** `project-plans/gmerge-0.24.5/`

## Counts

| Decision | Count | % |
|----------|------:|--:|
| PICK | 34 | 28% |
| SKIP | 45 | 37% |
| REIMPLEMENT | 30 | 25% |
| NO_OP | 12 | 10% |
| **Total** | **121** | |

## What Changed From Initial Audit

1. **Agent Skills → PICK** (11 commits). Cherry-pickable with branding changes.
2. **MessageBus → REIMPLEMENT** (3 commits). DI migration: service locator → constructor injection. ~57 files, mechanical refactoring. Design + plan in `messagebus/`.
3. **Remote Agents → SKIP (deferred)** (4 commits). Descoped from this sync — incompatible agent architecture needs ~1500-2000 LoC. Design/plan moved to `project-plans/a2a/`, tracked via GitHub issue.
4. **Tool Scheduler → REIMPLEMENT our own way** (2 commits). Extract-not-rewrite. Design + plan in `toolscheduler/`.
5. **Deferred items resolved**: 7 items previously "deferred" reclassified to REIMPLEMENT (hooks, settings, coreEvents migration). 2 minor items subsumed or trivial.

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
| Tool Scheduler Refactor | 2 | ~800-1200 LoC moved | Medium |
| Console → coreEvents | 1 (66 files) | ~1000 LoC changes | Medium |
| Hooks enhancements | 6 | ~800 LoC | High |
| Policy unification | 3 | ~500 LoC | Medium |
| Extensions UX | 4 | ~400 LoC | Low |
| Secrets sanitization | 1 | ~200 LoC new + integrations | High (security) |
| Folder trust default | 1 | ~50 LoC | High (security) |

## Deferred Items

All previously deferred items have been resolved:
- 7 items reclassified to REIMPLEMENT (hooks, settings, coreEvents migration) — now in REIMPLEMENT table rows 25-30.
- 4 Remote Agent/A2A commits descoped to separate issue — design/plan moved to `project-plans/a2a/`.
- 2 minor items resolved: yolo.toml `allow_redirection = true` (manual add during execution), dead `setMessageBus()` stubs (subsumed by MessageBus DI refactor).

## Risk Areas

1. **Skills cherry-pick** — 11 commits, linear chain. Verify `getAgentRegistry().getDirectoryContext()` exists.
2. **Race condition fix** — Touches useGeminiStream.ts which is a hot file. Minor conflicts expected.
3. **REIMPLEMENT volume** — 30 commits across ToolScheduler, MessageBus, hooks, settings, and coreEvents. Full PLANs created for ToolScheduler and MessageBus.
