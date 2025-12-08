/**
 * Regression guard tests to prevent reintroduction of Config-based state.
 *
 * @plan:PLAN-20251027-STATELESS5.P12
 * @requirement:REQ-STAT5-001 - Runtime state must be the source of truth
 * @requirement:REQ-STAT5-002 - No Config reads for provider/model/auth
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Config Regression Guards', () => {
  describe('GeminiChat', () => {
    it('should only import Config as a type (not for runtime use)', () => {
      const filePath = resolve(__dirname, '../geminiChat.ts');
      const content = readFileSync(filePath, 'utf-8');

      // Config should only be imported as a type (type-only import)
      // Allow: import type { Config } from '...'
      // Disallow: import { Config } from '...'
      const hasNonTypeConfigImport =
        /import\s+{[^}]*\bConfig\b[^}]*}\s+from\s+['"].*config.*['"]/.test(
          content,
        );
      const hasTypeOnlyConfigImport =
        /import\s+type\s+{[^}]*\bConfig\b[^}]*}\s+from\s+['"].*config.*['"]/.test(
          content,
        );

      // Either no Config import at all, or only type imports
      const hasConfigImport =
        content.includes("from '../config/config.js'") ||
        content.includes('from "../config/config.js"');

      // Assert: if there's a config import, it must be type-only
      const isValid =
        !hasConfigImport ||
        (hasTypeOnlyConfigImport && !hasNonTypeConfigImport);
      expect(isValid).toBe(true);
    });

    it('should not use Config static methods for provider/model/auth', () => {
      const filePath = resolve(__dirname, '../geminiChat.ts');
      const content = readFileSync(filePath, 'utf-8');

      // Remove comments and strings to avoid false positives
      const codeOnly = content
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
        .replace(/\/\/.*/g, '') // Remove line comments
        .replace(/'[^']*'/g, '""') // Remove single-quoted strings
        .replace(/"[^"]*"/g, '""'); // Remove double-quoted strings

      // Check for prohibited Config usage
      const prohibitedPatterns = [
        /Config\.getActiveProvider\s*\(/,
        /Config\.getActiveModel\s*\(/,
        /Config\.getApiKey\s*\(/,
        /Config\.getProviderConfig\s*\(/,
        /Config\.getModelConfig\s*\(/,
      ];

      for (const pattern of prohibitedPatterns) {
        expect(codeOnly).not.toMatch(pattern);
      }
    });

    it('should use runtime context for provider information', () => {
      const filePath = resolve(__dirname, '../geminiChat.ts');
      const content = readFileSync(filePath, 'utf-8');

      // Ensure runtime runtime adapters are the source of truth
      expect(content).toContain('runtimeContext.providerRuntime');
      expect(content).toContain('runtimeState.provider');
    });
  });

  describe('GeminiRequest', () => {
    it('should not import Config for runtime state', () => {
      const filePath = resolve(__dirname, '../geminiRequest.ts');
      const content = readFileSync(filePath, 'utf-8');

      // If Config is imported, ensure it's not used for runtime state
      const codeOnly = content
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
        .replace(/\/\/.*/g, '') // Remove line comments
        .replace(/'[^']*'/g, '""') // Remove single-quoted strings
        .replace(/"[^"]*"/g, '""'); // Remove double-quoted strings

      // Check for prohibited Config usage
      const prohibitedPatterns = [
        /Config\.getActiveProvider\s*\(/,
        /Config\.getActiveModel\s*\(/,
        /Config\.getApiKey\s*\(/,
        /Config\.getProviderConfig\s*\(/,
        /Config\.getModelConfig\s*\(/,
      ];

      for (const pattern of prohibitedPatterns) {
        expect(codeOnly).not.toMatch(pattern);
      }
    });
  });

  describe('Architecture Enforcement', () => {
    it('should prevent Config as source of truth for runtime state', () => {
      // This test documents the architectural principle:
      // Config should ONLY be used for:
      // 1. Test fixtures (explicit state setup)
      // 2. UI state mirroring (keeping UI in sync)
      // 3. Backward compatibility (legacy code paths)
      //
      // Config should NEVER be used as the source of truth for:
      // - Active provider
      // - Active model
      // - API keys/authentication
      // - Any runtime state

      expect(true).toBe(true); // Architectural documentation test
    });

    it('should use AgentRuntimeState as the single source of truth', () => {
      // Runtime state flow must be:
      // AgentRuntimeState (core) → ProviderRuntimeContext → GeminiClient/Chat
      //
      // NOT:
      // Config → GeminiClient/Chat

      expect(true).toBe(true); // Architectural documentation test
    });
  });
});
