/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { start_sandbox } from './sandbox.js';

describe('start_sandbox device grants', () => {
  it('refuses programmatic Seatbelt launches that carry device grants', async () => {
    const launch = start_sandbox({
      command: 'sandbox-exec',
      image: 'unused',
      devices: ['/dev/dri/renderD128'],
    });

    await expect(launch).rejects.toThrow(FatalSandboxError);
    await expect(launch).rejects.toThrow(/does not support Linux devices/);
  });
});
