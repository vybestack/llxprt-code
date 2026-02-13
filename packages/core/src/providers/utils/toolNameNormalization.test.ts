import { describe, it, expect } from 'vitest';
import { normalizeToolName } from './toolNameNormalization.js';

describe('normalizeToolName', () => {
  it('strips "functions" prefix from Kimi-style names', () => {
    expect(normalizeToolName('functionslist_directory')).toBe('list_directory');
    expect(normalizeToolName('functionssearch')).toBe('search');
  });

  it('strips "call_functions" prefix from Kimi-style names', () => {
    expect(normalizeToolName('call_functionslist_directory6')).toBe(
      'list_directory',
    );
    expect(normalizeToolName('call_functionsglob7')).toBe('glob');
  });

  it('lowercases normal names', () => {
    expect(normalizeToolName('ReadFile')).toBe('readfile');
    expect(normalizeToolName('run_shell_command')).toBe('run_shell_command');
  });

  it('handles empty/whitespace input', () => {
    expect(normalizeToolName('')).toBe('');
    expect(normalizeToolName('  ')).toBe('');
  });

  it('trims whitespace', () => {
    expect(normalizeToolName('  glob  ')).toBe('glob');
  });
});
