/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { AuthStatus } from '@vybestack/llxprt-code-providers/auth.js';

interface AuthDialogProps {
  onSelect: (authMethod: string | undefined, scope: SettingScope) => void;
  settings: LoadedSettings;
  initialErrorMessage?: string | null;
}

interface AuthDialogState {
  enabledProviders: Set<string>;
  setEnabledProviders: React.Dispatch<React.SetStateAction<Set<string>>>;
  authStatuses: Map<string, AuthStatus>;
  setAuthStatuses: React.Dispatch<
    React.SetStateAction<Map<string, AuthStatus>>
  >;
}

function getEnabledProviders(
  oauthProviders: Record<string, boolean> | undefined,
): Set<string> {
  const enabled = new Set<string>();
  const providers = oauthProviders ?? {};
  for (const [provider, isEnabled] of Object.entries(providers)) {
    if (isEnabled) {
      enabled.add(`oauth_${provider}`);
    }
  }
  return enabled;
}

const AuthDialogHeader: React.FC = () => (
  <>
    <Text bold color={Colors.Foreground}>
      OAuth Authentication
    </Text>
    <Box marginTop={1}>
      <Text color={Colors.Foreground}>
        Select an OAuth provider to authenticate:
      </Text>
    </Box>
    <Box marginTop={1}>
      <Text color={Colors.DimComment}>
        Note: You can also use API keys via /key, /keyfile, --key, --keyfile,
        --key-name, or environment variables
      </Text>
    </Box>
  </>
);

const AuthDialogFooter: React.FC = () => (
  <>
    <Box marginTop={1}>
      <Text color={Colors.Gray}>(Use Enter to select, ESC to close)</Text>
    </Box>
    <Box marginTop={1}>
      <Text color={Colors.Foreground}>
        Terms of Services and Privacy Notice for Gemini CLI
      </Text>
    </Box>
    <Box marginTop={1}>
      <Text color={Colors.AccentBlue}>
        {
          'https://github.com/acoliver/llxprt-code/blob/main/docs/tos-privacy.md'
        }
      </Text>
    </Box>
  </>
);

function getStatusLabel(
  provider: string,
  authStatuses: ReadonlyMap<string, AuthStatus>,
): string {
  const status = authStatuses.get(provider);
  if (status === undefined) return '';
  return status.authenticated ? ' (Authenticated)' : ' (Not authenticated)';
}

function buildAuthItems(
  enabledProviders: Set<string>,
  authStatuses: ReadonlyMap<string, AuthStatus>,
): Array<{
  key: string;
  label: string;
  value: string;
}> {
  return [
    {
      key: 'oauth_gemini',
      label: `Gemini (Google OAuth) ${enabledProviders.has('oauth_gemini') ? '[ON]' : '[OFF]'}${getStatusLabel('gemini', authStatuses)}`,
      value: 'oauth_gemini',
    },
    {
      key: 'oauth_qwen',
      label: `Qwen (OAuth) ${enabledProviders.has('oauth_qwen') ? '[ON]' : '[OFF]'}${getStatusLabel('qwen', authStatuses)}`,
      value: 'oauth_qwen',
    },
    {
      key: 'oauth_anthropic',
      label: `Anthropic Claude (OAuth) ${enabledProviders.has('oauth_anthropic') ? '[ON]' : '[OFF]'}${getStatusLabel('anthropic', authStatuses)}`,
      value: 'oauth_anthropic',
    },
    {
      key: 'oauth_codex',
      label: `Codex (ChatGPT OAuth) ${enabledProviders.has('oauth_codex') ? '[ON]' : '[OFF]'}${getStatusLabel('codex', authStatuses)}`,
      value: 'oauth_codex',
    },
    {
      key: 'close',
      label: 'Close',
      value: 'close',
    },
  ];
}

interface AuthDialogContentProps {
  items: Array<{ key: string; label: string; value: string }>;
  errorMessage: string | null;
  handleAuthSelect: (authMethod: string) => void;
}

const AuthDialogContent: React.FC<AuthDialogContentProps> = ({
  items,
  errorMessage,
  handleAuthSelect,
}) => (
  <>
    <AuthDialogHeader />
    <Box marginTop={1}>
      <RadioButtonSelect
        items={items}
        initialIndex={0}
        onSelect={handleAuthSelect}
      />
    </Box>
    {errorMessage && (
      <Box marginTop={1}>
        <Text color={Colors.AccentRed}>{errorMessage}</Text>
      </Box>
    )}
    <AuthDialogFooter />
  </>
);

