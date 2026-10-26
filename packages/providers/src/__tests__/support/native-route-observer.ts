/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NativeChatBody } from '../../openai/native-chat-body.js';
import { NativeChatEstimateProjection } from '../../openai/native-chat-estimate.js';
import { NativeAnthropicBody } from '../../anthropic/native-anthropic-request.js';
import { NativeAnthropicEstimateProjection } from '../../anthropic/native-anthropic-estimate.js';
import { NativeResponsesPrompt } from '../../openai-responses/native-responses-body.js';
import { NativeResponsesEstimateProjection } from '../../openai-responses/native-responses-estimate.js';
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

function observeNativeRetirements(retired: () => void): () => void {
  const chat = NativeChatBody.prototype.dispose;
  const anthropic = NativeAnthropicBody.prototype.dispose;
  const responses = NativeResponsesPrompt.prototype.dispose;
  NativeChatBody.prototype.dispose = function (): Promise<void> {
    retired();
    return chat.call(this);
  };
  NativeAnthropicBody.prototype.dispose = function (): Promise<void> {
    retired();
    return anthropic.call(this);
  };
  NativeResponsesPrompt.prototype.dispose = function (): Promise<void> {
    retired();
    return responses.call(this);
  };
  return () => {
    NativeChatBody.prototype.dispose = chat;
    NativeAnthropicBody.prototype.dispose = anthropic;
    NativeResponsesPrompt.prototype.dispose = responses;
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
  let tokens = 0;
  let retirements = 0;
  const restoreRetirements = observeNativeRetirements(() => {
    retirements++;
  });
  const open = NativeChatBody.prototype.openStream;
  const count = NativeChatEstimateProjection.prototype.estimate;
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
  return {
    counts: () => ({
      streams,
      estimates,
      fileCreates: files.count(),
      estimatorFiles: files.count(),
      tokens,
    }),
    requireSend(estimate): void {
      const invalid = [
        streams === 0 && retirements === 0,
        streams > 1,
        estimates > Number(estimate),
        files.count() !== 0,
        estimate && tokens <= 0,
      ].some((failed) => failed);
      if (invalid)
        throw new Error(
          `Native route assertion failed: ${JSON.stringify({ streams, estimates, fileCreates: files.count(), estimatorFiles: files.count(), tokens })}`,
        );
    },
    restore(): void {
      NativeChatBody.prototype.openStream = open;
      NativeChatEstimateProjection.prototype.estimate = count;
      restoreOther();
      restoreRetirements();
      files.restore();
    },
  };
}
