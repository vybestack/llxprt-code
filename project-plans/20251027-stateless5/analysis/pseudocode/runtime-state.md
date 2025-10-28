# AgentRuntimeState Pseudocode

@requirement:REQ-STAT5-001
@requirement:REQ-STAT5-002

1. Initialize runtime state
   1.1 Accept `runtimeId`, `settingsService`, `initialSnapshot`.
   1.2 Validate snapshot contains provider key, model id, auth payload.
   1.3 Freeze/internalize values to enforce immutability.
2. Provide read operations
   2.1 `getProvider()` returns provider key.
   2.2 `getModel()` returns active model id.
   2.3 `getAuth()` returns auth payload (no mutation allowed).
   2.4 `getEphemeralSettings()` returns clone for diagnostics.
3. Support immutable updates
   3.1 Accept partial update object.
   3.2 Validate update keys (provider/model/auth/baseUrl/params).
   3.3 Return new frozen instance merging old data + updates.
   3.4 Emit `RuntimeStateChanged` event with payload `{ runtimeId, changes, snapshot, timestamp }`.
4. Event subscription API
   4.1 Maintain subscriber list keyed by runtimeId.
   4.2 `subscribeToAgentRuntimeState(runtimeId, callback, options?)` returns unsubscribe fn (options flag `async` allows opt-in to deferred dispatch).
   4.3 Invoke callbacks synchronously by default; if `options.async === true`, schedule on microtask queue.
5. Snapshot export
   5.1 `getAgentRuntimeStateSnapshot(state)` returns serializable object with provider/model/auth/baseUrl/params/metadata.
   5.2 Include version number for future migrations.
6. Validation errors
   6.1 Missing provider → throw `RuntimeStateError` with code `provider.missing`.
   6.2 Missing model → throw `RuntimeStateError` with code `model.missing`.
   6.3 Invalid update key → throw `RuntimeStateError` with code `update.unsupported`.
7. Diagnostics helpers
   7.1 `toDiagnostics()` returns provider/model/settings for UI panels.
   7.2 `getChangeLog()` optional list of previous mutations (for debugging the runtime).
8. History service interaction placeholder
   8.1 Do **not** store `HistoryService` in runtime state (documented behavior).
   8.2 Consumers inject `HistoryService` separately alongside runtime state; runtime state only carries metadata.

> Notes:
> - Event emission is mandatory per REQ-STAT5-001.2; tests must assert dispatch behaviour.
> - Ensure numbering remains stable for implementation references.
