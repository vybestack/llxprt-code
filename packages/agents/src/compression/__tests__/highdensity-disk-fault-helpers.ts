/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdmissionFailureRecorder } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HighdensityDiskHistory } from './highdensity-disk-helpers.js';

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve: () => resolve() };
}

export class HighdensityFaultHistory extends HighdensityDiskHistory {
  beforeEstimate?: () => Promise<void>;
  estimateFault?: () => Error | undefined;
  attempts = 0;
  override async estimateTokensForContents(
    contents: Iterable<IContent> | AsyncIterable<IContent>,
  ): Promise<number> {
    this.attempts++;
    await this.beforeEstimate?.();
    const error = this.estimateFault?.();
    if (error !== undefined) throw error;
    return super.estimateTokensForContents(contents);
  }
}

export async function withFaultRollback<T>(
  action: (
    history: HighdensityFaultHistory,
    recorder: AdmissionFailureRecorder,
  ) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'highdensity-rollback-'));
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'highdensity',
    projectHash: 'highdensity',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const history = new HighdensityFaultHistory({ recording: recorder });
  try {
    return await action(history, recorder);
  } finally {
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
