# Welcome Onboarding Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create an interactive welcome wizard for first-run users that guides them through provider selection, authentication, and optional profile saving.

**Architecture:** Multi-step dialog component with state machine, leveraging existing RadioButtonSelect, auth infrastructure, and ProfileManager. Triggers after folder trust dialog, persists completion flag to `~/.llxprt/welcomeConfig.json`.

**Tech Stack:** React + Ink, TypeScript, existing ProviderManager/ProfileManager APIs

---

## Task 1: Create Welcome Config Service

**Files:**

- Create: `packages/cli/src/config/welcomeConfig.ts`

**Step 1: Create the welcome config module**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { USER_SETTINGS_DIR } from './paths.js';

export const WELCOME_CONFIG_FILENAME = 'welcomeConfig.json';

export function getWelcomeConfigPath(): string {
  if (process.env['LLXPRT_CODE_WELCOME_CONFIG_PATH']) {
    return process.env['LLXPRT_CODE_WELCOME_CONFIG_PATH'];
  }
  return path.join(USER_SETTINGS_DIR, WELCOME_CONFIG_FILENAME);
}

export interface WelcomeConfig {
  welcomeCompleted: boolean;
  completedAt?: string;
  skipped?: boolean;
}

let cachedConfig: WelcomeConfig | undefined;

export function resetWelcomeConfigForTesting(): void {
  cachedConfig = undefined;
}

export function loadWelcomeConfig(): WelcomeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getWelcomeConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      cachedConfig = JSON.parse(content) as WelcomeConfig;
      return cachedConfig;
    }
  } catch (_error) {
    // If parsing fails, return default
  }

  cachedConfig = { welcomeCompleted: false };
  return cachedConfig;
}

