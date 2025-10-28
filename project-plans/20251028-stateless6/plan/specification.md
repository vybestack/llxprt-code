# STATELESS6 Specification (P02)

> @plan PLAN-20251028-STATELESS6.P02

## 1. Background
- Summarise STATELESS5 outcomes (runtime state introduced, Config still needed for ephemerals/telemetry).
- Document observed issue (`setModel` mutation in SubAgentScope).

## 2. Glossary
- GeminiRuntimeView: Immutable wrapper providing runtime data + adapters.
- Ephemerals: Compression/context settings computed per runtime view.
- TelemetryTarget: Logging sink independent of Config.

## 3. Architectural Decisions
- Adopt runtime view wrapper (not extending AgentRuntimeState directly).
- Provide Config adapter for transitional compatibility.
- Enforce immutability to prevent shared state mutation.

## 4. Integration Points
- Consumers:
  - `SubAgentScope.create` (internal) – constructs runtime view per subagent profile.
  - `GeminiChat` (internal) – receives runtime view instead of Config.
  - Foreground agent helper (temporary) – `createRuntimeViewFromConfig` used by CLI runtime until STATELESS7.
- Replacements:
  - Remove direct `config.getEphemeralSetting*` usage in `geminiChat.ts` (lines 1392, 1396, 1575, 1700).
  - Remove `config.getProviderManager?.()` calls in `geminiChat.ts` (lines 561, 1177, 1775, 2480).
  - Delete `this.runtimeContext.setModel(...)` mutation from `subagent.ts` (line ~609).
- Access path:
  - Users continue to start chats via existing CLI/UI flows; runtime view wiring is internal to core modules.
- Migration:
  - Foreground Config path bridges through runtime view adapter until follow-on plan eliminates Config entirely.
  - Subagent profiles must supply model/provider/auth data explicitly; fallback to Config removed.

## 5. Evaluation Checklist
- [ ] Runtime view eliminates Config reads in GeminiChat.
- [ ] SubAgentScope no longer mutates shared Config.
- [ ] Integration test demonstrates isolated histories.

## 6. Stakeholder Sign-off
- Owner: _TBD (self sign-off during execution)_.
- Date: _TBD_.
