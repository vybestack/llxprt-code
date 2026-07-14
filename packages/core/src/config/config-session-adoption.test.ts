/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from './config.js';

/**
 * @requirement FIX-1336-SESSION-ADOPTION
 * Bug fix: Config should support adopting a restored session's ID.
 *
 * When using --continue, the session is restored but Config generates
 * a new sessionId. This causes TodoStore to read/write to the wrong file,
 * making todos appear lost.
 *
 * The fix adds adoptSessionId() method that allows updating the sessionId
 * after a session is restored, so that TodoStore uses the correct file.
 */
describe('Config session adoption fix #1336', () => {
  let config: Config;
  const originalSessionId = 'original-session-abc123';
  const restoredSessionId = 'restored-session-xyz789';

  beforeEach(() => {
    // Create a minimal Config with a known sessionId
    config = new Config({
      inputSource: 'repl',
      targetDir: '/tmp/test',
      sessionId: originalSessionId,
    });
  });

  describe('adoptSessionId', () => {
    it('should update getSessionId() to return the adopted sessionId', () => {
      // Before adoption, should return original
      expect(config.getSessionId()).toBe(originalSessionId);

      // Adopt the restored session's ID
      config.adoptSessionId(restoredSessionId);

      // After adoption, should return the restored ID
      expect(config.getSessionId()).toBe(restoredSessionId);
    });

    it('should allow TodoStore to use the correct file after adoption', () => {
      // This test verifies the end-to-end behavior:
      // After adopting a sessionId, any code that uses config.getSessionId()
      // (like TodoStore) will get the restored ID, not the original.

      config.adoptSessionId(restoredSessionId);

      // The sessionId used by dependent code should be the restored one
      const sessionIdForTodoStore = config.getSessionId();
      expect(sessionIdForTodoStore).toBe(restoredSessionId);
      expect(sessionIdForTodoStore).not.toBe(originalSessionId);
    });

    it('should handle multiple adoptions (last one wins)', () => {
      const firstAdoption = 'first-adopted-id';
      const secondAdoption = 'second-adopted-id';

      config.adoptSessionId(firstAdoption);
      expect(config.getSessionId()).toBe(firstAdoption);

      config.adoptSessionId(secondAdoption);
      expect(config.getSessionId()).toBe(secondAdoption);
    });

    it('should not affect other Config properties', () => {
      const originalTargetDir = config.getTargetDir();

      config.adoptSessionId(restoredSessionId);

      // Other properties should remain unchanged
      expect(config.getTargetDir()).toBe(originalTargetDir);
    });
  });
});
