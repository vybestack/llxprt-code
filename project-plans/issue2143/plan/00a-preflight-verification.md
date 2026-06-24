<!-- @plan:PLAN-20260622-COREAPIGAP.P00a @requirement:REQ-001..REQ-010,REQ-INT-001..005 -->
# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P00a`

## LLxprt Code Subagent: architect

## Purpose

Verify EVERY assumption this plan depends on against the actual current source BEFORE any
implementation phase begins, including the TWO corrected issue assumptions. If any check fails,
STOP and update the plan first.

## Prerequisites

- Branch `issue2143` derived from current `main` (post-#1594-remediation merge).
- Required reading: `specification.md`, `analysis/domain-model.md`, all nine
  `analysis/pseudocode/*.md`.

## Dependency Verification

Run and paste output:

```bash
set -o pipefail
npm ls zod                         # schema-first dependency (AgentTaskInfoSchema / PolicyRuleViewSchema)
npm ls fast-check                  # property-based testing (≥30% requirement)
grep -nE "@stryker-mutator/core" packages/agents/package.json   # expect "^9.6.1"
npm ls @stryker-mutator/core || { echo "FAIL: @stryker-mutator/core MISSING — restore the devDependency before proceeding."; exit 1; }
# agents must already depend on policy + providers + core (the backing engines we re-export from):
grep -nE ""@vybestack/llxprt-code-(core|policy|providers)"" packages/agents/package.json
```

| Dependency | Expected | Status |
|---|---|---|
| zod | installed | [ ] |
| fast-check | installed | [ ] |
| @stryker-mutator/core | installed (`^9.6.1`) | [ ] |
| agents → core / policy / providers deps | present | [ ] |

## CORRECTED ISSUE ASSUMPTIONS (must verify FIRST)

```bash
set -o pipefail
# CORRECTION 1: the issue body claims "no such file mcpAuth.ts". That is FALSE — it EXISTS and holds
# the real MCP OAuth reference flow. Confirm the file + the flow anchors:
test -f packages/cli/src/ui/commands/mcpAuth.ts && echo "CONFIRMED: mcpAuth.ts EXISTS (issue claim FALSE)" || { echo "UNEXPECTED: mcpAuth.ts absent — re-confirm REQ-006 reference flow before P13"; exit 1; }
grep -n "listOAuthServers" packages/cli/src/ui/commands/mcpAuth.ts          # expect ~:49
grep -n "performMcpOAuth" packages/cli/src/ui/commands/mcpAuth.ts           # expect ~:82
grep -n "MCPOAuthProvider.authenticate" packages/cli/src/ui/commands/mcpAuth.ts   # expect ~:108
grep -n "restartServer" packages/cli/src/ui/commands/mcpAuth.ts             # expect ~:132
grep -n "setTools" packages/cli/src/ui/commands/mcpAuth.ts                  # expect ~:136

# CORRECTION 2: Item A (auth detail) needs NO new constructor plumbing — OAuthManager is ALREADY a
# field on AgentImpl/AgentDeps; auth-detail is wired by threading this.deps.oauthManager into
# buildAuthControl(). Confirm the field + the build site:
grep -n "oauthManager" packages/agents/src/api/agentImpl.ts | head            # expect a field ~:121 + import ~:25
grep -n "buildAuthControl" packages/agents/src/api/agentImpl.ts               # expect ~:431
grep -n "oauthManager" packages/agents/src/api/control/authControl.ts || echo "CONFIRMED: AuthControlDeps lacks oauthManager today (P11/P12 add a getOAuthManager closure)"
```

| Corrected assumption | Expected | Actual | Match? |
|---|---|---|---|
| `mcpAuth.ts` EXISTS (issue "no such file" is FALSE) | yes | | [ ] |
| mcpAuth flow: authenticate → restartServer → setTools | yes | | [ ] |
| `oauthManager` already a field on `AgentImpl` (`:121`) | yes | | [ ] |
| `buildAuthControl()` present (`:431`) — thread point | yes | | [ ] |
| `AuthControlDeps` lacks `oauthManager` today (added by P11/P12 as a closure) | yes | | [ ] |

## Type / Interface Verification — backing engines

Run and confirm each MATCHES the plan's assumptions:

```bash
set -o pipefail
# REQ-001 approval:
grep -n "getApprovalMode" packages/core/src/config/configBaseCore.ts        # expect ~:463
grep -n "setApprovalMode" packages/core/src/config/config.ts                # expect ~:401
grep -n "untrusted" packages/core/src/config/config.ts | head               # expect the throw ~:404
grep -nE "ApprovalMode" packages/agents/src/api/agent.ts                    # expect import :11 + re-export :387

# REQ-002 policy:
grep -n "getPolicyEngine" packages/core/src/config/configBaseCore.ts        # expect ~:475 (non-optional)
grep -nE "getRules|getDefaultDecision|isNonInteractive" packages/policy/src/policy-engine.ts   # expect :320/:329/:338
grep -nE "argsPattern" packages/policy/src/types.ts                         # expect RegExp field ~:35
grep -nE "export (enum|const enum) PolicyDecision" packages/policy/src/types.ts   # value enum

# REQ-003 tasks:
grep -n "getAsyncTaskManager" packages/core/src/config/config.ts            # expect ~:601 (returns | undefined)
grep -nE "getAllTasks|getRunningTasks|getTask\(|cancelTask" packages/core/src/services/asyncTaskManager.ts   # :77/:319/:273/:239
grep -n "abortController" packages/core/src/services/asyncTaskManager.ts    # expect AsyncTaskInfo.abortController? ~:28 (MUST be omitted from public view)

# REQ-004 hooks admin:
grep -n "getHookSystem" packages/core/src/config/config.ts                  # expect ~:755 (| undefined)
grep -n "getDisabledHooks" packages/core/src/config/config.ts               # expect ~:734
grep -n "setDisabledHooks" packages/core/src/config/configBase.ts           # expect ~:132
grep -nE "getRegistry|isInitialized" packages/core/src/hooks/hookSystem.ts  # expect :137/:158
grep -nE "getAllHooks|setHookEnabled|getHookName" packages/core/src/hooks/hookRegistry.ts   # :82/:89/:118
grep -nE "enabled" packages/core/src/hooks/hookRegistry.ts | head           # HookRegistryEntry.enabled ~:41
# current AgentHookControl members (must remain unchanged; admin is ADDITIVE):
grep -nE "onHookExecution|triggerSessionStart|triggerSessionEnd|clear" packages/agents/src/api/agent.ts

# REQ-005 auth detail (OAuthManager surface):
grep -nE "peekStoredToken|getHigherPriorityAuth|getAuthStatusWithBuckets|isOAuthEnabled|isAuthenticated" packages/providers/src/auth/oauth-manager.ts   # :243/:313/:395/:300/:199

# REQ-006 MCP OAuth:
grep -n "authenticate(" packages/mcp/src/auth/oauth-provider.ts | head      # MCPOAuthProvider.authenticate ~:874
grep -n "MCPOAuthProvider" packages/core/src/index.ts                       # re-exported from core barrel ~:498
grep -n "setTools(): Promise<void>" packages/core/src/core/clientContract.ts   # ~:77 (the refresh-parity target)
grep -n "resolveClient" packages/agents/src/api/agentImpl.ts                # ~:132
grep -nE "getMcpServers|getBlockedMcpServers|getPromptRegistry|getResourceRegistry" packages/core/src/config/configBaseCore.ts   # :436/:445/:403/:406
# current McpControl + Deps (refresh lacks setTools today; auth(server) is per-agent flag only):
grep -nE "McpControlDeps|isMcpAuthenticated|getManager|getToolRegistry|refresh|auth\(" packages/agents/src/api/control/mcpControl.ts | head

# REQ-007 tool keys:
grep -nE "getToolKeyStorage|class ToolKeyStorage" packages/core/src/tools/tool-key-storage.ts   # :81 / :109
grep -nE "saveKey|getKey|deleteKey|setKeyfilePath|getKeyfilePath|clearKeyfilePath" packages/core/src/tools/tool-key-storage.ts
grep -nE "getSupportedToolNames|getToolKeyEntry|isValidToolKeyName|maskKeyForDisplay" packages/tools/src/utils/tool-key-storage-types.ts   # :72/:62/.../:82
grep -nE "ToolKeyStorage|getToolKeyStorage|maskKeyForDisplay|getSupportedToolNames" packages/core/src/index.ts   # core-barrel re-exports ~:466-475
# auth.keys is a DIFFERENT surface (must stay distinct):
grep -nE "AgentAuthKeysControl|keys" packages/agents/src/api/agent.ts | head

# REQ-008 barrel + command map:
grep -nE "COMMAND_API_MAP|APP_SERVICE_SUBPATH|CommandApiMapping" packages/agents/src/app-services/command-api-map.ts | head
for c in "/policies" "/task" "/hooks" "/toolkey" "/toolkeyfile" "/approval-mode"; do
  n=$(grep -c "command: '$c'" packages/agents/src/app-services/command-api-map.ts || true)
  echo "COMMAND_API_MAP rows for $c = $n (expect 0 — all six ABSENT today)"
done
grep -nE "export \* |export type \*|AgentClientContract" packages/agents/src/api/index.ts | head
```

| Assumption | Expected | Actual | Match? |
|---|---|---|---|
| `getApprovalMode` (`configBaseCore.ts:463`) | yes | | [ ] |
| `setApprovalMode` throws in untrusted folder (`config.ts:401-404`) | yes | | [ ] |
| `ApprovalMode` imported (`agent.ts:11`) + re-exported (`:387`) | yes | | [ ] |
| `getPolicyEngine` non-optional (`configBaseCore.ts:475`) | yes | | [ ] |
| `PolicyEngine.getRules/getDefaultDecision/isNonInteractive` | yes | | [ ] |
| `PolicyRule.argsPattern` is a raw `RegExp` (project to `.source`) | yes | | [ ] |
| `getAsyncTaskManager(): … \| undefined` (`config.ts:601`) | yes | | [ ] |
| `AsyncTaskInfo.abortController?` exists (`:28`) — MUST be omitted from public view | yes | | [ ] |
| `getHookSystem(): … \| undefined`; `getDisabledHooks`; `setDisabledHooks` | yes | | [ ] |
| `HookSystem.getRegistry/isInitialized`; `HookRegistry.getAllHooks/setHookEnabled/getHookName` | yes | | [ ] |
| existing `AgentHookControl` members present (admin is additive) | yes | | [ ] |
| OAuthManager `peekStoredToken/getHigherPriorityAuth/getAuthStatusWithBuckets` | yes | | [ ] |
| `MCPOAuthProvider.authenticate` exists + re-exported from core barrel | yes | | [ ] |
| `AgentClientContract.setTools(): Promise<void>` (`:77`); `resolveClient` (`:132`) | yes | | [ ] |
| `McpControl.refresh()` lacks setTools today; `auth(server)` is per-agent flag | yes | | [ ] |
| `getToolKeyStorage()` + `ToolKeyStorage` methods; tool-key helpers; core-barrel re-exports | yes | | [ ] |
| `auth.keys` is a distinct provider-auth surface | yes | | [ ] |
| all six target commands ABSENT from `COMMAND_API_MAP` (count 0 each) | yes | | [ ] |

## Convention Verification (control-wiring + top-level delegation)

```bash
set -o pipefail
# Existing sub-controller interfaces to mirror (declared in agent.ts):
grep -nE "interface Agent(Tool|Mcp|Auth|Ide|Session|Profile|Hook)Control" packages/agents/src/api/agent.ts
# Existing readonly controller fields + ctor wiring + build* methods in AgentImpl:
grep -nE "readonly (profiles|tools|mcp|auth|ide|session|hooks)\b" packages/agents/src/api/agentImpl.ts
grep -nE "this\.(auth|mcp|ide|session|hooks)\s*=\s*this\.build" packages/agents/src/api/agentImpl.ts
grep -nE "private build(Auth|Mcp|Ide|Session|Hook)Control" packages/agents/src/api/agentImpl.ts
# Top-level delegation one-liners to mirror for approval (ephemeral pattern):
grep -nE "getEphemeralSetting|setEphemeralSetting|getEphemeralSettings|getConfig|getRuntimeId" packages/agents/src/api/agentImpl.ts | head
```

| Item | Expected | Status |
|---|---|---|
| 7 existing `Agent*Control` interfaces in `agent.ts` (mirror their shape) | yes | [ ] |
| readonly fields + ctor wiring + `build*Control()` methods in `agentImpl.ts` | yes | [ ] |
| ephemeral one-liner delegation pattern present (mirror for approval) | yes | [ ] |

## Boundary / Test-Infra Verification

```bash
set -o pipefail
ls packages/agents/src/api/__tests__/ | head
grep -nE "isSpec|endsWith\('.spec.ts'\)|@vybestack/llxprt-code-agents|internals.js" packages/agents/src/api/__tests__/boundary.spec.ts | head
# Confirm the non-breaking characterization test exists (we EXTEND it):
ls packages/agents/src/api/__tests__/*nonbreaking* 2>/dev/null || echo "NOTE: nonbreaking test path to confirm in P18"
# Stryker mutate glob covers src/api/** (new control files auto-included):
grep -nE "mutate" packages/agents/stryker.conf.json
# Canonical single-file run form smoke (MIN-1: capture real status):
EXISTING=$(ls packages/agents/src/api/__tests__/*.test.ts packages/agents/src/api/__tests__/*.spec.ts 2>/dev/null | head -1)
if [ -n "$EXISTING" ]; then
  npx vitest run "$EXISTING" > /tmp/p00a-canon.log 2>&1; CANON=$?
  tail -5 /tmp/p00a-canon.log
  [ "$CANON" -eq 0 ] || { echo "FAIL: canonical single-file run form did not succeed on a known spec"; exit 1; }
fi
echo "CANONICAL: npx vitest run <file>"
npm run typecheck >/dev/null 2>&1 && echo "typecheck baseline OK" || echo "typecheck baseline BROKEN — fix before starting"
```

| Item | Expected | Status |
|---|---|---|
| `boundary.spec.ts` scans only `*.spec.ts`; allows public root; forbids internals/deep | yes | [ ] |
| non-breaking characterization test located (extend in P18) | yes | [ ] |
| Stryker `mutate` covers `src/api/**/*.ts` | yes | [ ] |
| Canonical single-file form `npx vitest run <file>` works | yes | [ ] |
| Baseline `npm run typecheck` clean | yes | [ ] |

## Blocking Issues Found

[List any mismatch that requires plan modification BEFORE Phase 01.]

## Verification Gate

- [ ] All dependencies verified (zod, fast-check, @stryker-mutator/core, core/policy/providers deps)
- [ ] Both corrected issue assumptions confirmed (mcpAuth.ts exists; oauthManager already on deps)
- [ ] All backing-engine types match plan assumptions
- [ ] Control-wiring + top-level delegation conventions confirmed
- [ ] Boundary guard + Stryker glob + canonical test command confirmed
- [ ] Baseline typecheck clean

IF ANY CHECKBOX IS UNCHECKED: STOP and update the plan before proceeding.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P00a.md`

Contents (REQUIRED — the executor fills every field with REAL values, not placeholders):

```markdown
Phase: P00a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
