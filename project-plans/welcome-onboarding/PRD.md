# Welcome Onboarding Flow: Product Requirements Document

## Purpose

Provide a guided first-run experience that helps new users configure authentication and select their first provider, enabling them to start using llxprt immediately without confusion or errors.

## Problem Statement

Currently, when users launch llxprt for the first time:

1. No provider is configured (Gemini is default but has no credentials)
2. Users immediately encounter errors about missing API keys/authentication
3. Users don't know what to do - should they provide an API key? Use OAuth? Which provider should they choose?
4. Users must discover `/auth` and `/provider` commands through trial and error
5. The experience is confusing and creates friction for new users

**Current Flow (Poor UX):**
```
1. Launch llxprt
2. Try to type something
3. Get error: "Gemini API key not configured"
4. User doesn't know what to do
5. User exits in frustration OR searches docs
```

**Desired Flow (Good UX):**
```
1. Launch llxprt
2. Welcome screen: "Let's get you set up!"
3. Guided provider selection
4. Guided authentication setup (OAuth or API key)
5. Confirmation: "All set! Try asking me something."
6. User starts using llxprt successfully
```

## Proposed Solution

Create an interactive welcome dialog that appears on first run, guiding users through:
1. Provider selection from available options
2. Authentication method choice (OAuth vs API key)
3. Completion of authentication flow
4. Automatic provider activation
5. Optional: Quick tutorial or example prompt

This leverages existing UI components (RadioButtonSelect, dialogs) and integrates with existing auth/provider systems.

## Architectural Context

### Existing Components to Leverage

**UI Components:**
- `RadioButtonSelect` - For provider and option selection
- `FolderTrustDialog` - Template for blocking dialogs
- `DialogManager` - Dialog orchestration
- `useKeypress` - Keyboard navigation

**Backend Services:**
- `ProviderManager` - Provider registration and switching
- `OAuthManager` - OAuth flow orchestration  
- `SettingsService` - Persistence of first-run flag
- Auth commands and infrastructure

**Entry Points:**
- `AppContainer.tsx` - Main app initialization
- `useFolderTrust` hook - Example of startup dialog

### Integration Points

1. **First-Run Detection**: Check settings for `firstRunCompleted` flag
2. **Welcome Dialog**: New component similar to `FolderTrustDialog`
3. **Provider Selection**: Use `RadioButtonSelect` with provider list
4. **Auth Flow**: Delegate to existing `/auth` command infrastructure
5. **Provider Activation**: Call `ProviderManager.setActiveProvider()`
6. **Persistence**: Save `firstRunCompleted: true` to settings

## Technical Environment

- **Type**: CLI Tool Enhancement
- **Runtime**: Node.js 20.x
- **Language**: TypeScript
- **UI Framework**: React + Ink
- **Affected Packages**:
  - `packages/cli/src/ui/components/` - New welcome dialog
  - `packages/cli/src/ui/hooks/` - New useWelcomeOnboarding hook
  - `packages/core/src/settings/` - First-run flag
  - `packages/core/src/providers/` - Provider listing

## Functional Requirements

### Core Flow Requirements

**[REQ-001]** The system shall detect first-run on application startup.
  - **[REQ-001.1]** Check for `firstRunCompleted` setting in SettingsService
  - **[REQ-001.2]** If false/undefined, trigger welcome flow
  - **[REQ-001.3]** Skip welcome flow if setting is true

**[REQ-002]** The system shall display a welcome screen before any other interactions.
  - **[REQ-002.1]** Block other input until welcome flow completes
  - **[REQ-002.2]** Show friendly, informative welcome message
  - **[REQ-002.3]** Set clear expectations about setup process

**[REQ-003]** The system shall present all available providers for selection.
  - **[REQ-003.1]** List: Anthropic, OpenAI, Gemini, DeepSeek, Qwen, and others
  - **[REQ-003.2]** Show brief description of each provider
  - **[REQ-003.3]** Use RadioButtonSelect for keyboard navigation
  - **[REQ-003.4]** Highlight recommended/popular options

