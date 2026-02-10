# Cleanup + Upstream-Parity Plan: `ab11b2c27` + `555e25e63` (History Message Componentization)

## Scope

This plan is a **follow-up cleanup** for the already-completed `ab11b2c27` reimplementation, with two goals:

1. **Match upstream cleanliness** for history message rendering by componentizing the profile-change row (instead of rendering via generic `InfoMessage` in `HistoryItemDisplay.tsx`).
2. **Implement the previously NO_OP formatting intent from `555e25e63`** in LLxprt’s current architecture, adapted to the profile-change message component.

We are not redoing model-router behavior. We are improving structure and presentation quality in LLxprt’s chosen profile-change implementation.

---

## Upstream Context (Ground Truth)

### `ab11b2c27` (Show model in history)
Upstream introduced:
- `packages/cli/src/ui/components/messages/ModelMessage.tsx` (new)
- a new history item type (`type: 'model'`)
- `HistoryItemDisplay` branch that renders `<ModelMessage model={...} />`

### `555e25e63` (Formatting tweak)
Upstream changed only `ModelMessage.tsx` formatting:
- `marginLeft={3}` -> `marginLeft={2}`
- text `responding with` -> `Responding with`

In LLxprt we reimplemented `ab11` as **profile-change-in-history** (not model-in-history), and therefore the upstream `ModelMessage.tsx` path became non-applicable. This cleanup applies the same componentization/formatting spirit to LLxprt’s profile-change path.

---

## Current LLxprt State (Before Cleanup)

### Existing behavior
- `useGeminiStream.ts` emits:
  - `type: 'profile_change'`
  - `profileName`
- `types.ts` defines `HistoryItemProfileChange`.
- `HistoryItemDisplay.tsx` currently renders profile change inline via `InfoMessage`:
  - `text={\`Switched to profile: ${itemForDisplay.profileName}\`}`

### Architectural smell
- `HistoryItemDisplay.tsx` is already a large dispatcher.
- New message-type display logic was added inline rather than creating a dedicated message component like upstream did for model messages.

---

## Target Outcome

After this cleanup:
1. `HistoryItemDisplay` keeps dispatch-only responsibility for profile-change rows.
2. A dedicated `ProfileChangeMessage` component exists under `components/messages/`.
3. Profile-change rendering uses formatting equivalent in spirit to upstream `555e25e63` polish:
   - compact left margin
   - sentence-style capitalization
4. Existing behavior semantics remain unchanged:
   - still profile-name changes
   - still guarded by `showProfileChangeInChat`
   - still no model-router integration

---

## Files to Modify

### Production files
1. `packages/cli/src/ui/components/messages/ProfileChangeMessage.tsx` (**NEW**)
2. `packages/cli/src/ui/components/HistoryItemDisplay.tsx` (replace inline profile-change `InfoMessage` branch with dedicated component)

### Test files
3. `packages/cli/src/ui/components/HistoryItemDisplay.test.tsx` (update/add assertions)
4. `packages/cli/src/ui/components/messages/ProfileChangeMessage.test.tsx` (**NEW**)

### Optional snapshot updates (if needed)
5. `packages/cli/src/ui/components/__snapshots__/HistoryItemDisplay.test.tsx.snap`

---

## Behavior Requirements

### Functional requirements
1. Profile-change history items continue rendering when `item.type === 'profile_change'`.
2. Rendered text remains semantically equivalent:
   - still conveys profile switch and profile name.
3. No changes to emission conditions in `useGeminiStream` (first-turn guard, unchanged guard, setting gate, null/empty guard all preserved).

### Presentation requirements (parity intent with `555e25e63`)
1. Message component should use compact indent consistent with upstream polishing intent (left offset reduced equivalent).
2. Message sentence should use title/sentence case style (`Switched ...` / `Responding ...` style, not all-lowercase phrase).
3. Styling should remain subtle and non-warning-like (this is informational status, not warning severity).

---

## TDD Workflow (MANDATORY)

## Phase 1 — RED (Write failing tests first)

### 1A. Add dedicated component tests
Create `ProfileChangeMessage.test.tsx` with failing tests:

- renders profile name in message text
- uses compact left margin layout (assert structural output/snapshot)
- does **not** use warning icon semantics (`ℹ`) by default

### 1B. Update HistoryItemDisplay tests
In `HistoryItemDisplay.test.tsx`, add/adjust failing tests:

- `profile_change` item renders profile change message text
- (optional) spy/mock message component import to verify branch dispatch calls dedicated component

Run targeted tests and confirm they fail before implementation:

```bash
npm run test -- packages/cli/src/ui/components/messages/ProfileChangeMessage.test.tsx
npm run test -- packages/cli/src/ui/components/HistoryItemDisplay.test.tsx
```

## Phase 2 — GREEN (Minimal implementation)

### 2A. Add component
Create `ProfileChangeMessage.tsx` as a focused presentational component.

Recommended shape (adapt to local conventions):
- props: `{ profileName: string }`
- `Box` with compact left margin (parity with upstream spacing polish)
- `Text` with subtle comment/dim color style
- message text with sentence-case capitalization, e.g. `Switched to profile: {profileName}`

### 2B. Wire HistoryItemDisplay
In `HistoryItemDisplay.tsx`:
- import new component
- replace inline `InfoMessage` usage for `profile_change` with `<ProfileChangeMessage profileName={...} />`

Keep all other branches unchanged.

## Phase 3 — REFACTOR

1. Ensure no duplicate string literals if profile-change text is repeated elsewhere.
2. Keep `HistoryItemDisplay` branch minimal and consistent with other message-type branches.
3. If snapshots changed only cosmetically, verify they are intentional and limited.

---

## Negative Checks (Do NOT change)

1. Do **not** reintroduce upstream `type: 'model'` history events.
2. Do **not** add `showModelInfoInChat` or `ServerGeminiEventType.ModelInfo` handling.
3. Do **not** alter `useGeminiStream` profile-change detection logic in this cleanup, except if strictly needed for typing/import cleanup.
4. Do **not** route this through warning semantics/icons (avoid `InfoMessage` default warning color/icon behavior for this row).
5. Do **not** touch provider/model routing architecture.

---

## Verification

### Targeted verification during work

```bash
npm run test -- packages/cli/src/ui/components/messages/ProfileChangeMessage.test.tsx
npm run test -- packages/cli/src/ui/components/HistoryItemDisplay.test.tsx
npm run lint
npm run typecheck
```

### Required full verification before completion

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

## Suggested Commit Message

`refactor(ui): componentize profile-change history message and apply upstream formatting parity`

---

## Audit/Plan Documentation Follow-up

After implementation, update these docs:

1. `project-plans/gmerge-0.17.1/NOTES.md`
   - add entry for this cleanup follow-up
2. `project-plans/gmerge-0.17.1/AUDIT.md`
   - keep `ab11b2c27` as REIMPLEMENTED
   - add note that `555e25e63` formatting intent is now realized via LLxprt profile-change componentization
3. (Optional) `project-plans/gmerge-0.17.1/SUMMARY.md`
   - mention post-sync cleanup to reduce `HistoryItemDisplay` inline rendering and align with upstream componentization quality
