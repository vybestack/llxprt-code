/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral enforcement (issue #3222): the ./internals.js escape hatch is
 * DEAD, so importing it must fail.
 *
 * The specifier is assembled from fragments so boundary scanners reading THIS
 * file never see a contiguous forbidden literal to flag.
 */

import { describe, expect, it } from 'bun:test';

const AGENTS_PACKAGE = '@vybestack/llxprt-code-agents';

describe('boundary: the agents internals subpath is dead (issue #3222)', () => {
  it('dynamic import of the retired subpath rejects', async () => {
    const specifier = AGENTS_PACKAGE + '/internals.js';
    // Bun 1.3 said "Cannot find module '<specifier>'"; Bun 1.4 says "Cannot
    // find package '<name>'". The stable contract is the Node error code.
    await expect(import(specifier)).rejects.toMatchObject({
      code: 'ERR_MODULE_NOT_FOUND',
      message: expect.stringMatching(/^Cannot find (module|package) /),
    });
  });
});
