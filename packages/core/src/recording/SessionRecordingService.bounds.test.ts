/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { SessionRecordingService } from './SessionRecordingService.js';

describe('SessionRecordingService queue bounds', () => {
  it('fails closed when pre-content metadata exceeds the retention bound', async () => {
    const service = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir: '/tmp/llxprt-recording-bound-test',
      workspaceDirs: ['/tmp'],
      cwd: '/tmp',
      provider: 'test',
      model: 'test',
    });

    for (let index = 0; index < 20_000 && service.isActive(); index += 1) {
      service.recordProviderSwitch(`provider-${index}`, 'x'.repeat(1024));
    }

    expect(service.isActive()).toBe(false);
    await service.dispose();
  });
});
