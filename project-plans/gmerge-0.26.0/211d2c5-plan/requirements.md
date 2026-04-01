# Hooks Schema Split — Requirements (EARS Format)

**Upstream Commit:** 211d2c5fdd877c506cb38217075d1aee98245d2c
**Notation:** EARS (Easy Approach to Requirements Syntax)
**Requirement ID Prefix:** REQ-211-

---

## Terminology

- **`hooksConfig`** — The new top-level settings key for hooks system configuration (enabled, disabled, notifications).
- **`hooks`** — The top-level settings key containing only event-name-to-hook-definition mappings.
- **Config fields** — The three properties being moved: `enabled`, `disabled`, `notifications`.
- **Event keys** — Valid `HookEventName` values (e.g., `BeforeTool`, `AfterTool`).
- **Scope** — A settings file tier: system, system-defaults, user, or workspace.
- **Pure event map** — An object where every key is a `HookEventName` and every value is a `HookDefinition[]`.

---

## R1. Schema Changes

### REQ-211-S01 — New `hooksConfig` Settings Key [Ubiquitous]

The settings schema shall define a top-level `hooksConfig` key of type `object` with the following properties:
- `enabled` (boolean, default `false`) — Canonical toggle for the hooks system.
- `disabled` (array of strings, default `[]`) — List of hook names that are disabled.
- `notifications` (boolean, default `true`) — Whether to show visual indicators when hooks execute.

**Acceptance Criteria:**
- AC-S01.1: `SETTINGS_SCHEMA.hooksConfig` exists and has type `'object'`.
- AC-S01.2: `SETTINGS_SCHEMA.hooksConfig.properties` contains `enabled`, `disabled`, and `notifications` with the specified types and defaults.
- AC-S01.3: The `hooksConfig` schema defines `category: 'Advanced'` and `showInDialog: false`.
- AC-S01.4: The inferred `Settings` type includes `hooksConfig?: { enabled?: boolean; disabled?: string[]; notifications?: boolean }`.

### REQ-211-S02 — `hooks` Contains Only Event Definitions [Ubiquitous]

The `hooks` settings schema shall not define `enabled`, `disabled`, or `notifications` as properties. The `hooks` object shall contain only hook event definitions keyed by `HookEventName`.

**Acceptance Criteria:**
- AC-S02.1: `SETTINGS_SCHEMA.hooks.properties` does not contain keys `enabled`, `disabled`, or `notifications`.
- AC-S02.2: The default type of `SETTINGS_SCHEMA.hooks` is `{ [K in HookEventName]?: HookDefinition[] }` with no config field union.
- AC-S02.3: The `hooks` schema retains `mergeStrategy: SHALLOW_MERGE`.

### REQ-211-S03 — `hooksConfig` Merge Strategy [Ubiquitous]

The `hooksConfig` settings key shall use a merge strategy that allows individual scopes to override individual fields while inheriting unset fields from lower-priority scopes.

**Acceptance Criteria:**
- AC-S03.1: `SETTINGS_SCHEMA.hooksConfig.mergeStrategy` is `SHALLOW_MERGE`.

---

## R2. Settings-Load Migration

### REQ-211-M01 — Automatic Migration on Load [Event-driven]

When settings are loaded from disk, **if** the `hooks` object contains any of the keys `enabled`, `disabled`, or `notifications`, **then** those keys shall be moved to the `hooksConfig` object and removed from `hooks`.

**Acceptance Criteria:**
- AC-M01.1: A settings file containing `{ "hooks": { "enabled": true, "disabled": ["foo"], "BeforeTool": [...] } }` produces, after load, `hooksConfig.enabled === true`, `hooksConfig.disabled` containing `"foo"`, and `hooks` containing only `{ "BeforeTool": [...] }`.
- AC-M01.2: After migration, `hooks.enabled`, `hooks.disabled`, and `hooks.notifications` are `undefined` in the loaded settings object.

### REQ-211-M02 — Migration Applies to All Scopes [Ubiquitous]

The migration shall execute for every loadable settings scope (system, user, workspace) independently, before the settings merge step. The migration call-site shall be in `loadSettings()` in the settings loading module, following the same pattern as existing per-scope migrations.

**Acceptance Criteria:**
- AC-M02.1: Given a system settings file with `hooks.enabled: true` and a user settings file with `hooks.disabled: ["x"]`, the merged result has `hooksConfig.enabled === true` and `hooksConfig.disabled` containing `"x"`.
- AC-M02.2: The migration function is called for each scope before `mergeSettings()` is invoked.

