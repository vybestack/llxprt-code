# Phase 12: Harness Layer 4 — CLI-parity Integration [RED]

## Phase ID

`PLAN-20260617-COREAPI.P12`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 11a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P11a.md`

## Requirements Implemented (Expanded)

### REQ-HARNESS-CLIPARITY: CLI-parity integration harness for provider/profile/auth/MCP/IDE/hooks

**Full Text**: Write richer-fixture behavioral integration tests for the provider,
model, profile, auth, MCP, IDE, hooks, memory refresh, and context-preservation
control-plane touchpoints that the CLI rewrite (#1595) must consume without deep
imports. These tests are written before implementation and fail naturally against
stubs.

**Behavior**:
- GIVEN: the public Agent stubs and realistic infra fakes for MCP, IDE, hooks,
  OAuth prompts, profiles, and file system boundaries
- WHEN: the harness exercises provider/profile switching, auth/key flows, MCP
  discovery, IDE status, hook lifecycle, and save_memory refresh through public APIs
- THEN: it asserts concrete public outcomes, including same-HistoryService context
  preservation, no stale client cache, MCP discovery semantics, and durable profile
  effects.

**Why This Matters**: This layer proves #1595 can be a thin UI over the public Agent
API instead of deep-importing runtime internals.


Richer-fixture integration tests (fake MCP server, fake hook, fake IDE, fake FS) for
the provider/profile-switch, auth, MCP, IDE, hooks, and context-preservation
touchpoints. Test-first; fail naturally until impl phases P16/P19/P22/P23.

| T-row | REQ | Asserts |
|---|---|---|
| T4 | REQ-004 | setProvider mid-session → getProvider, content-gen rebuilt, history transferred, next turn uses new provider |
| T4b | REQ-009 | profiles.apply (standard + load-balancer) → provider/model/params/auth match profile |
| T4c | REQ-004/005 | client rebinding on switch/auth — rebinds to config.getAgentClient(); no stale cache; transient never used |
| T4d | REQ-005 | context preservation: same HistoryService instance reused; follow-up sees prior N msgs |
| T4e | REQ-005/009 | LB failover preserves context via same transfer path (switch ≡ failover) |
| T4f | REQ-005 | switch normalization: stripThoughts applied switching into incompatible provider |
| T5 | REQ-004 | setModel/setModelParam → getModel/getModelParams; params reach provider call |
| T12 | REQ-017 | instance discovery includes MCP/extension/skill entries |
| T12b | REQ-013 | MCP listServers/status/toolsByServer; discovery-blocking honored |
| T15 | REQ-014 | ide.* current/detected IDE + trust; editor open/close callbacks fire |
| T15b | REQ-015 | hooks/lifecycle: observe hook execution and SessionStart/SessionEnd via public surface |
| T15c | REQ-007/REQ-010 | save_memory tool refreshes memory/system-instruction for next turn through high-level loop |

| T18 | REQ-008 | key/keyfile/key-name precedence wins per documented chain; status reflects it |
| T18b | REQ-008 | /key secure-store + profile-save: auth-key-name wins, raw key not persisted; saveCurrent stores reference |
| T18c | REQ-008 | OAuth/buckets/mcpLogin via onOAuthPrompt; no handler → clear rejection |
| T18d | REQ-009 | profiles CRUD + apply; durable store changes; apply preserves context |
| T18e | REQ-002/021 | sandbox is createAgent-time config; active sandbox status reports; live mutation is classified as recreate/app-service, not runtime mutation |
| T20 | REQ-013 | discovery gating: default chat/stream await MCP readiness; `TurnOptions.mcpDiscovery:'skip'` opts out; discovery failure yields `AgentError{code:'mcp_discovery_failed'}` + exactly one `done:error`; mcp.status/listTools still callable while pending |
| T25 | REQ-001/017 | provider-by-name one-call bootstrap, shared runtimeId/SettingsService behavior, post-auth client binding, static discovery, and no deep imports |

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/helpers/fakeMcpServer.ts`,
  `fakeHook.ts`, `fakeIde.ts` — infra fakes (allowed: infra, not the component under test).
