# State Coupling Inventory

@plan:PLAN-20251027-STATELESS5.P01
@requirement:REQ-STAT5-001
@requirement:REQ-STAT5-002
@requirement:REQ-STAT5-003
@requirement:REQ-STAT5-004
@requirement:REQ-STAT5-005

## Scope
- Foreground agent (`packages/core/src/core/client.ts`, `geminiChat.ts`)
- CLI runtime helpers (`packages/cli/src/runtime/runtimeSettings.ts`)
- Slash commands & dialogs (`packages/cli/src/ui`)
- Provider runtime context (`packages/core/src/runtime/providerRuntimeContext.ts`)

## Tasks
- [ ] Enumerate every `Config` provider/model/auth getter/setter usage (target ≥50 entries).
- [ ] Map dependency graph from CLI entrypoints to Gemini providers.
- [ ] Document HistoryService ownership/touchpoints for Gap 1 mitigation.
- [ ] Capture Config fields safe to retain (UI-only) vs slated for removal.

> Populate this document during Phase P01 execution with line-level references.
