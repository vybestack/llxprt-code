# Playbook: Default Folder Trust to Untrusted

**Upstream SHA:** `6f4b2ad0b95a3c7db26a3475105d3c8d74dcadb4`
**Upstream Subject:** fix: default folder trust to untrusted for enhanced security
**Upstream Stats:** 6 files, 101 insertions

## What Upstream Does

Changes the **default folder trust behavior** from "trusted" to "untrusted" when folder trust is enabled but no explicit trust decision has been made yet. This is a **security hardening** change that forces users to explicitly trust folders rather than implicitly trusting them on first run.

Key changes:
1. **CLI config:** `trustedFolder` default changes from `true` to `false` when trust is undefined
2. **Core config:** `isTrustedFolder()` now returns `false` (instead of `true`) when `folderTrust` is enabled and no explicit value is set
3. **UI hook:** `useFolderTrust.ts` changes the "was trusted" assumption from `true` to `false` when `isTrusted` is undefined
4. **Tests:** Multiple test updates to handle the new default, including a new test for unmounting before timeout

The rationale: "trusted by default" defeats the purpose of the folder trust feature. Users should explicitly opt-in to trusting folders.

## LLxprt Adaptation Strategy

LLxprt **has folder trust** (confirmed by finding `useFolderTrust` references), so this change applies directly. The upstream logic is straightforward:

- Change **3 default values** from `true` to `false`
- Update **restart logic** in `useFolderTrust` to handle implicit→explicit trust transitions correctly
- Add **test coverage** for the new behavior

No conceptual differences from upstream — this is a 1:1 port.

## Files to Create/Modify

### 1. Update CLI Config Default
**File:** `packages/cli/src/config/config.ts`
**Change:** Line ~416 (in `loadCliConfig()`)
```typescript
// OLD:
const trustedFolder = isWorkspaceTrusted(settings)?.isTrusted ?? true;

// NEW:
const trustedFolder = isWorkspaceTrusted(settings)?.isTrusted ?? false;
```
**Explanation:** When folder trust is enabled but no decision has been made yet, default to **untrusted** instead of trusted.

### 2. Update Core Config Logic
**File:** `packages/core/src/config/config.ts`
**Change:** Lines ~1428-1438 (in `isTrustedFolder()` method)

**OLD:**
```typescript
isTrustedFolder(): boolean {
  const context = ideContextStore.get();
  if (context?.workspaceState?.isTrusted !== undefined) {
    return context.workspaceState.isTrusted;
  }

  return this.trustedFolder ?? true;
}
```

**NEW:**
```typescript
isTrustedFolder(): boolean {
  const context = ideContextStore.get();
  if (context?.workspaceState?.isTrusted !== undefined) {
    return context.workspaceState.isTrusted;
  }

  // Default to untrusted if folder trust is enabled and no explicit value is set.
  return this.folderTrust ? (this.trustedFolder ?? false) : true;
}
```
**Explanation:** When folder trust is **enabled**, default to `false`. When folder trust is **disabled**, return `true` (no restrictions).

### 3. Update Folder Trust Dialog Test
**File:** `packages/cli/src/ui/components/FolderTrustDialog.test.tsx`

**a) Add missing imports (line 10):**
```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
```

**b) Fix test expectation (line ~77):**
```typescript
// OLD:
expect(lastFrame()).toContain(' Gemini CLI is restarting');

// NEW:
expect(lastFrame()).toContain('Gemini CLI is restarting');
```
(Removes leading space — minor formatting fix)

**c) Add new test (lines 91-103):**
```typescript
it('should not call relaunchApp if unmounted before timeout', async () => {
  vi.useFakeTimers();
  const relaunchApp = vi.spyOn(processUtils, 'relaunchApp');
  const { unmount } = renderWithProviders(
    <FolderTrustDialog onSelect={vi.fn()} isRestarting={true} />,
  );

  // Unmount immediately (before 250ms)
  unmount();

  await vi.advanceTimersByTimeAsync(250);
  expect(relaunchApp).not.toHaveBeenCalled();
  vi.useRealTimers();
});
```
**Explanation:** Prevents memory leaks if dialog is unmounted before the relaunch timer fires.