- `packages/agents/src/api/__tests__/fixtures/` — JSONL fixtures + profile JSON +
  load-balancer profile fixtures.
- `packages/agents/src/api/__tests__/switch-context.spec.ts` — T4, T4b, T4c, T4d, T4e, T4f, T5.
- `packages/agents/src/api/__tests__/mcp-discovery.spec.ts` — T12, T12b, T20.
- `packages/agents/src/api/__tests__/auth-profiles.spec.ts` — T18, T18b, T18c, T18d.
- `packages/agents/src/api/__tests__/sandbox-boundary.spec.ts` — T18e.
- `packages/agents/src/api/__tests__/provider-bootstrap.spec.ts` — T25 RED contract for provider-by-name bootstrap/shared runtime/static discovery.
- `packages/providers/src/runtime/runtimeContextFactory.messageBus.test.ts` — RED contract for the cross-package `messageBus?: MessageBus` seam required by createAgent: default private-bus behavior remains, provided bus is used exactly, and `handle.activate()` registers matching runtimeId/config/settings/providerManager.
- `packages/agents/src/api/__tests__/ide.spec.ts` — T15.
  - All `@plan:PLAN-20260617-COREAPI.P12` + relevant `@requirement`.

### Test Rules

- Real Agent; fakes ONLY for external infra (MCP transport, IDE, FS, OAuth prompt).
- T4d/T4e MUST assert `existingHistoryService === newHistoryService` (identity), not
  just equal contents — the headline guarantee.
- Contribute property-based tests (e.g. fc-generated message history for T4d). The
  ≥30% requirement is the GLOBAL gate computed across the full harness in P29 (B9),
  NOT a per-layer "where natural" allowance.
- Fail naturally. NO reverse tests. Tag everything.

## Verification Commands

```bash
missing=0
npm test -- --testNamePattern "@plan:.*P12"
for t in T4 T4b T4c T4d T4e T4f T5 T12 T12b T15 T15b T15c T18 T18b T18c T18d T18e T20 T25; do
  grep -rq "$t\b" packages/agents/src/api/__tests__/*.spec.ts || { echo "MISSING $t"; missing=1; }
done
npm test -- --testNamePattern "runtime context.*messageBus\|@plan:.*P12.*messageBus"
grep -rq "messageBus" packages/providers/src/runtime/runtimeContextFactory.messageBus.test.ts || { echo "MISSING provider runtime messageBus RED contract"; missing=1; }

grep -rn "existingHistoryService === newHistoryService\|toBe(.*HistoryService\|sameHistoryService" packages/agents/src/api/__tests__/switch-context.spec.ts || { echo "MISSING T4d identity assertion"; missing=1; }
# mock-theater / reverse-test guard (must NOT match)
grep -rn "toHaveBeenCalled\|not\.toThrow" packages/agents/src/api/__tests__/switch-context.spec.ts && { echo "FAIL mock/reverse"; missing=1; }
exit $missing
```

- [ ] T25 exists before P15 and asserts one-call bootstrap/shared runtime/static discovery behavior
- [ ] T18e explicitly asserts sandbox startup/status and app-service recreate boundary

### Semantic Verification Checklist

- [ ] T4d/T4e assert HistoryService IDENTITY reuse
- [ ] T18 asserts the exact precedence chain from REQ-008
- [ ] MCP/IDE/auth use infra fakes only
- [ ] Property-based tests contributed toward the GLOBAL ≥30% gate (computed in P29, B9)
- [ ] Fail naturally pending impl phases

## Success Criteria

- Layer-4 suite exists, tagged, fails naturally.

## Failure Recovery

- `git checkout -- packages/agents/src/api/__tests__/`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P12.md`
