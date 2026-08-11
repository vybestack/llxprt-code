# Phase 09: Settings (opt-in, default-off, nested shape — D2)

Plan ID: PLAN-20260808-PERFTREND.P09
Prerequisites: P02 (do before wiring 06/10/11).
Package: `core` (config) + `cli` (settings schema/configBuilder). @pseudocode:
`08-consumer-and-perf-command.md` lines 10-24.

> **Decision D2:** the persisted shape is **nested** `telemetry.perf.enabled`
> (master) and `telemetry.perf.memory`, both default **false**; memory requires
> enabled. `telemetry.perf` is **not** itself a boolean. (Spec §7.4 names the
> master `telemetry.perf`; the resolved persisted contract is the nested shape —
> recorded here because spec is not rewritten.)

## Why before wiring
The lifecycle/observer/memory/command phases all gate on `resolvePerf`. Landing
the setting + resolver first gives them a real (non-mock) switch to read.

## Stub
- `TelemetrySettings` gains `perf?: PerfTelemetrySettings` where
  `PerfTelemetrySettings = { enabled?: boolean; memory?: boolean }`.
- `resolvePerfSettings` helper returns `{ enabled, memory }` with master-gates-
  memory and default-false semantics.
- `resolveTelemetrySettings` deep-copies + freezes the perf sub-object so
  `Config.getTelemetrySettings()` cannot leak nested mutable state.

## Fact-check: hierarchy (corrected from original)

The original plan claimed hierarchy "CLI flag > env > workspace
`.llxprt/settings.json` > user > default (follow existing
`resolveTelemetrySettings` precedence)." Source fact-checking found this
conflates two distinct mechanisms:

1. **Persisted settings merge** (CLI `mergeSettings()` in `settingsMerge.ts`):
   layers are merged via `mergeObjectSection('telemetry', ...)` which does a
   **shallow spread** — a higher-precedence layer's `perf` object REPLACES the
   lower-precedence `perf` entirely (not a deep merge of `perf.enabled` /
   `perf.memory` across layers). Precedence: schema defaults < system defaults <
   user < workspace (trusted only) < system.

2. **CLI/env mapping**: yargs exposes ONLY flat flags (`--telemetry`,
   `--telemetry-log-prompts`, `--telemetry-outfile`). There are **no CLI flags
   or env vars for `telemetry.perf.*`** (the issue spec does not require them).
   `buildTelemetryConfig()` overlays these flat CLI flags on merged settings and
   passes `perf: telemetrySettings?.perf` through to Config unchanged.

3. **`resolveTelemetrySettings`** (core `configConstructor.ts`): does NOT
   implement a settings-layer hierarchy — it applies per-field defaults and
   deep-copies + freezes the perf sub-object. The hierarchy is in `mergeSettings`
   (CLI) + `buildTelemetryConfig` (CLI).

**No dedicated CLI perf flags or environment variables were added** (the existing
generic yargs pipeline does not make nested `telemetry.perf` addressable via
flags/env). Perf is configured only via persisted settings files.

## Implementation delivered

### Core (`packages/core/src/config/`)
- **`configTypes.ts`**: added `PerfTelemetrySettings` interface
  (`{ enabled?: boolean; memory?: boolean }`); added `perf?: PerfTelemetrySettings`
  to `TelemetrySettings`.
- **`configConstructor.ts`**: exported `resolveTelemetrySettings` (was private);
  added `resolvePerfSettings(settings): { enabled: boolean; memory: boolean }`
  with master-gates-memory; `resolveTelemetrySettings` now clones perf
  (`{ ...perf }`) on every ingress and egress via `withClonedPerf` so the
  shallow copy returned by `getTelemetrySettings()` cannot reach the source.
  The resolved perf is a mutable isolated copy — isolation is by cloning, not
  freezing.
- **`config.ts`**: unchanged (0 lines added). `getTelemetrySettings()` returns
  `{ ...this.telemetrySettings }` as before — the cloned perf isolates mutation.
- **`src/index.ts`**: exports `resolvePerfSettings` and `PerfTelemetrySettings`
  for downstream phases.

### CLI (`packages/cli/src/config/`)
- **`configBuilder.ts`**: `buildTelemetryConfig` passes `perf:
  telemetrySettings?.perf` through to Config.
- **`settingsSchema.ts`**: `SETTINGS_SCHEMA_DEFINITIONS.TelemetrySettings` gains
  `perf` property (type: object, additionalProperties: false, properties:
  enabled/memory booleans).
- **`schemas/settings.schema.json`**: regenerated `TelemetrySettings` $def with
  perf property.

### Docs
- **`docs/telemetry-privacy.md`**: added "Client Performance Telemetry" section
  documenting `telemetry.perf.enabled` / `telemetry.perf.memory`, default-off,
  local-only, master-gates-memory. No commands documented (P11 will add
  inspect/delete/report).

## Integration TDD (Bun, real behaviour)
- `perfSettings.behavior.test.ts` (16 tests — EVIDENCE-AC2):
  - Default (no setting) ⇒ `{ enabled: false, memory: false }`.
  - Master on, memory omitted ⇒ `{ enabled: true, memory: false }`.
  - Master off, memory on ⇒ `{ enabled: false, memory: false }`.
  - Both on ⇒ `{ enabled: true, memory: true }`.
  - False overrides.
  - Input immutability (3 tests).
  - Nested-return copy isolation (2 tests).
  - Return type safety.
- `telemetrySettingsCopy.behavior.test.ts` (6 tests — EVIDENCE-AC2):
  - Perf is a copy, not caller reference.
  - Resolved perf is a mutable isolated copy — isolation is by cloning, not freezing.
  - Mutations to input after resolution do not affect resolved copy.
  - Does not mutate caller settings object.
  - Undefined perf resolves to undefined.
  - Preserves perf fields through resolution.
- `perfSettingsMerge.behavior.test.ts` (8 tests — real `mergeSettings`):
  - Absent in all layers ⇒ no perf key.
  - User-only perf flows through.
  - Workspace replaces user perf (shallow merge at telemetry level).
  - Both layers set enabled — workspace wins.
  - Telemetry scalar fields coexist with perf across layers.
  - Untrusted workspace ignored.
  - System layer wins over user and workspace.
  - System defaults overridden by user.
- `perfSettingsValidation.behavior.test.ts` (14 tests — real Zod validation):
  - Accepts perf as object with enabled/memory (6 accepted shapes).
  - Rejects perf as boolean true/false (D2: not a boolean).
  - Rejects non-boolean enabled/memory.
  - Rejects unknown properties (additionalProperties: false).
  - Rejects string/number/array.

## Verify
- [x] AC-2 (settings half) evidenced; default-off; nested shape (D2).
- [x] No unrelated settings changed (config.ts: 0 lines changed).
- [x] typecheck/lint/prettier clean.
- [x] No CLI flags or env vars invented for perf.
- [x] Hierarchy fact-checked and corrected.
