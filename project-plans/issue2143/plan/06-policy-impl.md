<!-- @plan:PLAN-20260622-COREAPIGAP.P06 @requirement:REQ-002 -->
# Phase 06: Policy Control (read-only) — Implementation

## Phase ID

`PLAN-20260622-COREAPIGAP.P06`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 05 completed (PASS, suite RED)
- Verification: `test -f project-plans/issue2143/.completed/P05.md`
- Pseudocode: `analysis/pseudocode/policy-control.md` (getRules 1-18; getDefaultDecision 30-33; isNonInteractive 40-43)

## Requirements Implemented (Expanded)

### REQ-002 / .1 / .2 / .3 / .4

Add the `AgentPolicyControl` interface + projected `PolicyRuleView` type to `agent.ts`, implement
`PolicyControl` in a new `control/policyControl.ts`, and wire `readonly policy` into `AgentImpl`.
See Phase 05 GIVEN/WHEN/THEN.

## Implementation Tasks

### Files to Modify / Create

1. `packages/agents/src/api/agent.ts` — add the projected type + interface alongside the other
   control interfaces (`AgentMcpControl`/`AgentAuthControl` region, `:223-321`), and add the readonly
   field to the `Agent` interface in the controls block (after `readonly hooks: AgentHookControl;`,
   currently `agent.ts:357`):

   ```typescript
   /**
    * Read-only projection of a policy rule (REQ-002.1). `argsPattern` is the
    * RegExp source STRING (JSON-safe), never a RegExp.
    * @plan:PLAN-20260622-COREAPIGAP.P06
    * @requirement:REQ-002
    */
   export interface PolicyRuleView {
     readonly priority?: number;
     readonly toolName?: string;
     readonly decision: PolicyDecision;
     readonly argsPattern?: string;
     readonly source?: string;
   }

   /**
    * Read-only inspection of the engine policy (REQ-002).
    * @plan:PLAN-20260622-COREAPIGAP.P06
    * @requirement:REQ-002
    */
   export interface AgentPolicyControl {
     getRules(): readonly PolicyRuleView[];
     getDefaultDecision(): PolicyDecision;
     isNonInteractive(): boolean;
   }
   ```

   - Add `readonly policy: AgentPolicyControl;` to the `Agent` interface controls block.
   - Import `PolicyDecision` (VALUE — used in the type position here but it is an enum) and the
     `PolicyRule`/`PolicyEngine` types as needed for the control file (see below). In `agent.ts` only
     the TYPE `PolicyDecision` is referenced by `PolicyRuleView`/`AgentPolicyControl`; use
     `import type { PolicyDecision } from '@vybestack/llxprt-code-core';` (or the existing core type
     import style in this file).

2. `packages/agents/src/api/control/policyControl.ts` — NEW. Mirror `control/ideControl.ts` structure
   (header markers, `Deps` interface, class implementing the agent interface). Follow the pseudocode
   EXACTLY:

   ```typescript
   /**
    * @plan:PLAN-20260622-COREAPIGAP.P06
    * @requirement:REQ-002
    */
   import type { AgentPolicyControl, PolicyRuleView } from '../agent.js';
   import {
     type PolicyEngine,
     type PolicyDecision,
   } from '@vybestack/llxprt-code-core';

   export interface PolicyControlDeps {
     readonly getEngine: () => PolicyEngine;
   }

   export class PolicyControl implements AgentPolicyControl {
     constructor(private readonly deps: PolicyControlDeps) {}

     /** @requirement:REQ-002 @pseudocode lines 1-18 */
     getRules(): readonly PolicyRuleView[] {
       const engine = this.deps.getEngine();
       const rules = engine.getRules();
       const out: PolicyRuleView[] = [];
       for (const rule of rules) {
         out.push({
           priority: rule.priority,
           toolName: rule.toolName,
           decision: rule.decision,
           ...(rule.argsPattern !== undefined
             ? { argsPattern: rule.argsPattern.source }
             : {}),
           ...(rule.source !== undefined ? { source: rule.source } : {}),
         });
       }
       return out;
     }

     /** @requirement:REQ-002 @pseudocode lines 30-33 */
     getDefaultDecision(): PolicyDecision {
       return this.deps.getEngine().getDefaultDecision();
     }

     /** @requirement:REQ-002 @pseudocode lines 40-43 */
     isNonInteractive(): boolean {
       return this.deps.getEngine().isNonInteractive();
     }
   }
   ```

   - GROUND TRUTH (verified `packages/policy/src/types.ts`): `PolicyRule` is
     `{ name?: string; toolName?: string; argsPattern?: RegExp; decision: PolicyDecision;
     priority?: number; allowRedirection?: boolean; source?: string }`. BOTH `priority` (`:46`) and
     `toolName` (`:29`) are OPTIONAL, and `decision` is the only REQUIRED field. The repo does NOT set
     `exactOptionalPropertyTypes`, but `strict` is on, so a required `priority: number` field CANNOT
     receive `rule.priority` (type `number | undefined`). Therefore `PolicyRuleView` MUST mirror
     core's optionality: `priority?`, `toolName?` (and keep `argsPattern?`, `source?`). Project each
     field FAITHFULLY — copy `rule.priority`/`rule.toolName` through as-is (do NOT coerce a missing
     value to `0`/`'*'`/any placeholder; the CLI consumer already renders undefined via `?? 0` /
     `?? '*'` at `policiesCommand.ts:107/106`). Do NOT invent fields. `decision` stays required.

