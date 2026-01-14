# Summary: Cherry-Pick v0.12.0 → v0.13.0

**Related Issue:** https://github.com/vybestack/llxprt-code/issues/1133 (Subagent Recovery Turn)

## Overview

Upstream range: `v0.12.0..v0.13.0`
Total commits: **126**

This sync covers significant feature additions including:
- Hooks framework (Configuration, Types, Input/Output Contracts, Execution Planning)
- PolicyEngine refactored to Core package
- Alternate buffer support (terminal UI improvement)
- Extensions MCP refactor
- Granular memory loaders for JIT architecture
- Subagent timeout enforcement and recovery turns
- Various UI improvements (themes, settings, todo component)

## High-Risk Items

1. **Hook System** - 5 commits introducing hooks framework:
   - `c0495ce2` - Hook Configuration Schema and Types
   - `80673a0c` - Hook Type Decoupling and Translation
   - `b25915340` - Hook Input/Output Contracts
   - `cb2880cb` - Hook Execution Planning and Matching
   - These need careful review for multi-provider compatibility

2. **PolicyEngine to Core** (`ffc5e4d0`) - Major refactor, LLxprt has existing policy engine

3. **Alternate Buffer Support** (`4fc9b1cd`, `1671bf77`) - Terminal-level changes, test carefully

4. **Extensions MCP Refactor** (`da4fa5ad`) - Major MCP restructuring

5. **Remote Experiments Configuration** (`da3da198`) - Google-specific experiments system

## Decision Summary

| Decision | Count |
|----------|-------|
| PICK | 63 |
| SKIP | 55 |
| REIMPLEMENT | 8 |
| **Total** | 126 |

## Key SKIP Categories

1. **Release/Version Bumps** - 11 commits (nightly builds, preview releases, final release)
2. **ClearcutLogger/Google Telemetry** - All commits touching clearcut-logger for Google metrics
3. **GitHub Workflows** - gemini-automated-issue-triage.yml and release workflows
4. **debugLogger Migrations** - LLxprt has already done these differently with our DebugLogger
5. **Smart Edit fixes** - Smart Edit removed from LLxprt
6. **Remote Experiments** - Google-specific feature
7. **Todo-related commits** - LLxprt has completely different, superior todo implementation
8. **Model Routing** - LLxprt does NOT support Google's model routing (directs to lesser models)
9. **API key auth flow** - LLxprt handles API keys differently for multi-provider support
10. **Compression threshold UI** - LLxprt has own ephemeral-based system that doesn't require restart
11. **Subagent timeout/recovery** - LLxprt has completely different subagent architecture
12. **Context percentage in footer** - LLxprt doesn't have this feature

## Follow-up Issues to Create

- **Subagent Recovery Turn** - Implement similar concept from `60973aac` for LLxprt's subagent system. When subagent hits TIMEOUT/MAX_TURNS/NO_TOOL_CALL, give it one final grace turn to finalize. Like `--continue` for subagents.

## Key REIMPLEMENT Items

1. **PolicyEngine refactor** - Need to adapt to LLxprt's existing policy system
2. **Extensions MCP refactor** - Major changes requiring careful adaptation
3. **Hook System** - May need adaptation for multi-provider support
4. **Settings schema autogeneration** - May conflict with LLxprt settings

## Pre-Flight Checks Required

Before execution:
1. Verify LLxprt's current policy engine state
2. Check for existing hook implementations
3. Review current MCP/extension architecture
4. Verify alternate buffer terminal support in LLxprt

## Execution Estimate

- PICK batches (5 commits each): ~15 batches
- REIMPLEMENT batches (solo): ~11 batches
- Estimated total batches: ~26
- With verification cadence: Full verify every 2nd batch = ~13 full verifications