export function saveWelcomeConfig(config: WelcomeConfig): void {
  const configPath = getWelcomeConfigPath();

  try {
    const dirPath = path.dirname(configPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    cachedConfig = config;
  } catch (error) {
    console.error('Error saving welcome config:', error);
  }
}

export function markWelcomeCompleted(skipped: boolean = false): void {
  saveWelcomeConfig({
    welcomeCompleted: true,
    completedAt: new Date().toISOString(),
    skipped,
  });
}

export function isWelcomeCompleted(): boolean {
  return loadWelcomeConfig().welcomeCompleted;
}
```

**Step 2: Commit**

```bash
git add packages/cli/src/config/welcomeConfig.ts
git commit -m "feat(welcome): add welcome config service for first-run detection"
```

---

## Task 2: Create Welcome State Types and Hook

**Files:**

- Create: `packages/cli/src/ui/hooks/useWelcomeOnboarding.ts`

**Step 1: Create the hook with state management**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { type Config, DebugLogger } from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';
import {
  isWelcomeCompleted,
  markWelcomeCompleted,
} from '../../config/welcomeConfig.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

const debug = new DebugLogger('llxprt:ui:useWelcomeOnboarding');

export type WelcomeStep =
  | 'welcome'
  | 'provider'
  | 'auth_method'
  | 'authenticating'
  | 'completion'
  | 'skipped';

export interface WelcomeState {
  step: WelcomeStep;
  selectedProvider?: string;
  selectedAuthMethod?: 'oauth' | 'api_key';
  authInProgress: boolean;
  error?: string;
}

export interface WelcomeActions {
  startSetup: () => void;
  selectProvider: (providerId: string) => void;
  selectAuthMethod: (method: 'oauth' | 'api_key') => void;
  onAuthComplete: () => void;
  onAuthError: (error: string) => void;
  skipSetup: () => void;
  goBack: () => void;
  saveProfile: (name: string) => Promise<void>;
  dismiss: () => void;
}

export interface UseWelcomeOnboardingReturn {
  showWelcome: boolean;
  welcomeState: WelcomeState;
  welcomeActions: WelcomeActions;
  availableProviders: string[];
}

export const useWelcomeOnboarding = (
  config: Config,
  settings: LoadedSettings,
): UseWelcomeOnboardingReturn => {
  const runtime = useRuntimeApi();
  const [showWelcome, setShowWelcome] = useState(() => !isWelcomeCompleted());

  const [state, setState] = useState<WelcomeState>({
    step: 'welcome',
    authInProgress: false,
  });

  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

  // Load available providers on mount
  useEffect(() => {
    const providerManager = runtime.getCliProviderManager();
    if (providerManager) {
      const providers = providerManager.listProviders();
      setAvailableProviders(providers);
      debug.log(
        `Loaded ${providers.length} providers: ${providers.join(', ')}`,
      );
    }
  }, [runtime]);

  const startSetup = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'provider' }));
  }, []);

  const selectProvider = useCallback((providerId: string) => {
    setState((prev) => ({
      ...prev,
      selectedProvider: providerId,
      step: 'auth_method',
    }));
  }, []);

  const selectAuthMethod = useCallback((method: 'oauth' | 'api_key') => {
    setState((prev) => ({
      ...prev,
      selectedAuthMethod: method,
      step: 'authenticating',
      authInProgress: true,
    }));
  }, []);

  const onAuthComplete = useCallback(() => {
    const providerManager = runtime.getCliProviderManager();
    if (providerManager && state.selectedProvider) {
      try {
        providerManager.setActiveProvider(state.selectedProvider);
        debug.log(`Set active provider to: ${state.selectedProvider}`);
      } catch (error) {
        debug.log(`Failed to set active provider: ${error}`);
      }
    }

    setState((prev) => ({
      ...prev,
      step: 'completion',
      authInProgress: false,
      error: undefined,
    }));
  }, [runtime, state.selectedProvider]);

  const onAuthError = useCallback((error: string) => {
    setState((prev) => ({
      ...prev,
      authInProgress: false,
      error,
      step: 'auth_method',
    }));
  }, []);

  const skipSetup = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'skipped' }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      switch (prev.step) {
        case 'auth_method':
          return { ...prev, step: 'provider', selectedProvider: undefined };
        case 'authenticating':
          return {
            ...prev,
            step: 'auth_method',
            selectedAuthMethod: undefined,
            authInProgress: false,
          };
        case 'provider':
          return { ...prev, step: 'welcome' };
        default:
          return prev;
      }
    });
  }, []);

  const saveProfile = useCallback(
    async (name: string) => {
      try {
        const profileManager = runtime.getProfileManager();
        const settingsService = runtime.getSettingsService();
        if (profileManager && settingsService) {
          await profileManager.save(name, settingsService);
          debug.log(`Saved profile: ${name}`);
        }
      } catch (error) {
        debug.log(`Failed to save profile: ${error}`);
        throw error;
      }
    },
    [runtime],
  );

  const dismiss = useCallback(() => {
    const skipped = state.step === 'skipped';
    markWelcomeCompleted(skipped);
    setShowWelcome(false);
    debug.log(`Welcome flow completed (skipped: ${skipped})`);
  }, [state.step]);

  return {
    showWelcome,
    welcomeState: state,
    welcomeActions: {
      startSetup,
      selectProvider,
      selectAuthMethod,
      onAuthComplete,
      onAuthError,
      skipSetup,
      goBack,
      saveProfile,
      dismiss,
    },
    availableProviders,
  };
};
```

**Step 2: Commit**

```bash
git add packages/cli/src/ui/hooks/useWelcomeOnboarding.ts
git commit -m "feat(welcome): add useWelcomeOnboarding hook for state management"
```

---

## Task 3: Create WelcomeStep Component

**Files:**

- Create: `packages/cli/src/ui/components/WelcomeOnboarding/WelcomeStep.tsx`

**Step 1: Create the welcome step component**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from '../shared/RadioButtonSelect.js';

export type WelcomeChoice = 'setup' | 'skip';

interface WelcomeStepProps {
  onSelect: (choice: WelcomeChoice) => void;
  isFocused?: boolean;
}

export const WelcomeStep: React.FC<WelcomeStepProps> = ({
  onSelect,
  isFocused = true,
}) => {
  const options: Array<RadioSelectItem<WelcomeChoice>> = [
    {
      label: 'Set up now (recommended)',
      value: 'setup',
      key: 'setup',
    },
    {
      label: 'Skip setup (I know what I\'m doing)',
      value: 'skip',
      key: 'skip',
    },
  ];

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Welcome to llxprt!
        </Text>
        <Text> </Text>
        <Text>Let's get you set up in just a few steps.</Text>
        <Text>
          You'll choose an AI provider and configure authentication
        </Text>
        <Text>so llxprt can work its magic.</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>What would you like to do?</Text>
      </Box>

      <RadioButtonSelect
        items={options}
        onSelect={onSelect}
        isFocused={isFocused}
      />

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Use ↑↓ to navigate, Enter to select, Esc to skip
        </Text>
      </Box>
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add packages/cli/src/ui/components/WelcomeOnboarding/WelcomeStep.tsx
git commit -m "feat(welcome): add WelcomeStep component"
```

---

## Task 4: Create ProviderSelectStep Component

**Files:**

- Create: `packages/cli/src/ui/components/WelcomeOnboarding/ProviderSelectStep.tsx`

**Step 1: Create the provider selection component**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from '../shared/RadioButtonSelect.js';

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT-4, etc.)',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  'openai-responses': 'OpenAI Responses API',
  openaivercel: 'OpenAI (Vercel AI SDK)',
};

interface ProviderSelectStepProps {
  providers: string[];
  onSelect: (providerId: string) => void;
  onSkip: () => void;
  isFocused?: boolean;
}

export const ProviderSelectStep: React.FC<ProviderSelectStepProps> = ({
  providers,
  onSelect,
  onSkip,
  isFocused = true,
}) => {
  const options: Array<RadioSelectItem<string>> = useMemo(() => {
    const providerOptions = providers.map((provider) => ({
      label: PROVIDER_DISPLAY_NAMES[provider] || provider,
      value: provider,
      key: provider,
    }));

    // Add "configure manually" option
    providerOptions.push({
      label: 'Configure manually later',
      value: '__skip__',
      key: '__skip__',
    });

    return providerOptions;
  }, [providers]);

  const handleSelect = (value: string) => {
    if (value === '__skip__') {
      onSkip();
    } else {
      onSelect(value);
    }
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 1 of 3: Choose Your AI Provider
        </Text>
        <Text> </Text>
        <Text>Select which AI provider you'd like to use:</Text>
      </Box>

      <RadioButtonSelect
        items={options}
        onSelect={handleSelect}
        isFocused={isFocused}
        maxItemsToShow={8}
      />

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Use ↑↓ to navigate, Enter to select, Esc to skip
        </Text>
      </Box>
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add packages/cli/src/ui/components/WelcomeOnboarding/ProviderSelectStep.tsx
git commit -m "feat(welcome): add ProviderSelectStep component"
```

---

## Task 5: Create AuthMethodStep Component

**Files:**

- Create: `packages/cli/src/ui/components/WelcomeOnboarding/AuthMethodStep.tsx`

**Step 1: Create the auth method selection component**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from '../shared/RadioButtonSelect.js';

// Providers that support OAuth
const OAUTH_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'qwen']);