**[REQ-004]** The system shall offer authentication method choice for selected provider.
  - **[REQ-004.1]** If OAuth available: present "OAuth (recommended)" option
  - **[REQ-004.2]** Always present "API Key" option
  - **[REQ-004.3]** Show pros/cons or brief explanation of each method
  - **[REQ-004.4]** Use RadioButtonSelect for method selection

**[REQ-005]** The system shall guide users through OAuth setup if selected.
  - **[REQ-005.1]** Delegate to existing `/auth <provider> enable` logic
  - **[REQ-005.2]** Display in-progress indicators during auth flow
  - **[REQ-005.3]** Handle OAuth completion or cancellation
  - **[REQ-005.4]** Show success/failure messages

**[REQ-006]** The system shall guide users through API key setup if selected.
  - **[REQ-006.1]** Display instructions on where to get API key
  - **[REQ-006.2]** Provide secure input field for API key entry
  - **[REQ-006.3]** Validate API key format (basic validation)
  - **[REQ-006.4]** Save API key to settings/profile

**[REQ-007]** The system shall automatically set the configured provider as active.
  - **[REQ-007.1]** Call `ProviderManager.setActiveProvider()` after successful auth
  - **[REQ-007.2]** Persist active provider to settings
  - **[REQ-007.3]** Show confirmation message

**[REQ-008]** The system shall mark first-run as completed after successful setup.
  - **[REQ-008.1]** Set `firstRunCompleted: true` in settings
  - **[REQ-008.2]** Persist to disk immediately
  - **[REQ-008.3]** Never show welcome flow again for this installation

**[REQ-009]** The system shall allow users to skip or exit the welcome flow at any time.
  - **[REQ-009.1]** Provide clear "Skip setup (I know what I'm doing)" option on welcome screen
  - **[REQ-009.2]** ESC key exits welcome flow immediately from any step
  - **[REQ-009.3]** Mark first-run complete even if skipped
  - **[REQ-009.4]** Show brief acknowledgment: "Setup skipped. Use /auth and /provider to configure manually."
  - **[REQ-009.5]** Never force users through the flow - respect power users' time
  - **[REQ-009.6]** Allow navigation back and skip from any intermediate step

### User Experience Requirements

**[REQ-010]** The welcome flow shall be clear, concise, and respectful of user expertise.
  - **[REQ-010.1]** Use plain language without jargon
  - **[REQ-010.2]** Progressive disclosure - show only what's needed at each step
  - **[REQ-010.3]** Maximum 4 steps from start to completion
  - **[REQ-010.4]** Skip option prominent and accessible at all times
  - **[REQ-010.5]** No negative language or guilt about skipping ("I know what I'm doing" not "No, I don't want help")

**[REQ-011]** The system shall provide helpful context at each step.
  - **[REQ-011.1]** Explain what providers are and why to choose one
  - **[REQ-011.2]** Explain OAuth vs API key trade-offs
  - **[REQ-011.3]** Show links to provider signup pages if needed
  - **[REQ-011.4]** Provide escape hatches and help text

**[REQ-012]** The system shall show progress through the welcome flow.
  - **[REQ-012.1]** Display step indicators (e.g., "Step 1 of 3")
  - **[REQ-012.2]** Show what was completed and what's next
  - **[REQ-012.3]** Allow backward navigation where appropriate

**[REQ-013]** The system shall celebrate successful completion.
  - **[REQ-013.1]** Show success message: "You're all set!"
  - **[REQ-013.2]** Optionally show a sample prompt to try
  - **[REQ-013.3]** Transition smoothly to normal operation

### Advanced Requirements (Optional Phase 2)

**[REQ-014]** The system should support manual trigger of welcome flow.
  - **[REQ-014.1]** Add `/onboard` or `/setup` command
  - **[REQ-014.2]** Allow users to re-run setup if needed
  - **[REQ-014.3]** Warn about overwriting existing configuration

**[REQ-015]** The system should remember partial progress if interrupted.
  - **[REQ-015.1]** Save intermediate state during flow
  - **[REQ-015.2]** Resume from last completed step on restart
  - **[REQ-015.3]** Clear partial state after completion

