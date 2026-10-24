/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach } from 'bun:test';
import { NativeChatBody } from '../../openai/native-chat-body.js';
import { NativeAnthropicBody } from '../../anthropic/native-anthropic-request.js';

type NativeBody = NativeChatBody | NativeAnthropicBody;

export function observeNativeBodies(): () => number {
  const live = new Set<NativeBody>();
  const chatOpen = NativeChatBody.prototype.openStream;
  const chatDispose = NativeChatBody.prototype.dispose;
  const anthropicOpen = NativeAnthropicBody.prototype.openStream;
  const anthropicDispose = NativeAnthropicBody.prototype.dispose;
  beforeEach(() => {
    live.clear();
    NativeChatBody.prototype.openStream = function () {
      live.add(this);
      return chatOpen.call(this);
    };
    NativeChatBody.prototype.dispose = async function () {
      await chatDispose.call(this);
      live.delete(this);
    };
    NativeAnthropicBody.prototype.openStream = function () {
      live.add(this);
      return anthropicOpen.call(this);
    };
    NativeAnthropicBody.prototype.dispose = async function () {
      await anthropicDispose.call(this);
      live.delete(this);
    };
  });
  afterEach(() => {
    NativeChatBody.prototype.openStream = chatOpen;
    NativeChatBody.prototype.dispose = chatDispose;
    NativeAnthropicBody.prototype.openStream = anthropicOpen;
    NativeAnthropicBody.prototype.dispose = anthropicDispose;
  });
  return () => live.size;
}
