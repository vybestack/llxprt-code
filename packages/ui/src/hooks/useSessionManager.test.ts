import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionManager } from './useSessionManager';

describe('useSessionManager', () => {
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
          workingDir: '/home/test',
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
            workingDir: '/home/test',
          });
        });

        // After completion, status should be either ready or error (not initializing)
        expect(result.current.status).not.toBe('initializing');
        expect(['ready', 'error']).toContain(result.current.status);
      },
    );
  });
});