**[REQ-016]** The system should offer provider recommendations.
  - **[REQ-016.1]** Suggest providers based on use case (coding, chat, etc.)
  - **[REQ-016.2]** Show which providers have free tiers
  - **[REQ-016.3]** Indicate which are fastest to set up

## UI Wireframes (Text-Based)

### Step 1: Welcome Screen
```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Welcome to llxprt!                                  │
│                                                      │
│  Let's get you set up in just a few steps.          │
│  You'll need to choose an AI provider and configure │
│  authentication so llxprt can work its magic.       │
│                                                      │
│  What would you like to do?                         │
│                                                      │
│  ● 1. Set up now (recommended for new users)        │
│    2. Skip setup (I know what I'm doing)            │
│                                                      │
│  Use ↑↓ arrows to navigate, Enter to select         │
│  Press Esc anytime to skip setup                    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Step 2: Provider Selection
```
┌──────────────────────────────────────────────────────┐
│  Step 1 of 3: Choose Your AI Provider               │
│                                                      │
│  Select which AI provider you'd like to use:        │
│                                                      │
│  ● 1. Anthropic (Claude)                            │
│    2. OpenAI (GPT-4, GPT-3.5)                       │
│    3. Google Gemini                                  │
│    4. DeepSeek                                       │
│    5. Qwen                                           │
│    6. I'll configure this manually later            │
│                                                      │
│  Use ↑↓ arrows to navigate, Enter to select         │
│  Esc to skip setup                                   │
└──────────────────────────────────────────────────────┘
```

### Step 3: Auth Method Selection
```
┌──────────────────────────────────────────────────────┐
│  Step 2 of 3: Choose Authentication Method          │
│                                                      │
│  How would you like to authenticate with Anthropic? │
│                                                      │
│  ● 1. OAuth (Recommended - secure & easy)           │
│       → Browser-based authentication                 │
│       → No API key needed                            │
│                                                      │
│    2. API Key (Traditional)                          │
│       → You'll need to provide your API key          │
│       → Get one at: console.anthropic.com            │
│                                                      │
│    3. Back to provider selection                     │
│                                                      │
│  Use ↑↓ arrows to navigate, Enter to select         │
└──────────────────────────────────────────────────────┘
```

### Step 4a: OAuth Flow (if OAuth selected)
```
┌──────────────────────────────────────────────────────┐
│  Step 3 of 3: Authenticating with Anthropic         │
│                                                      │
│  Opening browser for OAuth authentication...         │
│                                                      │
│  Please complete the authentication in your browser. │
│  This window will update when done.                  │
│                                                      │
│  [Spinner animation]                                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Step 4b: API Key Flow (if API Key selected)
```
┌──────────────────────────────────────────────────────┐
│  Step 3 of 3: Enter Your API Key                    │
│                                                      │
│  Get your Anthropic API key at:                     │
│  https://console.anthropic.com/settings/keys         │
│                                                      │
│  Enter API key: ********************************     │
│                                                      │
│  Press Enter when done, or Esc to go back           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Step 5a: Success (Setup Completed)
```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  [OK] You're all set up!                               │
│                                                      │
│  Provider: Anthropic (Claude)                        │
│  Authentication: OAuth                               │
│                                                      │
│  Try asking me something like:                       │
│  "Explain how async/await works in JavaScript"      │
│                                                      │
│  Press Enter to continue...                          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Step 5b: Skipped (User Opted Out)
```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Setup skipped                                       │
│                                                      │
│  To configure llxprt manually:                       │
│  • Use /auth <provider> to set up authentication    │
│  • Use /provider to select your AI provider         │
│  • Type /help for more commands                     │
│                                                      │
│  Press Enter to continue...                          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Data Structures

```typescript
// Settings extension
interface WelcomeSettings {
  firstRunCompleted: boolean;
  welcomeFlowVersion?: string; // For future migrations
  skippedWelcome?: boolean;
  completedSteps?: WelcomeStep[];
}

// Welcome flow state
enum WelcomeStep {
  WELCOME = 'welcome',
  PROVIDER_SELECTION = 'provider_selection',
  AUTH_METHOD = 'auth_method',
  AUTHENTICATION = 'authentication',
  COMPLETION = 'completion',
  SKIP_EXIT = 'skip_exit',
}

