import { describe, it, expect } from 'vitest';
import { sanitizeProviderText } from './textSanitizer.js';

describe('sanitizeProviderText', () => {
  it('returns empty string for null or undefined', () => {
    expect(sanitizeProviderText(null)).toBe('');
    expect(sanitizeProviderText(undefined)).toBe('');
  });

  it('converts non-string input to string', () => {
    expect(sanitizeProviderText(42)).toBe('42');
    expect(sanitizeProviderText(true)).toBe('true');
  });

  it('strips <think>...</think> blocks', () => {
    expect(sanitizeProviderText('before<think>hidden</think>after')).toBe(
      'before after',
    );
  });

  it('strips <thinking>...</thinking> blocks', () => {
    expect(sanitizeProviderText('before<thinking>hidden</thinking>after')).toBe(
      'before after',
    );
  });

  it('strips <analysis>...</analysis> blocks', () => {
    expect(sanitizeProviderText('before<analysis>hidden</analysis>after')).toBe(
      'before after',
    );
  });

  it('replaces with space to preserve word separation', () => {
    const result = sanitizeProviderText('these<think>reasoning</think>5 items');
    expect(result).toBe('these 5 items');
  });

  it('cleans up stray unmatched tags', () => {
    expect(sanitizeProviderText('text<think>unclosed')).toBe('text unclosed');
    expect(sanitizeProviderText('text</think>extra')).toBe('text extra');
  });

  it('preserves text without reasoning tags', () => {
    expect(sanitizeProviderText(' 5 Biggest cities')).toBe(' 5 Biggest cities');
  });

  it('collapses whitespace only when tags were present', () => {
    expect(sanitizeProviderText('a   b')).toBe('a   b');
    expect(sanitizeProviderText('a<think>x</think>   b')).toBe('a b');
  });

  it('normalizes excessive newlines when tags present', () => {
    const input = 'before<think>x</think>\n\n\n\nafter';
    const result = sanitizeProviderText(input);
    expect(result).not.toContain('\n\n\n');
  });

  it('preserves newlines in regular text', () => {
    expect(sanitizeProviderText('line1\nline2')).toBe('line1\nline2');
  });

  it('is case-insensitive', () => {
    expect(sanitizeProviderText('<THINK>hidden</THINK>visible')).toBe(
      'visible',
    );
  });
});
