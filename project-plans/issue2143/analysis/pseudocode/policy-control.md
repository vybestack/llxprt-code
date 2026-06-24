<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-002 -->
# Pseudocode: Policy Control (read-only `agent.policy`)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G2 — `AgentPolicyControl` (new sub-controller, read-only)
Source of truth: specification.md REQ-002; domain-model.md R-POLICY-SNAPSHOT, R-ARGSPATTERN-STRING.
Analysis only — NO implementation code is written in this document.

---

## Interface Contracts

```typescript
// Declared in packages/agents/src/api/agent.ts alongside AgentMcpControl/AgentAuthControl (:223-321)
interface AgentPolicyControl {
  getRules(): readonly PolicyRuleView[];
  getDefaultDecision(): PolicyDecision;
  isNonInteractive(): boolean;
}

// Added to the Agent interface: `readonly policy: AgentPolicyControl;`

// Projected public type (specification.md Data Schemas) — argsPattern is a STRING, never RegExp.
interface PolicyRuleView {
  readonly priority?: number;            // mirror core PolicyRule.priority? (types.ts:46)
  readonly toolName?: string;            // mirror core PolicyRule.toolName? (types.ts:29)
  readonly decision: PolicyDecision;     // VALUE enum, re-exported from core barrel (index.ts:17)
  readonly argsPattern?: string;         // = rule.argsPattern?.source
  readonly source?: string;
}
```

### Dependencies (NEVER stubbed)

```typescript
// packages/agents/src/api/control/policyControl.ts
export interface PolicyControlDeps {
  // Resolves the live PolicyEngine from the bound Config PER CALL (never cached).
  // config.getPolicyEngine() is NON-optional (configBaseCore.ts:475) — but the closure
  // form keeps the controller decoupled from Config and uniform with the other controls.
  readonly getEngine: () => PolicyEngine;   // PolicyEngine from @vybestack/llxprt-code-policy
}
// Wired by AgentImpl.buildPolicyControl(): getEngine: () => this.deps.config.getPolicyEngine()
```

`PolicyEngine`, `PolicyDecision`, and `PolicyRule` come from `@vybestack/llxprt-code-policy`
(an agents dependency, package.json:44) and are re-exported through the core barrel
(`core/src/index.ts`: PolicyEngine:15, PolicyDecision:17, PolicyRule:19).

---

## Numbered Pseudocode

### METHOD getRules(): readonly PolicyRuleView[]

```
1: // @pseudocode REQ-002.1 — read-only snapshot; project argsPattern RegExp → .source string
2: METHOD getRules() RETURNS readonly PolicyRuleView[]
3:   SET engine = this.deps.getEngine()
4:   SET rules = engine.getRules()                      // readonly PolicyRule[] (policy-engine.ts:320)
5:   SET out = empty array
6:   FOR EACH rule IN rules
7:     SET view = {
8:       priority: rule.priority,
9:       toolName: rule.toolName,
10:      decision: rule.decision,
11:      // R-ARGSPATTERN-STRING: project RegExp to its .source; undefined stays undefined
12:      argsPattern: IF rule.argsPattern IS DEFINED THEN rule.argsPattern.source ELSE undefined,
13:      source: rule.source,
14:    }
15:    APPEND view TO out
16:  END FOR
17:  RETURN out                                          // a fresh snapshot array (not the live list)
18: END METHOD
```

### METHOD getDefaultDecision(): PolicyDecision

```
30: // @pseudocode REQ-002.2 — direct read-through
31: METHOD getDefaultDecision() RETURNS PolicyDecision
32:   RETURN this.deps.getEngine().getDefaultDecision()  // policy-engine.ts:329
33: END METHOD
```

### METHOD isNonInteractive(): boolean

```
40: // @pseudocode REQ-002.3 — direct read-through
41: METHOD isNonInteractive() RETURNS boolean
42:   RETURN this.deps.getEngine().isNonInteractive()    // policy-engine.ts:338
43: END METHOD
```

> REQ-002.4: rule MUTATION is OUT OF SCOPE — no `addRule`/`setRules`/`removeRule` on this controller.

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real symbol / call | File:line (verified) |
|---|---|---|
| 3 | `Config.getPolicyEngine(): PolicyEngine` (non-optional) | `packages/core/src/config/configBaseCore.ts:475` |
| 4 | `PolicyEngine.getRules(): readonly PolicyRule[]` | `packages/policy/src/policy-engine.ts:320` |
| 12 | `PolicyRule.argsPattern?: RegExp` → `.source` | `packages/policy/src/types.ts:35` (argsPattern); CLI consumes `.source` at `policiesCommand.ts:111` |
| 32 | `PolicyEngine.getDefaultDecision(): PolicyDecision` | `packages/policy/src/policy-engine.ts:329` |
| 42 | `PolicyEngine.isNonInteractive(): boolean` | `packages/policy/src/policy-engine.ts:338` |
| n/a | `PolicyDecision` enum (ALLOW/DENY/ASK_USER) | `packages/policy/src/types.ts:7`; core barrel `index.ts:17` |
| n/a (wiring) | `buildPolicyControl()` near other builders | `agentImpl.ts:431-510`; field near `:194-200`; ctor assign near `:328-332` |

CLI consumer this unblocks (#1595): `packages/cli/src/ui/commands/policiesCommand.ts`
(`getPolicyEngine:60`, `getRules:61`, `argsPattern.source:110-111`, `getDefaultDecision:125`,
`isNonInteractive:128`).

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: return `engine.getRules()` directly (leaks the live array + raw `RegExp`
  `argsPattern`).
  [OK] DO: build a fresh `PolicyRuleView[]` snapshot with `argsPattern` as `.source` string
  (R-POLICY-SNAPSHOT, R-ARGSPATTERN-STRING).
- [ERROR] DO NOT: expose a `RegExp` on the public type (not JSON-safe for non-TS consumers).
  [OK] DO: project to `argsPattern?: string`.
- [ERROR] DO NOT: cache the engine or the rules array on the controller.
  [OK] DO: resolve `this.deps.getEngine()` per call (R-DELEGATE).
- [ERROR] DO NOT: add rule mutation methods.
  [OK] DO: keep the controller strictly read-only (REQ-002.4).
- [ERROR] DO NOT: coerce a missing `argsPattern` to `""`.
  [OK] DO: keep it `undefined` when the rule has no pattern.

---

## Behavior Decision Table

| GIVEN | getRules() | getDefaultDecision() | isNonInteractive() |
|---|---|---|---|
| engine with 0 rules | `[]` | engine default decision | engine flag |
| rule `{priority:0.5, toolName:"run_shell_command", decision:DENY, argsPattern:/"command":"npm test"/, source:"user"}` | one view with `argsPattern === '"command":"npm test"'` (string) | — | — |
| rule with no `argsPattern` | view's `argsPattern === undefined` | — | — |
| engine default = ASK_USER | — | `ASK_USER` | — |
| engine non-interactive = true | — | — | `true` |