interface WelcomeFlowState {
  currentStep: WelcomeStep;
  selectedProvider?: string;
  selectedAuthMethod?: 'oauth' | 'api_key';
  inProgress: boolean;
  skipped: boolean;
  error?: string;
}

// Provider info for display
interface ProviderInfo {
  id: string;
  displayName: string;
  description: string;
  supportsOAuth: boolean;
  signupUrl?: string;
  apiKeyUrl?: string;
  recommended?: boolean;
}

// Available providers
const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    displayName: 'Anthropic (Claude)',
    description: 'Advanced reasoning and code assistance',
    supportsOAuth: true,
    signupUrl: 'https://console.anthropic.com/signup',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    recommended: true,
  },
  {
    id: 'openai',
    displayName: 'OpenAI (GPT-4, GPT-3.5)',
    description: 'Versatile models for chat and code',
    supportsOAuth: true,
    signupUrl: 'https://platform.openai.com/signup',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    displayName: 'Google Gemini',
    description: 'Multimodal AI from Google',
    supportsOAuth: true,
    signupUrl: 'https://makersuite.google.com/app/apikey',
    apiKeyUrl: 'https://makersuite.google.com/app/apikey',
  },
  // ... other providers
];
```

## Component Architecture

### New Components

**`WelcomeDialog.tsx`**
- Main dialog component
- State machine for multi-step flow
- Orchestrates child components
- Handles completion and persistence

**`ProviderSelectionStep.tsx`**
- Displays provider list with RadioButtonSelect
- Shows provider descriptions
- Handles provider selection

**`AuthMethodStep.tsx`**
- Shows OAuth vs API key options
- Provider-specific messaging
- Links to documentation

**`AuthenticationStep.tsx`**
- OAuth: Progress indicator during auth flow
- API Key: Secure text input field
- Error handling and retry logic

**`CompletionStep.tsx`**
- Success message
- Configuration summary
- Sample prompt suggestions

### New Hooks

**`useWelcomeFlow.ts`**
```typescript
interface UseWelcomeFlowReturn {
  shouldShowWelcome: boolean;
  welcomeState: WelcomeFlowState;
  actions: {
    startSetup: () => void;
    selectProvider: (provider: string) => void;
    selectAuthMethod: (method: 'oauth' | 'api_key') => void;
    completeAuth: () => void;
    skipWelcome: () => void;  // User chooses to skip
    cancelWelcome: () => void; // ESC key pressed
    goBack: () => void;
  };
}

function useWelcomeFlow(): UseWelcomeFlowReturn;
```

**`useFirstRunDetection.ts`**
```typescript
interface UseFirstRunDetectionReturn {
  isFirstRun: boolean;
  markCompleted: () => void;
}

function useFirstRunDetection(): UseFirstRunDetectionReturn;
```

## Flow State Machine

```
                    ┌──────────────┐
                    │   ESC/SKIP   │ (Anytime)
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
              ┌─────┤  SKIP_EXIT   ├─────┐
              │     └──────────────┘     │
              │                          │
┌─────────┐   │                          │
│ WELCOME │───┤                          │
└────┬────┘   │                          │
     │ Setup  │                          │
     ▼        │                          │
┌──────────────────┐                     │
│ PROVIDER_SELECT  │◄────┐               │
└────┬─────────────┘     │               │
     │ Select provider   │ Back          │
     ▼                   │               │
┌──────────────────┐     │               │
│ AUTH_METHOD      │─────┤               │
└────┬─────────────┘     │               │
     │ Select method     │               │
     ▼                   │               │
┌──────────────────┐     │               │
│ AUTHENTICATION   │─────┘               │
└────┬─────────────┘                     │
     │ Success                           │
     ▼                                   │
┌──────────────────┐                     │
│ COMPLETION       │                     │
└────┬─────────────┘                     │
     │ Enter                             │
     ▼                                   │
┌──────────────────┐◄────────────────────┘
│ Normal Operation │
└──────────────────┘
```

## Integration Sequence

### 1. First-Run Detection
```typescript
// In AppContainer.tsx or similar
const { isFirstRun, markCompleted } = useFirstRunDetection();
const welcomeFlow = useWelcomeFlow();