### 4. Update Folder Trust Dialog Component
**File:** `packages/cli/src/ui/components/FolderTrustDialog.tsx`

**a) Add import (line 8):**
```typescript
import { useEffect, useState, useCallback } from 'react';
```

**b) Refactor restart effect (lines 36-45):**

**OLD:**
```typescript
useEffect(() => {
  const doRelaunch = async () => {
    if (isRestarting) {
      setTimeout(async () => {
        await relaunchApp();
      }, 250);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  doRelaunch();
}, [isRestarting]);
```

**NEW:**
```typescript
useEffect(() => {
  let timer: ReturnType<typeof setTimeout>;
  if (isRestarting) {
    timer = setTimeout(async () => {
      await relaunchApp();
    }, 250);
  }
  return () => {
    if (timer) clearTimeout(timer);
  };
}, [isRestarting]);
```
**Explanation:** Properly cleans up the timer on unmount.

**c) Refactor exit handler (lines 47-57):**

**OLD:**
```typescript
useKeypress(
  (key) => {
    if (key.name === 'escape') {
      setExiting(true);
      setTimeout(async () => {
        await runExitCleanup();
        process.exit(ExitCodes.FATAL_CANCELLATION_ERROR);
      }, 100);
    }
  },
  { isActive: !isRestarting },
);
```

**NEW:**
```typescript
const handleExit = useCallback(() => {
  setExiting(true);
  // Give time for the UI to render the exiting message
  setTimeout(async () => {
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_CANCELLATION_ERROR);
  }, 100);
}, []);

useKeypress(
  (key) => {
    if (key.name === 'escape') {
      handleExit();
    }
  },
  { isActive: !isRestarting },
);
```
**Explanation:** Extracts callback to improve testability and readability.

### 5. Update Folder Trust Hook Tests
**File:** `packages/cli/src/ui/hooks/useFolderTrust.test.ts`

**a) Add missing imports (line 7-15):**
```typescript
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
  type MockInstance,
} from 'vitest';
```

**b) Update test expectations for restart behavior:**

Several tests need updates to reflect the new logic:
- **Line 130:** "should handle TRUST_FOLDER choice and trigger restart" — expect `isRestarting: true`
- **Line 169:** "should handle TRUST_PARENT choice and trigger restart" — expect `isRestarting: true`
- **Line 199:** "should handle DO_NOT_TRUST choice and NOT trigger restart (implicit → explicit)" — expect `isRestarting: false` (no restart when going from implicit untrusted to explicit untrusted)
- **Line 265:** "should not set isRestarting to true when trust status does not change (true → true)" — keep current behavior

**c) Key logic change in test on line 199:**
The test for `DO_NOT_TRUST` now expects **no restart** because:
- Old default: `isTrusted` is `undefined` → assumed `true` → explicit `false` triggers restart
- New default: `isTrusted` is `undefined` → assumed `false` → explicit `false` is a no-op

### 6. Update Folder Trust Hook Implementation
**File:** `packages/cli/src/ui/hooks/useFolderTrust.ts`

**a) Simplify choice handler (lines 52-96):**

**OLD:**
```typescript
const handleFolderTrustSelect = useCallback(
  (choice: FolderTrustChoice) => {
    const trustedFolders = loadTrustedFolders();
    const cwd = process.cwd();
    let trustLevel: TrustLevel;

    const wasTrusted = isTrusted ?? true; // <-- OLD DEFAULT

    switch (choice) {
      case FolderTrustChoice.TRUST_FOLDER:
        trustLevel = TrustLevel.TRUST_FOLDER;
        break;
      case FolderTrustChoice.TRUST_PARENT:
        trustLevel = TrustLevel.TRUST_PARENT;
        break;
      case FolderTrustChoice.DO_NOT_TRUST:
        trustLevel = TrustLevel.DO_NOT_TRUST;
        break;
      default:
        return;
    }
    // ... rest
  },
  [isTrusted, onTrustChange, addItem],
);
```

