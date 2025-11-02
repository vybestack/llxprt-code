# Plan: Stateless Foreground Agent Phase 5

Plan ID: PLAN-20251027-STATELESS5
Generated: 2025-10-27
Total Phases: 13
Requirements: REQ-STAT5-001, REQ-STAT5-002, REQ-STAT5-003, REQ-STAT5-004, REQ-STAT5-005

## Purpose
- Replace `Config`-centric provider/model state with an explicit runtime state container for the foreground agent.
- Ensure CLI runtime helpers (`runtimeSettings`, slash commands, CLI flags) mutate/query the runtime state abstraction.
- Refactor `GeminiClient` and `GeminiChat` so all provider/model/auth information flows through injected runtime state while `HistoryService` remains an instance-level dependency.
- Preserve diagnostics, history persistence, and provider switching behavior with expanded test coverage.

## Formal Requirements
- **[REQ-STAT5-001] AgentRuntimeState Abstraction**
  - [REQ-STAT5-001.1] Runtime state construction validates provider/model/auth inputs.
  - [REQ-STAT5-001.2] State updates are immutable and emit synchronous change events with payload `{ runtimeId, changes, snapshot, timestamp }`.
  - [REQ-STAT5-001.3] Diagnostics snapshot includes provider/model/auth/baseUrl metadata.
- **[REQ-STAT5-002] CLI Runtime Helper Integration**
  - [REQ-STAT5-002.1] Slash commands (`/set`, `/provider`, `/model`, `/key`, `/keyfile`, `/profile`) delegate to runtime state mutators.
  - [REQ-STAT5-002.2] CLI flags (`--set`, `--profile-load`, `--model`, `--key`, `--keyfile`) hydrate runtime state before command execution.
  - [REQ-STAT5-002.3] Legacy Config mirrors update only for UI diagnostics/status display.
- **[REQ-STAT5-003] GeminiClient Runtime Consumption**
  - [REQ-STAT5-003.1] GeminiClient reads provider/model/auth exclusively from runtime state.
  - [REQ-STAT5-003.2] GeminiClient subscribes to runtime state changes for telemetry context.
- **[REQ-STAT5-004] GeminiChat Stateless Operation**
  - [REQ-STAT5-004.1] GeminiChat provider invocations use runtime state metadata (model/auth/baseUrl/tools) without Config access.
  - [REQ-STAT5-004.2] HistoryService is injected per instance and never stored globally.
- **[REQ-STAT5-005] Integration & Diagnostics Continuity**
  - [REQ-STAT5-005.1] Diagnostics commands (`/diagnostics`, status panel) source data from runtime state snapshots.
  - [REQ-STAT5-005.2] Regression tests confirm runtime isolation between foreground agent instances.
  - [REQ-STAT5-005.3] Documentation updated to reflect runtime state usage for user workflows.

## Architectural Decisions
- **AD-STAT5-01**: Introduce `AgentRuntimeState` with immutable accessors/mutators, registered per runtime ID, and no fallback to global singletons.
- **AD-STAT5-02**: CLI runtime helpers produce actions against `AgentRuntimeState` and update legacy `Config` mirrors only where UI components still need them (e.g., status bar).
- **AD-STAT5-03**: `GeminiClient` receives `AgentRuntimeState` alongside `HistoryService`, forwarding runtime metadata to `GeminiChat`.
- **AD-STAT5-04**: `GeminiChat` depends solely on runtime state plus injected `HistoryService`; provider invocations receive stateless context assembled per call.
- **AD-STAT5-05**: Verification includes targeted isolation tests, regression of slash commands/flags, and full workspace lint/typecheck/format/build/test gates.

## Technical Environment
- **Language/Runtime**: TypeScript targeting Node.js ≥ 20 (workspace default).
- **Package Manager**: pnpm (monorepo workspaces `packages/core`, `packages/cli`, `integration-tests`).
- **Testing**: Vitest with `pnpm test --workspace <pkg>`.
- **Lint/Format**: ESLint + Prettier via `pnpm lint`, `pnpm format:check`.
- **Build**: Custom scripts invoked through `pnpm build`.

## Project Structure (Relevant Excerpts)
```
packages/
  core/
    src/
      core/
        client.ts
        geminiChat.ts
      runtime/
        AgentRuntimeState.ts        # new abstraction
        providerRuntimeContext.ts
  cli/
    src/
      runtime/
        runtimeSettings.ts
        agentRuntimeAdapter.ts      # new adapter
      ui/
        commands/
        components/
project-plans/20251027-stateless5/
  analysis/
    pseudocode/
  plan/
```

