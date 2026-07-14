import { describe, it, expect } from 'vitest';
import { isQwenBaseURL } from './qwenEndpoint.js';

describe('isQwenBaseURL', () => {
  it('returns false for undefined or empty', () => {
    expect(isQwenBaseURL(undefined)).toBe(false);
    expect(isQwenBaseURL('')).toBe(false);
    expect(isQwenBaseURL('  ')).toBe(false);
  });

  it('detects dashscope.aliyuncs.com', () => {
    expect(isQwenBaseURL('https://dashscope.aliyuncs.com/v1')).toBe(true);
    expect(isQwenBaseURL('https://sub.dashscope.aliyuncs.com')).toBe(true);
  });

  it('detects portal.qwen.ai', () => {
    expect(isQwenBaseURL('https://portal.qwen.ai/api')).toBe(true);
    expect(isQwenBaseURL('https://sub.qwen.ai')).toBe(true);
  });

  it('detects api.qwen.com', () => {
    expect(isQwenBaseURL('https://api.qwen.com/v1')).toBe(true);
    expect(isQwenBaseURL('https://sub.qwen.com')).toBe(true);
  });

  it('returns false for non-Qwen URLs', () => {
    expect(isQwenBaseURL('https://api.openai.com/v1')).toBe(false);
    expect(isQwenBaseURL('https://api.anthropic.com')).toBe(false);
    expect(isQwenBaseURL('https://api.cerebras.ai')).toBe(false);
  });

  it('handles URLs without protocol', () => {
    expect(isQwenBaseURL('dashscope.aliyuncs.com')).toBe(true);
    expect(isQwenBaseURL('api.qwen.com')).toBe(true);
  });

  it('handles malformed URLs gracefully', () => {
    expect(isQwenBaseURL('not a url at all')).toBe(false);
  });
});