function useMountedRef(): React.MutableRefObject<boolean> {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

function useAuthDialogState(
  settings: LoadedSettings,
  runtime: ReturnType<typeof useRuntimeApi>,
  mountedRef: React.MutableRefObject<boolean>,
): AuthDialogState {
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(() =>
    getEnabledProviders(settings.merged.oauthEnabledProviders),
  );
  const [authStatuses, setAuthStatuses] = useState<Map<string, AuthStatus>>(
    () => new Map(),
  );

  useEffect(() => {
    setEnabledProviders(
      getEnabledProviders(settings.merged.oauthEnabledProviders),
    );
  }, [settings.merged.oauthEnabledProviders]);

  useEffect(() => {
    const oauthManager = runtime.getCliOAuthManager();
    const getAuthStatus = oauthManager?.getAuthStatus;
    if (getAuthStatus === undefined) return;

    void (async () => {
      try {
        const statuses = await getAuthStatus.call(oauthManager);
        if (!mountedRef.current) return;
        setAuthStatuses(
          new Map(statuses.map((status) => [status.provider, status])),
        );
        syncEnabledProvidersFromAuthStatus(setEnabledProviders, statuses);
      } catch {
        if (mountedRef.current) setAuthStatuses(new Map());
      }
    })();
  }, [mountedRef, runtime]);

  return {
    enabledProviders,
    setEnabledProviders,
    authStatuses,
    setAuthStatuses,
  };
}

function syncEnabledProvidersFromAuthStatus(
  setEnabledProviders: React.Dispatch<React.SetStateAction<Set<string>>>,
  statuses: AuthStatus[],
): void {
  setEnabledProviders((prev) => {
    const next = new Set(prev);
    for (const status of statuses) {
      const key = `oauth_${status.provider}`;
      if (status.oauthEnabled === true) {
        next.add(key);
      } else if (status.oauthEnabled === false) {
        next.delete(key);
      }
    }
    return next;
  });
}

function recordAuthenticatedProvider(
  authMethod: string,
  providerName: string,
  setEnabledProviders: React.Dispatch<React.SetStateAction<Set<string>>>,
  setAuthStatuses: React.Dispatch<
    React.SetStateAction<Map<string, AuthStatus>>
  >,
): void {
  setEnabledProviders((prev) => new Set([...prev, authMethod]));
  setAuthStatuses((prev) =>
    new Map(prev).set(providerName, {
      provider: providerName,
      authenticated: true,
      oauthEnabled: true,
    }),
  );
}

function useCloseAuthDialogOnEscape(
  onSelect: AuthDialogProps['onSelect'],
): void {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onSelect(undefined, SettingScope.User);
      }
    },
    { isActive: true },
  );
}

export function AuthDialog({
  onSelect,
  settings,
  initialErrorMessage,
}: AuthDialogProps): React.JSX.Element {
  const runtime = useRuntimeApi();
  const mountedRef = useMountedRef();
  const [errorMessage, setErrorMessage] = useState<string | null>(
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string error message should be treated as null
    initialErrorMessage || null,
  );
  const {
    enabledProviders,
    setEnabledProviders,
    authStatuses,
    setAuthStatuses,
  } = useAuthDialogState(settings, runtime, mountedRef);
  const items = useMemo(
    () => buildAuthItems(enabledProviders, authStatuses),
    [enabledProviders, authStatuses],
  );

  const handleAuthSelect = useCallback(
    (authMethod: string) => {
      setErrorMessage(null);

      if (authMethod === 'close') {
        onSelect(undefined, SettingScope.User);
        return;
      }

      const providerName = authMethod.replace('oauth_', '');
      const oauthManager = runtime.getCliOAuthManager();

      if (!oauthManager) {
        setErrorMessage('OAuth manager unavailable');
        return;
      }

      void (async () => {
        try {
          await oauthManager.authenticate(providerName, undefined, {
            signalAuthCompletion: true,
          });
          if (!mountedRef.current) return;
          recordAuthenticatedProvider(
            authMethod,
            providerName,
            setEnabledProviders,
            setAuthStatuses,
          );
          onSelect(authMethod, SettingScope.User);
        } catch (error) {
          if (mountedRef.current) {
            setErrorMessage(
              `Authentication failed for ${providerName}: ${error}`,
            );
          }
        }
      })();
    },
    [mountedRef, onSelect, runtime, setAuthStatuses, setEnabledProviders],
  );

  useCloseAuthDialogOnEscape(onSelect);

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
      backgroundColor={Colors.Background}
    >
      <AuthDialogContent
        items={items}
        errorMessage={errorMessage}
        handleAuthSelect={handleAuthSelect}
      />
    </Box>
  );
}
