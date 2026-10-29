/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createSessionRecorder,
  RecordingIntegration,
  SessionLockManager,
} from '@vybestack/llxprt-code-core';
import { performResume } from '../services/performResume.js';
import { disposeResumeContext } from './dispose-resume-context.js';
import { seedSessionRows } from './journal-recording.js';
import {
  createTestSession,
  makeConfig,
  makeContent,
  makeResumeContext,
} from './sessionBrowserE2E.helpers.js';

describe('resume example ownership', () => {
  it.each([
    { ref: 'latest', ok: true },
    { ref: '999', ok: false },
  ])(
    'closes the current journal and lock after $ref returns ok:$ok',
    async ({ ref, ok }) => {
      const chatsDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'resume-example-ownership-'),
      );
      const recording = createSessionRecorder(
        makeConfig(chatsDir, { sessionId: 'current-session' }),
      );
      const context = makeResumeContext(chatsDir, {
        currentRecording: recording,
        currentIntegration: new RecordingIntegration(recording),
      });
      try {
        await seedSessionRows(recording, [makeContent('current content')]);
        const lock = await SessionLockManager.acquire(
          chatsDir,
          recording.getSessionId(),
        );
        context.recordingCallbacks.setRecording(
          recording,
          context.recordingCallbacks.getCurrentIntegration(),
          lock,
          null,
        );
        await createTestSession(chatsDir, {
          sessionId: 'resume-target',
          messages: [{ speaker: 'user', text: 'target content' }],
        });

        const result = await performResume(ref, context);
        expect(result.ok).toBe(ok);
        const current = context.recordingCallbacks.getCurrentRecording();
        if (current === null) throw new Error('Missing current recording');
        expect(current.isActive()).toBe(true);

        await disposeResumeContext(context);

        expect(current.isActive()).toBe(false);
        expect(
          await SessionLockManager.isLocked(chatsDir, current.getSessionId()),
        ).toBe(false);
        expect(
          await SessionLockManager.isLocked(chatsDir, recording.getSessionId()),
        ).toBe(false);
      } finally {
        try {
          await disposeResumeContext(context);
        } finally {
          await fs.rm(chatsDir, { recursive: true, force: true });
        }
      }
    },
  );
});
