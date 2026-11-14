/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResumeContext } from '../services/performResume.js';

export async function disposeResumeContext(
  context: ResumeContext,
): Promise<void> {
  const callbacks = context.recordingCallbacks;
  try {
    await callbacks.getCurrentIntegration()?.dispose();
  } finally {
    try {
      await callbacks.getCurrentRecording()?.dispose();
    } finally {
      await callbacks.getCurrentLockHandle()?.release();
    }
  }
}
