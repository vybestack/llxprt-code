/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NativeChatBody } from '../../openai/native-chat-body.js';
import { NativeChatEstimateProjection } from '../../openai/native-chat-estimate.js';
import { PromptEstimatorFiles } from '../../runtime/prompt-estimator-files.js';
import { observeNativeFileCreates } from './native-file-observer.js';

export interface NativeRouteCounts {
  readonly streams: number;
  readonly estimates: number;
  readonly fileCreates: number;
  readonly estimatorFiles: number;
  readonly tokens: number;
}

export function observeNativeRoute(): {
  counts(): NativeRouteCounts;
  requireSend(estimate: boolean): void;
  restore(): void;
} {
  let streams = 0;
  let estimates = 0;
  const files = observeNativeFileCreates();
  let estimatorFiles = 0;
  let tokens = 0;
  const open = NativeChatBody.prototype.openStream;
  const count = NativeChatEstimateProjection.prototype.estimate;
  const write = PromptEstimatorFiles.prototype.writeMessages;
  NativeChatBody.prototype.openStream = function () {
    streams++;
    return open.call(this);
  };
  NativeChatEstimateProjection.prototype.estimate = function (...args) {
    estimates++;
    return count.call(this, ...args).then((result) => {
      tokens = result.count;
      return result;
    });
  };
  PromptEstimatorFiles.prototype.writeMessages = function (...args) {
    estimatorFiles++;
    return write.call(this, ...args);
  };
  return {
    counts: () => ({
      streams,
      estimates,
      fileCreates: files.count(),
      estimatorFiles,
      tokens,
    }),
    requireSend(estimate): void {
      const invalid = [
        streams !== 1,
        estimates !== Number(estimate),
        files.count() !== 0,
        estimatorFiles !== 0,
        estimate && tokens <= 0,
      ].some((failed) => failed);
      if (invalid)
        throw new Error(
          `Native route assertion failed: ${JSON.stringify({ streams, estimates, fileCreates: files.count(), estimatorFiles, tokens })}`,
        );
    },
    restore(): void {
      NativeChatBody.prototype.openStream = open;
      NativeChatEstimateProjection.prototype.estimate = count;
      files.restore();
      PromptEstimatorFiles.prototype.writeMessages = write;
    },
  };
}