### REQ-211-M03 — Migration Is Idempotent [Ubiquitous]

The migration shall produce the same result when applied to already-migrated settings.

**Acceptance Criteria:**
- AC-M03.1: A settings object with `hooksConfig: { enabled: true }` and `hooks: { "BeforeTool": [...] }` (no config keys in hooks) is returned unchanged.
- AC-M03.2: Applying the migration twice to the same input produces identical output both times.

### REQ-211-M04 — Migration Does Not Overwrite Existing `hooksConfig` Values [State-driven]

When `hooksConfig` already contains a value for a key being migrated, the existing `hooksConfig` value shall take precedence over the value in `hooks`.

**Acceptance Criteria:**
- AC-M04.1: Given `hooks: { enabled: false }` and `hooksConfig: { enabled: true }`, the result is `hooksConfig.enabled === true`.

---

## R3. Config Loading

### REQ-211-C01 — `enableHooks` Reads from `hooksConfig` [Ubiquitous]

The `getEnableHooks()` function shall determine whether hooks are enabled by reading `settings.hooksConfig?.enabled` instead of `settings.hooks?.enabled`.

**Acceptance Criteria:**
- AC-C01.1: When `hooksConfig.enabled` is `true` and `tools.enableHooks` is defaulted, `getEnableHooks()` returns `true`.
- AC-C01.2: When only `hooks.enabled` is `true` (old location) and `hooksConfig` is absent, `getEnableHooks()` returns `false` — the old location is no longer read by this function.
- AC-C01.3: When no hooks settings are provided, `getEnableHooks()` returns `false` (default behavior preserved).

### REQ-211-C02 — `hooks` Passed to Config Is a Pure Event Map [Ubiquitous]

The `hooks` parameter passed to the `Config` constructor shall be a pure event map containing no `enabled`, `disabled`, or `notifications` keys.

**Acceptance Criteria:**
- AC-C02.1: The `hooks` object passed to `new Config(...)` does not contain keys `enabled`, `disabled`, or `notifications`.
- AC-C02.2: The destructuring workaround (filtering `disabled` from `hooks`) is removed from CLI config loading.

### REQ-211-C03 — `disabledHooks` Is an Explicit Config Parameter [Ubiquitous]

The `disabledHooks` parameter shall be passed explicitly to the `Config` constructor from `settings.hooksConfig?.disabled`.

**Acceptance Criteria:**
- AC-C03.1: The `Config` constructor receives a `disabledHooks` parameter that is set from `hooksConfig.disabled`.
- AC-C03.2: The `Config` constructor initializes `this.disabledHooks` from `params.disabledHooks ?? []`.
- AC-C03.3: The post-construction `setDisabledHooks()` call in CLI config loading is removed.

---

## R4. Config Class (Core)

### REQ-211-CC01 — `Config` Constructor Uses `disabledHooks` Param [Ubiquitous]

The `Config` class shall initialize its disabled hooks list from the `disabledHooks` constructor parameter rather than leaving it as an empty array.

**Acceptance Criteria:**
- AC-CC01.1: Constructing a `Config` with `disabledHooks: ['x']` results in `getDisabledHooks()` returning a list containing `'x'`.
- AC-CC01.2: Constructing a `Config` with no `disabledHooks` results in `getDisabledHooks()` returning `[]`.

### REQ-211-CC02 — `projectHooks` Type Is Pure Event Map [Ubiquitous]

The `Config.projectHooks` private field type and `getProjectHooks()` return type shall be a pure event map without a `disabled` property. The `ConfigParameters.projectHooks` type is already event-only; this requirement aligns the private field and return type to match. Residual runtime assumptions (such as disabled-key filtering in the hook registry trust scan) shall be eliminated.

**Acceptance Criteria:**
- AC-CC02.1: TypeScript compilation fails if code attempts to read `.disabled` on the result of `config.getProjectHooks()`.
- AC-CC02.2: The private field `projectHooks` is typed without `& { disabled?: string[] }`.

### REQ-211-CC03 — SettingsService Persistence Key Updated [Ubiquitous]

The `getDisabledHooks()` and `setDisabledHooks()` methods shall persist disabled hooks under the settings key `'hooksConfig.disabled'` instead of `'hooks.disabled'`.

