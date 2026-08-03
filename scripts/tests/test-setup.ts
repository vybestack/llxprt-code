/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const patched = {
    ...actual,
    appendFileSync: vi.fn(),
  };
  // Re-expose the patched namespace as the default export as well. Spreading
  // the module namespace drops `default`, which breaks `import fs from 'fs'`
  // consumers, and leaving the original `default` in place would hand them an
  // unpatched `appendFileSync`.
  return { ...patched, default: patched };
});