useEffect(() => {
  if (isFirstRun && !welcomeFlow.shouldShowWelcome) {
    welcomeFlow.actions.start();
  }
}, [isFirstRun]);
```

### 2. Provider Selection
```typescript
// In WelcomeDialog.tsx
const handleProviderSelect = (providerId: string) => {
  welcomeFlow.actions.selectProvider(providerId);
  // Auto-advance to auth method step
};
```

### 3. Authentication Execution
```typescript
// For OAuth
const handleOAuthAuth = async () => {
  const authCommand = `/auth ${selectedProvider} enable`;
  // Delegate to existing auth command logic
  await executeAuthCommand(authCommand);
};

// For API Key
const handleApiKeyAuth = async (apiKey: string) => {
  settingsService.set(`${selectedProvider}ApiKey`, apiKey);
  await settingsService.save();
};
```

### 4. Provider Activation
```typescript
// After successful auth
const activateProvider = () => {
  providerManager.setActiveProvider(selectedProvider);
  markCompleted();
  welcomeFlow.actions.complete();
};
```

## Non-Functional Requirements

### Performance

**[REQ-017]** Welcome flow shall start within 500ms of app launch.
  - **[REQ-017.1]** First-run check must be synchronous and fast
  - **[REQ-017.2]** Provider list loaded from static configuration

**[REQ-018]** Step transitions shall be instant (<100ms).
  - **[REQ-018.1]** No network calls during navigation
  - **[REQ-018.2]** Pre-load next step content

### Reliability

**[REQ-019]** Welcome flow shall never prevent app from starting.
  - **[REQ-019.1]** Errors in welcome flow fall back to normal start
  - **[REQ-019.2]** Corrupted state resets to initial step
  - **[REQ-019.3]** Always provide skip/exit option

**[REQ-020]** Authentication failures shall allow retry.
  - **[REQ-020.1]** Show error message with retry option
  - **[REQ-020.2]** Allow switching auth methods
  - **[REQ-020.3]** Preserve provider selection on retry

### Usability

**[REQ-021]** All interactions shall be keyboard-driven.
  - **[REQ-021.1]** No mouse required
  - **[REQ-021.2]** Clear keyboard shortcuts at each step
  - **[REQ-021.3]** Consistent navigation patterns

**[REQ-022]** Help shall be available at every step.
  - **[REQ-022.1]** `?` key shows context help
  - **[REQ-022.2]** Links to documentation displayed
  - **[REQ-022.3]** Tooltips for complex options

## Testing Requirements

### Unit Tests

**[TEST-001]** Test first-run detection logic
  - New installation → shows welcome
  - Existing installation → skips welcome
  - Completed flag persists correctly

**[TEST-002]** Test state machine transitions
  - All valid state transitions work
  - Invalid transitions are prevented
  - Back navigation works correctly

**[TEST-003]** Test provider selection
  - All providers selectable
  - Provider info displays correctly
  - Selection persists during flow

**[TEST-004]** Test auth method selection
  - OAuth option shown when supported
  - API key always available
  - Method selection persists

**[TEST-005]** Test authentication integration
  - OAuth flow triggers correctly
  - API key validation works
  - Errors handled gracefully

### Integration Tests

**[TEST-006]** Test complete welcome flow
  - Start to finish with OAuth
  - Start to finish with API key
  - Skip at various points

**[TEST-007]** Test provider activation
  - Selected provider becomes active
  - Settings persisted correctly
  - App ready to use after completion

**[TEST-008]** Test interruption handling
  - Exit during flow
  - Crash recovery
  - Resume partial flow (if implemented)

### User Acceptance Tests

**[TEST-009]** New user onboarding
  1. Fresh install of llxprt
  2. Launch application
  3. Complete welcome flow
  4. Verify can immediately start using
  5. No errors or confusion

**[TEST-010]** Skip flow validation
  1. Launch fresh install
  2. Skip welcome flow (via "Skip setup" option)
  3. Verify app starts normally
  4. Verify welcome never shows again
  5. Verify skip acknowledgment message shown
  6. Manual setup still possible via /auth and /provider

**[TEST-011]** ESC key skip validation
  1. Launch fresh install
  2. Press ESC during various steps
  3. Verify immediate exit to skip screen
  4. Verify first-run marked complete
  5. App continues to normal operation

**[TEST-012]** Power user experience
  1. User with existing knowledge
  2. Can skip in <2 seconds from launch
  3. No friction or annoyance
  4. Clear path to manual configuration

## Documentation Requirements

**[DOC-001]** User documentation
  - Add "Getting Started" guide with screenshots
  - Document welcome flow steps
  - Explain skip vs complete
  - Manual setup alternative

**[DOC-002]** Developer documentation
  - Architecture diagram
  - State machine documentation
  - Extension points for new providers
  - Testing strategy

**[DOC-003]** Troubleshooting guide
  - Common welcome flow issues
  - How to reset first-run flag
  - Manual trigger of welcome flow
  - Recovery from errors

**[DOC-004]** Changelog entry
  - Announce new welcome flow
  - Explain benefits for new users
  - Note no impact on existing users

## Success Metrics

### User Experience Metrics
- **Time to First Successful Interaction**: 
  - New users with setup: Target <2 minutes from launch
  - Power users who skip: Target <5 seconds from launch to normal operation
- **Setup Completion Rate**: Target >80% complete welcome flow (vs skip)
- **Skip Experience**: <2 seconds from launch to skip confirmation
- **Authentication Success Rate**: Target >95% successful auth on first attempt
- **User Confusion Reports**: Reduce by >70% compared to current onboarding
- **Power User Friction**: Zero complaints about forced onboarding

### Technical Metrics
- **Welcome Flow Start Time**: <500ms from app launch
- **Step Transition Time**: <100ms between steps
- **Error Rate**: <5% encounter errors during flow
- **Skip Rate**: <20% skip welcome flow

## Future Enhancements

### Phase 2 (Post-Launch)

**Multi-Provider Setup**
- Allow configuring multiple providers in welcome flow
- Show comparison matrix during selection
- Support fallback provider configuration

**Smart Recommendations**
- Detect use case from command line flags
- Recommend provider based on task type
- Show which providers have free tiers

**Tutorial Mode**
- Interactive tutorial after setup
- Sample prompts with explanations
- Feature discovery tour

**Profile Templates**
- Pre-configured profiles for common use cases
- "Developer", "Writer", "Data Analyst" templates
- One-click profile selection

**Provider Health Checks**
- Validate provider API availability during setup
- Show real-time status of providers
- Suggest alternatives if provider down

## Open Questions

1. **Should we show pricing information during provider selection?**
   - **Decision Needed**: May help users make informed choice, but adds complexity

2. **How should we handle provider-specific requirements (e.g., Gemini project ID)?**
   - **Decision Needed**: Show additional step for providers with extra config, or handle in post-setup?

3. **Should welcome flow support multiple profiles/workspaces?**
   - **Decision Needed**: Keep simple for v1, add in v2

4. **What happens if user has env vars set but no provider configured?**
   - **Decision Needed**: Skip welcome or show "detected config" message

5. **Should we allow changing provider/auth during welcome flow?**
   - **Decision Needed**: Support back navigation or force restart?

## Dependencies

- RadioButtonSelect component (existing)
- Dialog system infrastructure (existing)
- ProviderManager API (existing)
- OAuth/Auth command infrastructure (existing)
- SettingsService API (existing)
- Keyboard input handling (existing)

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Welcome flow too complex/long | High | Medium | Keep to 3-4 steps max, progressive disclosure |
| Auth failures during setup | High | Medium | Clear error messages, retry, allow skip |
| Users skip and still confused | Medium | Medium | Make manual setup easy, show hints in normal mode |
| Provider API changes break flow | Medium | Low | Validate providers at runtime, graceful degradation |
| State corruption prevents startup | High | Low | Always allow escape hatch, reset mechanism |
| Power users annoyed by onboarding | Medium | High | **Prominent skip option, ESC works everywhere, <2s to skip** |
| Skip too easy, new users miss help | Low | Medium | Make setup option default, but skip clearly visible |

## Acceptance Criteria

[OK] New users see welcome flow on first launch  
[OK] Welcome flow completes in <3 minutes for typical user  
[OK] Power users can skip in <2 seconds without friction  
[OK] ESC key works at any step to skip immediately  
[OK] Skip option prominent with positive, respectful language  
[OK] All providers can be configured through welcome flow  
[OK] OAuth and API key authentication both work  
[OK] Successfully configured provider is immediately usable  
[OK] Welcome flow never shows again after completion (skip or complete)  
[OK] Existing users never see welcome flow  
[OK] Clear, friendly messaging throughout  
[OK] All keyboard-driven, no mouse required  
[OK] Skip acknowledgment shows manual setup commands (/auth, /provider)  

## Timeline Estimate

- **Design & UX Refinement**: 4-6 hours
- **Component Implementation**: 16-20 hours
  - WelcomeDialog and step components: 8-10 hours
  - Hooks and state management: 4-6 hours
  - Integration with existing systems: 4-6 hours
- **Testing**: 8-12 hours
  - Unit tests: 4-6 hours
  - Integration tests: 2-4 hours
  - User acceptance testing: 2-4 hours
- **Documentation**: 4-6 hours
- **Polish & Bug Fixes**: 4-8 hours
- **Total**: 36-52 hours (5-7 days)

## Version History

| Version | Date | Author | Changes |

## Design Philosophy: Respecting User Expertise

### Core Principles

1. **Never Force**: Users should never feel trapped or forced through onboarding
2. **Respect Time**: Power users value their time - make skip instantaneous
3. **Positive Language**: "I know what I'm doing" not "No thanks" or "Skip"
4. **Clear Exit**: ESC key should work from any screen, anytime
5. **No Shame**: Skipping is a valid, respected choice, not a failure
6. **Helpful Fallback**: If skipped, provide clear pointers to manual setup

### User Personas

**Persona 1: Complete Beginner**
- Never used CLI tools before
- Needs hand-holding through setup
- Benefits from: Full guided flow with explanations
- Estimated time: 2-3 minutes

**Persona 2: Experienced Developer (New to llxprt)**
- Knows CLI tools, first time with llxprt
- Wants to see options but can configure themselves
- Benefits from: Quick overview, optional skip after seeing providers
- Estimated time: 30-60 seconds (may complete or skip)

**Persona 3: Power User / Advanced**
- Already read docs, knows exactly what to do
- Just wants to get started immediately
- Benefits from: Instant skip option, no friction
- Estimated time: <2 seconds (immediate skip)

**Persona 4: Returning User (Reinstall/New Machine)**
- Used llxprt before, reinstalling
- Already knows the system
- Benefits from: Instant skip, muscle memory works (ESC)
- Estimated time: <1 second (ESC reflex)

### Skip UX Best Practices

**DO:**
- Make skip option visible on first screen
- Use clear, positive language: "I know what I'm doing"
- Allow ESC key from anywhere
- Show brief, helpful message after skip
- Mark first-run complete even when skipped
- Provide command references (/auth, /provider)

**DON'T:**
- Hide skip option in deep menus
- Use negative language: "No", "Cancel", "Not now"
- Require confirmation to skip ("Are you sure?")
- Make user feel bad for skipping
- Block ESC key or other exit methods
- Leave user confused after skipping

### Skip Flow Examples

**Good Skip Experience:**
```
User: [Launches llxprt]
System: [Shows welcome with "Setup now" and "Skip setup" options]
User: [Presses ESC]
System: "Setup skipped. Use /auth and /provider to configure. Press Enter..."
User: [Continues immediately]
Time: <2 seconds
Feeling: Respected, in control
```

**Bad Skip Experience (What NOT to do):**
```
User: [Launches llxprt]
System: [Shows welcome, no skip visible]
User: [Presses ESC]
System: [ESC doesn't work]
User: [Looks for skip, not obvious]
System: [Must navigate through screens]
User: [Finally finds "No thanks"]
System: "Are you sure you want to skip? Setup is recommended."
User: [Confirms]
Time: >30 seconds
Feeling: Frustrated, annoyed
```


|---------|------|--------|---------|
| 1.0 | 2026-01-03 | Initial | Initial PRD creation |
