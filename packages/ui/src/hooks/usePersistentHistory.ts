import { useEffect, useRef, useState } from 'react';
import {
  PersistentHistoryService,
  createPersistentHistory,
} from '../features/chat/persistentHistory';
import { getLogger } from '../lib/logger';

const logger = getLogger('nui:use-persistent-history');

export interface UsePersistentHistoryOptions {
  /** Working directory for the session */
  workingDir: string | null;
  /** Session ID */
  sessionId: string | null;
}

export interface UsePersistentHistoryReturn {
  /** The persistent history service, null if not initialized */
  service: PersistentHistoryService | null;
  /** Whether the service is ready */
  isReady: boolean;
}

/**
 * Hook to manage persistent history service lifecycle.
 * Initializes when workingDir and sessionId are provided,
 * cleans up when they change or component unmounts.
 */
export function usePersistentHistory(
  options: UsePersistentHistoryOptions,
): UsePersistentHistoryReturn {
  const { workingDir, sessionId } = options;
  const [service, setService] = useState<PersistentHistoryService | null>(null);
  const [isReady, setIsReady] = useState(false);
  const serviceRef = useRef<PersistentHistoryService | null>(null);

  useEffect(() => {
    // Clean up previous service
    if (serviceRef.current) {
      logger.debug('Closing previous persistent history service');
      serviceRef.current.close();
      serviceRef.current = null;
      setService(null);
      setIsReady(false);
    }

    // Don't initialize without required params
    if (!workingDir || !sessionId) {
      return;
    }

    let cancelled = false;

    const initService = async () => {
      logger.debug('Initializing persistent history', {
        workingDir,
        sessionId,
      });
      const newService = createPersistentHistory(workingDir, sessionId);

      try {
        await newService.initialize();

        if (cancelled) {
          newService.close();
          return;
        }

        serviceRef.current = newService;
        setService(newService);
        setIsReady(true);
        logger.debug('Persistent history ready', {
          historyCount: newService.count,
        });
      } catch (err) {
        logger.error('Failed to initialize persistent history:', String(err));
        if (!cancelled) {
          setService(null);
          setIsReady(false);
        }
      }
    };

    void initService();

    return () => {
      cancelled = true;
      if (serviceRef.current) {
        serviceRef.current.close();
        serviceRef.current = null;
      }
    };
  }, [workingDir, sessionId]);

  return { service, isReady };
}
