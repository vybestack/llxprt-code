# Welcome Onboarding Flow - Design Document

## Overview

Interactive welcome wizard for first-run users. Appears after folder trust dialog, guides through provider selection and authentication, optionally saves as profile.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Flow trigger | After folder trust | Clean separation of concerns |
| Profile save | Optional prompt | Educate without forcing |
| Provider list | Dynamic from ProviderManager | Future-proof, no hardcoding |
| OAuth handling | Use existing flow | Reuse infrastructure, set provider after |
| First-run flag | Config file | Consistent with folder trust pattern |

## Flow

```
WELCOME → PROVIDER_SELECT → AUTH_METHOD → AUTHENTICATION → COMPLETION
    ↓           ↓               ↓              ↓
    └───────────┴───────────────┴──────────────┴──→ SKIP_EXIT
```

**Steps:**
1. **Welcome** - Setup/skip choice
2. **Provider Selection** - Dynamic list from ProviderManager
3. **Auth Method** - OAuth vs API key (provider-dependent)
4. **Authentication** - Delegates to existing `/auth` flow
5. **Completion** - Success + optional profile save

**Exit Paths:**
- Complete auth → set active provider → optional profile save → mark complete
- Skip/ESC → show manual setup hints → mark complete

## Component Architecture

```
packages/cli/src/ui/components/
  └── WelcomeOnboarding/
      ├── WelcomeDialog.tsx        # Main orchestrator, state machine
      ├── WelcomeStep.tsx          # Step 1: Welcome + setup/skip
      ├── ProviderSelectStep.tsx   # Step 2: Provider list
      ├── AuthMethodStep.tsx       # Step 3: OAuth vs API key
      ├── AuthenticationStep.tsx   # Step 4: Auth in progress
      ├── CompletionStep.tsx       # Step 5: Success + profile save
      └── SkipExitStep.tsx         # Shown when user skips

packages/cli/src/ui/hooks/
  └── useWelcomeOnboarding.ts      # State management, first-run detection
```

## State Management

```typescript
interface WelcomeState {
  step: 'welcome' | 'provider' | 'auth_method' | 'authenticating' | 'completion' | 'skipped';
  selectedProvider?: string;
  selectedAuthMethod?: 'oauth' | 'api_key';
  authInProgress: boolean;
  error?: string;
}

interface WelcomeActions {
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
```

## Integration

**AppContainer.tsx:**
```tsx
const { showWelcome, welcomeState, welcomeActions } = useWelcomeOnboarding(config, settings);

{!isFolderTrustDialogOpen && showWelcome && (
  <WelcomeDialog state={welcomeState} actions={welcomeActions} />
)}
```

**First-Run Detection:**
```tsx
const shouldShow = !config.get('welcomeCompleted');
```

**On Completion:**
```tsx
providerManager.setActiveProvider(state.selectedProvider);
config.set('welcomeCompleted', true);
await config.save();
```

## UI Details

### WelcomeStep
- Header: "Welcome to llxprt!"
- Options: "Set up now (recommended)" / "Skip setup (I know what I'm doing)"
- Footer: Navigation hints

### ProviderSelectStep
- Header: "Step 1 of 3: Choose Your AI Provider"
- Dynamic list from `providerManager.getProviders()`
- Includes "Configure manually later" option

### AuthMethodStep
- Header: "Step 2 of 3: Choose Authentication"
- Conditional: OAuth + API key (if supported) or API key only
- Back navigation option

### AuthenticationStep
- Header: "Step 3 of 3: Authenticating..."
- Spinner for OAuth, text input for API key
- Delegates to existing auth infrastructure

### CompletionStep
- Header: "You're all set!"
- Summary of provider + auth method
- Optional profile save: text input for name
- "Press Enter to continue..."

### SkipExitStep
- Header: "Setup skipped"
- Manual setup hints: `/auth`, `/provider`
- "Press Enter to continue..."

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Esc | Skip to exit (except during OAuth) |
| Enter | Select/confirm |
| ↑↓ | Navigate options |
| Backspace | Go back |

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Auth fails | Show error, offer retry or back |
| OAuth cancelled | Return to auth method step |
| API key invalid | Show error, allow re-entry |
| Provider has no auth | Skip auth steps → completion |
| Profile save fails | Show error, allow skip |

## Config Changes

`~/.llxprt/config.json`:
```json
{
  "welcomeCompleted": true
}
```

## Blocking Behavior

- Welcome flow blocks main input (like folder trust)
- Other dialogs wait until welcome completes
- Initial prompt auto-submit waits for `!showWelcome`
