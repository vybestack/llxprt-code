<!-- @plan:PLAN-20260621-COREAPIREMED.P02 @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Pseudocode: CLI-Parity Integration Adapter / Harness

Component target: `packages/agents/src/api/__tests__/cli-turn-parity.spec.ts` (CREATE) +
`config-injection.spec.ts` + `settings-surface.spec.ts` + boundary scan.
Requirements: REQ-INT-001, REQ-INT-002, REQ-INT-003, REQ-INT-004.

> This is the EXECUTABLE CONTRACT for #1595. It proves the public surface is adequate to replace
> the CLI's current direct-`AgenticLoop` drive, CLI Config construction, and settings deep imports.
> It uses a REAL `FakeProvider` JSONL fixture (no mock theater).

---

## Interface Contracts

```typescript
// PUBLIC-AGENT PATH (Path A) — the path UNDER TEST and the path #1595 production CLI will use —
// imports ONLY the curated public surface (REQ-INT-004). No `./internals.js`, no deep `/src/`.
import { createAgent, fromConfig } from '@vybestack/llxprt-code-agents';
import type { AgentClientContract, AgentEvent } from '@vybestack/llxprt-code-agents';

// REFERENCE-DRIVE PATH (Path B) — the CLI-today comparison drive — is TEST-ONLY and MAY import
// the reference `AgenticLoop` from the curated public root as the CLI does today
// (`import { AgenticLoop } from '@vybestack/llxprt-code-agents'` via useAgenticLoop), OR — if a
// future reference comparison needs it — from the documented `./internals.js` subpath. The
// reference side is permitted internals/`AgenticLoop` access PURELY for comparison; the
// public-agent path under test (Path A) and the eventual #1595 production CLI MUST import ONLY the
// curated public surface. The boundary scan (lines 80–84) enforces this distinction: it asserts
// the PUBLIC-AGENT path uses only the curated surface, while explicitly permitting the reference
// side to reach the reference `AgenticLoop`/internals for the parity comparison.

// INPUTS:
//   - a FakeProvider JSONL fixture: one FakeResponseTurn per line (a tool call + a final answer)
//   - a CLI-style pre-built Config (built the way loadCliConfig builds it, REAL)

// OUTPUTS observed:
//   - projected AgentEvent[] sequence from agent.stream()
//   - reference AgenticLoopEvent[] sequence from a directly-constructed AgenticLoop
```

---

## Numbered Pseudocode (test scenarios — behavioral, not structural)

