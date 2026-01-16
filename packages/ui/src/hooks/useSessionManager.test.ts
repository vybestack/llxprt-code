import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { useSessionManager } from './useSessionManager';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Simple renderHook implementation for testing React hooks
function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result = { current: hook() };
  return { result };
}

describe('useSessionManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-session-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initial state', () => {
    it('should start with null session and idle status', () => {
      const { result } = renderHook(() => useSessionManager());

      expect(result.current.session).toBeNull();
      expect(result.current.status).toBe('idle');
      expect(result.current.error).toBeNull();
    });

    it('should return false for hasSession initially', () => {
      const { result } = renderHook(() => useSessionManager());

      expect(result.current.hasSession).toBe(false);
    });
  });

  describe('destroySession', () => {
    it('should reset state to idle', () => {
      const { result } = renderHook(() => useSessionManager());

      act(() => {
        result.current.destroySession();
      });

      expect(result.current.session).toBeNull();
      expect(result.current.status).toBe('idle');
      expect(result.current.error).toBeNull();
    });
  });

  describe('createSession', () => {
    it('should set status to initializing when called', () => {
      const { result } = renderHook(() => useSessionManager());

      // Start the async operation but don't await it yet
      act(() => {
        void result.current.createSession({
          model: 'gemini-2.5-flash',
          workingDir: tempDir,
        });
      });

      // During initialization, status should be initializing
      expect(result.current.status).toBe('initializing');
    });

    // Session creation can be slow on Windows CI
    it(
      'should complete session creation with result',
      { timeout: 15000 },
      async () => {
        const { result } = renderHook(() => useSessionManager());

        await act(async () => {
          await result.current.createSession({
            model: 'gemini-2.5-flash',
            workingDir: tempDir,
          });
        });

        // After completion, status should be either ready or error (not initializing)
        expect(result.current.status).not.toBe('initializing');
        expect(['ready', 'error']).toContain(result.current.status);
      },
    );
  });
});
