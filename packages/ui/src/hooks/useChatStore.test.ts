import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './useChatStore';

describe('ChatMessage type', () => {
  it('accepts a message without profileName', () => {
    const msg: ChatMessage = {
      id: 'id-1',
      kind: 'message',
      role: 'model',
      text: 'Hello',
    };
    expect(msg.profileName).toBeUndefined();
  });

  it('accepts a message with profileName', () => {
    const msg: ChatMessage = {
      id: 'id-2',
      kind: 'message',
      role: 'model',
      text: 'Hello',
      profileName: 'synthetic',
    };
    expect(msg.profileName).toBe('synthetic');
  });

  it('profileName is optional and only applies to model messages', () => {
    const userMsg: ChatMessage = {
      id: 'id-3',
      kind: 'message',
      role: 'user',
      text: 'User question',
    };
    const modelMsg: ChatMessage = {
      id: 'id-4',
      kind: 'message',
      role: 'model',
      text: 'Model answer',
      profileName: 'my-profile',
    };
    expect(userMsg.profileName).toBeUndefined();
    expect(modelMsg.profileName).toBe('my-profile');
  });
});