```
# ---- T1 / REQ-INT-001: fromConfig adopts external Config ----
10: SCENARIO 'fromConfig adopts a CLI-style Config'
11:   GIVEN config = buildCliStyleConfig(fakeProviderFixture)   # real Config, real FakeProvider
12:   WHEN agent = AWAIT fromConfig({ config })
13:   THEN ASSERT agent.getConfig() === config                  # identity (REQ-002.2)
14:   AND   ASSERT agent.getRuntimeId() is a non-empty string
15:   AND   collect events = drainStream(agent.stream('hello'))
16:   AND   ASSERT events end with exactly one done event       # turn streams correctly

# ---- T6 / REQ-005, REQ-001.2: no second ProviderManager ----
20: SCENARIO 'fromConfig reuses provider runtime'
21:   GIVEN config = buildCliStyleConfig(...) with a known active provider/model
22:   WHEN agent = AWAIT fromConfig({ config })
23:   THEN ASSERT agent.getProvider() === config's active provider name
24:   AND   ASSERT agent.getModel() === config's active model
25:   AND   ASSERT agent.getRuntimeId() === the runtimeId bound to the runtime context

# ---- T7 / REQ-001.3: ownership ----
30: SCENARIO 'dispose does not dispose a supplied Config'
31:   GIVEN config = buildCliStyleConfig(...); agent = AWAIT fromConfig({ config })
32:   WHEN AWAIT agent.dispose()
33:   THEN ASSERT config is still usable (e.g. config.getEphemeralSettings() works)
34:   AND   ASSERT a createAgent-built agent DOES dispose its own Config (contrast)

# ---- T10 / REQ-INT-002: turn-drive parity ----
40: SCENARIO 'agent.stream() parity with reference AgenticLoop drive'
41:   GIVEN script = fakeProviderFixture(toolCall + finalAnswer)
42:   # Path A: public surface
43:   agentA = AWAIT fromConfig({ config: buildCliStyleConfig(script) })
44:   eventsA = projectToComparable(drainStream(agentA.stream('do the thing')))
45:   # Path B: reference drive as the CLI does TODAY (object-form options; see useAgenticLoop.ts:254)
46:   loopB = new AgenticLoop({ agentClient: configB.getAgentClient(), config: configB, messageBus: messageBusB ?? new MessageBus(), interactiveMode: false, approvalHandler: approvalHandlerB, displayCallbacks: {} })
47:   eventsB = projectToComparable(drainLoop(loopB.run('do the thing')))
48:   THEN ASSERT eventsA equivalent-to eventsB        # same tool call, same result, same finish
49:   AND   ASSERT eventsA has exactly one terminal done
50:   # 'equivalent-to' compares the PUBLIC projection (type, tool name, isError, done reason),
51:   #  NOT internal fields (prompt_id, traceId) — those are projected away (R-PROJECT, #1594).

# ---- T8 / REQ-INT-003: settings normalization parity ----
60: SCENARIO 'settings round-trip + normalization parity'
61:   GIVEN agent = AWAIT fromConfig({ config })
62:   WHEN agent.setEphemeralSetting('context-limit', '1000')
63:   THEN ASSERT agent.getEphemeralSetting('context-limit') === 1000           # numeric normalize
64:   AND   ASSERT agent.getEphemeralSetting('context-limit') === config.getEphemeralSetting('context-limit')
65:   WHEN agent.setEphemeralSetting('streaming', 'enabled')
66:   THEN ASSERT agent.getEphemeralSetting('streaming') === 'enabled'
67:   WHEN/THEN expect agent.setEphemeralSetting('streaming', 123) to THROW (Config rule propagates)
68:   AND   ASSERT agent.getEphemeralSettings() deep-equals config.getEphemeralSettings()

# ---- PROPERTY-BASED (>=30% of harness tests) ----
70: PROPERTY 'arbitrary plain key/value round-trips through the agent == through Config'
71:   FORALL key in arbitraryPlainSettingKey(), value in arbitraryJsonScalar()
72:     agent.setEphemeralSetting(key, value)
73:     ASSERT agent.getEphemeralSetting(key) === config.getEphemeralSetting(key)
74: PROPERTY 'getCurrentSequenceModel mirrors the bound client for arbitrary model strings'
75:   FORALL m in arbitraryModelString() ∪ {null}
76:     stub the bound client's currentSequenceModel = m   (at the REAL client, via fixture)
77:     ASSERT agent.getCurrentSequenceModel() === m

# ---- T11 / REQ-INT-004: boundary scan (Path A vs Path B) ----
80: SCENARIO 'public-agent path imports only the curated public root; reference drive may use internals'
81:   SCAN all import specifiers in this __tests__ directory's parity files, partitioned by path:
81a:  #   Path A = the PUBLIC-AGENT path under test (createAgent/fromConfig/agent.stream/
81b:  #            AgentClientContract) AND the model for the eventual #1595 production CLI.
81c:  #   Path B = the REFERENCE drive (CLI-today comparison via the reference AgenticLoop). TEST-ONLY.
82:   ASSERT every Path A specifier is EXACTLY '@vybestack/llxprt-code-agents' OR a documented
83:          NON-internals subpath ('/app-service.js') — Path A NEVER imports './internals.js'
83a:         and NEVER a deep '/src/' path (this is the #1595 production constraint).
84:   AND   Path B (reference drive) MAY import the reference `AgenticLoop` from the curated root OR
84a:        from the documented './internals.js' subpath — the reference drive is the ONLY permitted
84b:        './internals.js' consumer — but Path B too NEVER imports a deep '/src/'/'core/src'/
84c:        'providers/src' path.
84d:  # TEST-ONLY vs PRODUCTION distinction (CRIT-6/MIN-3): the scan asserts Path A uses ONLY the
84e:  #   curated public root (no './internals.js', no deep '/src/'); it permits './internals.js'
84f:  #   SOLELY for the Path-B reference drive; deep '/src/' paths are forbidden EVERYWHERE. It must
84g:  #   not flag the reference side's permitted `AgenticLoop`/'./internals.js' import as a violation.
```

