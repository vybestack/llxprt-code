# Upstream Sync Summary: v0.22.0 -> v0.23.0 (AUDIT-REVISED)

## Overview

Syncing LLxprt Code with upstream gemini-cli from tag `v0.22.0` to `v0.23.0` (70 commits, 2025-12-16 to 2026-01-07).

**Branch:** `gmerge/0.23.0`
**Range:** `v0.22.0..v0.23.0`

## Counts

| Decision | Count | % |
|----------|-------|---|
| PICK | 20 | 29% |
| REIMPLEMENT | 13 | 18% |
| NO_OP | 4 | 6% |
| SKIP | 33 | 47% |
| **Total** | **70** | |

## What Changed from Initial Assessment

The audit revised 20 commits from their initial decisions:

- **19 commits moved from PICK to SKIP/NO_OP/REIMPLEMENT.** The initial pass over-counted direct cherry-picks. Detailed file-level analysis revealed that many commits touch code paths that have diverged in LLxprt, reference files that no longer exist, duplicate work already done, or belong to the incompatible upstream agent framework. These were reclassified to SKIP (where the change is irrelevant or harmful), NO_OP (where LLxprt already has the equivalent), or REIMPLEMENT (where the intent is valuable but the patch cannot apply cleanly).
- **1 commit moved from SKIP to PICK.** `948401a4` (a2a-js/sdk 0.3.2 to 0.3.7) was initially skipped as "managed independently" but the audit confirmed LLxprt uses the same a2a-server package and should take the dependency bump.

Net result: PICK count dropped from 39 to 20, REIMPLEMENT grew from 3 to 13, and 4 NO_OP commits were identified where none existed before.

## High-Risk Items

1. **`41a1a3ee` -- CRITICAL SECURITY (REIMPLEMENT)** -- Sanitizes hook command expansion to prevent shell injection via `$LLXPRT_PROJECT_DIR`. The vulnerability exists in LLxprt. Must be reimplemented because hook infrastructure has diverged, but the security fix is mandatory.

2. **`419464a8` -- Security gate (PICK)** -- Gates the "Allow for all future sessions" / save-to-policy feature behind an opt-in setting (off by default). LLxprt currently exposes this dangerous feature ungated. Direct cherry-pick expected to apply cleanly.

3. **`322232e5` -- Terminal background detection (REIMPLEMENT)** -- Upstream touches 28 files for a full theme refactor. LLxprt will reimplement just the background color detection logic and theme auto-selection without the broad file restructuring.

4. **`2e229d3b` -- JIT ContextManager (REIMPLEMENT)** -- Introduces a new ContextManager service for lazy-loading memory context. Must be adapted for LLxprt's `.llxprt/LLXPRT.md` path conventions and existing memory infrastructure.

5. **`7f2d3345` -- no-return-await eslint rule (PICK)** -- Large mechanical change across eslint config, cli, and core packages. Low conceptual risk but high file count; verify no conflicts with LLxprt-specific async patterns.

## Functional Themes

### Security Fixes (3 commits)
- **Hook command injection prevention** (`41a1a3ee`, REIMPLEMENT) -- sanitizes variable expansion in hook commands to block shell injection
- **OAuth resource validation** (`9383b54d`, PICK) -- validates OAuth resource parameter matches MCP server URL
- **Trusted folder validation** (`8ed0f898`, PICK) -- adds level validation for trusted folder settings

### Hooks Improvements (4 commits)
- **Hook injection fix** (`41a1a3ee`, REIMPLEMENT) -- see Security above
- **Friendly names and descriptions** (`54466a3e`, REIMPLEMENT) -- add name/description fields to hook configuration schema, registry, planner, and UI
- **Hook failure feedback** (`402148db`, REIMPLEMENT) -- emit user-visible feedback via coreEvents when hooks fail instead of only logging
- **Hooks docs update** (`cc52839f`, REIMPLEMENT) -- update documentation to use snake_case tool names

### UI/UX (8 commits)
- **Permanent tool approval gate** (`419464a8`, PICK) -- "Allow for all future sessions" behind opt-in setting
- **Settings dialog flicker** (`da85aed5`, PICK) -- padding fix
- **Shared Table component** (`bc168bbe`, PICK) -- fixes layout with long model names
- **Infinite loop in prompt completion** (`1e10492e`, PICK) -- bug fix
- **Slash completion fixes** (`6ddd5abd` + `70696e36`, REIMPLEMENT) -- eager completion hiding siblings; show on perfect match + sort
- **Trust dialog border overflow** (`6084708c`, PICK) -- right border fix
- **Shell mode placeholder** (`181da07d`, PICK) -- input placeholder during shell mode
- **Tool confirmation labels** (`e0f15908`, PICK) -- simplify labels for better UX

### Infrastructure (5 commits)
- **no-return-await eslint rule** (`7f2d3345`, PICK) -- code quality, broad mechanical cleanup
- **Remove unnecessary dependencies** (`0c4fb6af`, PICK) -- package.json cleanup
- **Background color detection** (`322232e5`, REIMPLEMENT) -- terminal background auto-detection for theme selection
- **.llxprtignore for SearchText** (`58fd00a3`, REIMPLEMENT) -- adapt .geminiignore support to LLxprt conventions
- **Quota retry improvements** (`b7ad7e10`, REIMPLEMENT) -- optional retryDelayMs, exponential backoff

### Docs (1 commit)
- **Hooks docs snake_case** (`cc52839f`, REIMPLEMENT) -- update tool name references in hooks documentation

## Major Items Being Skipped

- **Gemini 3 Flash launch** (5 commits, ~65 files) -- Gemini-specific model infrastructure, routing, and availability
- **Agent framework** (3 commits) -- executor rename, TOML parser, cleanup; incompatible with LLxprt SubagentOrchestrator; tracked as future A2A issue
- **ClearcutLogger telemetry** (2 commits) -- Google-internal telemetry, excluded per policy
- **FlashFallback patches** (1 commit) -- patches code already removed from LLxprt
- **Google-internal telemetry** (2 commits) -- Code Assist metrics and startupProfiler (file doesn't exist)
- **Auth logout** (1 commit) -- LLxprt already has superior multi-provider implementation
- **Release/nightly bumps** (11 commits) -- version-only, no functional code
- **Gemini-specific docs/commands** (3 commits) -- .gemini commands, GEMINI_SYSTEM_MD docs, changelog
- **Introspection agent demo** (1 commit) -- Gemini-specific
- **Seasonal feature** (1 commit) -- snowfall/header
- **Sensitive keywords lint** (1 commit) -- Gemini-specific
- **GitHub workflow** (1 commit) -- gemini-cli repo specific
