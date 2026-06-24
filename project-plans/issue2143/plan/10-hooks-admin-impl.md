<!-- @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 -->
# Phase 10: Hooks Administration — Implementation (GREEN)

## Phase ID

`PLAN-20260622-COREAPIGAP.P10`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 09 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P09.md`
- Pseudocode: `project-plans/issue2143/analysis/pseudocode/hooks-admin.md`
  (listHooks lines 1-19; getDisabledHooks 30-32; setDisabledHooks 40-42; disable 50-54; enable 57-61)

## Purpose

Make the P09 behavioral RED suite pass by EXTENDING `AgentHookControl` (interface) and `HookControl`
(impl) with administration methods. Existing members are untouched (REQ-009 non-breaking). No new
wiring: `HookControl` already holds `this.deps.config`.

## Implementation Tasks

### Files to Modify

#### 1. `packages/agents/src/api/agent.ts` — extend the interface + add the projected type

Add `HookInfo` near the other projected public types, and extend `AgentHookControl`:

```ts
// @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004
export interface HookInfo {
  readonly name: string;
  readonly eventName: string;
  readonly enabled: boolean;
  readonly source?: string;
}
```

Extend the existing interface (do NOT remove the existing four members):

```ts
export interface AgentHookControl {
  onHookExecution(
    cb: (req: HookExecutionRequest, resp: HookExecutionResponse) => void,
  ): Unsubscribe;
  triggerSessionStart(): Promise<void>;
  triggerSessionEnd(): Promise<void>;
  clear(): void;
  // @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004
  listHooks(): readonly HookInfo[];
  getDisabledHooks(): readonly string[];
  setDisabledHooks(names: readonly string[]): void;
  enable(name: string): void;
  disable(name: string): void;
}
```

#### 2. `packages/agents/src/api/control/hooks.ts` — implement the five methods

Add to the `HookControl` class body (it already has `this.deps.config`). Follow the pseudocode
line-by-line.

```ts
// @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 1-19
listHooks(): readonly HookInfo[] {
  const system = this.deps.config.getHookSystem();
  if (!system) return [];
  if (!system.isInitialized()) return [];
  const registry = system.getRegistry();
  return registry.getAllHooks().map((entry) => ({
    name: registry.getHookName(entry),
    eventName: String(entry.eventName),
    enabled: entry.enabled,
    source: entry.source === undefined ? undefined : String(entry.source),
  }));
}

// @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 30-32
getDisabledHooks(): readonly string[] {
  return [...this.deps.config.getDisabledHooks()];
}

// @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 40-42
setDisabledHooks(names: readonly string[]): void {
  this.deps.config.setDisabledHooks([...names]);
}

// @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 50-54
disable(name: string): void {
  const current = this.deps.config.getDisabledHooks();
  if (current.includes(name)) return;
  this.deps.config.setDisabledHooks([...current, name]);
}

// @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004 @pseudocode lines 57-61
enable(name: string): void {
  const current = this.deps.config.getDisabledHooks();
  this.deps.config.setDisabledHooks(current.filter((n) => n !== name));
}
```

Add the `HookInfo` import to the existing `import type { AgentHookControl, ... } from '../agent.js';`
group. `getHookSystem`/`getDisabledHooks`/`setDisabledHooks` are already on the imported `Config` type.

### Constraints

- Do NOT modify the P09 test file.
- Existing `AgentHookControl` members remain byte-identical (REQ-009).
- No new wiring in `AgentImpl` (deps.config already present); `buildHookControl()` (agentImpl.ts:391)
  is unchanged.
- No cached registry/disabled-set state — read `this.deps.config` every call (R-DELEGATE).
- `listHooks()` guards both `undefined` system AND `!isInitialized()` (registry access only after init).
- Return fresh array copies (`[...]`) — never hand out the engine's internal arrays.

## Verification Commands

```bash
set -o pipefail
set -e
A=packages/agents/src/api/agent.ts
H=packages/agents/src/api/control/hooks.ts
F=packages/agents/src/api/__tests__/hookAdmin.behavior.test.ts

# Interface extended, existing members preserved.
grep -qE "listHooks\(\): readonly HookInfo\[\]" "$A" || { echo "FAIL: listHooks missing on interface"; exit 1; }
grep -qE "triggerSessionStart\(\): Promise<void>" "$A" || { echo "FAIL: existing member removed"; exit 1; }

# Impl present + delegates + markers.
grep -qE "@pseudocode lines 1-19" "$H" || { echo "FAIL: listHooks marker missing"; exit 1; }
grep -qE "getHookSystem\(\)" "$H" || { echo "FAIL: not delegating to config hook system"; exit 1; }
grep -qE "isInitialized\(\)" "$H" || { echo "FAIL: missing isInitialized guard"; exit 1; }
grep -qE "setDisabledHooks\(\[\.\.\." "$H" || { echo "FAIL: setDisabledHooks not fresh-copying"; exit 1; }

# No cached field for hooks admin.
if grep -nE "private .*(disabledHooks|hookCache|cachedHooks)\b" "$H"; then echo "FAIL: cached hook state"; exit 1; fi

# Tests now GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run "$F" > /tmp/p10_green.log 2>&1 || { echo "FAIL: P09 suite not green"; tail -40 /tmp/p10_green.log; exit 1; }

# Whole control dir still green (non-breaking).
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p10_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p10_all.log; exit 1; }

npm run typecheck 2>&1 | tail -15
npm run lint 2>&1 | tail -15
```

### Deferred Implementation Detection (MANDATORY — scoped to changed lines)

```bash
set -o pipefail
set -e
for F in packages/agents/src/api/agent.ts packages/agents/src/api/control/hooks.ts; do
  git diff HEAD -- "$F" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $F"; exit 1; } || true
done
echo "PASS: no deferred markers in changed lines."
```

## Success Criteria

- P09 suite GREEN; whole `__tests__` dir GREEN; typecheck + lint clean.
- Existing `AgentHookControl` members unchanged; five admin methods added and delegating.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts packages/agents/src/api/control/hooks.ts`

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P10.md` (same field schema as P08).
