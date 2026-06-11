/**
 * @plan:PLAN-20260608-ISSUE1586.P07
 * @requirement:REQ-INTF-001.3
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { IProviderKeyStorage } from '../provider-key-storage.js';

// ---------------------------------------------------------------------------
// In-memory test double implementing IProviderKeyStorage
// ---------------------------------------------------------------------------

class InMemoryProviderKeyStorage implements IProviderKeyStorage {
  private readonly keys = new Map<string, string>();

  async getKey(provider: string): Promise<string | null> {
    return this.keys.get(provider) ?? null;
  }

  async listKeys(): Promise<string[]> {
    return Array.from(this.keys.keys());
  }

  async hasKey(provider: string): Promise<boolean> {
    return this.keys.has(provider);
  }

  // Test helper to seed a key (not part of interface)
  setKey(provider: string, key: string): void {
    this.keys.set(provider, key);
  }
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('IProviderKeyStorage contract', () => {
  describe('getKey', () => {
    it('returns the key for a known provider', async () => {
      const storage = new InMemoryProviderKeyStorage();
      storage.setKey('openai', 'sk-abc123');
      const result = await storage.getKey('openai');
      expect(result).toBe('sk-abc123');
    });

    it('returns null for an unknown provider', async () => {
      const storage = new InMemoryProviderKeyStorage();
      const result = await storage.getKey('unknown');
      expect(result).toBeNull();
    });
  });

  describe('listKeys', () => {
    it('returns all provider names with keys', async () => {
      const storage = new InMemoryProviderKeyStorage();
      storage.setKey('openai', 'sk-openai');
      storage.setKey('anthropic', 'sk-ant');
      storage.setKey('google', 'sk-google');
      const keys = await storage.listKeys();
      const sorted = keys.toSorted();
      expect(sorted).toStrictEqual(['anthropic', 'google', 'openai']);
    });

    it('returns empty array when no keys stored', async () => {
      const storage = new InMemoryProviderKeyStorage();
      const keys = await storage.listKeys();
      expect(keys).toStrictEqual([]);
    });
  });

  describe('hasKey', () => {
    it('returns true when provider has a key', async () => {
      const storage = new InMemoryProviderKeyStorage();
      storage.setKey('openai', 'sk-key');
      expect(await storage.hasKey('openai')).toBe(true);
    });

    it('returns false when provider has no key', async () => {
      const storage = new InMemoryProviderKeyStorage();
      expect(await storage.hasKey('openai')).toBe(false);
    });
  });
});
