# REIMPLEMENT Playbook: d8e9db3 — package.ts add debugLogger to catch

## Upstream Change Summary

**Commit:** d8e9db3
**Author:** A.K.M. Adib
**Message:** address feedback

> PREREQUISITE: Assumes 43846f4 changes already applied.
> This playbook is a minimal follow-up delta on top of 43846f4.
> It ONLY covers adding debugLogger logging to the catch block
> and renaming the test variable.

### Changes in d8e9db3 (delta from 43846f4)

1. `package.ts` — add `import { debugLogger }`, change `catch (_error)` to `catch (error)`, add `debugLogger.error()` call
2. `package.test.ts` — rename `mockPackageJson` to `expectedPackageJsonResult` and update references

---

## LLxprt Current State (after 43846f4 applied)

### File: `packages/core/src/utils/package.ts`

After 43846f4, the file looks like:

```typescript
import {
  readPackageUp,
  type PackageJson as BasePackageJson,
} from 'read-package-up';

export type PackageJson = BasePackageJson & {
  config?: {
    sandboxImageUri?: string;
  };
};

export async function getPackageJson(
  cwd: string,
): Promise<PackageJson | undefined> {
  try {
    const result = await readPackageUp({ cwd, normalize: false });
    if (!result) {
      return undefined;
    }

    return result.packageJson;
  } catch (_error) {
    // Error logging added in follow-up commit d8e9db3
    return undefined;
  }
}
```

### File: `packages/core/src/utils/package.test.ts`

After 43846f4, the "found" test uses `mockPackageJson` as the variable name.

---

## Adaptation Plan

### Step 1: Update package.ts — add debugLogger import and use it in catch

**File:** `packages/core/src/utils/package.ts`

Add the import:
```typescript
import { debugLogger } from './debugLogger.js';
```

Change the catch block from:
```typescript
  } catch (_error) {
    // Error logging added in follow-up commit d8e9db3
    return undefined;
  }
```

To:
```typescript
  } catch (error) {
    debugLogger.error('Error occurred while reading package.json', error);
    return undefined;
  }
```

**Full file after d8e9db3:**
```typescript
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  readPackageUp,
  type PackageJson as BasePackageJson,
} from 'read-package-up';
import { debugLogger } from './debugLogger.js';

export type PackageJson = BasePackageJson & {
  config?: {
    sandboxImageUri?: string;
  };
};

/**
 * Reads package.json from the current directory or any parent directory.
 *
 * @param cwd - The directory to start searching from (searches upward to filesystem root)
 * @returns The package.json object if found, or `undefined` if no package.json exists
 *          in the directory hierarchy.
 */
export async function getPackageJson(
  cwd: string,
): Promise<PackageJson | undefined> {
  try {
    const result = await readPackageUp({ cwd, normalize: false });
    if (!result) {
      return undefined;
    }

    return result.packageJson;
  } catch (error) {
    debugLogger.error('Error occurred while reading package.json', error);
    return undefined;
  }
}
```

### Step 2: Update package.test.ts — rename variable

**File:** `packages/core/src/utils/package.test.ts`

The only change in d8e9db3 to the test file is renaming `mockPackageJson`
to `expectedPackageJsonResult` everywhere in the "should return packageJson when found" test.

```typescript
// BEFORE (43846f4 name):
const mockPackageJson = { name: 'test-pkg', version: '1.2.3' };
vi.mocked(readPackageUp).mockResolvedValue({
  packageJson: mockPackageJson,
  path: '/path/to/package.json',
});

const result = await getPackageJson('/some/path');
expect(result).toEqual(mockPackageJson);

// AFTER (d8e9db3 rename):
const expectedPackageJsonResult = { name: 'test-pkg', version: '1.2.3' };
vi.mocked(readPackageUp).mockResolvedValue({
  packageJson: expectedPackageJsonResult,
  path: '/path/to/package.json',
});

const result = await getPackageJson('/some/path');
expect(result).toEqual(expectedPackageJsonResult);
```

No other test changes. The `it.each` cases remain identical.

---

## Files to Read

| File | Purpose |
|------|---------|
| `packages/core/src/utils/package.ts` | Verify 43846f4 state before applying delta |
| `packages/core/src/utils/debugLogger.ts` | Confirm debugLogger export name and usage pattern |
| `packages/core/src/utils/package.test.ts` | Verify current variable name to rename |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/utils/package.ts` | Add debugLogger import, change `_error` to `error`, add `.error()` call |
| `packages/core/src/utils/package.test.ts` | Rename `mockPackageJson` to `expectedPackageJsonResult` |

---

## Specific Verification

```bash
# 1. Run package tests
npm run test -- packages/core/src/utils/package.test.ts

# 2. Run all utils tests
npm run test -- packages/core/src/utils/

# 3. Run full test suite
npm run test
```

---

## Technical Notes

### debugLogger usage pattern

Check `packages/core/src/utils/debugLogger.ts` for the correct import and API.
The expected pattern based on usage elsewhere in the codebase is a module-level
singleton logger, e.g.:

```typescript
import { debugLogger } from './debugLogger.js';
debugLogger.error('message', errorObject);
```

Verify the actual API before implementing.

### Why rename mockPackageJson?

`expectedPackageJsonResult` more clearly expresses test intent — it is the
value we expect the function to return, not just a mock placeholder.
