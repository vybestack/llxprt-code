/**
 * @plan:PLAN-20250212-LSP.P04
 * @requirement:REQ-LANG-010
 * @pseudocode:language-map.md lines 01-82
 */

import { describe, expect, it } from 'vitest';

import {
  getExtensionsForLanguage,
  getLanguageId,
} from '../src/service/language-map';

const knownMappings: ReadonlyArray<readonly [string, string]> = [
  ['.ts', 'typescript'],
  ['.tsx', 'typescriptreact'],
  ['.js', 'javascript'],
  ['.jsx', 'javascriptreact'],
  ['.py', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java', 'java'],
  ['.c', 'c'],
  ['.cpp', 'cpp'],
  ['.json', 'json'],
  ['.yaml', 'yaml'],
  ['dockerfile', 'dockerfile'],
  ['makefile', 'makefile'],
];

describe('language-map', () => {
  it('returns expected languageId for common known extensions', () => {
    for (const [extension, expectedLanguageId] of knownMappings) {
      expect(getLanguageId(extension)).toBe(expectedLanguageId);
    }
  });

  it('returns undefined for unknown extension', () => {
    expect(getLanguageId('.unknown')).toBeUndefined();
    expect(getLanguageId('.xyz')).toBeUndefined();
  });

  it('handles extension with and without dot', () => {
    expect(getLanguageId('.ts')).toBe('typescript');
    expect(getLanguageId('ts')).toBe('typescript');
    expect(getLanguageId('dockerfile')).toBe('dockerfile');
  });

  it('handles case-insensitive lookup', () => {
    expect(getLanguageId('.TS')).toBe('typescript');
    expect(getLanguageId('.Ts')).toBe('typescript');
    expect(getLanguageId('Dockerfile')).toBe('dockerfile');
  });

  it('returns undefined for empty extension', () => {
    expect(getLanguageId('')).toBeUndefined();
  });

  it('returns extensions for known language', () => {
    const tsExtensions = getExtensionsForLanguage('typescript');
    expect(tsExtensions).toContain('.ts');
    expect(tsExtensions).toContain('.mts');
    expect(tsExtensions).toContain('.cts');
  });

  it('returns empty array for unknown language', () => {
    expect(getExtensionsForLanguage('notalanguage')).toEqual([]);
  });

  it('returns immutable extensions view for language', () => {
    const tsExtensions = getExtensionsForLanguage('typescript') as string[];
    expect(() => tsExtensions.push('.madeup')).toThrow();
  });

  it('property-based: random unknown dotted extensions return undefined', () => {
    for (let i = 0; i < 120; i += 1) {
      const extension = `.zz${i}unknownext`;
      expect(getLanguageId(extension)).toBeUndefined();
    }
  });

  it('property-based: random unknown bare extensions return undefined', () => {
    for (let i = 0; i < 120; i += 1) {
      const extension = `zz${i}unknownext`;
      expect(getLanguageId(extension)).toBeUndefined();
    }
  });

  it('property-based: case normalization is idempotent for known mappings', () => {
    for (const [extension, expectedLanguageId] of knownMappings) {
      expect(getLanguageId(extension.toUpperCase())).toBe(expectedLanguageId);
      expect(getLanguageId(extension.toLowerCase())).toBe(expectedLanguageId);
    }
  });
});