**NEW:**
```typescript
const handleFolderTrustSelect = useCallback(
  (choice: FolderTrustChoice) => {
    const trustLevelMap: Record<FolderTrustChoice, TrustLevel> = {
      [FolderTrustChoice.TRUST_FOLDER]: TrustLevel.TRUST_FOLDER,
      [FolderTrustChoice.TRUST_PARENT]: TrustLevel.TRUST_PARENT,
      [FolderTrustChoice.DO_NOT_TRUST]: TrustLevel.DO_NOT_TRUST,
    };

    const trustLevel = trustLevelMap[choice];
    if (!trustLevel) return;

    const cwd = process.cwd();
    const trustedFolders = loadTrustedFolders();

    // ... setValue logic ...

    const currentIsTrusted =
      trustLevel === TrustLevel.TRUST_FOLDER ||
      trustLevel === TrustLevel.TRUST_PARENT;

    onTrustChange(currentIsTrusted);
    setIsTrusted(currentIsTrusted);

    // logic: we restart if the trust state *effectively* changes from the previous state.
    // previous state was `isTrusted`. If undefined, we assume false (untrusted).
    const wasTrusted = isTrusted ?? false; // <-- NEW DEFAULT

    if (wasTrusted !== currentIsTrusted) {
      setIsRestarting(true);
      setIsFolderTrustDialogOpen(true);
    } else {
      setIsFolderTrustDialogOpen(false);
    }
  },
  [isTrusted, onTrustChange, addItem],
);
```

**Explanation:** The key change is `wasTrusted = isTrusted ?? false` (was `true`). This makes "implicit untrusted → explicit untrusted" a no-op (no restart).

## Implementation Steps

1. **Update CLI config default:**
   - Edit `packages/cli/src/config/config.ts`
   - Change `trustedFolder` default from `?? true` to `?? false`

2. **Update core config logic:**
   - Edit `packages/core/src/config/config.ts`
   - Update `isTrustedFolder()` method to return `false` when folder trust is enabled and `trustedFolder` is undefined

3. **Update dialog component:**
   - Edit `FolderTrustDialog.tsx`
   - Refactor `useEffect` to properly clean up timer
   - Extract `handleExit` callback

4. **Update dialog tests:**
   - Edit `FolderTrustDialog.test.tsx`
   - Add new test for unmount cleanup
   - Fix minor formatting issue in existing test

5. **Update hook implementation:**
   - Edit `useFolderTrust.ts`
   - Change `wasTrusted` default from `?? true` to `?? false`
   - Simplify switch statement to map-based lookup

6. **Update hook tests:**
   - Edit `useFolderTrust.test.ts`
   - Update expectations for all 4 affected tests
   - Key: DO_NOT_TRUST no longer triggers restart when implicitly untrusted

7. **Manual testing:**
   - Enable folder trust in settings
   - Open a new project (no trust decision yet)
   - Verify dialog appears
   - Verify "Do Not Trust" does **not** restart (implicit→explicit untrusted)
   - Verify "Trust Folder" **does** restart (untrusted→trusted)

## Execution Notes

- **Batch group:** Security
- **Dependencies:** None (but logically follows folder trust feature)
- **Verification:** `npm run typecheck && npm run lint && npm run test`
- **Estimated magnitude:** Small — 6 files, mostly logic tweaks and test updates
- **Risk:** Low-medium — changes default behavior, but well-tested upstream
- **Critical gotcha:** This **breaks** any automation that assumes folders are trusted by default. Document this as a security improvement.
- **User impact:** Users who enable folder trust will now be prompted to explicitly trust folders on first run, even for previously "implicitly trusted" folders. This is intentional.
