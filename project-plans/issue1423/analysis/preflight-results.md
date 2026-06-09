# Preflight Results — PLAN-20260608-ISSUE1423.P0.5

Date: 2026-06-08
Branch: issue1423

## 1. Command Outputs

### 1.1 `git status --short`

```
?? project-plans/issue1423/
```

Only untracked plan files present; working tree is clean of production changes. Branch is `issue1423` as expected.

### 1.2 Source file existence checks

```bash
$ test -f packages/core/src/core/geminiChat.ts && echo found
found
$ test -f packages/core/src/core/geminiChatTypes.ts && echo found
found
$ test -f packages/cli/src/gemini.tsx && echo found
found
```

| File | Result |
|------|--------|
| `packages/core/src/core/geminiChat.ts` | **found** |
| `packages/core/src/core/geminiChatTypes.ts` | **found** |
| `packages/cli/src/gemini.tsx` | **found** |

All three primary rename targets exist in the expected locations.

### 1.3 `rg -l` rename-target scan (excludes dist, coverage, .log, .xml)

```bash
$ rg -l "GeminiChat|geminiChat|geminiChatTypes|GeminiClient|getGeminiClient|geminiClient|gemini\.tsx|from ['\"].*gemini\.js['\"]|import\(['\"].*gemini\.js['\"]\)" packages --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml' | sort | wc -l
175
```

The scan found **175 files**. Full list saved to `analysis/current-rename-matches.txt`. Per-package breakdown:

| Package | File count |
|---------|-----------|
| `packages/a2a-server/` | 6 |
| `packages/cli/` | 85 |
| `packages/core/` | 83 |
| `packages/providers/` | 1 |

Top directories by match density:

| Directory | File count |
|-----------|-----------|
| `packages/core/src/core` | 32 |
| `packages/cli/src/ui/commands` | 20 |
| `packages/cli/src/ui/hooks` | 16 |
| `packages/core/src/tools` | 11 |
| `packages/cli/src/ui/containers/AppContainer/hooks` | 10 |
| `packages/core/src/core/__tests__` | 9 |
| `packages/cli/src/ui/hooks/geminiStream` | 8 |
| `packages/cli/src` (top-level) | 8 |
| `packages/core/src/utils` | 7 |
| `packages/core/src/config` | 5 |
| `packages/cli/src/integration-tests` | 5 |
| `packages/core/src/core/compression` | 4 |
| `packages/cli/src/ui/__tests__` | 4 |

### 1.4 File-name scan (`find` for geminiChat*/geminiClient*/gemini.tsx)

```bash
$ find packages/core/src/core packages/core/src/integration-tests packages/cli/src -maxdepth 3 \( -name '*geminiChat*' -o -name '*geminiClient*' -o -name 'gemini.tsx' -o -name 'gemini.*.test.*' \) | sort
packages/cli/src/gemini.provider-init.test.ts
packages/cli/src/gemini.renderOptions.test.tsx
packages/cli/src/gemini.startInteractiveUI.test.tsx
packages/cli/src/gemini.tsx
packages/core/src/core/__tests__/geminiChat-density.test.ts
packages/core/src/core/__tests__/geminiChat.runtimeState.test.ts
packages/core/src/core/__tests__/geminiClient.dispose.test.ts
packages/core/src/core/__tests__/geminiClient.runtimeState.test.ts
packages/core/src/core/geminiChat.contextlimit.test.ts
packages/core/src/core/geminiChat.hook-control.test.ts
packages/core/src/core/geminiChat.issue1150.integration.test.ts
packages/core/src/core/geminiChat.issue1729.test.ts
packages/core/src/core/geminiChat.runtime.test.ts
packages/core/src/core/geminiChat.thinking-spacing.test.ts
packages/core/src/core/geminiChat.thinking-toolcalls.test.ts
packages/core/src/core/geminiChat.thinkingHistory.test.ts
packages/core/src/core/geminiChat.tokenSync.test.ts
packages/core/src/core/geminiChat.ts
packages/core/src/core/geminiChatTypes.ts
packages/core/src/integration-tests/geminiChat-isolation.integration.test.ts
```

20 files have `geminiChat`/`geminiClient`/`gemini.tsx` in their filename.

### 1.5 `packages/core/package.json` export subpath

```bash
$ grep -n "./core/geminiChat.js" packages/core/package.json
27:    "./core/geminiChat.js": "./dist/src/core/geminiChat.js",
```

