<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-008 -->
# Pseudocode: COMMAND_API_MAP rows (`app-services/command-api-map.ts`)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G8b — add the 6 missing CLI slash-command → Agent-API-target rows so the canonical
map documents how #1595 reaches each newly-exposed capability.
Source of truth: specification.md REQ-008; domain-model.md R-MAP-VALID.
Analysis only — NO implementation code is written in this document.

> The 6 target commands (`/policies`, `/task`, `/hooks`, `/toolkey`, `/toolkeyfile`,
> `/approval-mode`) are ALL currently ABSENT from `COMMAND_API_MAP` (verified: count 0 each).
> Each maps to a NEW live Agent method path → `kind: 'runtime'` (NOT subpath/cli-local). Adding
> `runtime` rows is SAFE under the boundary spec (`app-service-boundary.spec.ts`): its invariants
> only require (a) every row has a valid kind, (b) the REQUIRED_DURABLE subpath set is present +
> classified subpath, (c) unique command names — completeness is NOT enforced, and `runtime` rows
> need no subpath import.

---

## Interface Contracts

```typescript
// CommandApiMapping (app-services/types.ts):
interface CommandApiMapping {
  readonly command: string;
  readonly kind: 'runtime' | 'subpath' | 'cli-local';
  readonly target: string;       // dotted Agent-method path for runtime rows
  readonly exportName?: string;  // only used by subpath rows
  readonly note?: string;
}
// Rows are appended to the existing `COMMAND_API_MAP: readonly CommandApiMapping[]`
// (command-api-map.ts:37). No type change.
```

### Dependencies (NEVER stubbed)

```
None — static data rows. No runtime resolution; `runtime` rows are documentary target paths,
unlike `subpath` rows which the T23 test dynamically imports.
```

---

## Numbered Pseudocode

```
1: // @pseudocode REQ-008.4 — append 6 runtime rows to COMMAND_API_MAP (after existing entries)
2: APPEND row { command: '/approval-mode', kind: 'runtime', target: 'agent.setApprovalMode',
3:              note: 'Approval mode is a live engine setting on the active run' }
4: APPEND row { command: '/policies', kind: 'runtime', target: 'agent.policy.getRules',
5:              note: 'Policy inspection reads the active run policy engine' }
6: APPEND row { command: '/task', kind: 'runtime', target: 'agent.tasks.list',
7:              note: 'Async task list/inspect/cancel over the active run task manager' }
8: APPEND row { command: '/hooks', kind: 'runtime', target: 'agent.hooks.listHooks',
9:              note: 'Hook registry inspection + enable/disable on the active run' }
10: APPEND row { command: '/toolkey', kind: 'runtime', target: 'agent.tools.keys.save',
11:              note: 'Built-in tool key storage feeds the active run tools' }
12: APPEND row { command: '/toolkeyfile', kind: 'runtime', target: 'agent.tools.keys.setKeyFile',
13:              note: 'Built-in tool keyfile path feeds the active run tools' }
14:
15: // INVARIANTS that must still hold after the append (R-MAP-VALID):
16: //   - every row.kind ∈ {runtime, subpath, cli-local}            (no orphan)
17: //   - command names remain UNIQUE                                (no dup)
18: //   - REQUIRED_DURABLE subpath set unchanged + still subpath      (non-breaking)
19: //   - each new target dotted-path corresponds to a REAL Agent method added by this plan
```

> Target-path ground truth (each is a real Agent method created by this plan):
> `agent.setApprovalMode` (REQ-001), `agent.policy.getRules` (REQ-002),
> `agent.tasks.list` (REQ-003), `agent.hooks.listHooks` (REQ-004),
> `agent.tools.keys.save` / `agent.tools.keys.setKeyFile` (REQ-007).

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real anchor | File:line (verified) |
|---|---|---|
| 1 | `COMMAND_API_MAP: readonly CommandApiMapping[]` | `app-services/command-api-map.ts:37` |
| 2-13 | append point = after last existing row (`/quit` at `:267`) | `command-api-map.ts:267` (last entry block) |
| 16 | VALID_KINDS guard (no orphan) | `app-service-boundary.spec.ts:27,46,74` |
| 17 | unique-command guard | `app-service-boundary.spec.ts:48` |
| 18 | REQUIRED_DURABLE subpath guard | `app-service-boundary.spec.ts:33,52,80` |
| target paths | the Agent methods added by this plan | `agent.ts` (REQ-001..007 phases) |

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: classify these as `subpath` (the T23 test would try to dynamically import a named
  export from the app-service subpath and FAIL — these are live Agent runtime paths).
  [OK] DO: use `kind: 'runtime'` (no subpath import needed).
- [ERROR] DO NOT: duplicate an existing `command` string (breaks the unique-name invariant).
  [OK] DO: confirm each of the 6 is absent first (verified: count 0) before appending.
- [ERROR] DO NOT: invent a `target` path that no Agent method backs.
  [OK] DO: point each `target` at a REAL method this plan adds (see ground-truth list above).
- [ERROR] DO NOT: touch the existing rows.
  [OK] DO: append only (R-MAP-VALID / REQ-009 non-breaking).

---

## Behavior Decision Table

| command | kind | target | backed by REQ |
|---|---|---|---|
| `/approval-mode` | runtime | `agent.setApprovalMode` | REQ-001 |
| `/policies` | runtime | `agent.policy.getRules` | REQ-002 |
| `/task` | runtime | `agent.tasks.list` | REQ-003 |
| `/hooks` | runtime | `agent.hooks.listHooks` | REQ-004 |
| `/toolkey` | runtime | `agent.tools.keys.save` | REQ-007 |
| `/toolkeyfile` | runtime | `agent.tools.keys.setKeyFile` | REQ-007 |
| (post-append) every row | ∈ valid kinds | unique command | — |
| (post-append) REQUIRED_DURABLE | subpath | unchanged | REQ-009 |
