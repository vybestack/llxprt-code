# SUMMARY.md — gmerge-0.19.4 (upstream v0.18.4 → v0.19.4)

## Overview

Syncing LLxprt Code with upstream gemini-cli from **v0.18.4** to **v0.19.4**.

- **Range**: 71 upstream commits
- **PICK**: 22 commits (direct cherry-picks)
- **SKIP**: 47 commits (version bumps, ClearcutLogger, FlashFallback, hooks, model availability, compression, sessions, test-only, upstream docs)
- **REIMPLEMENT**: 2 commits (extension docs parity, /stats session subcommand)

## Major Functional Changes

### Cherry-Picks (PICK)
1. **MCP lenient schema validation** (`9937fb22`) — improved MCP interoperability
2. **Move stdio to core** (`fec0eba0`) — architecture improvement
3. **Git service: skip pre-commit hooks** (`78b10dcc`) — shadow repo improvement
4. **Wide-character cursor positioning** (`5982abef`) — UI bug fix
5. **Bash @P prompt detection** (`613b8a45`) — shell-utils fix
6. **Typo fixes** (`0f0b463a`) — codebase cleanup
7. **Zed integration tests** (`3370644f`) — 1,121 lines of needed test coverage
8. **Auth flow bug fixes** (`030a5ace`) — important auth restart support
9. **Custom loading phrases** (`d351f077`) — UX for shell input waiting
10. **Config docs multiline JS** (`0713c86d`) — docs rendering fix
11. **Bracketed paste restoration** (`1e715d1e`) — terminal fix after editor exit
12. **BaseLlmClient.generateContent** (`8c36b106`) — base LLM client enhancement
13. **Alternate buffer off by default** (`5e218a56`) — UX improvement
14. **Extension stdout/stderr patching** (`bdf80ea7`) — extension commands bug fix
15. **Ink 6.4.6** (`b3fcddde`) — dependency update
16. **PDF context overflow warning** (`7350399a`) — bug fix
17. **Extension explore messaging** (`569c6f1d`) — UX improvement
18. **Config/package.json improvements** (`d53a5c4f`) — minor fixes
19. **Alternate system prompt bool** (`d14779b2`) — feature
20. **$schema in settings.schema.json** (`2b41263a`) — schema improvement
21. **Non-GitHub SCP URLs for extensions** (`f2c52f77`) — feature
22. **URL.parse Node.js < v22 fix** (`6f9118dc`) — compatibility fix

### Reimplementations
1. **Extension documentation** (`19d4384f`) — Write comprehensive LLxprt extension management CLI docs reaching parity with upstream's 277-line guide (install, uninstall, disable, enable, update, new, link sections)
2. **/stats session subcommand** (`c21b6899`) — Add explicit `/stats session` subcommand to our heavily-customized statsCommand.ts

## High-Risk Items

1. **`fec0eba0` (move stdio)** — touches `gemini.tsx`, `AppContainer.tsx`, core index; moderate conflict risk
2. **`030a5ace` (auth flow fixes)** — touches auth dialog, oauth2, mouse utils; multi-provider auth divergence
3. **`bdf80ea7` (extension commands)** — massive commit touching all extension and MCP CLI commands
4. **`b3fcddde` (ink update)** — package-lock.json version drift
5. **`d351f077` (loading phrases)** — touches multiple UI hooks and components

## Skipped Themes Summary

- **12** release/version bumps
- **4** hook system commits (LLxprt has independent hook architecture)
- **3** model availability service (Gemini-only model health/fallback chains)
- **2** ClearcutLogger commits (telemetry removed from LLxprt)
- **2** FlashFallback/quota commits (removed from LLxprt)
- **2** chat compression (LLxprt has superior multi-strategy system)
- **6** session browser/resume/docs (tracked by #1385, blocked on #1361)
- **5** release-branch patches (underlying fixes arrive via main-branch originals)
- **3** test coverage-only commits (high conflict risk, divergent code)
- **1** useModelRouter removal (already done in LLxprt)
- **1** model config aliases (requires modelConfigService we don't have)
- **1** Databricks auth (Gemini-specific proxy solution)
- **1** MCP SDK update (evaluate independently)
- **1** upstream branding (README badge)
- **1** banner persistence (divergent UI)
- **1** upstream-specific docs (HTTP proxy)
- **1** trivial grammar doc fix

## Tracking Issues Filed

- **#1385** — Session Browser & /resume Command: Upstream Reference Implementation (references #1361)