Confirmed: `./core/geminiChat.js` export subpath exists at line 27 and must be replaced with `./core/chatSession.js`.

### 1.6 `npm run typecheck -- --help` (infrastructure reachability)

```bash
$ npm run typecheck -- --help >/dev/null 2>&1; echo "exit: $?"
exit: 0
```

TypeScript/Vitest infrastructure is reachable.

### 1.7 `rg --version`

```bash
$ rg --version
ripgrep 15.1.0

features:+pcre2
simd(compile):+NEON
simd(runtime):+NEON

PCRE2 10.45 is available (JIT is available)
```

ripgrep is installed.

### 1.8 `git branch --show-current`

```bash
$ git branch --show-current
issue1423
```

On expected branch.

## 2. Type/Interface Verification

| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| `GeminiChat` | class in `packages/core/src/core/geminiChat.ts` | `export class GeminiChat` at line 118 of `geminiChat.ts` | YES |
| `GeminiClient` | class in `packages/core/src/core/client.ts` | `export class GeminiClient` at line 72 of `client.ts` | YES |
| `getGeminiClient` | config accessor in `configBaseCore.ts` | `getGeminiClient(): GeminiClient` at line 494 of `configBaseCore.ts` | YES |

### Grep evidence

```bash
$ grep -n "export class GeminiChat" packages/core/src/core/geminiChat.ts
118:export class GeminiChat {

$ grep -n "export class GeminiClient" packages/core/src/core/client.ts
72:export class GeminiClient {

$ grep -n "getGeminiClient" packages/core/src/config/configBaseCore.ts
494:  getGeminiClient(): GeminiClient {
```

## 3. Call Path Verification

| Function | Expected Caller | Evidence |
|----------|-----------------|----------|
| CLI `main` | `packages/cli/index.ts` imports `./src/gemini.js` | Confirmed: line 11 `import { main } from './src/gemini.js'` |
| `new GeminiClient` | `packages/core/src/config/config.ts` | Confirmed: lines 198 and 315 construct `new GeminiClient(this, this.runtimeState)` |
| `startChat` via `ChatSessionFactory` | `packages/core/src/core/client.ts` imports from `ChatSessionFactory.js` | Confirmed: line 66 |

### Call path grep evidence

```bash
$ grep -n "import.*gemini" packages/cli/index.ts
11:import { main } from './src/gemini.js';

$ grep -n "new GeminiClient" packages/core/src/config/config.ts
198:    this.geminiClient = new GeminiClient(this, this.runtimeState);
315:    const newGeminiClient = new GeminiClient(this, this.runtimeState);

$ grep -n "ChatSessionFactory" packages/core/src/core/client.ts
66:} from './ChatSessionFactory.js';
```

Additional call paths found for `gemini.js` dynamic/static imports:
- `packages/cli/src/gemini.provider-init.test.ts` line 8: `import * as gemini from './gemini.js'`
- `packages/cli/src/commands/skills.tsx` line 13: `import { initializeOutputListenersAndFlush } from '../gemini.js'`
- `packages/cli/src/gemini.startInteractiveUI.test.tsx` line 8: `import { validateDnsResolutionOrder, startInteractiveUI } from './gemini.js'`
- `packages/cli/src/gemini.renderOptions.test.tsx` lines 114, 150: `await import('./gemini.js')`

## 4. Test Infrastructure Verification

### 4.1 Core tests for geminiChat

| Test file | Present? |
|-----------|----------|
| `packages/core/src/core/__tests__/geminiChat-density.test.ts` | YES |
| `packages/core/src/core/__tests__/geminiChat.runtimeState.test.ts` | YES |
| `packages/core/src/core/__tests__/geminiClient.dispose.test.ts` | YES |
| `packages/core/src/core/__tests__/geminiClient.runtimeState.test.ts` | YES |
| `packages/core/src/core/geminiChat.contextlimit.test.ts` | YES |
| `packages/core/src/core/geminiChat.hook-control.test.ts` | YES |
| `packages/core/src/core/geminiChat.issue1150.integration.test.ts` | YES |
| `packages/core/src/core/geminiChat.issue1729.test.ts` | YES |
| `packages/core/src/core/geminiChat.runtime.test.ts` | YES |
| `packages/core/src/core/geminiChat.thinking-spacing.test.ts` | YES |
| `packages/core/src/core/geminiChat.thinking-toolcalls.test.ts` | YES |
| `packages/core/src/core/geminiChat.thinkingHistory.test.ts` | YES |
| `packages/core/src/core/geminiChat.tokenSync.test.ts` | YES |
| `packages/core/src/integration-tests/geminiChat-isolation.integration.test.ts` | YES |

