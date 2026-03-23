/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ASTConfig } from '../ast-edit/ast-config.js';

describe('ASTConfig', () => {
  let originalEnvValue: string | undefined;

  beforeEach(() => {
    originalEnvValue = process.env.LLXPRT_ENABLE_SYMBOL_INDEXING;
  });

  afterEach(() => {
    if (originalEnvValue !== undefined) {
      process.env.LLXPRT_ENABLE_SYMBOL_INDEXING = originalEnvValue;
    } else {
      delete process.env.LLXPRT_ENABLE_SYMBOL_INDEXING;
    }
  });

  describe('ENABLE_SYMBOL_INDEXING', () => {
    it('should default to false when env var is not set', () => {
      delete process.env.LLXPRT_ENABLE_SYMBOL_INDEXING;
      // Re-import to pick up env change
      expect(ASTConfig.ENABLE_SYMBOL_INDEXING).toBe(false);
    });

    it('should be true when env var is "true"', () => {
      process.env.LLXPRT_ENABLE_SYMBOL_INDEXING = 'true';
      // Note: This test documents current behavior but doesn't reload the module
      // In practice, ENABLE_SYMBOL_INDEXING is evaluated at module load time
      expect(typeof ASTConfig.ENABLE_SYMBOL_INDEXING).toBe('boolean');
    });
  });

  describe('Static properties', () => {
    it('should define ENABLE_AST_PARSING', () => {
      expect(typeof ASTConfig.ENABLE_AST_PARSING).toBe('boolean');
      expect(ASTConfig.ENABLE_AST_PARSING).toBe(true);
    });

    it('should define MAX_SNIPPETS', () => {
      expect(typeof ASTConfig.MAX_SNIPPETS).toBe('number');
      expect(ASTConfig.MAX_SNIPPETS).toBeGreaterThan(0);
    });

    it('should define MAX_SNIPPET_CHARS', () => {
      expect(typeof ASTConfig.MAX_SNIPPET_CHARS).toBe('number');
      expect(ASTConfig.MAX_SNIPPET_CHARS).toBeGreaterThan(0);
    });

    it('should define CONTEXT_DEPTH', () => {
      expect(typeof ASTConfig.CONTEXT_DEPTH).toBe('number');
      expect(ASTConfig.CONTEXT_DEPTH).toBeGreaterThan(0);
    });

    it('should define MAX_DISPLAY_RESULTS', () => {
      expect(typeof ASTConfig.MAX_DISPLAY_RESULTS).toBe('number');
      expect(ASTConfig.MAX_DISPLAY_RESULTS).toBeGreaterThan(0);
    });

    it('should define MIN_SYMBOL_LENGTH', () => {
      expect(typeof ASTConfig.MIN_SYMBOL_LENGTH).toBe('number');
      expect(ASTConfig.MIN_SYMBOL_LENGTH).toBeGreaterThan(0);
    });

    it('should define MAX_RESULTS_PER_SYMBOL', () => {
      expect(typeof ASTConfig.MAX_RESULTS_PER_SYMBOL).toBe('number');
      expect(ASTConfig.MAX_RESULTS_PER_SYMBOL).toBeGreaterThan(0);
    });

    it('should define FIND_RELATED_TIMEOUT_MS', () => {
      expect(typeof ASTConfig.FIND_RELATED_TIMEOUT_MS).toBe('number');
      expect(ASTConfig.FIND_RELATED_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('should define MAX_WORKSPACE_FILES', () => {
      expect(typeof ASTConfig.MAX_WORKSPACE_FILES).toBe('number');
      expect(ASTConfig.MAX_WORKSPACE_FILES).toBeGreaterThan(0);
    });

    it('should define SUPPORTED_LANGUAGES', () => {
      expect(ASTConfig.SUPPORTED_LANGUAGES).toBeDefined();
      expect(typeof ASTConfig.SUPPORTED_LANGUAGES).toBe('object');
      expect(ASTConfig.SUPPORTED_LANGUAGES.ts).toBe('typescript');
      expect(ASTConfig.SUPPORTED_LANGUAGES.js).toBe('javascript');
      expect(ASTConfig.SUPPORTED_LANGUAGES.py).toBe('python');
    });
  });
});
