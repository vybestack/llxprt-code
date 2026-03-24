# Playbook: Show Settings Source in Extensions Lists

**Upstream SHA:** `77e226c55fe`
**Upstream Subject:** Show settings source in extensions lists (#16207)
**Upstream Stats:** extensions/config/UI change; small-to-moderate LLxprt adaptation

## What Upstream Does

Upstream annotates resolved extension settings with provenance so extension-listing UX can show where each effective value came from instead of only showing the final value. In practice that means the extension list still renders each resolved setting, but now also surfaces whether the winning value came from user scope, workspace scope, or a fallback/default path.

## Why REIMPLEMENT in LLxprt

1. LLxprt already renders `resolvedSettings` in `packages/cli/src/ui/components/views/ExtensionsList.tsx`, so the UI surface already exists.
2. LLxprt's current resolved setting objects do not carry source metadata.
3. `packages/cli/src/config/extensions/settingsIntegration.ts` already has the authoritative merge behavior for extension settings, and it merges user first then workspace, with workspace overriding only when a workspace value is actually set.
4. `packages/cli/src/config/extension.ts` currently returns `resolvedSettings`, but the resolution block is effectively stubbed and does not expose provenance.
5. This should follow LLxprt architecture rather than upstream's exact command/config plumbing: keep LLxprt naming, use the existing settings integration layer as the source of truth, and make the extension hydration flow async-aware only where LLxprt already allows it.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/cli/src/ui/components/views/ExtensionsList.tsx` — already renders `ext.resolvedSettings`
- [OK] `packages/cli/src/config/extensions/settingsIntegration.ts` — contains scope enum and merge logic; user loads first, workspace overrides second
- [OK] `packages/cli/src/config/extensions/settingsIntegration.test.ts` — existing settings integration test file to extend
- [OK] `packages/cli/src/config/extension.ts` — extension hydration returns `resolvedSettings`, but current implementation is a stub/TODO
- [OK] `packages/core/src/config/config.ts` — `resolvedSettings?: Array<Record<string, unknown>>` on extension-facing shape

**Likely also involved after reading current call sites:**
- [OK] `packages/cli/src/config/extension.ts` call paths that load/hydrate extension manifests for UI listing
- [OK] any existing tests around extension hydration/listing if present in the repo

**Do not create new architecture layers for this batch unless required by current tests.**

## Files to Modify/Create

### Modify: `packages/cli/src/config/extension.ts`
- Extend the local resolved-setting shape so hydrated extension metadata can include a setting source field.
- Replace the current `resolvedSettings` TODO/stub with real resolution grounded in LLxprt's existing settings integration functions.
- Ensure the returned objects preserve current masked display semantics for sensitive settings and `[not set]` behavior for unset values, while also adding source metadata for the UI.

### Modify: `packages/cli/src/config/extensions/settingsIntegration.ts`
- Add or expose a helper that returns resolved extension settings with provenance.
- Reuse the existing merge order already established here: load user scope, then overlay workspace scope only for defined values.
- Keep this file as the source of truth for effective-value selection rather than duplicating merge logic in UI code.

### Modify: `packages/cli/src/config/extensions/settingsIntegration.test.ts`
- Add behavioral coverage for provenance/source reporting.
- Verify user-only, workspace-override, and unset/default cases.
- Verify sensitive settings remain masked in the display-facing resolved output if that masking is done here.

### Modify: `packages/cli/src/ui/components/views/ExtensionsList.tsx`
- Update the settings rendering to include the provenance label next to the existing rendered setting value.
- Keep the current LLxprt list layout and naming conventions; this is a small rendering enhancement, not a redesign.

### Optional small type update if needed by compilation
- If LLxprt has a typed `ResolvedExtensionSetting` interface or equivalent shared extension metadata type, update it in the existing file where it already lives rather than inventing a new type file.

## Preflight Checks

```bash
# Confirm the batch files exist and inspect the current TODO/stub state
sed -n '300,380p' packages/cli/src/config/extension.ts

# Confirm the existing merge order and scope helpers
sed -n '240,360p' packages/cli/src/config/extensions/settingsIntegration.ts

# Confirm current extension list rendering of resolvedSettings
sed -n '1,160p' packages/cli/src/ui/components/views/ExtensionsList.tsx

# Confirm current tests available for extension settings integration
sed -n '1,260p' packages/cli/src/config/extensions/settingsIntegration.test.ts
```

## Implementation Steps

1. **Read the current extension hydration path in `packages/cli/src/config/extension.ts`.**
   - Identify where extension manifests are loaded for the installed-extensions UI.
   - Confirm whether the surrounding path is already async or whether there is an async variant used by the CLI/UI list flow.
   - Preserve LLxprt architecture and avoid broad signature churn unless the current caller path already supports async loading.

2. **Define the resolved-setting output shape in the existing extension/config typing layer.**
   - Add a source field using LLxprt naming aligned with current conventions, e.g. `source: 'user' | 'workspace' | 'default'` if no local convention says otherwise.
   - Do not rename existing fields that downstream UI already expects (`name`, `value`, etc.).

3. **Implement provenance-aware resolution in `settingsIntegration.ts`.**
   - Start from `loadExtensionSettingsFromManifest()` for the canonical declared setting list.
   - Load user-scoped values with `getScopedEnvContents(..., ExtensionSettingScope.USER)`.
   - Load workspace-scoped values with `getScopedEnvContents(..., ExtensionSettingScope.WORKSPACE)`.
   - Compute the effective value exactly the same way LLxprt already merges settings: user baseline, then workspace override when present.
   - For each declared setting, emit:
     - display value (`[not set]`, masked sensitive placeholder, or plain value)
     - provenance/source (`workspace` if workspace provided the winning value; `user` if only user did; otherwise `default` / unset fallback)
   - Keep the current merge semantics frozen to `CHERRIES.md` / current repo behavior.

4. **Wire `extension.ts` to use the provenance-aware resolver instead of the current placeholder array.**
   - Return actual resolved settings for extensions that declare settings.
   - Keep non-settings extensions returning an empty list.
   - Avoid embedding settings merge knowledge directly here; call the integration helper.

5. **Update `ExtensionsList.tsx` to show the source label.**
   - Preserve the current list format.
   - Example acceptable LLxprt-style rendering: `- apiKey: [value stored in keychain] (workspace)`.
   - Do not add color/formatting complexity beyond current local conventions unless it is already used nearby.

6. **Add tests in `settingsIntegration.test.ts` and any nearby extension-hydration test location if needed.**
   - user-only value reports source `user`
   - workspace value overrides user and reports source `workspace`
   - unset value reports `[not set]` with fallback/default source
   - sensitive value stays masked while still reporting the correct source

7. **Run verification for this batch scope.**
   - At minimum: `npm run lint`, `npm run typecheck`
   - Prefer targeted tests for settings integration / extension listing if present and stable

## Verification

```bash
npm run lint
npm run typecheck
npm run test -- --reporter=verbose packages/cli/src/config/extensions/settingsIntegration.test.ts
# If an extension listing/UI test already exists in-repo, run it too.
```

## Execution Notes/Risks

- **Key repo fact:** `ExtensionsList.tsx` already renders `resolvedSettings`; the missing part is provenance in the data, not a brand-new list surface.
- **Key repo fact:** current resolved setting values do not carry user/workspace source metadata.
- **Key repo fact:** `settingsIntegration.ts` merges user then workspace, and that ordering is the frozen source of truth for this batch.
- **Risk:** `packages/cli/src/config/extension.ts` currently shows a TODO about async settings resolution. Keep the adaptation narrowly scoped to the current extension loading path; do not redesign extension hydration across the repo unless strictly necessary for correct current behavior.
- **Risk:** `default` here really means “no explicit user/workspace value won.” If the repo has no true manifest default-value concept for extension settings, document and test the actual LLxprt behavior rather than inventing one.
- **Do not** move merge logic into the UI.
- **Do not** edit unrelated extension command files for this batch.
- **Do not** copy upstream naming or flow if it fights LLxprt's existing extension/config structure.