3. `packages/agents/src/api/agentImpl.ts`:
   - Add `readonly policy: PolicyControl;` to the controls field block (near `:194-200`).
   - In the ctor controls-assignment block (near `:328-332`), add `this.policy = this.buildPolicyControl();`.
   - Add the builder near the other `build*Control()` methods (e.g. after `buildMcpControl`, `:476-482`):

     ```typescript
     /**
      * @plan:PLAN-20260622-COREAPIGAP.P06
      * @requirement:REQ-002
      */
     private buildPolicyControl(): PolicyControl {
       const policyDeps: PolicyControlDeps = {
         getEngine: () => this.deps.config.getPolicyEngine(),
       };
       return new PolicyControl(policyDeps);
     }
     ```
   - Import `PolicyControl` + `PolicyControlDeps` from `./control/policyControl.js` (match the other
     control imports at the top of `agentImpl.ts`).

### Constraints

- Follow pseudocode line-by-line; cite `@pseudocode lines 1-18 / 30-33 / 40-43`.
- `getRules` MUST build a fresh snapshot array and project `argsPattern` to `.source` (undefined stays
  undefined). NEVER return `engine.getRules()` directly.
- Resolve `getEngine()` per call; do NOT cache the engine or rules (R-DELEGATE).
- No rule-mutation methods (REQ-002.4). No `RegExp` on the public type.
- Do NOT modify Phase 05 tests.

## Verification Commands

```bash
set -o pipefail
set -e
npx vitest run packages/agents/src/api/__tests__/policyControl.behavior.test.ts
npm run typecheck

# New control file exists and delegates (BLOCKING).
test -f packages/agents/src/api/control/policyControl.ts
grep -qE "getEngine\(\)\.getRules\(\)" packages/agents/src/api/control/policyControl.ts || { echo "FAIL: getRules not delegating"; exit 1; }
grep -qE "getEngine\(\)\.getDefaultDecision\(\)" packages/agents/src/api/control/policyControl.ts || { echo "FAIL: getDefaultDecision not delegating"; exit 1; }
grep -qE "getEngine\(\)\.isNonInteractive\(\)" packages/agents/src/api/control/policyControl.ts || { echo "FAIL: isNonInteractive not delegating"; exit 1; }

# argsPattern projected to .source string (BLOCKING — no raw RegExp on the view).
grep -qE "argsPattern\.source" packages/agents/src/api/control/policyControl.ts || { echo "FAIL: argsPattern not projected to .source"; exit 1; }
# Must NOT return the live engine array directly.
if grep -nE "return[[:space:]]+(engine|this\.deps\.getEngine\(\))\.getRules\(\)" packages/agents/src/api/control/policyControl.ts; then
  echo "FAIL: getRules returns the live engine array (must snapshot)"; exit 1
fi

# Wiring present (BLOCKING).
grep -qE "this\.policy = this\.buildPolicyControl\(\)" packages/agents/src/api/agentImpl.ts || { echo "FAIL: policy not wired in ctor"; exit 1; }
grep -qE "readonly policy: PolicyControl;" packages/agents/src/api/agentImpl.ts || { echo "FAIL: policy field missing"; exit 1; }
grep -qE "readonly policy: AgentPolicyControl;" packages/agents/src/api/agent.ts || { echo "FAIL: Agent.policy interface field missing"; exit 1; }

# No rule mutation on the controller (REQ-002.4).
if grep -nE "(addRule|removeRule|setRules)\b" packages/agents/src/api/control/policyControl.ts; then echo "FAIL: rule mutation present"; exit 1; fi

# Pseudocode markers.
grep -q "@pseudocode lines 1-18" packages/agents/src/api/control/policyControl.ts || { echo "FAIL: getRules pseudocode marker missing"; exit 1; }
```

### Deferred Implementation Detection (MANDATORY — scoped to CHANGED + NEW files, MIN-3)

```bash
set -o pipefail
NEW=packages/agents/src/api/control/policyControl.ts
if grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)" "$NEW"; then echo "FAIL: deferred marker in new control"; exit 1; fi
for FILE in packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts; do
  if git diff HEAD -- "$FILE" | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)"; then
    echo "FAIL: deferred marker in changed lines of $FILE"; exit 1
  fi
done
echo "PASS: no deferred markers."
```

### Semantic Verification Checklist

- [ ] Phase 05 tests pass (T4/T4b/T6 + both PROPs).
- [ ] `getRules` snapshots + projects `argsPattern`→`.source`; `undefined` preserved.
- [ ] Delegates per call (no cache); no mutation methods; no `RegExp` on public type.
- [ ] Wired via `buildPolicyControl`; pseudocode cited; typecheck clean.

## Success Criteria

- Policy tests green; control file + interface + wiring in place; snapshot/projection correct.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts` and
  `rm packages/agents/src/api/control/policyControl.ts`; re-implement from pseudocode.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P06.md`

```markdown
Phase: P06
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
ssment]
```
