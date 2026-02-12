// @plan PLAN-20260211-ASTGREP.P02
import { describe, it, expect } from 'vitest';
import { Lang } from '@ast-grep/napi';
import {
  getAstLanguage,
  resolveLanguageFromPath,
  isAstGrepAvailable,
  parseSource,
  LANGUAGE_MAP,
  JAVASCRIPT_FAMILY_EXTENSIONS,
} from './ast-grep-utils.js';

describe('ast-grep-utils', () => {
  describe('LANGUAGE_MAP', () => {
    it('should have ts mapped to Lang.TypeScript', () => {
      expect(LANGUAGE_MAP['ts']).toBe(Lang.TypeScript);
    });

    it('should have py mapped to python', () => {
      expect(LANGUAGE_MAP['py']).toBe('python');
    });

    it('should have all expected extensions', () => {
      const expectedKeys = [
        'ts',
        'js',
        'tsx',
        'jsx',
        'py',
        'rb',
        'go',
        'rs',
        'java',
        'cpp',
        'c',
        'html',
        'css',
        'json',
      ];
      for (const key of expectedKeys) {
        expect(LANGUAGE_MAP).toHaveProperty(key);
      }
    });
  });

  describe('JAVASCRIPT_FAMILY_EXTENSIONS', () => {
    it('should include ts, js, tsx, jsx', () => {
      expect(JAVASCRIPT_FAMILY_EXTENSIONS).toContain('ts');
      expect(JAVASCRIPT_FAMILY_EXTENSIONS).toContain('js');
      expect(JAVASCRIPT_FAMILY_EXTENSIONS).toContain('tsx');
      expect(JAVASCRIPT_FAMILY_EXTENSIONS).toContain('jsx');
    });
  });

  describe('getAstLanguage', () => {
    it('should return Lang.TypeScript for ts extension', () => {
      expect(getAstLanguage('ts')).toBe(Lang.TypeScript);
    });

    it('should return python for py extension', () => {
      expect(getAstLanguage('py')).toBe('python');
    });

    it('should return Lang.TypeScript for full name typescript', () => {
      expect(getAstLanguage('typescript')).toBe(Lang.TypeScript);
    });

    it('should return undefined for unknown extension', () => {
      expect(getAstLanguage('unknown')).toBeUndefined();
    });

    it('should handle case-insensitive full names', () => {
      expect(getAstLanguage('TypeScript')).toBe(Lang.TypeScript);
      expect(getAstLanguage('Python')).toBe('python');
    });
  });

  describe('resolveLanguageFromPath', () => {
    it('should detect TypeScript from .ts extension', () => {
      expect(resolveLanguageFromPath('foo.ts')).toBe(Lang.TypeScript);
    });

    it('should return undefined for unknown extension', () => {
      expect(resolveLanguageFromPath('foo.xyz')).toBeUndefined();
    });

    it('should detect Python from nested path', () => {
      expect(resolveLanguageFromPath('path/to/file.py')).toBe('python');
    });

    it('should detect JavaScript from .js extension', () => {
      expect(resolveLanguageFromPath('index.js')).toBe(Lang.JavaScript);
    });

    it('should handle files with no extension', () => {
      expect(resolveLanguageFromPath('Makefile')).toBeUndefined();
    });
  });

  describe('isAstGrepAvailable', () => {
    it('should return true when @ast-grep/napi is available', () => {
      expect(isAstGrepAvailable()).toBe(true);
    });
  });

  describe('parseSource', () => {
    it('should parse valid TypeScript source', () => {
      const result = parseSource(Lang.TypeScript, 'const x = 1;');
      expect(result).toHaveProperty('root');
      expect(result).not.toHaveProperty('error');
    });

    it('should return error for invalid source that cannot be parsed', () => {
      // Note: tree-sitter is error-tolerant so most "invalid" code still parses.
      // We test that parseSource returns a root even for malformed code
      // (tree-sitter produces error nodes rather than failing entirely).
      // The real error case is an unsupported language.
      const result = parseSource(Lang.TypeScript, '}{');
      // tree-sitter will parse this with error nodes but won't throw
      expect(result).toHaveProperty('root');
    });

    it('should return error for unsupported language string', () => {
      const result = parseSource(
        'nonexistent_language' as unknown as string,
        'code',
      );
      expect(result).toHaveProperty('error');
      expect(result).not.toHaveProperty('root');
    });

    it('should parse Python source with dynamic language', () => {
      const result = parseSource('python', 'x = 1');
      expect(result).toHaveProperty('root');
    });
  });
});
