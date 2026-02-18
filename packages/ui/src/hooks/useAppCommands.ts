import { useCallback } from 'react';
import type { SessionConfig } from '../features/config';
import type { ConfigSessionOptions } from '../features/config/configSession';
import { listModels, listProviders } from '../features/config';
import {
  applyProfileWithSession,
  validateSessionConfig,
} from '../features/config';
import { findTheme, type ThemeDefinition } from '../features/theme';

interface ItemFetchResult {
  items: { id: string; label: string }[];
  messages?: string[];
}

interface ConfigCommandResult {
  handled: boolean;
  nextConfig: SessionConfig;
  messages: string[];
  profileName?: string;
}

interface UseAppCommandsProps {
  sessionConfig: SessionConfig;
  setSessionConfig: (config: SessionConfig) => void;
  themes: ThemeDefinition[];
  setThemeBySlug: (slug: string) => void;
  appendMessage: (role: 'user' | 'model' | 'system', text: string) => string;
  createSession: (options: ConfigSessionOptions) => Promise<void>;
}

interface UseAppCommandsResult {
  fetchModelItems: () => Promise<ItemFetchResult>;
  fetchProviderItems: () => Promise<ItemFetchResult>;
  applyTheme: (key: string) => void;
  handleConfigCommand: (command: string) => Promise<ConfigCommandResult>;
}

export function useAppCommands({
  sessionConfig,
  setSessionConfig,
  themes,
  setThemeBySlug,
  appendMessage,
  createSession,
}: UseAppCommandsProps): UseAppCommandsResult {
  const fetchModelItems = useCallback(async (): Promise<ItemFetchResult> => {
    const missing = validateSessionConfig(sessionConfig, {
      requireModel: false,
    });
    if (missing.length > 0) {
      return { items: [], messages: missing };
    }
    try {
      const models = await listModels(sessionConfig);
      const items = models.map((model) => ({
        id: model.id,
        label: model.name || model.id,
      }));
      return { items };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { items: [], messages: [`Failed to load models: ${message}`] };
    }
  }, [sessionConfig]);

  const fetchProviderItems = useCallback(async (): Promise<ItemFetchResult> => {
    try {
      const providers = await Promise.resolve(listProviders());
      const items = providers.map((p) => ({ id: p.id, label: p.label }));
      return { items };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { items: [], messages: [`Failed to load providers: ${message}`] };
    }
  }, []);

  const applyTheme = useCallback(
    (key: string) => {
      const match = findTheme(themes, key);
      if (!match) {
        appendMessage('system', `Theme not found: ${key}`);
        return;
      }
      setThemeBySlug(match.slug);
      appendMessage('system', `Theme set to ${match.name}`);
    },
    [appendMessage, setThemeBySlug, themes],
  );

  const handleConfigCommand = useCallback(
    async (command: string): Promise<ConfigCommandResult> => {
      const configResult = await applyProfileWithSession(
        command,
        sessionConfig,
        {
          workingDir: process.cwd(),
        },
      );
      if (configResult.handled) {
        setSessionConfig(configResult.nextConfig);
        for (const msg of configResult.messages) {
          appendMessage('system', msg);
        }

        // If profile was loaded successfully, create the session
        if (configResult.sessionOptions) {
          try {
            appendMessage('system', 'Initializing session...');
            await createSession(configResult.sessionOptions);
            appendMessage('system', 'Session ready. You can now chat.');
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            appendMessage('system', `Failed to initialize session: ${message}`);
          }
        }
      }
      return { ...configResult, profileName: configResult.profileName };
    },
    [appendMessage, sessionConfig, setSessionConfig, createSession],
  );

  return {
    fetchModelItems,
    fetchProviderItems,
    applyTheme,
    handleConfigCommand,
  };
}
