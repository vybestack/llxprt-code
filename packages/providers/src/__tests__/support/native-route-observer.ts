/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NativeChatBody } from '../../openai/native-chat-body.js';
import { NativeChatEstimateProjection } from '../../openai/native-chat-estimate.js';
import { PromptEstimatorFiles } from '../../runtime/prompt-estimator-files.js';
import { WireBodySpool } from '../../utils/wire-body-spool.js';

export interface NativeRouteCounts {
  readonly streams: number;
  readonly estimates: number;
  readonly spools: number;
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
  let spools = 0;
  let estimatorFiles = 0;
  let tokens = 0;
  const open = NativeChatBody.prototype.openStream;
  const count = NativeChatEstimateProjection.prototype.estimate;
  const create = WireBodySpool.create;
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
  WireBodySpool.create = function (...args) {
    spools++;
    return create.call(this, ...args);
  };
  PromptEstimatorFiles.prototype.writeMessages = function (...args) {
    estimatorFiles++;
    return write.call(this, ...args);
  };
  return {
    counts: () => ({ streams, estimates, spools, estimatorFiles, tokens }),
    requireSend(estimate): void {
      const invalid = [
        streams !== 1,
        estimates !== Number(estimate),
        spools !== 0,
        estimatorFiles !== 0,
        estimate && tokens <= 0,
      ].some((failed) => failed);
      if (invalid)
        throw new Error(
          `Native route assertion failed: ${JSON.stringify({ streams, estimates, spools, estimatorFiles, tokens })}`,
        );
    },
    restore(): void {
      NativeChatBody.prototype.openStream = open;
      NativeChatEstimateProjection.prototype.estimate = count;
      WireBodySpool.create = create;
      PromptEstimatorFiles.prototype.writeMessages = write;
    },
  };
}
