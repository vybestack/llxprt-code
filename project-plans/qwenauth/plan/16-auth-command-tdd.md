# Phase 16: Auth Command TDD Tests

## Objective
Write comprehensive behavioral tests for multi-provider auth command.

## Input
- specification.md [REQ-001]
- analysis/pseudocode/auth-command.md

## Test Requirements
Create packages/cli/src/commands/auth.spec.ts with 15-18 behavioral tests.

## Required Test Scenarios

### OAuth-Only Menu
```typescript
/**
 * @requirement REQ-001.1
 * @scenario Show OAuth-only menu
 * @given Auth command with no argument
 * @when execute() called
 * @then Displays only OAuth providers
 * @and No API key options shown
 */

/**
 * @requirement REQ-001.2
 * @scenario No API key setup in menu
 * @given OAuth provider menu displayed
 * @when Viewing options
 * @then Only Gemini and Qwen OAuth listed
 * @and No "API Key" option present
 */
```

### Direct Provider Authentication
```typescript
/**
 * @requirement REQ-001.3
 * @scenario Direct Gemini authentication
 * @given Command: /auth gemini
 * @when execute('gemini') called
 * @then Initiates Gemini OAuth flow directly
 * @and No menu shown
 */

/**
 * @requirement REQ-001.3
 * @scenario Direct Qwen authentication
 * @given Command: /auth qwen
 * @when execute('qwen') called
 * @then Initiates Qwen OAuth flow directly
 * @and No menu shown
 */
```

### Menu Selection
```typescript
/**
 * @requirement REQ-001.1
 * @scenario Select Gemini from menu
 * @given OAuth menu displayed
 * @when User selects option 1 (Gemini)
 * @then Initiates Gemini OAuth flow
 */

/**
 * @requirement REQ-001.1
 * @scenario Select Qwen from menu
 * @given OAuth menu displayed
 * @when User selects option 2 (Qwen)
 * @then Initiates Qwen OAuth flow
 */
```

### Provider Registration
```typescript
/**
 * @requirement REQ-001.1
 * @scenario List registered OAuth providers
 * @given Gemini and Qwen providers registered
 * @when Menu generated
 * @then Shows both providers in order
 */

/**
 * @requirement REQ-001.3
 * @scenario Handle unknown provider
 * @given Command: /auth unknown
 * @when execute('unknown') called
 * @then Shows error: Provider not supported
 * @and Lists available providers
 */
```

### Authentication Flow
```typescript
/**
 * @requirement REQ-001.1
 * @scenario Complete OAuth flow
 * @given Provider selected from menu
 * @when OAuth flow initiated
 * @then Shows device code and URL
 * @and Polls for completion
 * @and Stores token on success
 */

/**
 * @requirement REQ-001.1
 * @scenario Handle auth cancellation
 * @given OAuth flow in progress
 * @when User cancels
 * @then Returns to command prompt
 * @and No token stored
 */
```

### Multi-Provider Support
```typescript
/**
 * @requirement REQ-001.3
 * @scenario Authenticate multiple providers
 * @given No providers authenticated
 * @when Auth gemini, then auth qwen
 * @then Both providers authenticated
 * @and Tokens stored separately
 */

/**
 * @requirement REQ-001.3
 * @scenario Re-authenticate provider
 * @given Qwen already authenticated
 * @when /auth qwen called again
 * @then Refreshes authentication
 * @and Updates stored token
 */
```

### Status Display
```typescript
/**
 * @requirement REQ-005.4
 * @scenario Show auth status in menu
 * @given Gemini authenticated, Qwen not
 * @when Menu displayed
 * @then Shows "✓" next to Gemini
 * @and Shows no mark for Qwen
 */
```

### Error Handling
```typescript
/**
 * @requirement REQ-001.3
 * @scenario OAuth flow failure
 * @given OAuth initiated
 * @when Flow fails (timeout/denied)
 * @then Shows clear error message
 * @and No token stored
 */
```

## Forbidden Patterns
- NO testing internal menu rendering
- NO mocking OAuth flows
- NO API key related tests
- Must test actual command behavior

## Verification
- All tests fail with NotYetImplemented
- OAuth-only focus verified
- Multi-provider scenarios tested
- Direct and menu paths covered