import { describe, it, expect } from 'vitest';
import { processToolParameters } from './doubleEscapeUtils.js';

describe('processToolParameters', () => {
  it('returns empty object for empty string arguments', () => {
    const result = processToolParameters('', 'get_weather');
    expect(result).toStrictEqual({});
  });

  it('returns empty object for quoted empty string arguments', () => {
    const result = processToolParameters('""', 'get_weather');
    expect(result).toStrictEqual({});
  });

  it('parses valid JSON even when quoted', () => {
    const result = processToolParameters('"{\\"city\\":\\"Paris\\"}"', 'tool');
    expect(result).toStrictEqual({ city: 'Paris' });
  });
});
