<!-- @plan:PLAN-20260622-COREAPIGAP.P20 @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Phase 20: Capability-Gap Integration Adequacy Driver

## Phase ID

`PLAN-20260622-COREAPIGAP.P20`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 19a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P19a.md`

## Requirements Implemented (Expanded)

### REQ-INT-001..004: CLI-parity capabilities are reachable on the PUBLIC-ROOT-ONLY path

**Full Text**: Each of the seven engine capabilities the CLI drives today (approval-mode, policy,
async-tasks, hooks-admin, auth-detail, MCP-OAuth/details, tool-keys) MUST be reachable on a real
`fromConfig`/harness-built `Agent` using ONLY the public root `@vybestack/llxprt-code-agents` — with
NO `agent.getConfig()` escape hatch and NO deep import. This is the EXECUTABLE form of the #1595
adequacy criterion.
**Behavior**:
- GIVEN: a real Agent built through the public path (FakeProvider, no MCP manager, no real OAuth, no
  async manager) — exactly the surface #1595 will hold
- WHEN: the driver calls each capability's public method
- THEN: every method is reachable directly on `agent` (or its sub-controllers) and returns a
  correctly-typed, sane result for a safe call — including the approval untrusted-folder throw — and
  NONE of it requires `agent.getConfig()`
**Why This Matters**: the per-component `.behavior.test.ts` files prove each control's DEEP behavior
(T17-exempt, may deep-import). THIS phase proves ADEQUACY/REACHABILITY across the whole new surface
from the boundary the CLI actually imports from. If a capability is only reachable via `getConfig()`
or a deep import, this driver fails — and #1595 would stall. It is the single most important
acceptance artifact of the plan.

## Background — boundary facts (verified)

- The driver is a `.spec.ts`, so it is **T17-ENFORCED** by `boundary.spec.ts`: it may import ONLY the
  public root `@vybestack/llxprt-code-agents`, `node:*`, `vitest`, `fast-check`, and relative paths
  that resolve WITHIN `src/` (which includes `./helpers/agentHarness.js`). It MUST NOT import
  `./internals.js`, any other `@vybestack/llxprt-code-agents/<subpath>`, `/dist/`, or any deep
  `core/`, `providers/`, `tools/`, `auth/`, `settings/`, `ide-integration/`, `policy/` path. This is
  precisely the #1595 import boundary, so the driver IS the adequacy proof.
- `buildAgent('plain-text.jsonl', Partial<AgentConfig>)` (`__tests__/helpers/agentHarness.ts:79`)
  builds a real Agent over the FakeProvider and returns `{ agent, cleanup }`. `folderTrust: false`
  maps (agentConfig.adapter) to an UNTRUSTED Config, which makes `setApprovalMode(non-default)` throw
  the real untrusted-folder error — drivable through the public harness with ZERO mocking.
- Enum VALUES (`ApprovalMode`, `PolicyDecision`) and the projected TYPES are now (post-P17) importable
  from the public root, so the driver types its assertions from the public root too.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/capabilityGaps.integration.spec.ts` — marker
  `@plan:PLAN-20260622-COREAPIGAP.P20 @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004`.
  Imports (PUBLIC-ROOT ONLY for production symbols):
  ```ts
  import { describe, expect, it, afterEach } from 'vitest';
  import * as fc from 'fast-check';
  import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-agents';
  import type {
    AgentTaskInfo, PolicyRuleView, HookInfo, AuthProviderDetail,
    AuthBucketStatus, McpDetailStatus, ToolKeyInfo, ToolKeyStatus,
  } from '@vybestack/llxprt-code-agents';
  import { buildAgent } from './helpers/agentHarness.js';
  ```
  It MUST exercise EACH capability on the public agent (build via harness; `afterEach` cleanup). Use
  SAFE, deterministic calls (this is reachability/adequacy, not deep-state behavior):
  1. **Approval (REQ-INT-001):** trusted agent → `agent.getApprovalMode()` returns an `ApprovalMode`;
     `agent.setApprovalMode(ApprovalMode.YOLO)` then `getApprovalMode() === ApprovalMode.YOLO`.
     Separately build an UNTRUSTED agent (`buildAgent('plain-text.jsonl', { folderTrust: false })`)
     and assert `() => agent.setApprovalMode(ApprovalMode.YOLO)` throws with message matching
     `/untrusted folder/i` (the delegated, uncaught throw).
  2. **Policy (REQ-INT-002):** `agent.policy.getRules()` returns a readonly `PolicyRuleView[]` (each
     element, if any, has a string `toolName` and a `decision` ∈ `Object.values(PolicyDecision)`);
     `agent.policy.getDefaultDecision()` ∈ `Object.values(PolicyDecision)`;
     `agent.policy.isNonInteractive()` is a boolean.
  3. **Tasks (REQ-INT-002):** on a fresh agent with no submitted tasks:
     `agent.tasks.list()` and `listRunning()` are arrays; `agent.tasks.get('nonexistent')` is
     `undefined`; `agent.tasks.cancel('nonexistent')` is `false`; `agent.tasks.cancelAllRunning()` is
     `0`. (Undefined-safe even if no async manager exists.) If any element is present, assert it is a
     projected `AgentTaskInfo` WITHOUT an `abortController` key
     (`expect('abortController' in task).toBe(false)`).
  4. **Hooks-admin (REQ-INT-003):** `agent.hooks.listHooks()` returns a `HookInfo[]`;
     disabled-set round-trip: `agent.hooks.setDisabledHooks(['demo-hook'])` then
     `agent.hooks.getDisabledHooks()` contains `'demo-hook'`; `agent.hooks.enable('demo-hook')` then
     `getDisabledHooks()` no longer contains it. (Undefined-safe if no hook system: `listHooks()` →
     `[]`, setters are no-ops — assert no throw.)
  5. **Auth-detail (REQ-INT-003):** `agent.auth.detailedStatus('openai')` resolves to an
     `AuthProviderDetail` (a `authenticated` boolean field); `agent.auth.getHigherPriorityAuth('openai')`
     resolves to `string | null`; `agent.auth.listBucketStatuses('openai')` resolves to a readonly
     `AuthBucketStatus[]`. Masked invariant: the JSON-serialized result contains no field literally
     named `token`/`accessToken`/`refreshToken` carrying a long secret (see property below).
  6. **MCP (REQ-INT-004):** `agent.mcp.status()` resolves (idle when no manager);
     `agent.mcp.details()` resolves to an `McpDetailStatus` (a `servers` array, empty when no
     manager); `agent.mcp.authenticate('nonexistent-server')` resolves to a status with
     `authenticated === false` (unknown server, undefined-safe — no throw).
  7. **Tool-keys (REQ-INT-004):** `agent.tools.keys.supported()` returns a non-empty readonly
     `ToolKeyInfo[]` (each with a string `toolName`); assert `typeof agent.tools.keys.save`,
     `agent.tools.keys.status`, `agent.tools.keys.delete`, `agent.tools.keys.setKeyFile`,
     `agent.tools.keys.getKeyFile` are all `'function'` (reachability). Do NOT mutate the real
     keyring; a read-only `agent.tools.keys.status('exa')` may be called only to assert the result
     has a boolean `hasKey` and (when present) a `maskedKey` that is NOT a full-length raw secret.
  - **Adequacy assertion (the #1595 keystone):** across the whole file, NONE of the above used
    `agent.getConfig()`. Add one explicit `it('exercises every capability without getConfig escape')`
    that asserts each capability ENTRY is a function reachable directly on the public agent surface:
    `typeof agent.setApprovalMode === 'function'`, `typeof agent.policy.getRules === 'function'`,
    `typeof agent.tasks.list === 'function'`, `typeof agent.hooks.listHooks === 'function'`,
    `typeof agent.auth.detailedStatus === 'function'`, `typeof agent.mcp.details === 'function'`,
    `typeof agent.tools.keys.supported === 'function'`.
  - **≥30% property-based, MIN-2 distinct cases:**
    1. Property over `fc.constantFrom(...Object.values(ApprovalMode))` on a TRUSTED agent: for any
       mode, `setApprovalMode(mode)` then `getApprovalMode() === mode` (all three modes are allowed
       in a trusted folder; round-trip invariant).
    2. Property over `fc.uniqueArray(fc.string({minLength:1}), {maxLength:5})` for hook names:
       `setDisabledHooks(names)` then `getDisabledHooks()` set-equals the input (round-trip);
       restore with `setDisabledHooks([])` after.
    3. (Masked invariant) Property over `fc.constantFrom('openai','anthropic','gemini')`:
       `await detailedStatus(p)` serialized via `JSON.stringify` contains no substring of length ≥ 20
       that looks like a raw bearer token (assert the masked-only contract — no long opaque secret).
  - NO mock theater (`vi.fn`/`vi.spyOn`/`mockResolvedValue`/`mockReturnValue`/`toHaveBeenCalled`), NO
    reverse tests (`not.toThrow()`), NO `.skip`, no `any`, and NO `agent.getConfig()` anywhere.

### Constraints

- PUBLIC-ROOT ONLY for all production symbols. The ONLY non-public import permitted is the relative
  `./helpers/agentHarness.js` (fixture plumbing, within `src/`, T17-allowed).
- Every assertion must be on REAL results from a REAL Agent built through the public path — no fakes
  injected at the control layer (that is the per-component behavior tests' job).
- The file MUST contain zero occurrences of the string `getConfig` (gate-enforced).

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/capabilityGaps.integration.spec.ts
test -f "$F"

# 1. PUBLIC-ROOT-ONLY: no deep import, no internals, no other subpath. (Pre-empts the T17 guard.)
if grep -nE "from '[^']*(/src/|core/|providers/|tools/|auth/|settings/|ide-integration/|policy/)" "$F" \
   | grep -vE "from '@vybestack/llxprt-code-agents'"; then echo "FAIL: deep import in adequacy driver"; exit 1; fi
if grep -nE "internals(\.js)?'|/dist/" "$F"; then echo "FAIL: internals/dist import"; exit 1; fi
# The only allowed non-public, non-stdlib import is ./helpers/agentHarness.js.
grep -qE "from './helpers/agentHarness\.js'" "$F" || { echo "FAIL: must build via the public harness"; exit 1; }
# 2. The #1595 keystone: zero getConfig escape.
if grep -nE "getConfig" "$F"; then echo "FAIL: adequacy driver used the getConfig escape hatch"; exit 1; fi
# 3. Every capability entry exercised by name.
for SYM in "agent.getApprovalMode" "agent.setApprovalMode" "agent.policy.getRules" "agent.tasks.list" \
           "agent.hooks.listHooks" "agent.hooks.setDisabledHooks" "agent.auth.detailedStatus" \
           "agent.mcp.details" "agent.tools.keys.supported"; do
  grep -qF "$SYM" "$F" || { echo "FAIL: capability not exercised: $SYM"; exit 1; }
done
# 4. Untrusted-folder throw driven through the public harness.
grep -qE "folderTrust: false" "$F" || { echo "FAIL: untrusted-folder path not driven"; exit 1; }
grep -qiE "untrusted folder" "$F" || { echo "FAIL: untrusted throw not asserted"; exit 1; }
# 5. abortController projected-out assertion present.
grep -qE "abortController" "$F" || { echo "FAIL: must assert AgentTaskInfo omits abortController"; exit 1; }

# 6. RED capture happens in the worker flow BEFORE controllers are wired through the harness; here
#    (post-impl) it must be GREEN. Run the driver + the T17 boundary guard (proves it's clean).
npx vitest run "$F" 2>&1 | tail -40
npx vitest run packages/agents/src/api/__tests__/boundary.spec.ts 2>&1 | tail -20
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p20_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p20_all.log; exit 1; }
npm run typecheck 2>&1 | tail -15

# 7. Property gate (≥30%, MIN-2).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }

# 8. Discipline.
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)|toThrow\('NotYetImplemented'\)|\.skip\(|xit\(|xdescribe\(" "$F"; then echo "FAIL: reverse/skip"; exit 1; fi
echo "PASS: P20 adequacy driver green."
```

> RED note (worker runs this BEFORE all impl is wired, or on a scratch branch with one controller
> un-wired): `npx vitest run "$F"` MUST fail with a BEHAVIORAL error (a missing method TypeError or an
> AssertionError on a real result), NOT `Cannot find module`. Since this phase runs after P19a (all
> controllers wired), the canonical state here is GREEN; capture a one-line note confirming the file
> was authored test-first against the public surface.

### Semantic Verification Checklist

- [ ] All seven capabilities exercised on a REAL public-root-built Agent; each entry is a function on
      the public surface.
- [ ] Untrusted-folder throw driven through the public harness (delegated, uncaught).
- [ ] `AgentTaskInfo` omits `abortController`; auth output masked (no long raw secret).
- [ ] ZERO `getConfig`, zero deep import, zero internals — T17 boundary guard green on the file.
- [ ] ≥30% property (MIN-2); no mock theater / reverse tests.

## Success Criteria

- The public-root-only adequacy driver is green, proving every #2143 capability is reachable for
  #1595 without an escape hatch.

## Failure Recovery

- If a capability is NOT reachable from the public root (forces `getConfig`/deep import), STOP and
  reopen the owning component phase (barrel P17 for a missing re-export; the control phase for a
  missing method). Never add a `getConfig` escape to make this pass.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P20.md`

```markdown
Phase: P20
Completed: YYYY-MM-DD HH:MM
Files Created: [capabilityGaps.integration.spec.ts with line count]
Files Modified: none
Tests Added: [count]
Verification: [paste actual output incl. driver + boundary.spec.ts green]
Semantic Assessment: [one-line: all 7 caps reachable via public root only, no getConfig escape]
```
