# gemini-cli v0.11.3 → v0.12.0: Cherry-Pick Summary

Tracking issue: https://github.com/vybestack/llxprt-code/issues/709

## Overview

| Metric | Value |
|--------|-------|
| **Upstream Range** | v0.11.3 → v0.12.0 |
| **Total Commits** | 135 |
| **PICK** | 55 |
| **SKIP** | 67 |
| **REIMPLEMENT** | 13 |

## PICK Highlights

### Features
- `6d75005a` - Add setting to disable YOLO mode (#11609)
- `3f38f95b` - executeCommand endpoint with /extensions list (#11515)
- `750c0e36` - Extension settings requested on install (#9802)
- `3a501196` - Surface internal errors via unified event system (#11803)
- `c079084c` - Token caching in google auth provider (#11946)
- `cdff69b7` - Support redirects in fetchJson (#11993)
- `145e099c` - Support paste markers split across writes (#11977)
- `ef70e632` - Make PASTE_WORKAROUND the default (#12008)
- `c7817aee` - Add delimiter before tool response in non-interactive mode (#11351)

### Moved to SKIP (per review)
- `30dd2f1d` - Todo tool documentation - LLxprt has completely different todo implementation
- `ee92db75` - Request retries and model fallback - LLxprt has different retry architecture, FlashFallback removed
- `e750da98` - Console.error migration in useGeminiStream - LLxprt has DebugLogger

### Bug Fixes
- `d9f0b9c6` - Fix race condition in useGitBranchName (#11759)
- `8e9f71b7` - Resolve race condition in double-escape handler (#8913)
- `9e91aafe` - Fix tool scheduler repeatedly created bug (#11767)
- `5e70a7dd` - Align shell allowlist handling (#11813)
- `884d838a` - Re-throw errors in non-interactive mode (#11849)
- `40057b55` - Use correct defaults for file filtering (#11426)
- `73570f1c` - Fix shortenPath ellipsis insertion (#12004)
- `a2d7f82b` - Prepend user message to loop detection history (#11860)
- `23c906b0` - User configured oauth scopes take precedence (#12088)
- `4ef3c093` - Update loop detection LLM schema fields (#12091)

### Refactors & Test Improvements
- `92d412e5` - Simplify FilterReport, remove unused code (#11681)
- `047bc440` - Clean up exclude description (#11678)
- `1202dced` - Refactor KeypressContext (#11677)
- `b1059f89` - Switch to unified shouldIgnoreFile (#11815)
- `ee66732a` - First batch of test best practices (#11964)
- Multiple parameterized test commits for better test maintainability

### Documentation
- `30dd2f1d` - Document todo tool (#11695)
- `445ef4fb` - Fix broken link in configuration docs (#11655)
- `5ae9fe69` - Fix broken links in documentation (#11789)
- `ce26b58f` - Update project structure in CONTRIBUTING (#11599)
- `e115083f` - Revamp pull request template (#11949)
- `44c62c8e` - Contributing guide improvements (#12012)

## SKIP Highlights

### Release Management (15 commits)
- All `chore(release):` version bump commits
- All `v0.12.0-preview.N` release commits
- Cherry-pick patches for preview releases

### GitHub Workflows/Infra (12 commits)
- deflake.yml, test_chained_e2e.yml, merge queue workflows
- lychee-action for link checking
- e2e workflow modifications

### Telemetry/ClearcutLogger (6 commits)
- `4f220e94` - Exit multiple times logging (uses ClearcutLogger)
- `8bdef875` - Stop logging session ids on extension events
- `6db64aab` - Prevent duplicate StartSessionEvent logging
- `70996bfd` - OTEL semantic standard log
- Various debugLogger migrations (LLxprt has superior DebugLogger)

### Google-Specific (5 commits)
- `9e8f7c07` - BYOID auth client
- `abd22a75` + `034ca939` - ID token support (added then reverted)
- `601a639f` - Disable model routing for oauth users
- `cb208f53` - Genkit telemetry setup script

## REIMPLEMENT Highlights

### High Priority
- `b188a51c` - **Message bus for tool execution confirmation** - Core scheduler changes, LLxprt has different message bus architecture
- `064edc52` - **Config-based policy engine with TOML** - LLxprt already has policy engine, need to evaluate overlap
- `541eeb7a` - **Sequential approval implementation** - Major scheduler changes for approval flow

### Extension System
- `c4c0c0d1` - **ExtensionManager class** - Major refactor, needs adaptation for LLxprt
- `1b302dee` - **ExtensionLoader interface on Config** - Config object changes
- `7e987113` - **Sensitive keychain-stored extension settings** - Security feature worth reimplementing

### Infrastructure
- `ee92db75` - **Request retries and model fallback** - Touches FlashFallback (removed from LLxprt)
- `2a87d663` - **ChatCompressionService extraction** - LLxprt has different compression architecture
- `a9cb8f49` - **OTEL trace instrumentation** - Needs careful adaptation for multi-provider
- `44bdd3ad` - **Record model responses for testing** - Useful testing infrastructure

### UI/UX
- `2dfb813c` - **AppContainer polling and footer currentModel** - UI state changes
- `c2d60d61` - **Extension explore subcommand** - New feature
- `e750da98` - **Console.error migration in useGeminiStream** - Logger adaptation needed

## High-Risk Items

1. **Message Bus / Policy Engine Changes**
   - `b188a51c` - Message bus for tool confirmation
   - `064edc52` - TOML-based policy engine
   - `5d61adf8` - Message bus setting guard
   - LLxprt has existing implementations - need careful merge/evaluation

2. **Extension Manager Refactors**
   - `c4c0c0d1` - ExtensionManager class creation
   - `1b302dee` - ExtensionLoader interface
   - `7e987113` - Keychain-stored settings
   - Major architectural changes to extension handling

3. **Scheduler Changes**
   - `541eeb7a` - Sequential approval
   - `9e91aafe` - Fix tool scheduler repeated creation
   - LLxprt has superior parallel batching - must preserve

4. **Model Fallback / Retry Logic**
   - `ee92db75` - Request retries and model fallback
   - Touches FlashFallback which is removed from LLxprt

## Estimated Effort

| Category | Count | Complexity |
|----------|-------|------------|
| Straightforward PICKs | ~45 | Low |
| PICKs needing conflict resolution | ~13 | Medium |
| REIMPLEMENTs | 15 | High |
| **Total Batches (est.)** | ~20 | - |

## Notes

- Many test improvements and parameterization commits - good for code quality
- Heavy debugLogger migration in upstream - all SKIP since LLxprt has DebugLogger
- Extension system seeing significant changes - may want to evaluate holistically
- Policy engine overlap needs careful analysis before REIMPLEMENT
- Waiting for human review before creating batch execution plan

## Next Steps

1. Review CHERRIES.md decisions
2. Identify any decision overrides
3. Create PLAN.md with batch schedule (will use subagents for execution)
4. Execute batches with verification cadence