---

## Integration Points (Line-by-Line)

```
Line 11/21/31/43/61: buildCliStyleConfig
         - Builds a REAL Config the way the CLI does (provider runtime + FakeProvider), so the
           parity proof is against the actual CLI shape, not a toy Config.
Line 46: new AgenticLoop({ agentClient, config, messageBus, interactiveMode, approvalHandler, displayCallbacks })
         - AgenticLoop's constructor is OBJECT-FORM: `constructor(options: AgenticLoopOptions)`
           (packages/agents/src/core/agenticLoop/AgenticLoop.ts:182; AgenticLoopOptions fields in
           packages/agents/src/core/agenticLoop/types.ts: agentClient, config, messageBus,
           approvalHandler?, interactiveMode?, displayCallbacks?). This is EXACTLY how the CLI
           constructs the loop today at packages/cli/src/ui/hooks/geminiStream/useAgenticLoop.ts:254
           (`new AgenticLoop({ agentClient: args.agentClient, config: args.config, messageBus:
           args.messageBus ?? new MessageBus(), interactiveMode: args.interactiveMode ?? false,
           approvalHandler: args.approvalHandler, displayCallbacks })`). The reference path must
           mirror it (all fields, object form) so parity is meaningful. `args.agentClient` is an
           `AgentClientContract` threaded from `config.getAgentClient()` at
           packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts:331 down through
           useGeminiStream → useGeminiStreamOrchestration → useAgenticLoop.
Line 50-51: projectToComparable
         - Compares only the PUBLIC projection. Internal-only fields are intentionally absent from
           AgentEvent (#1594 R-PROJECT); comparison must not require them.
Line 81-84: boundary scan
         - Models the #1595 no-deep-import constraint as an executable test.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: mockProvider.complete.mockResolvedValue(...)   // mock theater
[OK]   DO:     drive a real FakeProvider JSONL fixture

[ERROR] DO NOT: expect(loopB.run).toHaveBeenCalled()           // verifying a mock was called
[OK]   DO:     compare the actual projected event sequences (eventsA vs eventsB)

[ERROR] DO NOT: import { AgenticLoop } from '@vybestack/llxprt-code-agents/src/core/...'  // deep
[OK]   DO:     import from the public root (as the CLI does)

[ERROR] DO NOT: assert only events.length > 0                  // structure-only
[OK]   DO:     assert the specific tool name, isError flag, and single terminal done reason

[ERROR] DO NOT: compare internal fields (prompt_id, traceId)   // not in the public projection
[OK]   DO:     compare the public AgentEvent projection only
```

---

## Why This Is Integration-First (PLAN.md red-flag guard)

This harness is written against stubs FIRST (it fails on the stubbed `fromConfig`/settings/
sequence-model), then drives the implementation. It exercises the SAME entry points #1595 will
use (`fromConfig`, `agent.stream`, `agent.getEphemeralSetting`, `AgentClientContract`), against a
CLI-style Config and the CLI's actual reference drive. If the public surface were inadequate, this
harness could not be written without deep imports — which is exactly the failure it guards against.
