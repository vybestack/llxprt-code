import { describe, expect, it } from 'vitest';
import type { MessageRole } from './types';

describe('MessageRole type', () => {
  it('should include user role', () => {
    const role: MessageRole = 'user';
    expect(role).toBe('user');
  });

  it('should include model role', () => {
    const role: MessageRole = 'model';
    expect(role).toBe('model');
  });

  it('should include system role', () => {
    const role: MessageRole = 'system';
    expect(role).toBe('system');
  });

  it('should include thinking role', () => {
    const role: MessageRole = 'thinking';
    expect(role).toBe('thinking');
  });
});
