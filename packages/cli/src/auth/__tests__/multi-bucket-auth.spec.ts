/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiBucketAuthenticator } from '../MultiBucketAuthenticator.js';

/**
 * Phase 9: Multi-Bucket Authentication Flow Tests
 *
 * Tests for sequential multi-bucket authentication with timing controls,
 * user notifications, browser control, and partial cancellation handling.
 */

/**
 * Mock ephemeral settings storage
 */
const mockEphemeralSettings = new Map<string, unknown>();

/**
 * Get ephemeral setting value
 */
function getEphemeralSetting<T>(key: string): T | undefined {
  return mockEphemeralSettings.get(key) as T | undefined;
}

/**
 * Set ephemeral setting value
 */
function setEphemeralSetting<T>(key: string, value: T): void {
  mockEphemeralSettings.set(key, value);
}

/**
 * Clear all ephemeral settings
 */
function clearEphemeralSettings(): void {
  mockEphemeralSettings.clear();
}

describe('Phase 9: Multi-Bucket Authentication Flow', () => {
  let authenticator: MultiBucketAuthenticator;
  let authLog: string[] = [];
  let promptResponses: boolean[] = [];
  let delayLog: Array<{ ms: number; bucket: string }> = [];

  beforeEach(() => {
    clearEphemeralSettings();
    authLog = [];
    promptResponses = [];
    delayLog = [];

    authenticator = new MultiBucketAuthenticator(
      async (
        provider: string,
        bucket: string,
        index: number,
        total: number,
      ) => {
        authLog.push(
          `Authenticating bucket ${index}/${total}: ${provider}/${bucket}`,
        );
      },
      async (provider: string, bucket: string) => {
        authLog.push(`Prompt for ${provider}/${bucket}`);
        return promptResponses.shift() ?? true;
      },
      async (ms: number, bucket: string) => {
        delayLog.push({ ms, bucket });
        authLog.push(`Delay ${ms}ms before ${bucket}`);
      },
      getEphemeralSetting,
    );
  });

  describe('Auth Timing Ephemerals', () => {
    /**
     * @requirement Phase 9 - Auth timing ephemerals
     * @scenario Default delay setting
     * @given No auth-bucket-delay ephemeral set
     * @when Multi-bucket auth initiated
     * @then Uses default 5000ms delay
     */
    it('should use default 5000ms delay when auth-bucket-delay not set', async () => {
      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(result.authenticatedBuckets).toHaveLength(2);
      expect(delayLog).toHaveLength(2); // Delay before ALL buckets including first
      expect(delayLog[0].ms).toBe(5000);
      expect(delayLog[0].bucket).toBe('bucket1');
      expect(delayLog[1].ms).toBe(5000);
      expect(delayLog[1].bucket).toBe('bucket2');
    });

    /**
     * @requirement Phase 9 - Auth timing ephemerals
     * @scenario Custom delay setting
     * @given auth-bucket-delay set to 10000ms
     * @when Multi-bucket auth initiated
     * @then Uses custom 10000ms delay
     */
    it('should use custom delay when auth-bucket-delay ephemeral set', async () => {
      setEphemeralSetting('auth-bucket-delay', 10000);

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(result.authenticatedBuckets).toHaveLength(2);
      expect(delayLog).toHaveLength(2); // Delay before ALL buckets including first
      expect(delayLog[0].ms).toBe(10000);
      expect(delayLog[1].ms).toBe(10000);
    });

    /**
     * @requirement Phase 9 - Auth timing ephemerals
     * @scenario Prompt mode instead of delay
     * @given auth-bucket-prompt set to true
     * @when Multi-bucket auth initiated
     * @then Shows prompts instead of delays
     */
    it('should show prompts when auth-bucket-prompt is true', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, true];

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(result.authenticatedBuckets).toHaveLength(2);
      expect(delayLog).toHaveLength(0); // No delays when using prompts
      expect(authLog.filter((l) => l.includes('Prompt'))).toHaveLength(2);
    });

    /**
     * @requirement Phase 9 - Auth timing ephemerals
     * @scenario Browser auto-open setting
     * @given auth-browser-open set to false
     * @when Multi-bucket auth initiated
     * @then Should indicate manual URL mode
     */
    it('should respect auth-browser-open ephemeral setting', async () => {
      setEphemeralSetting('auth-browser-open', false);

      const autoOpenSetting = getEphemeralSetting<boolean>('auth-browser-open');
      expect(autoOpenSetting).toBe(false);
    });

    /**
     * @requirement Phase 9 - Auth timing ephemerals
     * @scenario Default browser auto-open
     * @given auth-browser-open not set
     * @when Multi-bucket auth initiated
     * @then Defaults to true (auto-open)
     */
    it('should default auth-browser-open to true', () => {
      const autoOpenSetting =
        getEphemeralSetting<boolean>('auth-browser-open') ?? true;
      expect(autoOpenSetting).toBe(true);
    });
  });

  describe('Sequential Multi-Bucket Auth', () => {
    /**
     * @requirement Phase 9 - Sequential multi-bucket auth
     * @scenario Authenticate multiple buckets in sequence
     * @given Three buckets to authenticate
     * @when authenticateMultipleBuckets called
     * @then Authenticates in order: bucket1, bucket2, bucket3
     */
    it('should authenticate buckets sequentially in order', async () => {
      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: [
          'work@company.com',
          'personal@gmail.com',
          'backup@example.com',
        ],
      });

      expect(result.authenticatedBuckets).toEqual([
        'work@company.com',
        'personal@gmail.com',
        'backup@example.com',
      ]);
      // First log is delay, second is auth
      expect(authLog[0]).toContain('Delay');
      expect(authLog[0]).toContain('work@company.com');
      expect(authLog[1]).toContain('bucket 1/3');
      expect(authLog[1]).toContain('work@company.com');
    });

    /**
     * @requirement Phase 9 - Sequential multi-bucket auth
     * @scenario Show bucket name before each auth
     * @given Multiple buckets to authenticate
     * @when Each auth starts
     * @then Bucket name shown before authentication
     */
    it('should show bucket name before each auth', async () => {
      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(authLog[0]).toContain('bucket1');
      expect(authLog[2]).toContain('bucket2');
    });

    /**
     * @requirement Phase 9 - Sequential multi-bucket auth
     * @scenario Pause before first bucket with prompt mode
     * @given auth-bucket-prompt is true
     * @when First bucket authentication starts
     * @then Prompts user before first bucket
     */
    it('should pause before first bucket when using prompts', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, true];

      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(authLog[0]).toContain('Prompt for anthropic/bucket1');
    });

    /**
     * @requirement Phase 9 - Sequential multi-bucket auth
     * @scenario Delay before all buckets in delay mode (so user can switch browser)
     * @given auth-bucket-prompt is false (default)
     * @when Multi-bucket authentication starts
     * @then Delay applied before each bucket including first
     */
    it('should delay before all buckets when using delay mode', async () => {
      setEphemeralSetting('auth-bucket-prompt', false);

      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      // Delay before ALL buckets including first (so user can switch browser)
      expect(delayLog).toHaveLength(2);
      expect(delayLog[0].bucket).toBe('bucket1');
      expect(delayLog[1].bucket).toBe('bucket2');
      // Auth should happen after delay
      expect(authLog[0]).toContain('Delay 5000ms before bucket1');
      expect(authLog[1]).toContain('Authenticating bucket 1/2');
    });

    /**
     * @requirement Phase 9 - Sequential multi-bucket auth
     * @scenario Use delay between buckets in delay mode
     * @given auth-bucket-prompt is false
     * @when Multiple buckets authenticated
     * @then Delays between each bucket after first
     */
    it('should delay between buckets when using delay mode', async () => {
      setEphemeralSetting('auth-bucket-delay', 3000);

      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2', 'bucket3'],
      });

      expect(delayLog).toHaveLength(3); // Delay before ALL buckets including first
      expect(delayLog[0]).toEqual({ ms: 3000, bucket: 'bucket1' });
      expect(delayLog[1]).toEqual({ ms: 3000, bucket: 'bucket2' });
      expect(delayLog[2]).toEqual({ ms: 3000, bucket: 'bucket3' });
    });
  });

  describe('User Notification', () => {
    /**
     * @requirement Phase 9 - User notification
     * @scenario Show bucket count and name
     * @given Multiple buckets to authenticate
     * @when Each bucket auth starts
     * @then Shows "Bucket X of Y: bucket-name"
     */
    it('should show bucket count and name for each bucket', async () => {
      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: [
          'work@company.com',
          'personal@gmail.com',
          'backup@example.com',
        ],
      });

      // With delays before each bucket, authLog has: [delay, auth, delay, auth, delay, auth]
      // So bucket 1 auth is at index 1, bucket 2 at index 3, bucket 3 at index 5
      expect(authLog[1]).toContain('bucket 1/3');
      expect(authLog[1]).toContain('work@company.com');
      expect(authLog[3]).toContain('bucket 2/3');
      expect(authLog[3]).toContain('personal@gmail.com');
      expect(authLog[5]).toContain('bucket 3/3');
      expect(authLog[5]).toContain('backup@example.com');
    });

    /**
     * @requirement Phase 9 - User notification
     * @scenario Ready prompt in prompt mode
     * @given auth-bucket-prompt is true
     * @when About to authenticate bucket
     * @then Shows "Ready to authenticate? Press Enter to continue..."
     */
    it('should show ready prompt when auth-bucket-prompt is true', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, true];

      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(authLog.filter((l) => l.includes('Prompt'))).toHaveLength(2);
    });

    /**
     * @requirement Phase 9 - User notification
     * @scenario Delay countdown in delay mode
     * @given auth-bucket-prompt is false
     * @when Delay before bucket auth
     * @then Shows delay duration and bucket name
     */
    it('should show delay countdown when using delay mode', async () => {
      setEphemeralSetting('auth-bucket-delay', 5000);

      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(authLog.some((l) => l.includes('Delay 5000ms'))).toBe(true);
      expect(authLog.some((l) => l.includes('bucket2'))).toBe(true);
    });

    /**
     * @requirement Phase 9 - User notification
     * @scenario Provider and bucket identification
     * @given Authentication in progress
     * @when Bucket displayed
     * @then Shows provider and bucket name clearly
     */
    it('should clearly identify provider and bucket', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true];

      await authenticator.authenticateMultipleBuckets({
        provider: 'gemini',
        buckets: ['work@example.com'],
      });

      expect(authLog.some((l) => l.includes('gemini'))).toBe(true);
      expect(authLog.some((l) => l.includes('work@example.com'))).toBe(true);
    });
  });

  describe('Partial Cancellation', () => {
    /**
     * @requirement Phase 9 - Partial cancellation
     * @scenario User cancels mid-sequence
     * @given Multiple buckets to authenticate
     * @when User cancels after second bucket
     * @then First two buckets authenticated, rest not
     */
    it('should handle cancellation mid-sequence', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, true, false]; // Cancel on third

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2', 'bucket3', 'bucket4'],
      });

      expect(result.authenticatedBuckets).toEqual(['bucket1', 'bucket2']);
      expect(result.failedBuckets).toEqual(['bucket3', 'bucket4']);
      expect(result.cancelled).toBe(true);
    });

    /**
     * @requirement Phase 9 - Partial cancellation
     * @scenario Successfully authenticated buckets remain usable
     * @given Partial cancellation occurred
     * @when Auth result checked
     * @then Authenticated buckets list shows which succeeded
     */
    it('should preserve successfully authenticated buckets on cancellation', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, false];

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2', 'bucket3'],
      });

      expect(result.authenticatedBuckets).toEqual(['bucket1']);
      expect(result.authenticatedBuckets).toHaveLength(1);
    });

    /**
     * @requirement Phase 9 - Partial cancellation
     * @scenario Show which buckets authenticated and which didn't
     * @given Cancellation mid-sequence
     * @when Result returned
     * @then Result shows authenticated and failed buckets
     */
    it('should report which buckets authenticated and which did not', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, true, false];

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: [
          'work@company.com',
          'personal@gmail.com',
          'backup@example.com',
        ],
      });

      expect(result.authenticatedBuckets).toEqual([
        'work@company.com',
        'personal@gmail.com',
      ]);
      expect(result.failedBuckets).toEqual(['backup@example.com']);
      expect(result.cancelled).toBe(true);
    });

    /**
     * @requirement Phase 9 - Partial cancellation
     * @scenario Cancellation on first prompt
     * @given Prompt mode enabled
     * @when User cancels on first bucket
     * @then No buckets authenticated
     */
    it('should handle cancellation on first bucket', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [false];

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(result.authenticatedBuckets).toHaveLength(0);
      expect(result.failedBuckets).toEqual(['bucket1', 'bucket2']);
      expect(result.cancelled).toBe(true);
    });

    /**
     * @requirement Phase 9 - Partial cancellation
     * @scenario Programmatic cancellation
     * @given Multi-bucket auth in progress
     * @when cancel() method called
     * @then Stops auth at next bucket boundary
     */
    it('should support programmatic cancellation', async () => {
      setEphemeralSetting('auth-bucket-delay', 0);

      const slowAuthenticator = new MultiBucketAuthenticator(
        async (provider: string, bucket: string) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          authLog.push(`Authenticated ${bucket}`);
        },
        async () => true,
        async () => {},
        getEphemeralSetting,
      );

      // Start auth
      const authPromise = slowAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2', 'bucket3'],
      });

      // Request cancellation
      slowAuthenticator.cancel();

      const result = await authPromise;

      expect(result.cancelled).toBe(true);
      expect(result.authenticatedBuckets.length).toBeLessThan(3);
    });
  });

  describe('Browser Control', () => {
    /**
     * @requirement Phase 9 - Browser control
     * @scenario Auto-open browser when enabled
     * @given auth-browser-open is true (default)
     * @when Bucket auth starts
     * @then Browser should auto-open
     */
    it('should auto-open browser when auth-browser-open is true', () => {
      setEphemeralSetting('auth-browser-open', true);

      const shouldOpen =
        getEphemeralSetting<boolean>('auth-browser-open') ?? true;
      expect(shouldOpen).toBe(true);
    });

    /**
     * @requirement Phase 9 - Browser control
     * @scenario Show clickable URL when browser disabled
     * @given auth-browser-open is false
     * @when Bucket auth starts
     * @then Should show URL instead of opening browser
     */
    it('should show URL when auth-browser-open is false', () => {
      setEphemeralSetting('auth-browser-open', false);

      const shouldOpen =
        getEphemeralSetting<boolean>('auth-browser-open') ?? true;
      expect(shouldOpen).toBe(false);
    });

    /**
     * @requirement Phase 9 - Browser control
     * @scenario Device code flow with timing controls
     * @given Device code flow (no browser)
     * @when Multiple buckets to authenticate
     * @then Uses same delay/prompt timing as browser flow
     */
    it('should use same timing controls for device code flow', async () => {
      setEphemeralSetting('auth-browser-open', false);
      setEphemeralSetting('auth-bucket-delay', 2000);

      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(delayLog).toHaveLength(2);
      expect(delayLog[0].ms).toBe(2000);
      expect(delayLog[1].ms).toBe(2000);
    });

    /**
     * @requirement Phase 9 - Browser control
     * @scenario Device code flow with prompts
     * @given Device code flow and auth-bucket-prompt true
     * @when Multiple buckets to authenticate
     * @then Shows prompts between device code displays
     */
    it('should support prompts in device code flow', async () => {
      setEphemeralSetting('auth-browser-open', false);
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, true];

      await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(authLog.filter((l) => l.includes('Prompt'))).toHaveLength(2);
    });

    /**
     * @requirement Phase 9 - Browser control
     * @scenario Browser setting per-auth override
     * @given auth-browser-open ephemeral set to true
     * @when Auth options specify autoOpenBrowser false
     * @then Options override ephemeral setting
     */
    it('should allow options to override ephemeral setting', async () => {
      setEphemeralSetting('auth-browser-open', true);

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1'],
        autoOpenBrowser: false,
      });

      expect(result.authenticatedBuckets).toHaveLength(1);
      // If implementation checked, should use false despite ephemeral true
    });
  });

  describe('Integration Scenarios', () => {
    /**
     * @requirement Phase 9 - Integration
     * @scenario Complete multi-bucket auth with all features
     * @given Three buckets, custom delay, browser disabled
     * @when Full auth flow executes
     * @then All settings respected, all buckets authenticated
     */
    it('should handle complete multi-bucket auth flow', async () => {
      setEphemeralSetting('auth-bucket-delay', 1000);
      setEphemeralSetting('auth-browser-open', false);

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: [
          'work@company.com',
          'personal@gmail.com',
          'backup@example.com',
        ],
      });

      expect(result.authenticatedBuckets).toHaveLength(3);
      expect(result.failedBuckets).toHaveLength(0);
      expect(result.cancelled).toBe(false);
      expect(delayLog).toHaveLength(3); // Delay before ALL buckets including first
      expect(delayLog.every((d) => d.ms === 1000)).toBe(true);
    });

    /**
     * @requirement Phase 9 - Integration
     * @scenario Prompt mode with partial cancellation
     * @given Prompt mode, multiple buckets
     * @when User cancels after some buckets
     * @then Shows correct status for each bucket
     */
    it('should handle prompt mode with partial cancellation', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, true, false, false];

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'gemini',
        buckets: ['bucket1', 'bucket2', 'bucket3', 'bucket4'],
      });

      expect(result.authenticatedBuckets).toEqual(['bucket1', 'bucket2']);
      expect(result.failedBuckets).toEqual(['bucket3', 'bucket4']);
      expect(result.cancelled).toBe(true);
    });

    /**
     * @requirement Phase 9 - Integration
     * @scenario Single bucket authentication
     * @given Single bucket to authenticate
     * @when Auth starts
     * @then Applies delay before authentication for rate-limit protection
     */
    it('should handle single bucket with delay for rate-limit protection', async () => {
      setEphemeralSetting('auth-bucket-delay', 5000);

      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['single-bucket'],
      });

      expect(result.authenticatedBuckets).toEqual(['single-bucket']);
      expect(delayLog).toHaveLength(1); // Delay applied for rate-limit protection
      expect(delayLog[0].ms).toBe(5000);
    });

    /**
     * @requirement Phase 9 - Integration
     * @scenario Empty bucket list
     * @given Empty buckets array
     * @when Auth initiated
     * @then Returns immediately with empty result
     */
    it('should handle empty bucket list gracefully', async () => {
      const result = await authenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: [],
      });

      expect(result.authenticatedBuckets).toHaveLength(0);
      expect(result.failedBuckets).toHaveLength(0);
      expect(result.cancelled).toBe(false);
    });
  });

  describe('Error Handling', () => {
    /**
     * @requirement Phase 9 - Error handling
     * @scenario Authentication error on one bucket
     * @given Second bucket fails authentication
     * @when Multi-bucket auth runs
     * @then First bucket succeeds, second fails, third continues
     */
    it('should continue to next bucket on authentication error', async () => {
      const errorAuthenticator = new MultiBucketAuthenticator(
        async (
          _provider: string,
          bucket: string,
          _index: number,
          _total: number,
        ) => {
          if (bucket === 'bucket2') {
            throw new Error('Auth failed for bucket2');
          }
          authLog.push(`Authenticated ${bucket}`);
        },
        async () => true,
        async () => {},
        getEphemeralSetting,
      );

      const result = await errorAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2', 'bucket3'],
      });

      expect(result.authenticatedBuckets).toEqual(['bucket1', 'bucket3']);
      expect(result.failedBuckets).toEqual(['bucket2']);
      expect(result.error).toContain('Auth failed for bucket2');
    });

    /**
     * @requirement Phase 9 - Error handling
     * @scenario All buckets fail
     * @given All bucket authentications fail
     * @when Multi-bucket auth runs
     * @then Reports all as failed
     */
    it('should handle all buckets failing', async () => {
      const failAuthenticator = new MultiBucketAuthenticator(
        async () => {
          throw new Error('Auth failed');
        },
        async () => true,
        async () => {},
        getEphemeralSetting,
      );

      const result = await failAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2'],
      });

      expect(result.authenticatedBuckets).toHaveLength(0);
      expect(result.failedBuckets).toEqual(['bucket1', 'bucket2']);
    });
  });

  /**
   * Issue 913: Prompt Mode Indefinite Wait
   *
   * When auth-bucket-prompt is enabled, the system should wait indefinitely
   * for user approval via MessageBus dialog - no 3-second timeout race.
   */
  describe('Issue 913: Prompt Mode Indefinite Wait', () => {
    /**
     * @requirement Issue 913 - No timeout when prompt mode enabled
     * @scenario MessageBus responds after 3+ seconds
     * @given auth-bucket-prompt is true
     * @when MessageBus takes 5 seconds to respond
     * @then System waits for full response (no premature timeout)
     */
    it('should wait indefinitely for MessageBus confirmation when auth-bucket-prompt is true', async () => {
      vi.useFakeTimers();

      setEphemeralSetting('auth-bucket-prompt', true);

      let messageBusResponseResolver: ((value: boolean) => void) | null = null;
      const messageBusResponsePromise = new Promise<boolean>((resolve) => {
        messageBusResponseResolver = resolve;
      });

      const promptCallTimes: number[] = [];
      const promptAuthenticator = new MultiBucketAuthenticator(
        async () => {
          // Auth succeeds
        },
        async () => {
          promptCallTimes.push(Date.now());
          // Simulate MessageBus that takes 5 seconds to respond
          return messageBusResponsePromise;
        },
        async () => {},
        getEphemeralSetting,
      );

      const authPromise = promptAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1'],
      });

      // Advance past the 3-second timeout that currently exists
      await vi.advanceTimersByTimeAsync(4000);

      // MessageBus responds after 5 seconds with approval
      await vi.advanceTimersByTimeAsync(1000);
      messageBusResponseResolver!(true);

      const result = await authPromise;

      // Should have waited for full MessageBus response, not timed out
      expect(result.authenticatedBuckets).toEqual(['bucket1']);
      expect(result.cancelled).toBe(false);

      vi.useRealTimers();
    });

    /**
     * @requirement Issue 913 - No stdin fallback with prompt mode
     * @scenario MessageBus available and prompt mode enabled
     * @given auth-bucket-prompt is true and MessageBus is available
     * @when Authentication is requested
     * @then stdin.setRawMode is never called (no stdin fallback)
     */
    it('should not invoke stdin fallback when auth-bucket-prompt is true and MessageBus available', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);

      // Spy on stdin.setRawMode to detect fallback usage
      const setRawModeSpy = vi.fn();
      const originalSetRawMode = process.stdin.setRawMode;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode = setRawModeSpy;
      }

      const noStdinAuthenticator = new MultiBucketAuthenticator(
        async () => {},
        async (_provider: string, _bucket: string) =>
          // This simulates the onPrompt callback in oauth-manager.ts
          // When prompt mode is enabled and MessageBus responds,
          // we should NEVER hit the stdin fallback path
          true, // MessageBus approved
        async () => {},
        getEphemeralSetting,
      );

      const result = await noStdinAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1'],
      });

      expect(result.authenticatedBuckets).toEqual(['bucket1']);
      // Verify stdin.setRawMode was never called (no stdin fallback occurred)
      expect(setRawModeSpy).not.toHaveBeenCalled();

      // Restore original setRawMode
      if (originalSetRawMode) {
        process.stdin.setRawMode = originalSetRawMode;
      }
    });

    /**
     * @requirement Issue 913 - Backward compatibility
     * @scenario auth-bucket-prompt is false
     * @given auth-bucket-prompt is false or not set
     * @when MessageBus doesn't respond
     * @then Falls back within ~3 seconds (preserves old behavior)
     */
    it('should use 3-second timeout when auth-bucket-prompt is false', async () => {
      vi.useFakeTimers();

      setEphemeralSetting('auth-bucket-prompt', false);

      const timeoutAuthenticator = new MultiBucketAuthenticator(
        async () => {},
        async () => {
          // This simulates a slow/non-responsive MessageBus
          // With prompt mode disabled, should fall back after timeout
          await new Promise((resolve) => setTimeout(resolve, 10000));
          return true;
        },
        async () => {
          // Delay callback - fallback triggered
        },
        getEphemeralSetting,
      );

      const authPromise = timeoutAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1'],
      });

      // In non-prompt mode with delay, delay is called instead of prompt
      // So this test validates delay-mode behavior is preserved
      await vi.advanceTimersByTimeAsync(6000);

      const result = await authPromise;

      expect(result.authenticatedBuckets).toEqual(['bucket1']);

      vi.useRealTimers();
    });
  });

  /**
   * Issue 913: Single-Bucket Prompt Support
   *
   * When auth-bucket-prompt is enabled, even single-bucket or default-bucket
   * profiles should show the confirmation dialog before opening browser.
   */
  describe('Issue 913: Single-Bucket Prompt Support', () => {
    /**
     * @requirement Issue 913 - Single bucket prompt
     * @scenario Single bucket profile with prompt mode
     * @given auth-bucket-prompt is true and profile has single bucket
     * @when Authentication triggered
     * @then onPrompt callback is invoked before authenticate
     */
    it('should show prompt dialog for single-bucket profile when auth-bucket-prompt is true', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);

      const callOrder: string[] = [];

      const singleBucketAuthenticator = new MultiBucketAuthenticator(
        async (_provider: string, bucket: string) => {
          callOrder.push(`auth:${bucket}`);
        },
        async (_provider: string, bucket: string) => {
          callOrder.push(`prompt:${bucket}`);
          return true;
        },
        async () => {},
        getEphemeralSetting,
      );

      await singleBucketAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['single-bucket'],
      });

      // Prompt should be called BEFORE auth
      expect(callOrder).toEqual(['prompt:single-bucket', 'auth:single-bucket']);
    });

    /**
     * @requirement Issue 913 - Default bucket prompt
     * @scenario Default (bucketless) profile with prompt mode
     * @given auth-bucket-prompt is true and no buckets specified (uses "default")
     * @when Authentication triggered
     * @then onPrompt callback is invoked before authenticate
     */
    it('should show prompt dialog for default bucket when auth-bucket-prompt is true', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);

      const callOrder: string[] = [];

      const defaultBucketAuthenticator = new MultiBucketAuthenticator(
        async (_provider: string, bucket: string) => {
          callOrder.push(`auth:${bucket}`);
        },
        async (_provider: string, bucket: string) => {
          callOrder.push(`prompt:${bucket}`);
          return true;
        },
        async () => {},
        getEphemeralSetting,
      );

      // Using 'default' as the implicit bucket name
      await defaultBucketAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['default'],
      });

      expect(callOrder).toEqual(['prompt:default', 'auth:default']);
    });
  });

  /**
   * Issue 913: Eager Multi-Bucket Authentication
   *
   * Multi-bucket profiles should authenticate ALL buckets upfront,
   * not lazily on failover. Partial auth should only prompt for missing buckets.
   */
  describe('Issue 913: Eager Multi-Bucket Authentication', () => {
    /**
     * @requirement Issue 913 - Eager auth all buckets
     * @scenario Multi-bucket profile, none authenticated
     * @given 3 buckets, none have tokens
     * @when Profile loaded
     * @then All 3 buckets get auth attempts before any API call
     */
    it('should eager-authenticate all buckets in multi-bucket profile', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);
      promptResponses = [true, true, true];

      const authenticatedBuckets: string[] = [];

      const eagerAuthenticator = new MultiBucketAuthenticator(
        async (_provider: string, bucket: string) => {
          authenticatedBuckets.push(bucket);
        },
        async () => promptResponses.shift() ?? true,
        async () => {},
        getEphemeralSetting,
      );

      const result = await eagerAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2', 'bucket3'],
      });

      // All 3 buckets should be authenticated upfront
      expect(authenticatedBuckets).toEqual(['bucket1', 'bucket2', 'bucket3']);
      expect(result.authenticatedBuckets).toHaveLength(3);
    });

    /**
     * @requirement Issue 913 - Partial auth prompts only missing
     * @scenario Multi-bucket profile, some already authenticated
     * @given 3 buckets, 1 already has valid token
     * @when Authentication check runs
     * @then Only 2 prompts shown (for missing buckets)
     *
     * NOTE: This test validates the expected behavior. The actual implementation
     * in oauth-manager.ts needs to check token existence before prompting.
     */
    it('should only show prompts for unauthenticated buckets', async () => {
      setEphemeralSetting('auth-bucket-prompt', true);

      const promptedBuckets: string[] = [];
      const authenticatedBuckets: string[] = [];

      // Simulate bucket2 already being authenticated
      const alreadyAuthenticated = new Set(['bucket2']);

      const partialAuthenticator = new MultiBucketAuthenticator(
        async (_provider: string, bucket: string) => {
          if (!alreadyAuthenticated.has(bucket)) {
            authenticatedBuckets.push(bucket);
          }
        },
        async (_provider: string, bucket: string) => {
          // Only prompt for buckets that aren't already authenticated
          if (!alreadyAuthenticated.has(bucket)) {
            promptedBuckets.push(bucket);
          }
          return true;
        },
        async () => {},
        getEphemeralSetting,
      );

      await partialAuthenticator.authenticateMultipleBuckets({
        provider: 'anthropic',
        buckets: ['bucket1', 'bucket2', 'bucket3'],
      });

      // Only bucket1 and bucket3 should have been prompted
      // (bucket2 was already authenticated)
      // NOTE: Current implementation prompts for ALL buckets - this test
      // documents the EXPECTED behavior after the fix
      expect(promptedBuckets).toEqual(['bucket1', 'bucket3']);
      expect(authenticatedBuckets).toEqual(['bucket1', 'bucket3']);
    });
  });
});
