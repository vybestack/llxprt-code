import { useCallback, useState, useRef, useEffect } from 'react';
import type {
  ConfigSession,
  ConfigSessionOptions,
} from '../features/config/configSession';
import { createConfigSession } from '../features/config/configSession';
import { getLogger } from '../lib/logger';

export type SessionStatus = 'idle' | 'initializing' | 'ready' | 'error';

export interface UseSessionManagerReturn {
  session: ConfigSession | null;
  sessionOptions: ConfigSessionOptions | null;
  status: SessionStatus;
  error: string | null;
  hasSession: boolean;
  createSession: (options: ConfigSessionOptions) => Promise<void>;
  destroySession: () => void;
}

const logger = getLogger('nui:session-manager');

export function useSessionManager(): UseSessionManagerReturn {
  const [session, setSession] = useState<ConfigSession | null>(null);
  const [sessionOptions, setSessionOptions] =
    useState<ConfigSessionOptions | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ConfigSession | null>(null);

  const destroySession = useCallback(() => {
    if (sessionRef.current) {
      logger.debug('Disposing existing session');
      sessionRef.current.dispose();
      sessionRef.current = null;
    }
    setSession(null);
    setSessionOptions(null);
    setStatus('idle');
    setError(null);
  }, []);

  const createSession = useCallback(
    async (options: ConfigSessionOptions): Promise<void> => {
      logger.debug('Creating new session', {
        model: options.model,
        provider: options.provider,
      });

      // Dispose existing session first
      if (sessionRef.current) {
        sessionRef.current.dispose();
        sessionRef.current = null;
      }

      setStatus('initializing');
      setError(null);
      setSession(null);

      try {
        const newSession = createConfigSession(options);
        await newSession.initialize();

        sessionRef.current = newSession;
        setSession(newSession);
        setSessionOptions(options);
        setStatus('ready');

        const registry = newSession.config.getToolRegistry();
        const tools = registry.getFunctionDeclarations();
        logger.debug('Session ready', { toolCount: tools.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Session initialization failed', { error: message });
        setError(message);
        setStatus('error');
        setSession(null);
      }
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.dispose();
      }
    };
  }, []);

  return {
    session,
    sessionOptions,
    status,
    error,
    hasSession: session !== null && status === 'ready',
    createSession,
    destroySession,
  };
}
