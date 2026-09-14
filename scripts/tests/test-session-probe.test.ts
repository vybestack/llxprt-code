/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end proof that the shared runner's spawn-time environment controls
 * Bun's process-cached home and temp directories (issue #3622). A direct
 * `bun test` invocation has no runner session and skips this probe.
 */

import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionRoot = process.env.LLXPRT_TEST_SESSION_ROOT;

describe('test session process environment', () => {
  it.skipIf(sessionRoot === undefined)(
    'resolves HOME, TMPDIR, and XDG directories inside the runner session root',
    () => {
      if (sessionRoot === undefined) {
        throw new Error('LLXPRT_TEST_SESSION_ROOT is required for this probe');
      }

      const sessionHome = join(sessionRoot, 'home', 'user');
      expect(homedir()).toBe(sessionHome);
      expect(tmpdir()).toBe(join(sessionRoot, 'tmp'));
      expect(process.env.XDG_CONFIG_HOME).toBe(join(sessionHome, '.config'));
      expect(process.env.XDG_CACHE_HOME).toBe(join(sessionHome, '.cache'));
      expect(process.env.XDG_DATA_HOME).toBe(
        join(sessionHome, '.local', 'share'),
      );
      expect(process.env.LLXPRT_TEST_DISABLE_OS_KEYRING).toBe('1');
      const receipt = process.env.LLXPRT_SESSION_PROBE_RECEIPT;
      if (receipt !== undefined) writeFileSync(receipt, sessionRoot);
    },
  );
});