**Acceptance Criteria:**
- AC-CC03.1: After calling `config.setDisabledHooks(['a'])`, the settings service holds the value `['a']` under the key `'hooksConfig.disabled'`.
- AC-CC03.2: `setDisabledHooks()` does not write to the `'hooks.disabled'` key.
- AC-CC03.3: `getDisabledHooks()` reads from `'hooksConfig.disabled'` when the in-memory list is empty.

---

## R5. Hook Dispatch

### REQ-211-HD01 — Hook Registration Unaffected [Ubiquitous]

The hook registration system shall continue to use the `config.getDisabledHooks()` API to determine hook enablement. No changes to `hookRegistry.ts` registration logic are required.

**Acceptance Criteria:**
- AC-HD01.1: A hook whose name appears in the disabled hooks list is registered with `enabled: false`.
- AC-HD01.2: A hook whose name does not appear in the disabled hooks list is registered with `enabled: true`.

### REQ-211-HD02 — Hook Execution Guards Unchanged [Ubiquitous]

The `getEnableHooks()` method on the `Config` class shall continue to be the sole runtime check for whether the hook system is active.

**Acceptance Criteria:**
- AC-HD02.1: All hook trigger entry points check `config.getEnableHooks()` before dispatching.
- AC-HD02.2: No new hook dispatch guards referencing `hooksConfig` are introduced at the core level.

### REQ-211-HD03 — Hook Registry Trust Scan Treats Project Hooks as Pure Event Map [Ubiquitous]

The `checkProjectHooksTrust()` method in the hook registry shall not filter out a `disabled` pseudo-key when iterating project hook entries. Since `getProjectHooks()` returns a pure event map, no non-event keys exist to skip.

**Acceptance Criteria:**
- AC-HD03.1: The `if (key === 'disabled') continue;` guard in `checkProjectHooksTrust()` is removed.
- AC-HD03.2: The trust scan correctly processes all entries from `getProjectHooks()` without skipping any valid event keys.
- AC-HD03.3: Project hooks with all valid event names pass through the trust scan without false skips.

---

## R6. CLI Commands

### REQ-211-CMD01 — `/hooks` Command Uses Config API [Ubiquitous]

The `/hooks` slash command shall continue to use `config.getDisabledHooks()` and `config.setDisabledHooks()` for enable/disable operations. It shall not directly access settings objects.

**Acceptance Criteria:**
- AC-CMD01.1: Enable/disable operations call `config.setDisabledHooks()` which persists under the correct key.
- AC-CMD01.2: The `/hooks` command does not directly reference settings-level `hooks.disabled` or `hooksConfig.disabled` keys.

### REQ-211-CMD02 — User-Facing Messages Reference `hooksConfig.enabled` [Event-driven]

When the hooks system is not enabled, **if** the `/hooks list` command is invoked, **then** the message shall reference `hooksConfig.enabled` (not `hooks.enabled`) as the setting to change.

**Acceptance Criteria:**
- AC-CMD02.1: The info message displayed when hooks are not enabled contains `hooksConfig.enabled` instead of `hooks.enabled`.

---

## R7. Hooks Migration Command

### REQ-211-MIG01 — `hooks migrate` Operates on Pure Event Map [Ubiquitous]

The `hooks migrate` CLI command shall iterate over `settings.merged.hooks` entries and shall not need to filter out `disabled`, `enabled`, or `notifications` keys, because those keys shall no longer be present in `hooks`.

**Acceptance Criteria:**
- AC-MIG01.1: The `eventName === 'disabled'` guard in the migrate command is no longer necessary (can be removed or left harmlessly).
- AC-MIG01.2: The migrate command correctly copies event hook definitions from `hooks` to project settings without encountering config field keys.

---

## R8. UI Display

### REQ-211-UI01 — StatusDisplay Does Not Regress [Ubiquitous]

The `StatusDisplay` component shall continue to display hook status when active hooks are present, without referencing `hooks.notifications` or `hooksConfig.notifications`.

**Acceptance Criteria:**
- AC-UI01.1: Hook status display renders identically before and after the change when active hooks are present.
- AC-UI01.2: No new references to `hooksConfig` or `hooks.notifications` are introduced in `StatusDisplay`.

---

## R9. Settings Merge

### REQ-211-SM01 — `hooksConfig` Is Merged Across Scopes [Ubiquitous]

The `mergeSettings()` function shall merge `hooksConfig` objects from all scopes using shallow merge, following the same precedence order as other settings (schema defaults < system defaults < user < workspace < system overrides).

