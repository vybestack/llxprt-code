/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NativeChatBody } from '../../openai/native-chat-body.js';
import { NativeChatEstimateProjection } from '../../openai/native-chat-estimate.js';
import { NativeAnthropicBody } from '../../anthropic/native-anthropic-request.js';
import { NativeAnthropicEstimateProjection } from '../../anthropic/native-anthropic-estimate.js';
import { NativeResponsesPrompt } from '../../openai-responses/native-responses-body.js';
import { NativeResponsesEstimateProjection } from '../../openai-responses/native-responses-estimate.js';
import { PromptEstimatorFiles } from '../../runtime/prompt-estimator-files.js';
import { observeNativeFileCreates } from './native-file-observer.js';

export interface NativeRouteCounts {
  readonly streams: number;
  readonly estimates: number;
  readonly fileCreates: number;
  readonly estimatorFiles: number;
  readonly tokens: number;
}

function observeOtherNativeRoutes(
  onStream: () => void,
  onEstimate: () => void,
  onTokens: (tokens: number) => void,
): () => void {
  const anthropicOpen = NativeAnthropicBody.prototype.openStream;
  const responsesBody = NativeResponsesPrompt.prototype.body;
  const anthropicEstimate =
    NativeAnthropicEstimateProjection.prototype.estimate;
  const responsesEstimate =
    NativeResponsesEstimateProjection.prototype.estimate;
  NativeAnthropicBody.prototype.openStream = function () {
    onStream();
    return anthropicOpen.call(this);
  };
  NativeResponsesPrompt.prototype.body = function (...args) {
    if (args[1] !== 'dump') onStream();
    return responsesBody.call(this, ...args);
  };
  NativeAnthropicEstimateProjection.prototype.estimate = function (...args) {
    onEstimate();
    return anthropicEstimate.call(this, ...args).then((result) => {
      onTokens(result.count);
      return result;
    });
  };
  NativeResponsesEstimateProjection.prototype.estimate = function (...args) {
    onEstimate();
    return responsesEstimate.call(this, ...args).then((result) => {
      onTokens(result.count);
      return result;
    });
  };
  return () => {
    NativeAnthropicBody.prototype.openStream = anthropicOpen;
    NativeResponsesPrompt.prototype.body = responsesBody;
    NativeAnthropicEstimateProjection.prototype.estimate = anthropicEstimate;
    NativeResponsesEstimateProjection.prototype.estimate = responsesEstimate;
  };
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
  const restoreOther = observeOtherNativeRoutes(
    () => {
      streams++;
    },
    () => {
      estimates++;
    },
    (count) => {
      tokens = count;
    },
  );
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
      restoreOther();
      files.restore();
      PromptEstimatorFiles.prototype.writeMessages = write;
    },
  };
}
