import { describe, it, expect } from 'vitest';
import { normalizeToolName } from './toolNameNormalization.js';

describe('normalizeToolName', () => {
  it('strips "functions" prefix from Kimi-style names with numeric suffixes', () => {
    expect(normalizeToolName('functionslist_directory6')).toBe(
      'list_directory',
    );
    expect(normalizeToolName('functionssearch7')).toBe('search');
  });

  it('preserves legitimate names that start with functions but lack numeric suffixes', () => {
    expect(normalizeToolName('functions_list')).toBe('functions_list');
    expect(normalizeToolName('functionslist_directory')).toBe(
      'functionslist_directory',
    );
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