**Acceptance Criteria:**
- AC-SM01.1: Given user settings `hooksConfig: { enabled: true }` and workspace settings `hooksConfig: { disabled: ['x'] }`, the merged result has `enabled: true` and `disabled: ['x']`.
- AC-SM01.2: The merged output for `hooksConfig` reflects shallow merge semantics — higher-precedence scope fields override lower-precedence scope fields, while unset fields are inherited.

---

## R10. Testing

### REQ-211-T01 — Schema Helper Tests Updated [Ubiquitous]

All tests for `getEnableHooks()` and `getEnableHooksUI()` shall use the new `hooksConfig` settings structure.

**Acceptance Criteria:**
- AC-T01.1: Tests pass `hooksConfig: { enabled: true }` rather than `hooks: { enabled: true }`.
- AC-T01.2: Tests verify that `hooks: { enabled: true }` alone does NOT enable hooks (old path no longer works).

### REQ-211-T02 — Core Config Tests Updated [Ubiquitous]

Tests for `Config` construction and `getDisabledHooks()`/`setDisabledHooks()` shall use the new parameter and persistence key.

**Acceptance Criteria:**
- AC-T02.1: Tests that pass `disabledHooks: ['x']` to the constructor verify `getDisabledHooks()` returns a list containing `'x'`.
- AC-T02.2: Tests verify persistence under `'hooksConfig.disabled'` key.

### REQ-211-T03 — Hook System Tests Use Split Schema [Ubiquitous]

All hook system test files that construct mock configs shall provide `disabledHooks` as a separate parameter, not as a key within the `hooks` object.

**Acceptance Criteria:**
- AC-T03.1: No test file sets `hooks: { disabled: [...] }` — `disabled` is always in `disabledHooks` or `hooksConfig.disabled`.
- AC-T03.2: All existing hook system tests pass after the migration.

### REQ-211-T04 — Migration Function Tests [Ubiquitous]

The `migrateHooksConfig()` function shall have dedicated unit tests.

**Acceptance Criteria:**
- AC-T04.1: Test verifies old-format settings are correctly migrated (enabled, disabled, notifications moved to hooksConfig).
- AC-T04.2: Test verifies already-migrated settings are returned unchanged (idempotency).
- AC-T04.3: Test verifies that existing `hooksConfig` values are not overwritten by migrated values.
- AC-T04.4: Test verifies settings with no hooks are returned unchanged.
- AC-T04.5: Test verifies event hook definitions remain in `hooks` after migration.

### REQ-211-T05 — Integration Tests Use Split Schema [Ubiquitous]

Integration tests that construct settings objects with hooks shall use the split `hooksConfig` + `hooks` structure.

**Acceptance Criteria:**
- AC-T05.1: Integration tests use `hooksConfig: { enabled: true }` for hook enablement.
- AC-T05.2: All integration tests pass after the migration.

### REQ-211-T06 — CLI Config Loading Tests [Ubiquitous]

Tests shall verify that CLI config loading correctly extracts `disabledHooks` from `hooksConfig.disabled` and passes it to the `Config` constructor.

**Acceptance Criteria:**
- AC-T06.1: A test verifies that `effectiveSettings.hooksConfig.disabled` flows through to `config.getDisabledHooks()`.
- AC-T06.2: A test verifies that `effectiveSettings.hooks` does not contain `disabled` after loading.

---

## R11. Zero-Downgrade Constraint

### REQ-211-ZD01 — No Breaking Change for Existing Settings Files [Complex]

While the system is running with the updated schema, **if** a settings file uses the old schema format (config fields inside `hooks`), **then** the migration function shall transparently convert it, **so that** no user action is required and all hooks behavior is preserved.

**Acceptance Criteria:**
- AC-ZD01.1: Given a settings file containing `{ "hooks": { "enabled": true, "disabled": ["x"], "BeforeTool": [...] } }`, after loading: enabled hooks still evaluate (i.e., `getEnableHooks()` returns `true`), disabled hooks are still enforced (i.e., `getDisabledHooks()` includes `"x"`), and event hook definitions are retained in the `hooks` object (i.e., `hooks.BeforeTool` is present and correct).
- AC-ZD01.2: The settings file on disk is NOT modified by the migration (migration is in-memory only during load).

---

## R12. No Regressions

### REQ-211-NR01 — Full Verification Suite Passes [Ubiquitous]

After all changes, the full verification suite shall pass: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and the smoke test (`node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`).

**Acceptance Criteria:**
- AC-NR01.1: All commands exit with code 0.
- AC-NR01.2: No new TypeScript errors are introduced.
- AC-NR01.3: No test regressions.