const API_KEY_URLS: Record<string, string> = {
  anthropic: 'console.anthropic.com/settings/keys',
  openai: 'platform.openai.com/api-keys',
  gemini: 'aistudio.google.com/app/apikey',
  deepseek: 'platform.deepseek.com/api_keys',
  qwen: 'dashscope.console.aliyun.com/apiKey',
};

type AuthMethod = 'oauth' | 'api_key' | 'back';

interface AuthMethodStepProps {
  provider: string;
  onSelect: (method: 'oauth' | 'api_key') => void;
  onBack: () => void;
  error?: string;
  isFocused?: boolean;
}

export const AuthMethodStep: React.FC<AuthMethodStepProps> = ({
  provider,
  onSelect,
  onBack,
  error,
  isFocused = true,
}) => {
  const supportsOAuth = OAUTH_PROVIDERS.has(provider);
  const apiKeyUrl = API_KEY_URLS[provider];

  const options: Array<RadioSelectItem<AuthMethod>> = useMemo(() => {
    const opts: Array<RadioSelectItem<AuthMethod>> = [];

    if (supportsOAuth) {
      opts.push({
        label: 'OAuth (Recommended - secure & easy)',
        value: 'oauth',
        key: 'oauth',
      });
    }

    opts.push({
      label: 'API Key',
      value: 'api_key',
      key: 'api_key',
    });

    opts.push({
      label: '← Back to provider selection',
      value: 'back',
      key: 'back',
    });

    return opts;
  }, [supportsOAuth]);

  const handleSelect = (value: AuthMethod) => {
    if (value === 'back') {
      onBack();
    } else {
      onSelect(value);
    }
  };

  const providerDisplay =
    provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 2 of 3: Choose Authentication Method
        </Text>
        <Text> </Text>
        <Text>How would you like to authenticate with {providerDisplay}?</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color={Colors.AccentRed}>{error}</Text>
        </Box>
      )}

      <RadioButtonSelect
        items={options}
        onSelect={handleSelect}
        isFocused={isFocused}
      />

      {apiKeyUrl && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Get API key at: {apiKeyUrl}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Use ↑↓ to navigate, Enter to select, Esc to skip
        </Text>
      </Box>
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add packages/cli/src/ui/components/WelcomeOnboarding/AuthMethodStep.tsx
git commit -m "feat(welcome): add AuthMethodStep component"
```

---

## Task 6: Create AuthenticationStep Component

**Files:**

- Create: `packages/cli/src/ui/components/WelcomeOnboarding/AuthenticationStep.tsx`

**Step 1: Create the authentication step component**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import Spinner from 'ink-spinner';

interface AuthenticationStepProps {
  provider: string;
  method: 'oauth' | 'api_key';
  onComplete: () => void;
  onError: (error: string) => void;
  onBack: () => void;
  triggerAuth: (provider: string, method: 'oauth' | 'api_key', apiKey?: string) => Promise<void>;
  isFocused?: boolean;
}

export const AuthenticationStep: React.FC<AuthenticationStepProps> = ({
  provider,
  method,
  onComplete,
  onError,
  onBack,
  triggerAuth,
  isFocused = true,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(method === 'api_key');

  const providerDisplay =
    provider.charAt(0).toUpperCase() + provider.slice(1);

  // Handle escape to go back
  useKeypress(
    (key) => {
      if (key.name === 'escape' && !isAuthenticating) {
        onBack();
      }
    },
    { isActive: isFocused && !isAuthenticating },
  );

  // Start OAuth flow automatically
  useEffect(() => {
    if (method === 'oauth' && !isAuthenticating) {
      setIsAuthenticating(true);
      triggerAuth(provider, 'oauth')
        .then(() => {
          onComplete();
        })
        .catch((error) => {
          setIsAuthenticating(false);
          onError(error instanceof Error ? error.message : String(error));
        });
    }
  }, [method, provider, triggerAuth, onComplete, onError, isAuthenticating]);

  const handleApiKeySubmit = useCallback(async () => {
    if (!apiKey.trim()) {
      return;
    }

    setIsAuthenticating(true);
    try {
      await triggerAuth(provider, 'api_key', apiKey.trim());
      onComplete();
    } catch (error) {
      setIsAuthenticating(false);
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [apiKey, provider, triggerAuth, onComplete, onError]);

  if (method === 'oauth') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={Colors.AccentCyan}>
            Step 3 of 3: Authenticating with {providerDisplay}
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text>
            <Text color={Colors.AccentYellow}>
              <Spinner type="dots" />
            </Text>
            {' '}Opening browser for OAuth authentication...
          </Text>
        </Box>

        <Text>Please complete the authentication in your browser.</Text>
        <Text>This window will update when done.</Text>

        <Box marginTop={1}>
          <Text color={Colors.Gray}>Press Esc to cancel and go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 3 of 3: Enter Your API Key
        </Text>
      </Box>

      {isAuthenticating ? (
        <Box marginBottom={1}>
          <Text>
            <Text color={Colors.AccentYellow}>
              <Spinner type="dots" />
            </Text>
            {' '}Validating API key...
          </Text>
        </Box>
      ) : (
        <>
          <Box marginBottom={1}>
            <Text>Enter your {providerDisplay} API key:</Text>
          </Box>

          <Box>
            <Text>API Key: </Text>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              onSubmit={handleApiKeySubmit}
              mask="*"
              focus={isFocused}
            />
          </Box>
        </>
      )}

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Press Enter when done, Esc to go back
        </Text>
      </Box>
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add packages/cli/src/ui/components/WelcomeOnboarding/AuthenticationStep.tsx
git commit -m "feat(welcome): add AuthenticationStep component"
```

---

## Task 7: Create CompletionStep Component

**Files:**

- Create: `packages/cli/src/ui/components/WelcomeOnboarding/CompletionStep.tsx`

**Step 1: Create the completion step component**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';

interface CompletionStepProps {
  provider: string;
  authMethod: 'oauth' | 'api_key';
  onSaveProfile: (name: string) => Promise<void>;
  onDismiss: () => void;
  isFocused?: boolean;
}

export const CompletionStep: React.FC<CompletionStepProps> = ({
  provider,
  authMethod,
  onSaveProfile,
  onDismiss,
  isFocused = true,
}) => {
  const [showProfilePrompt, setShowProfilePrompt] = useState(true);
  const [profileName, setProfileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const providerDisplay =
    provider.charAt(0).toUpperCase() + provider.slice(1);
  const authDisplay = authMethod === 'oauth' ? 'OAuth' : 'API Key';

  // Handle escape to skip profile save
  useKeypress(
    (key) => {
      if (key.name === 'escape' && showProfilePrompt && !saving) {
        setShowProfilePrompt(false);
      }
    },
    { isActive: isFocused && showProfilePrompt && !saving },
  );

  // Handle enter to dismiss after profile step
  useKeypress(
    (key) => {
      if (key.name === 'return' && !showProfilePrompt) {
        onDismiss();
      }
    },
    { isActive: isFocused && !showProfilePrompt },
  );

  const handleProfileSubmit = useCallback(async () => {
    if (!profileName.trim()) {
      setShowProfilePrompt(false);
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await onSaveProfile(profileName.trim());
      setShowProfilePrompt(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
      setSaving(false);
    }
  }, [profileName, onSaveProfile]);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentGreen}>
          ✓ You're all set!
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>Provider: {providerDisplay}</Text>
        <Text>Authentication: {authDisplay}</Text>
      </Box>

      {showProfilePrompt ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Save this setup as a profile? (optional)</Text>
          </Box>

          <Text color={Colors.Gray}>
            Profiles let you quickly switch between configurations.
          </Text>
          <Text color={Colors.Gray}>
            Use /profile load &lt;name&gt; to restore this setup later.
          </Text>

          <Box marginTop={1}>
            {error && (
              <Box marginBottom={1}>
                <Text color={Colors.AccentRed}>{error}</Text>
              </Box>
            )}

            {saving ? (
              <Text>Saving profile...</Text>
            ) : (
              <Box>
                <Text>Profile name: </Text>
                <TextInput
                  value={profileName}
                  onChange={setProfileName}
                  onSubmit={handleProfileSubmit}
                  placeholder="my-setup"
                  focus={isFocused}
                />
              </Box>
            )}
          </Box>

          <Box marginTop={1}>
            <Text color={Colors.Gray}>
              Enter a name and press Enter to save, or Esc to skip
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text>Try asking me something like:</Text>
            <Text color={Colors.AccentCyan}>
              "Explain how async/await works in JavaScript"
            </Text>
          </Box>

          <Box marginTop={1}>
            <Text color={Colors.Gray}>Press Enter to continue...</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add packages/cli/src/ui/components/WelcomeOnboarding/CompletionStep.tsx
git commit -m "feat(welcome): add CompletionStep component with profile save"
```

---

## Task 8: Create SkipExitStep Component

**Files:**

- Create: `packages/cli/src/ui/components/WelcomeOnboarding/SkipExitStep.tsx`

**Step 1: Create the skip exit step component**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';

interface SkipExitStepProps {
  onDismiss: () => void;
  isFocused?: boolean;
}

export const SkipExitStep: React.FC<SkipExitStepProps> = ({
  onDismiss,
  isFocused = true,
}) => {
  useKeypress(
    (key) => {
      if (key.name === 'return') {
        onDismiss();
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Setup skipped</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>To configure llxprt manually:</Text>
        <Text> </Text>
        <Text>
          • Use <Text color={Colors.AccentCyan}>/auth &lt;provider&gt;</Text> to
          set up authentication
        </Text>
        <Text>
          • Use <Text color={Colors.AccentCyan}>/provider</Text> to select your
          AI provider
        </Text>
        <Text>
          • Type <Text color={Colors.AccentCyan}>/help</Text> for more commands
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press Enter to continue...</Text>
      </Box>
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add packages/cli/src/ui/components/WelcomeOnboarding/SkipExitStep.tsx
git commit -m "feat(welcome): add SkipExitStep component"
```

---

## Task 9: Create Main WelcomeDialog Component

**Files:**

- Create: `packages/cli/src/ui/components/WelcomeOnboarding/WelcomeDialog.tsx`
- Create: `packages/cli/src/ui/components/WelcomeOnboarding/index.ts`

**Step 1: Create the main dialog component**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Box } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { WelcomeStep, type WelcomeChoice } from './WelcomeStep.js';
import { ProviderSelectStep } from './ProviderSelectStep.js';
import { AuthMethodStep } from './AuthMethodStep.js';
import { AuthenticationStep } from './AuthenticationStep.js';
import { CompletionStep } from './CompletionStep.js';
import { SkipExitStep } from './SkipExitStep.js';
import type { WelcomeState, WelcomeActions } from '../../hooks/useWelcomeOnboarding.js';

interface WelcomeDialogProps {
  state: WelcomeState;
  actions: WelcomeActions;
  availableProviders: string[];
  triggerAuth: (
    provider: string,
    method: 'oauth' | 'api_key',
    apiKey?: string,
  ) => Promise<void>;
}

export const WelcomeDialog: React.FC<WelcomeDialogProps> = ({
  state,
  actions,
  availableProviders,
  triggerAuth,
}) => {
  // Handle global escape to skip (except during auth)
  useKeypress(
    (key) => {
      if (key.name === 'escape' && !state.authInProgress) {
        actions.skipSetup();
      }
    },
    { isActive: state.step !== 'completion' && state.step !== 'skipped' },
  );

  const handleWelcomeSelect = useCallback(
    (choice: WelcomeChoice) => {
      if (choice === 'setup') {
        actions.startSetup();
      } else {
        actions.skipSetup();
      }
    },
    [actions],
  );

  const renderStep = () => {
    switch (state.step) {
      case 'welcome':
        return <WelcomeStep onSelect={handleWelcomeSelect} />;

      case 'provider':
        return (
          <ProviderSelectStep
            providers={availableProviders}
            onSelect={actions.selectProvider}
            onSkip={actions.skipSetup}
          />
        );

      case 'auth_method':
        return (
          <AuthMethodStep
            provider={state.selectedProvider!}
            onSelect={actions.selectAuthMethod}
            onBack={actions.goBack}
            error={state.error}
          />
        );

      case 'authenticating':
        return (
          <AuthenticationStep
            provider={state.selectedProvider!}
            method={state.selectedAuthMethod!}
            onComplete={actions.onAuthComplete}
            onError={actions.onAuthError}
            onBack={actions.goBack}
            triggerAuth={triggerAuth}
          />
        );

      case 'completion':
        return (
          <CompletionStep
            provider={state.selectedProvider!}
            authMethod={state.selectedAuthMethod!}
            onSaveProfile={actions.saveProfile}
            onDismiss={actions.dismiss}
          />
        );

      case 'skipped':
        return <SkipExitStep onDismiss={actions.dismiss} />;

      default:
        return null;
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentCyan}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      {renderStep()}
    </Box>
  );
};
```

**Step 2: Create the index file**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { WelcomeDialog } from './WelcomeDialog.js';
export { WelcomeStep } from './WelcomeStep.js';
export { ProviderSelectStep } from './ProviderSelectStep.js';
export { AuthMethodStep } from './AuthMethodStep.js';
export { AuthenticationStep } from './AuthenticationStep.js';
export { CompletionStep } from './CompletionStep.js';
export { SkipExitStep } from './SkipExitStep.js';
```

**Step 3: Commit**

```bash
git add packages/cli/src/ui/components/WelcomeOnboarding/
git commit -m "feat(welcome): add WelcomeDialog main component and exports"
```

---

## Task 10: Integrate into AppContainer

**Files:**

- Modify: `packages/cli/src/ui/AppContainer.tsx`

**Step 1: Add imports at top of file**

Add after existing imports (around line 100):

```typescript
import { useWelcomeOnboarding } from './hooks/useWelcomeOnboarding.js';
import { WelcomeDialog } from './components/WelcomeOnboarding/index.js';
```

**Step 2: Add hook usage**

Add inside AppContainer function, after the useFolderTrust hook (around line 625):

```typescript
const { showWelcome, welcomeState, welcomeActions, availableProviders } =
  useWelcomeOnboarding(config, settings);
```

**Step 3: Add triggerAuth function**

Add the auth trigger function (after the welcome hook):

```typescript
const triggerWelcomeAuth = useCallback(
  async (provider: string, method: 'oauth' | 'api_key', apiKey?: string) => {
    if (method === 'api_key' && apiKey) {
      // Set API key in settings
      const settingsService = runtime.getSettingsService();
      if (settingsService) {
        settingsService.setProviderSetting(provider, 'apiKey', apiKey);
      }
    } else if (method === 'oauth') {
      // Trigger OAuth flow
      await config.refreshAuth(`oauth_${provider}`);
    }
  },
  [config, runtime],
);
```

**Step 4: Add welcome dialog to the render**

In the `uiState` object, add to UIState interface check (around line 1475):

```typescript
    // Welcome flow
    showWelcome,
```

Update the condition for initial prompt submission (around line 1474):

```typescript
useEffect(() => {
  if (
    initialPrompt &&
    !initialPromptSubmitted.current &&
    !isAuthenticating &&
    !isAuthDialogOpen &&
    !isThemeDialogOpen &&
    !isEditorDialogOpen &&
    !isProviderDialogOpen &&
    !isProviderModelDialogOpen &&
    !isToolsDialogOpen &&
    !showPrivacyNotice &&
    !showWelcome && // Add this
    geminiClient
  ) {
    submitQuery(initialPrompt);
    initialPromptSubmitted.current = true;
  }
}, [
  // ... existing deps
  showWelcome, // Add this
]);
```

**Step 5: Render welcome dialog in DefaultAppLayout**

The WelcomeDialog should be rendered in the layout. Modify `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` to include welcome dialog before main content when `showWelcome` is true.

Add to UIState interface in `packages/cli/src/ui/contexts/UIStateContext.ts`:

```typescript
showWelcome: boolean;
```

**Step 6: Commit**

```bash
git add packages/cli/src/ui/AppContainer.tsx
git add packages/cli/src/ui/contexts/UIStateContext.ts
git commit -m "feat(welcome): integrate welcome onboarding into AppContainer"
```

---

## Task 11: Update DefaultAppLayout

**Files:**

- Modify: `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`

**Step 1: Add welcome dialog rendering**

Import and render the WelcomeDialog when `showWelcome` is true, after folder trust dialog check but before main content.

```typescript
// At the top of the render, after isFolderTrustDialogOpen check:
if (!isFolderTrustDialogOpen && showWelcome) {
  return (
    <WelcomeDialog
      state={welcomeState}
      actions={welcomeActions}
      availableProviders={availableProviders}
      triggerAuth={triggerWelcomeAuth}
    />
  );
}
```

**Step 2: Commit**

```bash
git add packages/cli/src/ui/layouts/DefaultAppLayout.tsx
git commit -m "feat(welcome): render welcome dialog in DefaultAppLayout"
```

---

## Task 12: Run Build and Fix Errors

**Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: May have errors to fix

**Step 2: Fix any type errors**

Address any TypeScript errors that arise.

**Step 3: Run lint**

```bash
npm run lint
```

**Step 4: Fix lint errors**

Address any linting issues.

**Step 5: Run format**

```bash
npm run format
```

**Step 6: Run build**

```bash
npm run build
```

**Step 7: Commit fixes**

```bash
git add -A
git commit -m "fix(welcome): address build and lint errors"
```

---

## Task 13: Manual Testing

**Step 1: Reset welcome config for testing**

```bash
rm -f ~/.llxprt/welcomeConfig.json
```

**Step 2: Run llxprt**

```bash
npm run bundle && node scripts/start.js
```

**Step 3: Test welcome flow**

- Verify welcome screen appears
- Test "Set up now" path
- Test provider selection
- Test auth method selection
- Test skip via ESC
- Test "Skip setup" option
- Verify profile save prompt

**Step 4: Verify persistence**

Exit and restart llxprt - welcome should NOT appear again.

---

## Summary

This plan creates:

- `welcomeConfig.ts` - First-run detection service
- `useWelcomeOnboarding.ts` - State management hook
- `WelcomeOnboarding/` component folder with 6 step components
- Integration into AppContainer and DefaultAppLayout

The flow:

1. After folder trust → check `welcomeCompleted`
2. If false → show welcome dialog
3. User navigates: Welcome → Provider → Auth Method → Auth → Completion
4. ESC from any step → Skip exit
5. On completion/skip → mark `welcomeCompleted: true`
6. Never show again
