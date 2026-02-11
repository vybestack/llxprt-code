# Reimplement Plan: ea3d022c — AppHeader extraction + useBanner + persistentState

## Upstream Commit
- **SHA:** `ea3d022c8b9ec2de`
- **Subject:** fix(patch): cherry-pick 3e50be1 — AppHeader, useBanner, persistentState
- **Files touched:** 5 files

## Why REIMPLEMENT (not PICK)

LLxprt has no `AppHeader.tsx`. Banner/header rendering is inline in `DefaultAppLayout.tsx` (appears in TWO places — alternate buffer mode at ~line 197-210 and normal mode at ~line 449-462). LLxprt also has no `Banner.tsx`, no `bannerData`/`bannerVisible` state, and no `persistentState.ts`.

The user wants LLxprt to adopt the cleaner extracted component pattern rather than keeping the monolith.

## LLxprt Architecture Facts (Verified)

- `DefaultAppLayout.tsx` is at `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` (651 lines)
- `config` is passed as a **prop** (type `Config`), NOT from a context hook — there is NO `useConfig` or `ConfigContext` in LLxprt
- `settings` is passed as a **prop** (type `LoadedSettings`)
- `nightly` is passed as a **prop** (boolean)
- `Header.tsx` takes `terminalWidth`, `version`, `nightly` as props
- No `useConfig` context exists — contexts are: SettingsContext, SessionContext, UIStateContext, etc.
- No `persistentState.ts` exists anywhere in the codebase
- No `getPreviewFeatures()` method exists on Config — LLxprt doesn't have this concept
- LLxprt uses `DebugLogger` class instances (via `DebugLogger.getLogger(namespace)`), NOT a `debugLogger` singleton

## Implementation Plan (TDD per RULES.md)

### Phase 1: Create persistentState.ts (standalone utility)

**1a. RED — Write test first:**
Create `packages/cli/src/utils/persistentState.test.ts`:
- Test: `get()` returns `undefined` for unset key
- Test: `set()` then `get()` returns the value
- Test: persists to file (reads back after new instance creation)
- Test: handles corrupt JSON gracefully (returns `{}`, does not throw)
- Test: creates directory if it doesn't exist
- Mock `fs` and `Storage.getGlobalLlxprtDir()`

