# Pseudocode: Settings Service And Registry

Plan ID: PLAN-20260608-ISSUE1588

## Interface Contracts

Inputs:

- Settings keys and values from CLI/core/providers
- Provider-specific settings namespaces
- Settings registry definitions
- Runtime registration calls from core runtime context

Outputs:

- Same `SettingsService` behavior from settings package
- Same registry validation/normalization behavior
- Settings-owned singleton helpers independent of core runtime context
- Core-owned `ProviderRuntimeSettingsService` structural interface decoupling runtime context from settings types

## Numbered Pseudocode

01: MOVE settings types from core settings path to settings package types path
02: MOVE `SettingsService` implementation to settings package
03: UPDATE imports inside `SettingsService` to local settings package type imports
04: PRESERVE all public methods and event behavior
05: MOVE settings registry to settings package
06: REMOVE import of core `COMPRESSION_STRATEGIES`
07: DEFINE settings-owned compression strategy values matching current literal values (`'middle-out'`, `'top-down-truncation'`, `'one-shot'`, `'high-density'`)
08: UPDATE `compression.strategy` registry entry to use settings-owned values
09: UPDATE registry tests to assert literal compatibility without importing core compression
10: CREATE settings-owned `settingsServiceInstance` module
11: DEFINE module-level active settings service variable
12: IMPLEMENT `registerSettingsService(settingsService)` to store active service in settings-package state ONLY; do NOT create core `ProviderRuntimeContext`; do NOT import core
13: IMPLEMENT `getSettingsService()` to return active service or throw current-style clear error
14: IMPLEMENT `resetSettingsService()` to clear active service and call `clear()` on previous service if current behavior requires it; do NOT import or call core `clearActiveProviderRuntimeContext`
15: DO NOT import core runtime context in settings service instance module
16: SETTINGS-PACKAGE TESTS verify ONLY settings-owned state: register/get/reset singleton behavior. They MUST NOT import or assert anything about core `ProviderRuntimeContext`. ProviderRuntimeContext creation/clearing assertions belong in core adapter tests (P06)
17: CREATE core-owned `settingsRuntimeAdapter.ts` providing `activateSettingsRuntimeContext(settingsService, runtimeId?)` and `deactivateSettingsRuntimeContext()` that bridge settings package calls with core `ProviderRuntimeContext` management
18: UPDATE `settingsRuntimeAdapter.ts` to call `registerSettingsService` from settings package inside `activateSettingsRuntimeContext`: adapter calls `setActiveProviderRuntimeContext(context)` then `registerSettingsService(context.settingsService)`
19: UPDATE `settingsRuntimeAdapter.ts` to call `resetSettingsService` from settings package inside `deactivateSettingsRuntimeContext`: adapter calls `clearActiveProviderRuntimeContext()` then `resetSettingsService()`
20: VERIFY `providerRuntimeContext.ts` does NOT import or call settings-package functions — the adapter is the SOLE bridge
21: DEFINE `ProviderRuntimeSettingsService` structural interface in `packages/core/src/runtime/providerRuntimeContext.ts` with methods: `get(key: string): unknown`, `set(key: string, value: unknown): void`, `on(event: string, handler: (...args: unknown[]) => void): () => void`, `clear(): void`
22: UPDATE `ProviderRuntimeContextInit.settingsService` field type from `SettingsService` to `ProviderRuntimeSettingsService` in `providerRuntimeContext.ts`
23: ASSERT `ProviderRuntimeContextInit.settingsService` is required (not optional) after migration — `createProviderRuntimeContext({})` without a settings service is invalid
24: EXPORT `ProviderRuntimeSettingsService` interface from core `providerRuntimeContext.ts` so adapter can reference it
25: TEST register-before-context: call `registerSettingsService(s)` when no runtime context exists; `getSettingsService()` returns `s`; no core `ProviderRuntimeContext` created
26: TEST context-activation-updates-settings: core activates runtime context with `s2`; `getSettingsService()` returns `s2` overriding previously registered singleton
27: TEST context-clearing-resets-settings: core clears runtime context; `getSettingsService()` reflects cleared state
28: TEST settings-isolation: two contexts with different settings, activate A then B, read settings, returns B's settings
29: TEST SettingsService event behavior: `set()` emits `change` event with `{key, oldValue, newValue}`; `clear()` emits `cleared` event; `setProviderSetting()` emits `provider-change` event with `{provider, key, oldValue, newValue}`; `on('settings_changed', listener)` subscribes to settings change events
30: TEST SettingsService clear-invokes-clear: calling `resetSettingsService()` calls `.clear()` on the previous service instance if one exists
31: EXPORT settings service, registry, types, and singleton helpers from settings package public API
32: UPDATE `configConstructor.ts` to use `activateSettingsRuntimeContext()` instead of direct `registerSettingsService()` when context creation is needed — **this is a P06 task** (P03b creates the adapter module but does NOT wire configConstructor)
33: TEST core-owned adapter: `activateSettingsRuntimeContext(s)` creates context AND registers settings; `deactivateSettingsRuntimeContext()` clears context AND resets settings
34: TEST reset-settings-state-only: `resetSettingsService()` clears settings state but does NOT call `clearActiveProviderRuntimeContext()`
35: RUN settings package tests
36: RUN core runtime context tests
37: RETURN settings service and registry extraction complete

## Anti-Pattern Warnings

- DO NOT keep `settingsServiceInstance.ts` in core as a compatibility decision unless user explicitly changes acceptance criteria.
- DO NOT import `providerRuntimeContext` from settings. Settings package MUST NOT import `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, or any consumer package — not even as devDependencies — per final-architecture.md forbidden production dependency rules and package-metadata-constraints.md forbidden dependency rules.
- DO NOT test only that `getSettingsService` returns an object; test identity and isolation.
- DO NOT leave registry compression strategy tied to core compression. Settings registry must own its own literal values.
- DO NOT allow `providerRuntimeContext.ts` to import or reference `SettingsService` from settings package. It must stay agnostic, using only `ProviderRuntimeSettingsService` structural interface. The adapter (`settingsRuntimeAdapter.ts`) is the SOLE authorized bridge.
- DO NOT create `ProviderRuntimeContext` from settings-package `registerSettingsService()`. The old behavior of creating a runtime context from `registerSettingsService` is replaced by the core-owned `activateSettingsRuntimeContext()` adapter.
- DO NOT test settings-package singleton functions using core `ProviderRuntimeContext` assertions in settings-package tests. Settings tests verify settings-state-only; adapter tests verify bridge behavior.
- RUNTIME ISOLATION: `registerSettingsService()` stores state in settings-package-owned variable ONLY — no `ProviderRuntimeContext` creation, no core imports, no side effects in core runtime. `getSettingsService()` reads from settings-package state ONLY. `resetSettingsService()` clears settings-package state and calls `.clear()` on previous service — it does NOT call `clearActiveProviderRuntimeContext()`. Core runtime context is decoupled: `providerRuntimeContext.ts` manages context state via `ProviderRuntimeSettingsService` interface without importing settings. The sole bridge is `settingsRuntimeAdapter.ts`.
