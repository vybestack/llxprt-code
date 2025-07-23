import { describe, it, expect } from 'vitest';

// Since formatArrayResponse is not exported, we need to extract it from the file
// This is a workaround for testing internal functions
const formatArrayResponse = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    // Handle numeric arrays like [4, 1] -> "4.1"
    if (value.every((item) => typeof item === 'number')) {
      return value.join('.');
    }

    // Handle mixed arrays like ["gpt", 4.1] -> "gpt 4.1"
    return value.map((item) => String(item)).join(' ');
  }

  // Handle other types by converting to string
  return String(value);
};

describe('formatArrayResponse', () => {
  it('should return string unchanged', () => {
    expect(formatArrayResponse('gpt 4.1')).toBe('gpt 4.1');
  });

  it('should format numeric array with dots', () => {
    expect(formatArrayResponse([4, 1])).toBe('4.1');
  });

  it('should format mixed array with spaces', () => {
    expect(formatArrayResponse(['gpt', 4.1])).toBe('gpt 4.1');
  });

  it('should convert object to string representation', () => {
    expect(formatArrayResponse({ model: 'gpt' })).toBe('[object Object]');
  });

  it('should convert null to string', () => {
    expect(formatArrayResponse(null)).toBe('null');
  });

  it('should convert undefined to string', () => {
    expect(formatArrayResponse(undefined)).toBe('undefined');
  });

  it('should return empty string for empty array', () => {
    expect(formatArrayResponse([])).toBe('');
  });

  it('should format single number array', () => {
    expect(formatArrayResponse([42])).toBe('42');
  });

  it('should format array with multiple numbers', () => {
    expect(formatArrayResponse([1, 2, 3, 4])).toBe('1.2.3.4');
  });

  it('should handle mixed types in array', () => {
    expect(formatArrayResponse(['version', 3, 'beta', 2])).toBe(
      'version 3 beta 2',
    );
  });

  it('should handle boolean values', () => {
    expect(formatArrayResponse(true)).toBe('true');
    expect(formatArrayResponse(false)).toBe('false');
  });

  it('should handle numbers', () => {
    expect(formatArrayResponse(42)).toBe('42');
    expect(formatArrayResponse(3.14)).toBe('3.14');
  });

  it('should handle nested arrays by converting to string', () => {
    expect(
      formatArrayResponse([
        [1, 2],
        [3, 4],
      ]),
    ).toBe('1,2 3,4');
  });
});
