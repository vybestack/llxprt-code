# Profile Create Wizard - Design Document

**Date:** 2026-01-08
**Feature:** `/profile create` - Interactive wizard for profile creation
**Status:** Design Phase

---

## Table of Contents

1. [Overview](#overview)
2. [User Experience](#user-experience)
3. [Technical Architecture](#technical-architecture)
4. [Screen Specifications](#screen-specifications)
5. [Error Handling](#error-handling)
6. [Implementation Plan](#implementation-plan)
7. [Testing Strategy](#testing-strategy)
8. [Future Enhancements](#future-enhancements)
9. [Configuration Reference](#configuration-reference)

---

## Overview

### Problem Statement

Currently, creating llxprt profiles requires either:
- Typing multiple slash commands in sequence (`/provider`, `/model`, `/key`, `/set`, `/profile save`)
- Manually creating JSON files in `~/.llxprt/profiles/`

This creates friction for users, especially those unfamiliar with the configuration structure.

### Solution

An interactive, multi-step wizard accessed via `/profile create` that:
- Guides users through all necessary configuration steps
- Adapts based on provider selection (conditional screens)
- Validates input at each step
- Tests connections before saving
- Provides clear success feedback with configuration summary

### Goals

- **Reduce friction:** Make profile creation accessible to all users
- **Prevent errors:** Validate before save, test connections
- **Educate users:** Show available options, provide defaults
- **Match existing patterns:** Use established UI components and navigation

---

## User Experience

### Entry Point

```bash
/profile create
```

### High-Level Flow

```
1. Provider Selection
   ↓
2. Base URL Configuration (conditional: local/custom providers only)
   ↓
3. Model Selection
   ↓
4. Authentication (API key, keyfile, or OAuth)
   ↓
5. Advanced Parameters (optional: temperature, tokens, context)
   ↓
6. Save Profile (name validation, suggestions)
   ↓
7. Success Summary (show config, option to load immediately)
```

### Navigation Model

**At Each Step:**
- After making a selection/entry, show navigation menu:
  - ○ Continue - Go to next step
  - ○ Back - Return to previous step
  - ○ Cancel - Exit wizard (with confirmation)

**Keyboard Shortcuts:**
- `↑↓` - Navigate options in lists
- `←→` - Move cursor in text inputs
- `Enter` - Confirm selection
- `Esc` - Trigger cancel (shows confirmation)
- `Ctrl+C` - Immediate exit (no confirmation)

### Exit Points

- **Success:** Profile saved, configuration summary shown, option to load immediately
- **Cancel:** Confirmation dialog prevents accidental loss of work
- **Error:** Clear error messages with retry/alternative options

---

## Technical Architecture

### Component Structure

```
ProfileCreateWizard (Main Container)
├── ProviderSelectStep
├── BaseUrlConfigStep (conditional)
├── ModelSelectStep
├── AuthenticationStep
│   ├── ApiKeyInput
│   ├── KeyFileInput
│   └── OAuthConfirm
├── AdvancedParamsStep (optional)
├── ProfileSaveStep
│   └── NameInput
└── ProfileSuccessSummary
```

### State Management

```typescript
interface WizardState {
  currentStep: WizardStep;
  stepHistory: WizardStep[]; // For back navigation
  config: {
    provider: string | null;
    baseUrl?: string;
    model: string | null;
    auth: {
      type: 'apikey' | 'keyfile' | 'oauth' | null;
      value?: string; // key or file path
      buckets?: string[]; // for OAuth
    };
    params?: {
      temperature?: number;
      maxTokens?: number;
      contextLimit?: number;
    };
  };
  profileName?: string;
  validationErrors: Record<string, string>;
  skipValidation: boolean; // If user opts to skip connection test
}

enum WizardStep {
  PROVIDER_SELECT,
  BASE_URL_CONFIG,
  MODEL_SELECT,
  AUTHENTICATION,
  ADVANCED_PARAMS,
  SAVE_PROFILE,
  SUCCESS_SUMMARY
}
```

### Navigation Logic

```typescript
function getNextStep(current: WizardStep, state: WizardState): WizardStep {
  switch (current) {
    case WizardStep.PROVIDER_SELECT:
      // Show base URL only for local/custom providers
      if (needsBaseUrlConfig(state.config.provider)) {
        return WizardStep.BASE_URL_CONFIG;
      }
      return WizardStep.MODEL_SELECT;

    case WizardStep.BASE_URL_CONFIG:
      return WizardStep.MODEL_SELECT;

    case WizardStep.MODEL_SELECT:
      return WizardStep.AUTHENTICATION;

    case WizardStep.AUTHENTICATION:
      return WizardStep.ADVANCED_PARAMS;

    case WizardStep.ADVANCED_PARAMS:
      return WizardStep.SAVE_PROFILE;

    case WizardStep.SAVE_PROFILE:
      return WizardStep.SUCCESS_SUMMARY;

    default:
      return current;
  }
}

function getPreviousStep(state: WizardState): WizardStep {
  // Pop from step history
  return state.stepHistory[state.stepHistory.length - 2] || WizardStep.PROVIDER_SELECT;
}

function needsBaseUrlConfig(provider: string | null): boolean {
  if (!provider) return false;

  const localProviders = ['lm-studio', 'ollama', 'llama-cpp'];
  const customProvider = provider === 'custom';

  return localProviders.includes(provider) || customProvider;
}
```

### Integration Points

**Command Registration:**

Add to `profileCommand.ts` subcommands:

```typescript
const createCommand: SlashCommand = {
  name: 'create',
  description: 'interactive wizard to create a new profile',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext): Promise<OpenDialogActionReturn> => {
    return {
      type: 'dialog',
      dialog: 'createProfile',
    };
  },
};

// Add to profileCommand.subCommands array
export const profileCommand: SlashCommand = {
  name: 'profile',
  description: 'manage configuration profiles',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    saveCommand,
    loadCommand,
    createCommand, // NEW
    deleteCommand,
    setDefaultCommand,
    listCommand,
  ],
  // ...
};
```

**Dialog Registration:**

In `AppContainer.tsx`:

```typescript
const dialogs = {
  loadProfile: LoadProfileDialog,
  createProfile: ProfileCreateWizard, // NEW
  // ...
};
```

**Component Location:**

New file: `packages/cli/src/ui/components/ProfileCreateWizard/`

```
ProfileCreateWizard/
├── index.tsx                    # Main wizard container
├── ProviderSelectStep.tsx
├── BaseUrlConfigStep.tsx
├── ModelSelectStep.tsx
├── AuthenticationStep.tsx
├── AdvancedParamsStep.tsx
├── ProfileSaveStep.tsx
├── ProfileSuccessSummary.tsx
├── NavigationMenu.tsx           # Reusable Continue/Back/Cancel menu
├── types.ts                     # Shared types
├── constants.ts                 # Provider lists, defaults
├── validation.ts                # Validation functions
└── utils.ts                     # Helper functions
```

---

## Screen Specifications

### Step 1: Provider Selection

**Component:** `ProviderSelectStep`

**UI Layout:**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 1 of 6: Choose Your AI Provider        │
│                                              │
│ Select which AI provider you'd like to use: │
│                                              │
│ ● Anthropic (Claude)                         │
│ ○ Google Gemini                              │
│ ○ OpenAI                                     │
│ ○ Qwen                                       │
│ ○ DeepSeek                                   │
│ ○ Cerebras                                   │
│ ○ LM Studio (local)                          │
│ ○ Ollama (local)                             │
│ ○ llama.cpp (local)                          │
│ ○ Custom OpenAI-compatible endpoint          │
│                                              │
│ ↑↓ Navigate  Enter Select                   │
│                                              │
│ ○ Continue                                   │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Provider Configuration:**

```typescript
interface ProviderOption {
  value: string;          // Internal provider name
  label: string;          // Display name
  needsBaseUrl: boolean;  // Show base URL step?
  defaultBaseUrl?: string; // Pre-fill for local providers
  supportsOAuth: boolean; // Show OAuth option?
  knownModels?: string[]; // Predefined model list
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  // Cloud Providers (no base URL needed)
  {
    value: 'anthropic',
    label: 'Anthropic (Claude)',
    needsBaseUrl: false,
    supportsOAuth: true,
    knownModels: [
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
    ],
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    needsBaseUrl: false,
    supportsOAuth: true,
    knownModels: [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
    ],
  },
  {
    value: 'openai',
    label: 'OpenAI',
    needsBaseUrl: false,
    supportsOAuth: false,
    knownModels: [
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-5-thinking',
    ],
  },
  {
    value: 'qwen',
    label: 'Qwen',
    needsBaseUrl: false,
    supportsOAuth: true,
    knownModels: [
      'qwen3-coder-pro',
      'qwen3-coder',
    ],
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    needsBaseUrl: false,
    supportsOAuth: false,
  },
  {
    value: 'cerebras',
    label: 'Cerebras',
    needsBaseUrl: false,
    supportsOAuth: false,
    knownModels: [
      'qwen-3-coder-480b',
      'zai-glm-4.7',
      'llama-3.3-70b',
    ],
  },

  // Local Providers (base URL with defaults)
  {
    value: 'lm-studio',
    label: 'LM Studio (local)',
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
    supportsOAuth: false,
  },
  {
    value: 'ollama',
    label: 'Ollama (local)',
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434/v1',
    supportsOAuth: false,
  },
  {
    value: 'llama-cpp',
    label: 'llama.cpp (local)',
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:8080/v1',
    supportsOAuth: false,
  },

  // Custom Provider (empty base URL)
  {
    value: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    needsBaseUrl: true,
    supportsOAuth: false,
  },
];
```

**Behavior:**
- Uses `RadioButtonSelect` component (existing)
- After selection, shows navigation menu
- Stores `provider` in wizard state
- Next step determined by `needsBaseUrl` property

---

### Step 2: Base URL Configuration (Conditional)

**Component:** `BaseUrlConfigStep`

**Shown When:**
- Provider is `lm-studio`, `ollama`, `llama-cpp`, or `custom`

**UI Layout (Local Provider - Pre-filled):**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 2 of 6: Configure Base URL              │
│                                              │
│ LM Studio typically runs on port 1234.       │
│ Edit if you're using a different port.       │
│                                              │
│ Base URL:                                    │
│ > http://localhost:1234/v1|                  │
│                                              │
│ ← → Move cursor  Backspace Delete            │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**UI Layout (Custom Provider - Empty):**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 2 of 6: Configure Base URL              │
│                                              │
│ Enter the API endpoint for your provider:    │
│                                              │
│ Base URL:                                    │
│ > |                                          │
│                                              │
│ Examples:                                    │
│   • https://api.x.ai/v1/                     │
│   • https://openrouter.ai/api/v1/            │
│   • https://api.fireworks.ai/inference/v1/   │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Validation:**

```typescript
function validateBaseUrl(url: string): { valid: boolean; error?: string } {
  if (!url.trim()) {
    return { valid: false, error: 'Base URL is required' };
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use http:// or https://' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}
```

**Behavior:**
- Uses Ink `TextInput` component
- Pre-filled with `defaultBaseUrl` for local providers
- Empty for custom provider
- Real-time validation on blur
- "Continue" disabled if validation fails
- Stores `baseUrl` in wizard state

---

### Step 3: Model Selection

**Component:** `ModelSelectStep`

**UI Layout (Known Models - List):**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 3 of 6: Select Model                    │
│                                              │
│ Choose a model for Anthropic:                │
│                                              │
│ ● claude-sonnet-4-5-20250929 (Recommended)   │
│ ○ claude-haiku-4-5-20251001                  │
│ ○ claude-opus-4-5-20251101                   │
│ ○ Enter custom model name...                 │
│                                              │
│ ↑↓ Navigate  Enter Select                   │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**UI Layout (Custom Entry - Text Input):**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 3 of 6: Enter Model Name                │
│                                              │
│ Enter the model name exactly as it appears   │
│ in your provider's documentation:            │
│                                              │
│ Model name:                                  │
│ > codellama:13b|                             │
│                                              │
│ For Ollama: Run 'ollama list' to see models  │
│ For custom: Check provider documentation     │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Behavior:**
- **If provider has `knownModels`:** Show `RadioButtonSelect` with list
  - First model marked as "(Recommended)"
  - Last option: "Enter custom model name..." → switches to text input
- **If provider has no `knownModels` OR custom selected:** Show `TextInput`
- Model name validation: non-empty string
- Stores `model` in wizard state

---

### Step 4: Authentication

**Component:** `AuthenticationStep`

**UI Layout (Method Selection):**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 4 of 6: Configure Authentication        │
│                                              │
│ Choose how to authenticate with Cerebras:    │
│                                              │
│ ● Enter API key now                          │
│ ○ Use key file (provide path)                │
│ ○ OAuth (not supported) [DISABLED]           │
│                                              │
│ ↑↓ Navigate  Enter Select                   │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Sub-flow A: API Key Entry**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 4 of 6: Enter API Key                   │
│                                              │
│ Enter your Cerebras API key:                 │
│                                              │
│ API Key:                                     │
│ > ************************|                  │
│                                              │
│ ℹ Your key will be stored in the profile     │
│   JSON file. For better security, consider   │
│   using a key file instead.                  │
│                                              │
│ Testing connection to Cerebras...            │
│ ✓ Connection successful!                     │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Sub-flow B: Key File Path**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 4 of 6: Specify Key File                │
│                                              │
│ Enter the path to your API key file:         │
│                                              │
│ Key file path:                               │
│ > ~/.keys/cerebras.key|                      │
│                                              │
│ ℹ Supports ~ expansion for home directory    │
│                                              │
│ Validating key file...                       │
│ ✓ File exists and is readable                │
│ ✓ Connection successful!                     │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Sub-flow C: OAuth Setup**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 4 of 6: Configure OAuth                 │
│                                              │
│ OAuth authentication will be configured      │
│ for Anthropic.                               │
│                                              │
│ You'll authenticate when you first load      │
│ this profile using the existing OAuth flow.  │
│                                              │
│ Optional: Specify OAuth buckets              │
│ (leave empty for default bucket)             │
│                                              │
│ Buckets (comma-separated):                   │
│ > default, work|                             │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Connection Testing:**

```typescript
async function testConnection(
  provider: string,
  baseUrl: string | undefined,
  model: string,
  authType: 'apikey' | 'keyfile',
  authValue: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Read key from file if keyfile type
    const apiKey = authType === 'keyfile'
      ? await fs.readFile(expandTilde(authValue), 'utf-8').then(k => k.trim())
      : authValue;

    // Make a simple test request to provider
    const runtime = getRuntimeApi();
    const testResult = await runtime.testProviderConnection({
      provider,
      baseUrl,
      model,
      apiKey,
    });

    return { success: testResult.ok };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
```

**Behavior:**
- Method selection uses `RadioButtonSelect`
- OAuth option disabled if `supportsOAuth: false`
- API key input is masked (`*****`)
- After key/file entry, automatically tests connection (30s timeout)
- Shows progress indicator during test
- On success: ✓ checkmark, proceed to navigation
- On failure: Error message with retry/skip options
- OAuth skips connection test (lazy auth)
- Stores `auth.type` and `auth.value` in wizard state

---

### Step 5: Advanced Parameters (Optional)

**Component:** `AdvancedParamsStep`

**UI Layout (Initial Choice):**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 5 of 6: Advanced Settings (Optional)    │
│                                              │
│ Configure advanced model parameters?         │
│                                              │
│ ● Use recommended defaults                   │
│ ○ Configure custom parameters                │
│                                              │
│ Recommended defaults for Cerebras:           │
│   Temperature: 1.0                           │
│   Max Tokens: 10000                          │
│   Context Limit: 121000                      │
│                                              │
│ ↑↓ Navigate  Enter Select                   │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**UI Layout (Custom Configuration):**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 5 of 6: Configure Parameters            │
│                                              │
│ Temperature (0.0 - 2.0):                     │
│ Controls randomness/creativity               │
│ > 1.0|                                       │
│ ✓ Valid                                      │
│                                              │
│ Max Output Tokens:                           │
│ Maximum length of model response             │
│ > 10000|                                     │
│ ✓ Valid                                      │
│                                              │
│ Context Limit:                               │
│ Maximum tokens for context window            │
│ > 121000|                                    │
│ ✓ Valid                                      │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Provider-Specific Defaults:**

```typescript
interface AdvancedParams {
  temperature: number;
  maxTokens: number;
  contextLimit: number;
}

const PARAMETER_DEFAULTS: Record<string, AdvancedParams> = {
  anthropic: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  openai: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  gemini: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  cerebras: {
    temperature: 1.0,
    maxTokens: 10000,
    contextLimit: 121000,
  },
  qwen: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  deepseek: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  'lm-studio': {
    temperature: 0.7,
    maxTokens: 2048,
    contextLimit: 32000,
  },
  ollama: {
    temperature: 0.7,
    maxTokens: 2048,
    contextLimit: 32000,
  },
  'llama-cpp': {
    temperature: 0.7,
    maxTokens: 2048,
    contextLimit: 32000,
  },
  default: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
};
```

**Validation:**

```typescript
const PARAM_VALIDATORS = {
  temperature: (val: number) => {
    if (val < 0 || val > 2.0) {
      return { valid: false, error: 'Must be between 0.0 and 2.0' };
    }
    return { valid: true };
  },

  maxTokens: (val: number) => {
    if (!Number.isInteger(val) || val <= 0) {
      return { valid: false, error: 'Must be a positive integer' };
    }
    if (val > 1000000) {
      return { valid: false, error: 'Maximum value is 1,000,000' };
    }
    return { valid: true };
  },

  contextLimit: (val: number) => {
    if (!Number.isInteger(val) || val <= 0) {
      return { valid: false, error: 'Must be a positive integer' };
    }
    return { valid: true };
  },
};
```

**Behavior:**
- Initial choice: `RadioButtonSelect` (use defaults vs configure)
- If "use defaults": Skip to next step, apply provider-specific defaults
- If "configure custom": Show three `TextInput` fields
- Real-time validation for each field
- "Continue" disabled until all fields valid
- Visual indicators (✓/✗) for each field
- Stores `params.temperature`, `params.maxTokens`, `params.contextLimit` in wizard state

---

### Step 6: Save Profile

**Component:** `ProfileSaveStep`

**UI Layout:**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 6 of 6: Name Your Profile               │
│                                              │
│ Enter a name for this profile:               │
│                                              │
│ Profile name:                                │
│ > cerebras-glm47|                            │
│                                              │
│ ✓ Name is available                          │
│                                              │
│ ℹ Suggested names:                           │
│   • cerebras-glm47                           │
│   • cerebras-zai-glm-4.7                     │
│   • cerebras-custom                          │
│                                              │
│ ○ Save Profile                               │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Name Suggestion Logic:**

```typescript
function generateProfileNameSuggestions(config: WizardState['config']): string[] {
  const suggestions: string[] = [];

  // Suggestion 1: provider-model (cleaned)
  if (config.provider && config.model) {
    const cleanProvider = config.provider.replace(/[^a-z0-9]/gi, '-');
    const cleanModel = config.model.replace(/[^a-z0-9.]/gi, '-');
    suggestions.push(`${cleanProvider}-${cleanModel}`);
  }

  // Suggestion 2: provider-custom
  if (config.provider) {
    suggestions.push(`${config.provider}-custom`);
  }

  // Suggestion 3: model-only
  if (config.model) {
    const cleanModel = config.model.replace(/[^a-z0-9.]/gi, '-');
    suggestions.push(cleanModel);
  }

  return suggestions.slice(0, 3); // Max 3 suggestions
}
```

**Validation:**

```typescript
async function validateProfileName(name: string): Promise<{ valid: boolean; error?: string }> {
  if (!name.trim()) {
    return { valid: false, error: 'Profile name cannot be empty' };
  }

  if (name.includes('/') || name.includes('\\')) {
    return { valid: false, error: 'Profile name cannot contain path separators' };
  }

  const existingProfiles = await getRuntimeApi().listSavedProfiles();
  if (existingProfiles.includes(name)) {
    return { valid: false, error: 'Profile name already exists' };
  }

  return { valid: true };
}
```

**Behavior:**
- `TextInput` for profile name
- Real-time validation as user types
- Show suggestions below input
- Suggestions are clickable (select to auto-fill)
- "Save Profile" disabled if name invalid
- On save: Build profile JSON and save to `~/.llxprt/profiles/{name}.json`
- On success: Proceed to success summary
- On error: Show error with retry option

**Profile JSON Structure:**

```typescript
function buildProfileJSON(state: WizardState): object {
  const profile: any = {
    version: 1,
    provider: state.config.provider === 'custom' ? 'openai' : state.config.provider,
    model: state.config.model,
    modelParams: {},
    ephemeralSettings: {},
  };

  // Add base URL if present
  if (state.config.baseUrl) {
    profile.ephemeralSettings['base-url'] = state.config.baseUrl;
  }

  // Add authentication
  if (state.config.auth.type === 'apikey') {
    profile.ephemeralSettings['auth-key'] = state.config.auth.value;
  } else if (state.config.auth.type === 'keyfile') {
    profile.ephemeralSettings['auth-keyfile'] = state.config.auth.value;
  } else if (state.config.auth.type === 'oauth') {
    profile.auth = {
      type: 'oauth',
      buckets: state.config.auth.buckets || ['default'],
    };
  }

  // Add parameters if configured
  if (state.config.params) {
    if (state.config.params.temperature !== undefined) {
      profile.modelParams.temperature = state.config.params.temperature;
    }
    if (state.config.params.maxTokens !== undefined) {
      profile.modelParams.max_tokens = state.config.params.maxTokens;
    }
    if (state.config.params.contextLimit !== undefined) {
      profile.ephemeralSettings['context-limit'] = state.config.params.contextLimit;
    }
  }

  return profile;
}
```

---

### Step 7: Success Summary

**Component:** `ProfileSuccessSummary`

**UI Layout:**

```
┌─────────────────────────────────────────────┐
│ ✓ Profile Created Successfully!              │
│                                              │
│ Profile: cerebras-glm47                      │
│ ─────────────────────────────────────────── │
│ Provider: OpenAI-compatible                  │
│ Base URL: https://api.cerebras.ai/v1/        │
│ Model: zai-glm-4.7                           │
│ Auth: Key file (~/.keys/cerebras.key)        │
│ Temperature: 1.0                             │
│ Max Tokens: 10000                            │
│ Context Limit: 121000                        │
│ ─────────────────────────────────────────── │
│                                              │
│ Profile saved to:                            │
│ ~/.llxprt/profiles/cerebras-glm47.json       │
│                                              │
│ ● Load this profile now                      │
│ ○ Return to llxprt                           │
│                                              │
│ ↑↓ Navigate  Enter Select                   │
└─────────────────────────────────────────────┘
```

**Behavior:**
- Shows complete configuration summary
- File path displayed for reference
- Two options via `RadioButtonSelect`:
  - **Load this profile now:** Calls existing `/profile load` logic
  - **Return to llxprt:** Closes dialog, returns to main UI
- This is the final screen, wizard exits after selection

**Configuration Display:**

```typescript
function formatConfigSummary(state: WizardState): string {
  const lines: string[] = [];

  // Provider
  const providerDisplay = state.config.provider === 'custom'
    ? 'OpenAI-compatible'
    : state.config.provider;
  lines.push(`Provider: ${providerDisplay}`);

  // Base URL (if present)
  if (state.config.baseUrl) {
    lines.push(`Base URL: ${state.config.baseUrl}`);
  }

  // Model
  lines.push(`Model: ${state.config.model}`);

  // Auth
  const authDisplay =
    state.config.auth.type === 'apikey' ? 'API key (stored in profile)' :
    state.config.auth.type === 'keyfile' ? `Key file (${state.config.auth.value})` :
    state.config.auth.type === 'oauth' ? 'OAuth (lazy authentication)' :
    'None';
  lines.push(`Auth: ${authDisplay}`);

  // Parameters (if configured)
  if (state.config.params) {
    if (state.config.params.temperature !== undefined) {
      lines.push(`Temperature: ${state.config.params.temperature}`);
    }
    if (state.config.params.maxTokens !== undefined) {
      lines.push(`Max Tokens: ${state.config.params.maxTokens}`);
    }
    if (state.config.params.contextLimit !== undefined) {
      lines.push(`Context Limit: ${state.config.params.contextLimit}`);
    }
  }

  return lines.join('\n');
}
```

---

## Error Handling

### Connection Test Failures

**Scenario:** API key or connection test fails

**UI Response:**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 4 of 6: Enter API Key                   │
│                                              │
│ API Key:                                     │
│ > csk-abc123************************         │
│                                              │
│ Testing connection to Cerebras...            │
│ ✗ Connection failed                          │
│                                              │
│ Error: Invalid API key (401 Unauthorized)    │
│                                              │
│ ● Try again                                  │
│ ○ Continue anyway (skip validation)          │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Behavior:**
- Show clear error message from API
- "Try again" keeps user on same step
- "Continue anyway" sets `skipValidation: true` and proceeds
- Warning shown in final summary if validation was skipped

---

### File Path Validation Errors

**Scenario:** Key file path doesn't exist or isn't readable

**UI Response:**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 4 of 6: Specify Key File                │
│                                              │
│ Key file path:                               │
│ > ~/.keys/missing.key                        │
│                                              │
│ Validating key file...                       │
│ ✗ File not found                             │
│                                              │
│ Error: Cannot read ~/.keys/missing.key       │
│                                              │
│ ℹ Make sure the file exists and you have     │
│   read permissions.                          │
│                                              │
│ ○ Continue                                   │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Validation:**

```typescript
async function validateKeyFile(path: string): Promise<{ valid: boolean; error?: string }> {
  const expandedPath = expandTilde(path);

  try {
    await fs.access(expandedPath, fs.constants.R_OK);
    return { valid: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { valid: false, error: `File not found: ${path}` };
    }
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      return { valid: false, error: `Permission denied: ${path}` };
    }
    return { valid: false, error: `Cannot read file: ${path}` };
  }
}
```

---

### Profile Name Conflicts

**Scenario:** User enters a profile name that already exists

**UI Response:**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 6 of 6: Name Your Profile               │
│                                              │
│ Profile name:                                │
│ > cerebras-glm47                             │
│                                              │
│ ✗ Name already exists                        │
│                                              │
│ A profile named 'cerebras-glm47' already     │
│ exists. Choose a different name or:          │
│                                              │
│ ● Choose different name                      │
│ ○ Overwrite existing profile                 │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Overwrite Confirmation:**

```
┌─────────────────────────────────────────────┐
│ Confirm Overwrite                            │
│                                              │
│ Are you sure you want to overwrite the       │
│ existing profile 'cerebras-glm47'?           │
│                                              │
│ This action cannot be undone.                │
│                                              │
│ ● No, choose different name                  │
│ ○ Yes, overwrite                             │
└─────────────────────────────────────────────┘
```

---

### Cancel Confirmation

**Scenario:** User presses "Cancel" at any step

**UI Response:**

```
┌─────────────────────────────────────────────┐
│ Cancel Profile Creation?                     │
│                                              │
│ Your configuration will be lost:             │
│   • Provider: Cerebras                       │
│   • Model: zai-glm-4.7                       │
│   • Base URL: https://api.cerebras.ai/v1/    │
│                                              │
│ Are you sure you want to cancel?             │
│                                              │
│ ● No, continue editing                       │
│ ○ Yes, discard and exit                      │
└─────────────────────────────────────────────┘
```

**Behavior:**
- Shows current progress to help user decide
- Default selection is "No, continue editing"
- Only shows if user has entered any configuration
- If no config entered yet (first step), exits immediately

---

### Network Timeout

**Scenario:** Connection test hangs or times out

**UI Response (During Test):**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 4 of 6: Enter API Key                   │
│                                              │
│ API Key:                                     │
│ > csk-abc123************************         │
│                                              │
│ Testing connection to Cerebras...            │
│ (25 seconds remaining)                       │
│                                              │
│ Press Esc to cancel test                     │
└─────────────────────────────────────────────┘
```

**After Timeout:**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 4 of 6: Enter API Key                   │
│                                              │
│ Testing connection to Cerebras...            │
│ ✗ Connection test timed out                  │
│                                              │
│ The server did not respond within 30 seconds │
│                                              │
│ ● Try again                                  │
│ ○ Continue anyway (skip validation)          │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Implementation:**

```typescript
async function testConnectionWithTimeout(
  provider: string,
  baseUrl: string | undefined,
  model: string,
  authType: 'apikey' | 'keyfile',
  authValue: string,
  timeoutMs: number = 30000
): Promise<{ success: boolean; error?: string; timedOut?: boolean }> {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
  );

  try {
    await Promise.race([
      testConnection(provider, baseUrl, model, authType, authValue),
      timeoutPromise
    ]);
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'TIMEOUT') {
      return { success: false, timedOut: true };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
```

---

### Invalid Parameter Values

**Scenario:** User enters invalid temperature or token values

**UI Response:**

```
┌─────────────────────────────────────────────┐
│ Create New Profile                           │
│                                              │
│ Step 5 of 6: Configure Parameters            │
│                                              │
│ Temperature (0.0 - 2.0):                     │
│ Controls randomness/creativity               │
│ > 3.5                                        │
│ ✗ Must be between 0.0 and 2.0                │
│                                              │
│ Max Output Tokens:                           │
│ Maximum length of model response             │
│ > -100                                       │
│ ✗ Must be a positive number                  │
│                                              │
│ Context Limit:                               │
│ Maximum tokens for context window            │
│ > 121000                                     │
│ ✓ Valid                                      │
│                                              │
│ ○ Continue  [DISABLED]                       │
│ ○ Back                                       │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Behavior:**
- Real-time validation on change/blur
- Inline error messages next to each field
- "Continue" button disabled until all fields valid
- Clear visual indication (✓/✗) for each field

---

### Save Failures

**Scenario:** Profile save fails (disk full, permissions, etc.)

**UI Response:**

```
┌─────────────────────────────────────────────┐
│ ✗ Failed to Save Profile                     │
│                                              │
│ Error: Permission denied                     │
│                                              │
│ Could not write to:                          │
│ ~/.llxprt/profiles/cerebras-glm47.json       │
│                                              │
│ Possible solutions:                          │
│   • Check ~/.llxprt/profiles/ exists         │
│   • Verify write permissions                 │
│   • Check available disk space               │
│                                              │
│ ● Retry save                                 │
│ ○ Choose different name                      │
│ ○ Cancel                                     │
└─────────────────────────────────────────────┘
```

**Implementation:**

```typescript
async function saveProfile(name: string, config: object): Promise<{ success: boolean; error?: string }> {
  try {
    const runtime = getRuntimeApi();
    const profilesDir = path.join(os.homedir(), '.llxprt', 'profiles');

    // Ensure directory exists
    await fs.mkdir(profilesDir, { recursive: true });

    // Write profile
    const profilePath = path.join(profilesDir, `${name}.json`);
    await fs.writeFile(profilePath, JSON.stringify(config, null, 2), 'utf-8');

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

---

## Implementation Plan

### Phase 1: Core Wizard Infrastructure (Week 1)

**Tasks:**

1. **Create component structure**
   - [ ] Create `ProfileCreateWizard/` directory
   - [ ] Set up `index.tsx` (main wizard container)
   - [ ] Create `types.ts` with `WizardState`, `WizardStep` enums
   - [ ] Create `constants.ts` with provider options, defaults
   - [ ] Create `NavigationMenu.tsx` (reusable Continue/Back/Cancel component)

2. **Implement state management**
   - [ ] Set up wizard state with `useState`
   - [ ] Implement step history for back navigation
   - [ ] Create `getNextStep()` and `getPreviousStep()` logic
   - [ ] Handle cancel confirmation state

3. **Register command and dialog**
   - [ ] Add `createCommand` to `profileCommand.ts`
   - [ ] Register `ProfileCreateWizard` in `AppContainer.tsx` dialog map
   - [ ] Test command invocation (`/profile create`)

**Acceptance Criteria:**
- `/profile create` opens wizard dialog
- Navigation menu appears and responds to keyboard
- Cancel confirmation works
- State transitions between mock steps

---

### Phase 2: Provider & Base URL Steps (Week 1-2)

**Tasks:**

1. **Implement ProviderSelectStep**
   - [ ] Create `ProviderSelectStep.tsx`
   - [ ] Use `RadioButtonSelect` with `PROVIDER_OPTIONS`
   - [ ] Store selected provider in wizard state
   - [ ] Determine if base URL step needed

2. **Implement BaseUrlConfigStep**
   - [ ] Create `BaseUrlConfigStep.tsx`
   - [ ] Show conditional help text (local vs custom)
   - [ ] Pre-fill with `defaultBaseUrl` for local providers
   - [ ] Implement URL validation
   - [ ] Disable "Continue" if invalid

3. **Create validation module**
   - [ ] Create `validation.ts`
   - [ ] Implement `validateBaseUrl()`
   - [ ] Add unit tests for validation

**Acceptance Criteria:**
- Provider selection works with all options
- Base URL step only shows for local/custom providers
- Local providers pre-fill with correct defaults
- Invalid URLs prevent navigation
- Validation errors show clearly

---

### Phase 3: Model Selection Step (Week 2)

**Tasks:**

1. **Implement ModelSelectStep**
   - [ ] Create `ModelSelectStep.tsx`
   - [ ] Show `RadioButtonSelect` for known models
   - [ ] Show `TextInput` for custom/unknown providers
   - [ ] Handle "Enter custom model name" option
   - [ ] Store model in wizard state

2. **Add model lists to constants**
   - [ ] Update `constants.ts` with `knownModels` per provider
   - [ ] Mark first model as "(Recommended)"

**Acceptance Criteria:**
- Cloud providers show model lists
- Local providers show text input
- Custom model entry works
- Model name validation (non-empty)

---

### Phase 4: Authentication Step (Week 2-3)

**Tasks:**

1. **Implement AuthenticationStep**
   - [ ] Create `AuthenticationStep.tsx`
   - [ ] Method selection (API key, keyfile, OAuth)
   - [ ] Disable OAuth for unsupported providers

2. **Implement sub-flows**
   - [ ] Create `ApiKeyInput` component (masked input)
   - [ ] Create `KeyFileInput` component (path input)
   - [ ] Create `OAuthConfirm` component (bucket entry)

3. **Implement connection testing**
   - [ ] Create `testConnection()` in `utils.ts`
   - [ ] Add timeout handling (30s)
   - [ ] Show progress indicator
   - [ ] Handle success/failure states
   - [ ] Add "Continue anyway" option on failure

4. **Key file validation**
   - [ ] Implement `validateKeyFile()` in `validation.ts`
   - [ ] Check file existence and readability
   - [ ] Expand `~` to home directory

**Acceptance Criteria:**
- All three auth methods work
- API key input is masked
- Connection test runs and shows result
- Timeout handling works (30s)
- File validation catches errors
- OAuth buckets can be specified

---

### Phase 5: Advanced Parameters Step (Week 3)

**Tasks:**

1. **Implement AdvancedParamsStep**
   - [ ] Create `AdvancedParamsStep.tsx`
   - [ ] Initial choice: defaults vs custom
   - [ ] Show provider-specific defaults

2. **Implement custom parameter form**
   - [ ] Three text inputs (temperature, maxTokens, contextLimit)
   - [ ] Real-time validation for each field
   - [ ] Visual indicators (✓/✗)
   - [ ] Disable "Continue" if any invalid

3. **Add parameter defaults and validation**
   - [ ] Update `constants.ts` with `PARAMETER_DEFAULTS`
   - [ ] Implement `PARAM_VALIDATORS` in `validation.ts`
   - [ ] Add unit tests for validators

**Acceptance Criteria:**
- Defaults option applies provider-specific values
- Custom form validates all fields
- Invalid input disables navigation
- Visual feedback is clear

---

### Phase 6: Save & Success Steps (Week 3-4)

**Tasks:**

1. **Implement ProfileSaveStep**
   - [ ] Create `ProfileSaveStep.tsx`
   - [ ] Text input for profile name
   - [ ] Real-time name validation
   - [ ] Generate name suggestions
   - [ ] Handle name conflicts (with overwrite option)

2. **Implement save logic**
   - [ ] Create `buildProfileJSON()` in `utils.ts`
   - [ ] Create `saveProfile()` function
   - [ ] Handle filesystem errors
   - [ ] Show retry options on failure

3. **Implement ProfileSuccessSummary**
   - [ ] Create `ProfileSuccessSummary.tsx`
   - [ ] Format configuration summary
   - [ ] Show file path
   - [ ] "Load now" vs "Return" options
   - [ ] Integrate with existing `/profile load`

**Acceptance Criteria:**
- Profile name validation works
- Suggestions are generated correctly
- Conflicts handled with confirmation
- Save succeeds and creates valid JSON
- Success summary shows all config
- "Load now" option works

---

### Phase 7: Error Handling & Polish (Week 4)

**Tasks:**

1. **Enhance error handling**
   - [ ] Connection test failures
   - [ ] File path errors
   - [ ] Network timeouts
   - [ ] Save failures
   - [ ] Invalid parameter values

2. **Add progress indicators**
   - [ ] Spinner during connection test
   - [ ] Countdown timer for timeout
   - [ ] "Saving..." indicator

3. **Polish UI**
   - [ ] Consistent spacing and borders
   - [ ] Color scheme matching existing UI
   - [ ] Help text for each step
   - [ ] Keyboard shortcuts shown

4. **Add unit tests**
   - [ ] Test state management
   - [ ] Test navigation logic
   - [ ] Test validation functions
   - [ ] Test profile JSON generation

**Acceptance Criteria:**
- All error scenarios handled gracefully
- Progress indicators work smoothly
- UI matches existing llxprt style
- Test coverage >80%

---

### Phase 8: Integration Testing (Week 4)

**Tasks:**

1. **Integration tests**
   - [ ] Test full wizard flow (all paths)
   - [ ] Test back navigation
   - [ ] Test cancel at each step
   - [ ] Test with real API connections (optional)

2. **Documentation**
   - [ ] Update `/profile` help text
   - [ ] Add to CLI documentation
   - [ ] Add screenshots/examples

3. **User testing**
   - [ ] Test with various providers
   - [ ] Test error scenarios
   - [ ] Gather feedback

**Acceptance Criteria:**
- All integration tests pass
- Documentation complete
- No critical bugs

---

## Testing Strategy

### Unit Tests

**Validation Functions:**
```typescript
// validation.test.ts
describe('validateBaseUrl', () => {
  it('should accept valid http URLs', () => {
    expect(validateBaseUrl('http://localhost:1234/v1')).toEqual({ valid: true });
  });

  it('should accept valid https URLs', () => {
    expect(validateBaseUrl('https://api.cerebras.ai/v1')).toEqual({ valid: true });
  });

  it('should reject invalid protocols', () => {
    expect(validateBaseUrl('ftp://example.com')).toEqual({
      valid: false,
      error: 'URL must use http:// or https://'
    });
  });

  it('should reject malformed URLs', () => {
    expect(validateBaseUrl('not a url')).toEqual({
      valid: false,
      error: 'Invalid URL format'
    });
  });

  it('should reject empty strings', () => {
    expect(validateBaseUrl('')).toEqual({
      valid: false,
      error: 'Base URL is required'
    });
  });
});

describe('PARAM_VALIDATORS.temperature', () => {
  it('should accept valid temperatures', () => {
    expect(PARAM_VALIDATORS.temperature(0.7)).toEqual({ valid: true });
    expect(PARAM_VALIDATORS.temperature(0.0)).toEqual({ valid: true });
    expect(PARAM_VALIDATORS.temperature(2.0)).toEqual({ valid: true });
  });

  it('should reject out of range values', () => {
    expect(PARAM_VALIDATORS.temperature(-0.1)).toEqual({
      valid: false,
      error: 'Must be between 0.0 and 2.0'
    });
    expect(PARAM_VALIDATORS.temperature(2.1)).toEqual({
      valid: false,
      error: 'Must be between 0.0 and 2.0'
    });
  });
});
```

**State Management:**
```typescript
// ProfileCreateWizard.test.tsx
describe('ProfileCreateWizard state', () => {
  it('should initialize with PROVIDER_SELECT step', () => {
    const { getByText } = render(<ProfileCreateWizard />);
    expect(getByText(/Choose Your AI Provider/i)).toBeInTheDocument();
  });

  it('should transition to BASE_URL_CONFIG for local providers', async () => {
    const { getByText, user } = render(<ProfileCreateWizard />);
    await user.selectOption(getByText(/LM Studio/i));
    await user.click(getByText(/Continue/i));
    expect(getByText(/Configure Base URL/i)).toBeInTheDocument();
  });

  it('should skip BASE_URL_CONFIG for cloud providers', async () => {
    const { getByText, user } = render(<ProfileCreateWizard />);
    await user.selectOption(getByText(/Anthropic/i));
    await user.click(getByText(/Continue/i));
    expect(getByText(/Select Model/i)).toBeInTheDocument();
  });
});
```

### Integration Tests

**Full Flow Test:**
```typescript
describe('Profile creation flow', () => {
  it('should create a valid profile through full wizard', async () => {
    const { getByText, getByLabelText, user } = render(<ProfileCreateWizard />);

    // Step 1: Select provider
    await user.selectOption(getByText(/Cerebras/i));
    await user.click(getByText(/Continue/i));

    // Step 2: Select model
    await user.selectOption(getByText(/zai-glm-4.7/i));
    await user.click(getByText(/Continue/i));

    // Step 3: Enter API key
    await user.selectOption(getByText(/Enter API key now/i));
    await user.click(getByText(/Continue/i));
    await user.type(getByLabelText(/API Key/i), 'csk-test-key');
    // Mock connection test success
    await waitFor(() => expect(getByText(/Connection successful/i)).toBeInTheDocument());
    await user.click(getByText(/Continue/i));

    // Step 4: Use defaults
    await user.selectOption(getByText(/Use recommended defaults/i));
    await user.click(getByText(/Continue/i));

    // Step 5: Name profile
    await user.type(getByLabelText(/Profile name/i), 'cerebras-test');
    await user.click(getByText(/Save Profile/i));

    // Step 6: Verify success
    await waitFor(() => expect(getByText(/Profile Created Successfully/i)).toBeInTheDocument());
    expect(getByText(/cerebras-test/i)).toBeInTheDocument();
  });
});
```

**Error Handling Tests:**
```typescript
describe('Error scenarios', () => {
  it('should handle connection test failures gracefully', async () => {
    // Mock failed connection
    vi.mocked(testConnection).mockResolvedValue({
      success: false,
      error: '401 Unauthorized'
    });

    const { getByText, user } = render(<ProfileCreateWizard />);
    // ... navigate to auth step ...
    await user.type(getByLabelText(/API Key/i), 'bad-key');

    await waitFor(() => expect(getByText(/Connection failed/i)).toBeInTheDocument());
    expect(getByText(/401 Unauthorized/i)).toBeInTheDocument();
    expect(getByText(/Try again/i)).toBeInTheDocument();
  });

  it('should handle profile name conflicts', async () => {
    // Mock existing profile
    vi.mocked(getRuntimeApi().listSavedProfiles).mockResolvedValue(['existing-profile']);

    const { getByText, getByLabelText, user } = render(<ProfileCreateWizard />);
    // ... navigate to save step ...
    await user.type(getByLabelText(/Profile name/i), 'existing-profile');

    expect(getByText(/Name already exists/i)).toBeInTheDocument();
    expect(getByText(/Overwrite existing profile/i)).toBeInTheDocument();
  });
});
```

---

## Future Enhancements

### Phase 2: Additional Configuration Options

These configuration options are documented but not included in the initial wizard implementation. They can be added in future iterations based on user demand.

**Generation Parameters (Extended):**
- `top_p` - Nucleus sampling (0.0-1.0)
- `top_k` - Top-k sampling (Anthropic-specific)
- `presence_penalty` - Penalize repeated topics (-2.0 to 2.0)
- `frequency_penalty` - Penalize repeated words (-2.0 to 2.0)
- `seed` - Deterministic output (integer)
- `stop` / `stop_sequences` - Stop generation at specific tokens

**Reasoning/Thinking Parameters:**
- `thinking` - Anthropic thinking mode config
- `enable_thinking` - Boolean toggle
- `reasoning.enabled` - Enable reasoning mode
- `reasoning.includeInContext` - Keep reasoning in context
- `reasoning.includeInResponse` - Show reasoning in output
- `reasoning.stripFromContext` - Control reasoning history (`none`, `all`, `allButLast`)

**Network/Connection Settings:**
- `streaming` - Enable/disable streaming (`enabled`/`disabled`)
- `stream-options` - OpenAI stream options JSON
- `socket-timeout` - Request timeout in ms
- `socket-keepalive` - TCP keepalive boolean
- `socket-nodelay` - TCP_NODELAY boolean

**Tool Output Control:**
- `tool-output-max-items` - Max files/matches returned
- `tool-output-max-tokens` - Max tokens in tool output
- `tool-output-truncate-mode` - `warn`, `truncate`, or `sample`
- `tool-output-item-size-limit` - Max bytes per file

**Specialized Settings:**
- `tool-format` - Override tool format (`openai`, `anthropic`, `hermes`)
- `api-version` - API version (Azure OpenAI)
- `custom-headers` - HTTP headers as JSON
- `shell-replacement` - Allow command substitution (security risk)
- `emojifilter` - Filter emoji in responses (`auto`, `allowed`, `warn`, `error`)
- `compression-threshold` - When to compress history (0.0-1.0)
- `max-prompt-tokens` - Max tokens in any single prompt

**Implementation Approach:**

When Phase 2 is prioritized:
1. Add "Advanced Settings" toggle in Step 5
2. Create expandable sections for parameter groups
3. Use accordion/tabs UI for organization
4. Provide inline help for each parameter
5. Only show provider-relevant parameters

---

### Other Enhancements

**Profile Templates:**
- Pre-configured templates for common use cases
- "Quick setup" option that skips wizard for standard providers
- Import from existing profile

**Bulk Operations:**
- Create multiple profiles at once
- Duplicate existing profile with modifications
- Profile comparison view

**Enhanced Validation:**
- Check model availability via API
- Verify OAuth bucket existence
- Test rate limits during connection check

**UI Improvements:**
- Progress bar showing wizard completion
- Collapsible sections for advanced settings
- Keyboard shortcuts reference (F1 help)
- Undo/redo for wizard steps

---

## Configuration Reference

### Complete List of Configurable Options

This section documents all configuration options available in llxprt profiles. The initial wizard implementation covers essential options (marked with ✓). Additional options (marked with 🔮) are available for manual JSON editing and may be added to the wizard in future phases.

#### Core Settings

| Setting | Coverage | Type | Description | Example |
|---------|----------|------|-------------|---------|
| `provider` | ✓ Wizard | string | AI service provider | `"anthropic"`, `"openai"`, `"cerebras"` |
| `model` | ✓ Wizard | string | Model identifier | `"claude-sonnet-4"`, `"gpt-5"`, `"zai-glm-4.7"` |
| `base-url` | ✓ Wizard | string | API endpoint (ephemeral) | `"https://api.cerebras.ai/v1/"` |

#### Authentication

| Setting | Coverage | Type | Description | Example |
|---------|----------|------|-------------|---------|
| `auth-key` | ✓ Wizard | string | API key (ephemeral) | `"sk-ant-..."` |
| `auth-keyfile` | ✓ Wizard | string | Path to key file (ephemeral) | `"~/.keys/cerebras.key"` |
| `auth.type` | ✓ Wizard | string | OAuth type | `"oauth"` |
| `auth.buckets` | ✓ Wizard | string[] | OAuth bucket names | `["default", "work"]` |

#### Generation Parameters

| Setting | Coverage | Type | Range/Options | Description |
|---------|----------|------|---------------|-------------|
| `temperature` | ✓ Wizard | number | 0.0-2.0 (OpenAI)<br>0.0-1.0 (others) | Creativity/randomness |
| `max_tokens` | ✓ Wizard | number | 1-∞ | Max output length |
| `top_p` | 🔮 Future | number | 0.0-1.0 | Nucleus sampling |
| `top_k` | 🔮 Future | number | 1-∞ | Top-k sampling (Anthropic) |
| `presence_penalty` | 🔮 Future | number | -2.0 to 2.0 | Penalize repeated topics |
| `frequency_penalty` | 🔮 Future | number | -2.0 to 2.0 | Penalize repeated words |
| `seed` | 🔮 Future | number | any integer | Deterministic output |
| `stop` / `stop_sequences` | 🔮 Future | string[] | - | Stop generation at tokens |

#### Context Management

| Setting | Coverage | Type | Description | Default |
|---------|----------|------|-------------|---------|
| `context-limit` | ✓ Wizard | number | Max tokens for context window | Provider-specific |
| `compression-threshold` | 🔮 Future | number | When to compress (0.0-1.0) | - |
| `max-prompt-tokens` | 🔮 Future | number | Max tokens in any prompt | 200000 |

#### Reasoning/Thinking (Provider-Specific)

| Setting | Coverage | Provider | Type | Description |
|---------|----------|----------|------|-------------|
| `thinking` | 🔮 Future | Anthropic | object | Claude thinking mode config |
| `enable_thinking` | 🔮 Future | Anthropic | boolean | Enable/disable thinking |
| `reasoning.enabled` | 🔮 Future | Kimi, MiniMax | boolean | Enable reasoning mode |
| `reasoning.includeInContext` | 🔮 Future | Reasoning models | boolean | Keep reasoning in context |
| `reasoning.stripFromContext` | 🔮 Future | Reasoning models | string | `"none"`, `"all"`, `"allButLast"` |

#### Network/Connection

| Setting | Coverage | Type | Description | Default |
|---------|----------|------|-------------|---------|
| `streaming` | 🔮 Future | string | `"enabled"` or `"disabled"` | `"enabled"` |
| `stream-options` | 🔮 Future | object | OpenAI stream options | `{"include_usage": true}` |
| `socket-timeout` | 🔮 Future | number | Request timeout (ms) | 60000 |
| `socket-keepalive` | 🔮 Future | boolean | TCP keepalive | true |
| `socket-nodelay` | 🔮 Future | boolean | TCP_NODELAY | true |

#### Tool Output Control

| Setting | Coverage | Type | Description | Default |
|---------|----------|------|-------------|---------|
| `tool-output-max-items` | 🔮 Future | number | Max files/matches | 50 |
| `tool-output-max-tokens` | 🔮 Future | number | Max tokens in output | 50000 |
| `tool-output-truncate-mode` | 🔮 Future | string | `"warn"`, `"truncate"`, `"sample"` | `"warn"` |
| `tool-output-item-size-limit` | 🔮 Future | number | Max bytes per file | 524288 (512KB) |

#### Specialized Settings

| Setting | Coverage | Type | Description | Use Case |
|---------|----------|------|-------------|----------|
| `tool-format` | 🔮 Future | string | `"openai"`, `"anthropic"`, `"hermes"` | Override tool format |
| `api-version` | 🔮 Future | string | API version string | Azure OpenAI |
| `custom-headers` | 🔮 Future | object | HTTP headers JSON | Custom auth |
| `shell-replacement` | 🔮 Future | boolean | Allow command substitution | Advanced users (security risk) |
| `emojifilter` | 🔮 Future | string | `"auto"`, `"allowed"`, `"warn"`, `"error"` | Filter emoji responses |

---

## Appendix

### Provider Alias Definitions

Reference for built-in provider configurations:

**Cerebras Code:**
```json
{
  "name": "Cerebras Code",
  "baseProvider": "openai",
  "baseUrl": "https://api.cerebras.ai/v1/",
  "defaultModel": "qwen-3-coder-480b",
  "description": "Cerebras Code compatibility profile"
}
```

**LM Studio:**
```json
{
  "name": "LM Studio",
  "baseProvider": "openai",
  "baseUrl": "http://localhost:1234/v1",
  "description": "Local LM Studio server"
}
```

**Ollama:**
```json
{
  "name": "Ollama",
  "baseProvider": "openai",
  "baseUrl": "http://localhost:11434/v1",
  "description": "Local Ollama server"
}
```

**llama.cpp:**
```json
{
  "name": "llama.cpp",
  "baseProvider": "openai",
  "baseUrl": "http://localhost:8080/v1",
  "description": "Local llama.cpp server"
}
```

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.0 | Initial design document |

---

**End of Design Document**