## Integration Points

### Existing Code That Will Use This Feature
- `packages/cli/src/runtime/runtimeSettings.ts` – setter/getter helpers (lines 150-420) must delegate to `AgentRuntimeState`.
- `packages/cli/src/ui/commands/{setCommand.ts,providerCommand.ts,modelCommand.ts,keyCommand.ts,keyfileCommand.ts,profileCommand.ts}` – command handlers call runtime helper API backed by runtime state.
- `packages/cli/src/ui/components/ProviderModelDialog.tsx` – reads runtime state snapshot for UI display.
- `packages/core/src/core/client.ts` – chat initialization/path rely on runtime state injection.
- `packages/core/src/core/geminiChat.ts` – provider calls use runtime state metadata per message.
- `packages/core/src/runtime/providerRuntimeContext.ts` – stores runtime state alongside settings/config for isolation.

### Existing Code To Be Replaced/Adjusted
- `packages/core/src/config/config.ts` – remove provider/model/auth caches and setters.
- `packages/cli/src/runtime/runtimeSettings.ts` – eliminate direct Config mutations for provider/model/auth.
- `packages/core/src/core/subagent.ts` – adjust to pass runtime state rather than mutating Config.
- `packages/cli/src/ui/components/diagnostics/*` – switch to runtime state snapshots.
- `packages/core/src/core/geminiChat.test.ts` / `client.test.ts` – update fixtures to build runtime state instead of Config.

### User Access Points
- Foreground agent CLI session (interactive) – slash commands update runtime state.
- CLI non-interactive flags – `llxprt --profile-load`, `--model`, `--set`.
- Diagnostics UI (`/diagnostics`, status bar) – reads runtime state to display provider/model/auth.

## Data Flow Summary
1. CLI bootstrap registers runtime ID → creates `AgentRuntimeState` seeded from existing settings/profile.
2. Slash commands / CLI flags invoke runtime helper API → state mutators update provider/model/auth fields, emit events.
3. `GeminiClient.startChat()` / send paths read runtime state and pass normalized options to `GeminiChat`.
4. `GeminiChat` constructs provider payloads using runtime state, retains injected `HistoryService` for compression/context.
5. Diagnostics and status components consume runtime state snapshots via runtime helper API.

## Data Schemas
```typescript
// Runtime state snapshot shape (subset)
const AgentRuntimeStateSnapshot = z.object({
  runtimeId: z.string(),
  provider: z.string(),
  model: z.string(),
  auth: z.object({
    type: z.string(),
    token: z.string().optional(),
  }),
  baseUrl: z.string().url().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.number().int(),
});
```

## Example Data
```json
{
  "runtimeId": "foreground-agent",
  "provider": "gemini",
  "model": "gemini-2.0-flash",
  "auth": { "type": "oauth", "token": "ya29.a0Af..." },
  "baseUrl": "https://generativelanguage.googleapis.com",
  "params": { "temperature": 0.2, "topP": 0.9 },
  "updatedAt": 1761859200
}
```

## Performance Requirements
- Runtime state updates must complete within 2ms in local profiling (no async I/O).
- GeminiClient must not introduce additional asynchronous hops beyond existing provider calls.
- Diagnostics snapshot generation should allocate <5 KB per invocation.
- Event emission (if enabled) should deliver callbacks synchronously unless subscriber runtime opts into async.

## Constraints
- No direct provider/model/auth reads from `Config` within `GeminiClient`/`GeminiChat` after implementation.
- `HistoryService` remains instance-owned; not converted to singleton nor recreated per message.
- Maintain plan tagging: every new/modified code annotated with `@plan:PLAN-20251027-STATELESS5.PNN` and matching requirement markers.
- Follow dev-docs/RULES.md (strict TDD, immutable patterns, behavior-focused tests).

## Verification Strategy
- Phase-level verification includes lint/typecheck/format/build/test commands (`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build`, targeted `pnpm test`) and manual checklists.
- Verification markdown files capture command outputs, pseudocode compliance review, and mutation/property testing expectations.
- `execution-tracker.md` updated after every phase; `.completed/P[NN].md` created with detailed audit trail.