### 4.2 CLI tests for gemini entry

| Test file | Present? |
|-----------|----------|
| `packages/cli/src/gemini.test.tsx` | YES |
| `packages/cli/src/gemini.provider-init.test.ts` | YES |
| `packages/cli/src/gemini.renderOptions.test.tsx` | YES |
| `packages/cli/src/gemini.startInteractiveUI.test.tsx` | YES |

### 4.3 Config/client tests

| Test file | Present? |
|-----------|----------|
| `packages/core/src/config/config.test.ts` | YES |
| `packages/core/src/config/config-lsp-integration.test.ts` | YES |
| `packages/core/src/config/onAuthErrorHandler.test.ts` | YES |
| `packages/core/src/core/client.test.ts` | YES |
| `packages/core/src/core/ChatSessionFactory.test.ts` | YES |

All test infrastructure present.

## 5. Package Metadata Export Surface

```bash
$ grep -n "geminiChat" packages/core/src/index.ts
80:export * from './core/geminiChat.js';

$ grep -n "./core/geminiChat.js" packages/core/package.json
27:    "./core/geminiChat.js": "./dist/src/core/geminiChat.js",
```

| Item | Value |
|------|-------|
| `packages/core/package.json` subpath `./core/geminiChat.js` | Line 27: maps to `./dist/src/core/geminiChat.js` |
| `packages/core/src/index.ts` re-export | Line 80: `export * from './core/geminiChat.js'` |

Both must be updated to `./core/chatSession.js` after rename.

## 6. Provider-Specific Names to Preserve (confirmed present, not to rename)

| File/Path | Present? |
|-----------|----------|
| `packages/cli/src/auth/gemini-oauth-provider.ts` | YES |
| `packages/cli/src/providers/aliases/gemini.config` | YES |
| `packages/core/src/core/geminiRequest.ts` | YES |
| `packages/cli/src/ui/hooks/geminiStream/` directory | YES |

## 7. Current-rename-matches.txt Refresh

```bash
$ diff <(rg -l "GeminiChat|geminiChat|geminiChatTypes|GeminiClient|getGeminiClient|geminiClient|gemini\.tsx|from ['\"].*gemini\.js['\"]|import\(['\"].*gemini\.js['\"]\)" packages --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml' | sort) project-plans/issue1423/analysis/current-rename-matches.txt
(empty diff)
```

Fresh scan output matches the current `analysis/current-rename-matches.txt` exactly (diff = empty). The file has 175 entries and is current. No material differences found.

## 8. Verification Gate Checklist

- [x] **All dependencies verified** — TypeScript/Vitest infrastructure reachable (exit 0), ripgrep 15.1.0 installed, git on branch `issue1423`
- [x] **All types match expectations** — `GeminiChat` (class, line 118 geminiChat.ts), `GeminiClient` (class, line 72 client.ts), `getGeminiClient` (method, line 494 configBaseCore.ts)
- [x] **All call paths are possible** — CLI main→gemini.js import, config→new GeminiClient, client→ChatSessionFactory confirmed
- [x] **Test infrastructure ready** — All 14 core geminiChat/geminiClient test files, 4 CLI gemini test files, and config/client/ChatSessionFactory test files present
- [x] **Out-of-scope Gemini provider files identified** — `gemini-oauth-provider.ts`, `gemini.config`, `geminiRequest.ts`, `geminiStream/` directory confirmed present and marked as preserve
- [x] **Package metadata export surface verified** — `./core/geminiChat.js` in package.json line 27 and `export * from './core/geminiChat.js'` in index.ts line 80 confirmed
- [x] **Generated artifact exclusions verified** — `dist/`, `coverage/`, `*.log`, `*.xml`, `node_modules/` excluded by rg glob patterns

## 9. Blocker Assessment

**No blockers found.** All preflight checks pass. The rename surface matches the existing plan inventory exactly. All expected source files, package metadata exports, and test infrastructure are present. The branch is `issue1423` with a clean working tree (only untracked plan files).

PASS — Proceed to P01.