Run test — should fail (file doesn't exist).

**1b. GREEN — Create `packages/cli/src/utils/persistentState.ts`:**
- Port from upstream, adapting:
  - Import `Storage` from `@vybestack/llxprt-code-core`
  - Use `Storage.getGlobalLlxprtDir()` for state file location
  - Use `DebugLogger.getLogger('llxprt:persistentState')` for warn logging (not a `debugLogger` singleton)
  - Vybestack copyright
  - STATE_FILENAME = `'state.json'`
- Export `PersistentState` class + `persistentState` singleton
- Type-safe `PersistentStateData` interface with `defaultBannerShownCount?: Record<string, number>`

Run test — should pass.

**1c. Verify:** `npm run lint && npm run typecheck`

### Phase 2: Create AppHeader.tsx (extract from DefaultAppLayout)

**2a. RED — Write test first:**
Create `packages/cli/src/ui/components/AppHeader.test.tsx`:
- Test: renders Header when `hideBanner` is not set and not screen reader
- Test: renders Tips when `hideTips` is not set and not screen reader
- Test: does NOT render Header when settings has `hideBanner: true`
- Test: does NOT render Tips when settings has `hideTips: true`
- Test: does NOT render Header/Tips when config.getScreenReader() returns true
- Mock `Config` and `LoadedSettings` per existing test patterns in the project

Run test — should fail (AppHeader doesn't exist).

**2b. GREEN — Create `packages/cli/src/ui/components/AppHeader.tsx`:**

AppHeader takes props (NOT context hooks, since LLxprt passes config/settings/nightly as props):

```typescript
interface AppHeaderProps {
  config: Config;
  settings: LoadedSettings;
  version: string;
  nightly: boolean;
  terminalWidth: number;
}

export const AppHeader = ({ config, settings, version, nightly, terminalWidth }: AppHeaderProps) => {
  return (
    <Box flexDirection="column">
      {!(settings.merged.ui?.hideBanner || config.getScreenReader()) && (
        <Header terminalWidth={terminalWidth} version={version} nightly={nightly} />
      )}
      {!(settings.merged.ui?.hideTips || config.getScreenReader()) && (
        <Tips config={config} />
      )}
    </Box>
  );
};
```

Key: config and settings are PROPS, matching DefaultAppLayout's architecture.

Run test — should pass.

**2c. Update DefaultAppLayout.tsx:**
Replace BOTH inline header/tips blocks with `<AppHeader>`:
- Alternate buffer path (~line 197-210): replace fragment with `<AppHeader config={config} settings={settings} version={version} nightly={nightly} terminalWidth={terminalWidth} />`
- Normal mode path (~line 449-462): replace fragment with same `<AppHeader>` invocation

Run existing DefaultAppLayout tests — should still pass.

**2d. Verify:** `npm run lint && npm run typecheck && npm run test`

### Phase 3: Create useBanner hook

**3a. RED — Write test first:**
Create `packages/cli/src/ui/hooks/useBanner.test.ts`:
- Test: returns empty `bannerText` when both defaultText and warningText are empty
- Test: returns `warningText` when warningText is non-empty
- Test: returns `defaultText` when warningText is empty and shown count < max
- Test: returns empty string when defaultText shown count >= max (suppressed)
- Test: increments shown count in persistent state on first render
- Test: does NOT increment when defaultText is empty
- Test: idempotent — does not double-increment on re-render
- Test: replaces `\\n` with actual newlines in output
- Mock `persistentState` and `crypto.createHash`

Run test — should fail.

**3b. GREEN — Create `packages/cli/src/ui/hooks/useBanner.ts`:**
- Port from upstream, adapting:
  - Import `Config` from `@vybestack/llxprt-code-core`
  - Import `persistentState` from `../../utils/persistentState.js`
  - Vybestack copyright
  - **Remove `config.getPreviewFeatures()` check** — LLxprt has no preview features concept. The banner suppression logic simplifies to: show default banner if count < max, regardless of preview mode.
  - Keep the SHA-256 per-content tracking (good dedup mechanism)
  - Keep `DEFAULT_MAX_BANNER_SHOWN_COUNT = 5`

Run test — should pass.

**3c. Verify:** `npm run lint && npm run typecheck`

### Phase 4: Wire useBanner into AppHeader

**4a. Update AppHeader.tsx:**
- Add optional `bannerData` prop (default `{ defaultText: '', warningText: '' }`)
- Call `useBanner(bannerData, config)` inside AppHeader
- For now, render banner text as simple `<Text>` if non-empty (basic rendering)
- This is NOT the full `Banner.tsx` component with gradient styling — that can come in a future PR
- But the text IS visible (not deferred/hidden), so the hook has observable output

**4b. Update AppHeader.test.tsx:**
- Test: renders banner text when bannerData has non-empty defaultText
- Test: does not render banner when bannerData is not provided
- Test: renders warning text when warningText is non-empty

**4c. Update DefaultAppLayout.tsx:**
- If DefaultAppLayout has any future source of bannerData, pass it to AppHeader
- For now, no bannerData is passed (uses default empty), so banner is dormant but wired

**4d. Verify:** `npm run lint && npm run typecheck && npm run test`

## File Inventory

### New files:
| File | Description |
|------|-------------|
| `packages/cli/src/utils/persistentState.ts` | JSON-backed persistent state utility (new file) |
| `packages/cli/src/utils/persistentState.test.ts` | Tests for persistent state |
| `packages/cli/src/ui/components/AppHeader.tsx` | Extracted header component |
| `packages/cli/src/ui/components/AppHeader.test.tsx` | Tests for AppHeader |
| `packages/cli/src/ui/hooks/useBanner.ts` | Banner display state management hook |
| `packages/cli/src/ui/hooks/useBanner.test.ts` | Tests for useBanner |

### Modified files:
| File | Change |
|------|--------|
| `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` | Replace 2 inline header blocks with `<AppHeader>` |

## Preservation Checklist

- [ ] Vybestack copyright on all new files
- [ ] `@vybestack/llxprt-code-core` imports (never `@google/gemini-cli-core`)
- [ ] Config and settings passed as PROPS (no `useConfig` context — it doesn't exist)
- [ ] LLxprt's `Header` component receives `terminalWidth` prop — preserved
- [ ] `Storage.getGlobalLlxprtDir()` in persistentState (not `getGlobalGeminiDir`)
- [ ] `DebugLogger.getLogger()` pattern for logging (not `debugLogger` singleton)
- [ ] No `getPreviewFeatures()` call (doesn't exist in LLxprt) — simplified banner logic
- [ ] Tests are behavioral (verify outcomes, not implementation details)
- [ ] DefaultAppLayout.tsx existing tests still pass after extraction

## Risk Assessment

- **Low risk** — Clean extraction refactoring + utility creation
- **Main risk**: DefaultAppLayout.tsx is 651 lines; extracting the header requires care to not break the two rendering paths (alternate buffer vs normal)
- **Resolved**: Config access is via props, not context — plan now matches actual architecture
- **Banner visual**: Basic text rendering in Phase 4, not full gradient Banner.tsx. Full Banner component can be added later.
