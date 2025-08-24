# Phase 5B: Proper Error Handling Implementation (P5)

## Problem Analysis

**Current State**: OAuth providers have inconsistent and inadequate error handling:

1. **Silent Failures**: Errors logged but not exposed to users
2. **Poor User Experience**: Generic error messages with no actionable guidance
3. **Inconsistent Error Types**: Different providers throw different error types for same issues
4. **Missing Recovery**: No automatic retry or recovery mechanisms
5. **No Error Classification**: All errors treated the same regardless of severity

**Examples of Poor Error Handling**:
```typescript
// From current code - errors are swallowed
try {
  const savedToken = await this.tokenStore?.getToken('qwen');
  // ... process token
} catch (error) {
  console.error('Failed to load token:', error); // Just logged!
  // User never knows what happened
}
```

## Error Classification System

### Error Categories

#### Category 1: User-Actionable Errors (Show to user)
- Authentication expired or invalid
- Network connectivity issues  
- Service unavailable (provider down)
- Quota exceeded or rate limiting
- Missing permissions or scopes

#### Category 2: System Errors (Log and handle gracefully)
- File system permission issues
- Malformed configuration
- Internal state corruption
- Programming errors (missing parameters)

#### Category 3: Transient Errors (Retry automatically)
- Temporary network failures
- Server overload (5xx responses)
- Token refresh failures (with valid refresh token)
- Race conditions in file access

#### Category 4: Critical Errors (Fail fast)
- Invalid OAuth configuration
- Unsupported authentication methods
- Security violations
- Corrupted token storage

## Error Handling Architecture

### Step 1: Define Error Types

**File**: `/packages/core/src/auth/oauth-errors.ts` (new)

```typescript
/**
 * OAuth authentication error types and utilities
 */

export enum OAuthErrorType {
  // User-actionable errors
  AuthenticationRequired = 'authentication_required',
  AuthenticationExpired = 'authentication_expired', 
  AuthenticationInvalid = 'authentication_invalid',
  NetworkError = 'network_error',
  ServiceUnavailable = 'service_unavailable',
  QuotaExceeded = 'quota_exceeded',
  PermissionDenied = 'permission_denied',
  
  // System errors
  ConfigurationError = 'configuration_error',
  StorageError = 'storage_error',
  FileSystemError = 'file_system_error',
  InternalError = 'internal_error',
  
  // Transient errors (retryable)
  TemporaryFailure = 'temporary_failure',
  RateLimited = 'rate_limited',
  ServerOverload = 'server_overload',
  
  // Critical errors  
  InvalidConfiguration = 'invalid_configuration',
  SecurityViolation = 'security_violation',
  CorruptedStorage = 'corrupted_storage',
}

export enum OAuthErrorSeverity {
  Info = 'info',
  Warning = 'warning', 
  Error = 'error',
  Critical = 'critical',
}

export interface OAuthErrorContext {
  provider: string;
  operation: string;
  timestamp: Date;
  userId?: string;
  tokenExpiry?: Date;
  retryCount?: number;
  originalError?: Error;
}

/**
 * Base class for all OAuth errors
 */
export class OAuthError extends Error {
  readonly type: OAuthErrorType;
  readonly severity: OAuthErrorSeverity;
  readonly context: OAuthErrorContext;
  readonly retryable: boolean;
  readonly userActionable: boolean;

  constructor(
    type: OAuthErrorType,
    message: string,
    context: OAuthErrorContext,
    originalError?: Error
  ) {
    super(message);
    this.name = 'OAuthError';
    this.type = type;
    this.context = { ...context, originalError };
    
    // Determine error properties based on type
    const errorProps = this.getErrorProperties(type);
    this.severity = errorProps.severity;
    this.retryable = errorProps.retryable;
    this.userActionable = errorProps.userActionable;
    
    // Preserve original stack trace
    if (originalError && originalError.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }

  private getErrorProperties(type: OAuthErrorType): {
    severity: OAuthErrorSeverity;
    retryable: boolean;
    userActionable: boolean;
  } {
    switch (type) {
      case OAuthErrorType.AuthenticationRequired:
      case OAuthErrorType.AuthenticationExpired:
        return { severity: OAuthErrorSeverity.Warning, retryable: false, userActionable: true };
        
      case OAuthErrorType.AuthenticationInvalid:
      case OAuthErrorType.PermissionDenied:
        return { severity: OAuthErrorSeverity.Error, retryable: false, userActionable: true };
        
      case OAuthErrorType.NetworkError:
      case OAuthErrorType.TemporaryFailure:
        return { severity: OAuthErrorSeverity.Warning, retryable: true, userActionable: false };
        
      case OAuthErrorType.ServiceUnavailable:
      case OAuthErrorType.ServerOverload:
        return { severity: OAuthErrorSeverity.Warning, retryable: true, userActionable: true };
        
      case OAuthErrorType.QuotaExceeded:
      case OAuthErrorType.RateLimited:
        return { severity: OAuthErrorSeverity.Error, retryable: false, userActionable: true };
        
      case OAuthErrorType.InvalidConfiguration:
      case OAuthErrorType.SecurityViolation:
      case OAuthErrorType.CorruptedStorage:
        return { severity: OAuthErrorSeverity.Critical, retryable: false, userActionable: false };
        
      default:
        return { severity: OAuthErrorSeverity.Error, retryable: false, userActionable: false };
    }
  }

  /**
   * Get user-friendly error message with actionable guidance
   */
  getUserMessage(): string {
    switch (this.type) {
      case OAuthErrorType.AuthenticationRequired:
        return `Authentication required for ${this.context.provider}. Run: llxprt auth ${this.context.provider} enable`;
        
      case OAuthErrorType.AuthenticationExpired:
        return `Authentication expired for ${this.context.provider}. Run: llxprt auth ${this.context.provider} enable`;
        
      case OAuthErrorType.AuthenticationInvalid:
        return `Invalid authentication for ${this.context.provider}. Please logout and re-authenticate: llxprt auth ${this.context.provider} logout && llxprt auth ${this.context.provider} enable`;
        
      case OAuthErrorType.NetworkError:
        return `Network connection failed. Please check your internet connection and try again.`;
        
      case OAuthErrorType.ServiceUnavailable:
        return `${this.context.provider} service is temporarily unavailable. Please try again later.`;
        
      case OAuthErrorType.QuotaExceeded:
        return `API quota exceeded for ${this.context.provider}. Please try again later or check your usage limits.`;
        
      case OAuthErrorType.PermissionDenied:
        return `Access denied for ${this.context.provider}. Please check your account permissions.`;
        
      case OAuthErrorType.StorageError:
        return `Failed to save authentication data. Please check file permissions for ~/.llxprt/oauth/`;
        
      case OAuthErrorType.ConfigurationError:
        return `OAuth configuration error for ${this.context.provider}. Please check your settings.`;
        
      default:
        return this.message;
    }
  }

  /**
   * Get technical details for debugging
   */
  getTechnicalDetails(): string {
    const details = [
      `Provider: ${this.context.provider}`,
      `Operation: ${this.context.operation}`,
      `Error Type: ${this.type}`,
      `Severity: ${this.severity}`,
      `Retryable: ${this.retryable}`,
      `Timestamp: ${this.context.timestamp.toISOString()}`,
    ];

    if (this.context.retryCount) {
      details.push(`Retry Count: ${this.context.retryCount}`);
    }

    if (this.context.tokenExpiry) {
      details.push(`Token Expiry: ${this.context.tokenExpiry.toISOString()}`);
    }

    if (this.context.originalError) {
      details.push(`Original Error: ${this.context.originalError.message}`);
    }

    return details.join('\n');
  }
}

/**
 * Utility functions for error handling
 */
export class OAuthErrorUtils {
  /**
   * Create an OAuth error from any error object
   */
  static fromError(
    error: unknown,
    type: OAuthErrorType,
    context: OAuthErrorContext
  ): OAuthError {
    const message = error instanceof Error ? error.message : String(error);
    const originalError = error instanceof Error ? error : undefined;
    return new OAuthError(type, message, context, originalError);
  }

  /**
   * Classify error based on common patterns
   */
  static classifyError(error: unknown, context: OAuthErrorContext): OAuthError {
    if (error instanceof OAuthError) {
      return error; // Already classified
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const originalError = error instanceof Error ? error : undefined;

    // Network errors
    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
      return new OAuthError(
        OAuthErrorType.NetworkError,
        'Network connection failed',
        context,
        originalError
      );
    }

    // File system errors
    if (errorMessage.includes('EACCES') || errorMessage.includes('EPERM')) {
      return new OAuthError(
        OAuthErrorType.FileSystemError,
        'File permission denied',
        context,
        originalError
      );
    }

    // HTTP errors
    if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      return new OAuthError(
        OAuthErrorType.AuthenticationInvalid,
        'Authentication failed',
        context,
        originalError
      );
    }

    if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
      return new OAuthError(
        OAuthErrorType.PermissionDenied,
        'Access denied',
        context,
        originalError
      );
    }

    if (errorMessage.includes('429') || errorMessage.includes('Rate limit')) {
      return new OAuthError(
        OAuthErrorType.RateLimited,
        'Rate limit exceeded',
        context,
        originalError
      );
    }

    if (errorMessage.includes('5') && errorMessage.includes('Server')) {
      return new OAuthError(
        OAuthErrorType.ServiceUnavailable,
        'Service temporarily unavailable',
        context,
        originalError
      );
    }

    // Default to internal error
    return new OAuthError(
      OAuthErrorType.InternalError,
      errorMessage,
      context,
      originalError
    );
  }

  /**
   * Check if error should be retried
   */
  static shouldRetry(error: OAuthError, retryCount: number, maxRetries: number = 3): boolean {
    if (retryCount >= maxRetries) {
      return false;
    }

    return error.retryable;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  static getRetryDelay(retryCount: number, baseDelay: number = 1000): number {
    return Math.min(baseDelay * Math.pow(2, retryCount), 10000); // Max 10 seconds
  }
}
```

### Step 2: Implement Error Handling in Providers

**File**: `/packages/cli/src/auth/qwen-oauth-provider.ts`

Add comprehensive error handling:

```typescript
import { OAuthError, OAuthErrorType, OAuthErrorUtils, OAuthErrorContext } from '@vybestack/llxprt-code-core';

export class QwenOAuthProvider implements OAuthProvider {
  // ... existing code ...

  /**
   * Create error context for this provider
   */
  private createErrorContext(operation: string, additionalContext?: Partial<OAuthErrorContext>): OAuthErrorContext {
    return {
      provider: this.name,
      operation,
      timestamp: new Date(),
      ...additionalContext,
    };
  }

  /**
   * Handle errors with proper classification and user messaging
   */
  private handleError(error: unknown, operation: string, additionalContext?: Partial<OAuthErrorContext>): never {
    const context = this.createErrorContext(operation, additionalContext);
    const oauthError = OAuthErrorUtils.classifyError(error, context);
    
    // Log technical details
    console.error(`OAuth error in ${this.name}.${operation}:`, oauthError.getTechnicalDetails());
    
    // Show user-friendly message for actionable errors
    if (oauthError.userActionable) {
      console.error(oauthError.getUserMessage());
    }
    
    throw oauthError;
  }

  /**
   * Enhanced token initialization with proper error handling
   */
  private async initializeToken(): Promise<void> {
    if (this.initializationState !== InitializationState.NotStarted) {
      return;
    }

    this.initializationState = InitializationState.InProgress;

    try {
      console.debug(`Initializing ${this.name} OAuth provider...`);
      
      if (!this.tokenStore) {
        this.initializationState = InitializationState.Completed;
        return;
      }

      const savedToken = await this.tokenStore.getToken(this.name);

      if (savedToken && !this.isTokenExpired(savedToken)) {
        console.debug(`Found valid saved token for ${this.name}, expires: ${new Date(savedToken.expiry * 1000).toISOString()}`);
      } else if (savedToken) {
        console.debug(`Found expired token for ${this.name}, will need refresh`);
      } else {
        console.debug(`No saved token found for ${this.name}`);
      }
      
      this.initializationState = InitializationState.Completed;
    } catch (error) {
      this.initializationError = error instanceof Error ? error : new Error(String(error));
      this.initializationState = InitializationState.Failed;
      
      // Classify error but don't throw - initialization failure should not crash provider
      const context = this.createErrorContext('initialization');
      const oauthError = OAuthErrorUtils.classifyError(error, context);
      
      console.error(`Failed to initialize ${this.name} OAuth provider:`, oauthError.getTechnicalDetails());
      
      // For critical errors, show user message
      if (oauthError.severity === OAuthErrorSeverity.Critical) {
        console.error(oauthError.getUserMessage());
      }
    }
  }

  /**
   * Enhanced getToken with proper error handling
   */
  async getToken(): Promise<OAuthToken | null> {
    try {
      await this.ensureInitialized();
      
      if (!this.tokenStore) {
        return null;
      }

      const token = await this.tokenStore.getToken(this.name);
      
      if (token && !this.isTokenExpired(token)) {
        return token;
      }
      
      if (token && this.isTokenExpired(token)) {
        // Token expired - this is expected, not an error
        console.debug(`Token expired for ${this.name}, returning null`);
        return null;
      }
      
      return null;
    } catch (error) {
      // Classify and handle error
      const context = this.createErrorContext('getToken');
      const oauthError = OAuthErrorUtils.classifyError(error, context);
      
      // For storage errors, log but don't throw - return null instead
      if (oauthError.type === OAuthErrorType.StorageError || 
          oauthError.type === OAuthErrorType.FileSystemError) {
        console.error(`Storage error getting token for ${this.name}:`, oauthError.getUserMessage());
        return null;
      }
      
      // For other errors, throw
      throw oauthError;
    }
  }

  /**
   * Enhanced refreshIfNeeded with retry logic
   */
  async refreshIfNeeded(): Promise<OAuthToken | null> {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        await this.ensureInitialized();
        
        const currentToken = await this.getToken();
        if (!currentToken || !this.isTokenExpired(currentToken)) {
          return currentToken; // No refresh needed
        }

        if (!currentToken.refresh_token) {
          // No refresh token available
          throw new OAuthError(
            OAuthErrorType.AuthenticationExpired,
            `No refresh token available for ${this.name}`,
            this.createErrorContext('refreshToken')
          );
        }

        console.debug(`Refreshing expired token for ${this.name}...`);
        
        const refreshedToken = await this.deviceFlow.refreshToken(currentToken.refresh_token);
        
        if (refreshedToken && this.tokenStore) {
          await this.tokenStore.saveToken(this.name, refreshedToken);
          console.debug(`Successfully refreshed token for ${this.name}`);
          return refreshedToken;
        }
        
        throw new OAuthError(
          OAuthErrorType.AuthenticationInvalid,
          `Token refresh failed for ${this.name}`,
          this.createErrorContext('refreshToken')
        );
        
      } catch (error) {
        const context = this.createErrorContext('refreshToken', { retryCount });
        const oauthError = error instanceof OAuthError ? error : OAuthErrorUtils.classifyError(error, context);
        
        // Check if we should retry
        if (OAuthErrorUtils.shouldRetry(oauthError, retryCount, maxRetries)) {
          retryCount++;
          const delay = OAuthErrorUtils.getRetryDelay(retryCount);
          console.warn(`Retrying token refresh for ${this.name} in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // No more retries - throw error
        console.error(`Token refresh failed for ${this.name} after ${retryCount} retries:`, oauthError.getTechnicalDetails());
        throw oauthError;
      }
    }
    
    // This should never be reached
    throw new OAuthError(
      OAuthErrorType.InternalError,
      `Unexpected end of retry loop for ${this.name}`,
      this.createErrorContext('refreshToken')
    );
  }

  /**
   * Enhanced initiateAuth with comprehensive error handling
   */
  async initiateAuth(): Promise<void> {
    try {
      await this.ensureInitialized();
      
      console.log(`\n${this.name.charAt(0).toUpperCase() + this.name.slice(1)} OAuth Authentication`);
      console.log('─'.repeat(40));
      
      const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();
      const authUrl = deviceCodeResponse.verification_uri_complete ||
                      `${deviceCodeResponse.verification_uri}?user_code=${deviceCodeResponse.user_code}`;
      
      // ... show auth URL and handle user interaction ...
      
      const token = await this.deviceFlow.pollForToken(deviceCodeResponse.device_code);
      
      if (!token) {
        throw new OAuthError(
          OAuthErrorType.AuthenticationInvalid,
          `Authentication failed for ${this.name} - no token received`,
          this.createErrorContext('initiateAuth')
        );
      }
      
      if (!this.tokenStore) {
        throw new OAuthError(
          OAuthErrorType.ConfigurationError,
          `No token storage configured for ${this.name}`,
          this.createErrorContext('initiateAuth')
        );
      }
      
      await this.tokenStore.saveToken(this.name, token);
      console.log(`✅ Successfully authenticated with ${this.name}`);
      
    } catch (error) {
      this.handleError(error, 'initiateAuth');
    }
  }

  /**
   * Enhanced logout with proper error handling
   */
  async logout(): Promise<void> {
    try {
      await this.ensureInitialized();
      
      if (!this.tokenStore) {
        console.warn(`No token storage configured for ${this.name}, logout may be incomplete`);
        return;
      }
      
      await this.tokenStore.removeToken(this.name);
      console.log(`✅ Successfully logged out from ${this.name}`);
      
    } catch (error) {
      const context = this.createErrorContext('logout');
      const oauthError = OAuthErrorUtils.classifyError(error, context);
      
      // For file system errors during logout, warn but don't fail
      if (oauthError.type === OAuthErrorType.FileSystemError) {
        console.warn(`Warning: ${oauthError.getUserMessage()}`);
        console.warn('Logout may be incomplete, but you can continue.');
        return;
      }
      
      this.handleError(error, 'logout');
    }
  }
}
```

### Step 3: Error Recovery Mechanisms

**File**: `/packages/core/src/auth/oauth-recovery.ts` (new)

```typescript
/**
 * OAuth error recovery and self-healing mechanisms
 */

import { OAuthError, OAuthErrorType } from './oauth-errors.js';
import { TokenStore } from './token-store.js';

export class OAuthRecoveryService {
  constructor(private tokenStore: TokenStore) {}

  /**
   * Attempt to recover from OAuth errors automatically
   */
  async attemptRecovery(error: OAuthError): Promise<boolean> {
    console.debug(`Attempting recovery for ${error.type} in ${error.context.provider}`);
    
    switch (error.type) {
      case OAuthErrorType.CorruptedStorage:
        return await this.recoverFromCorruptedStorage(error);
        
      case OAuthErrorType.FileSystemError:
        return await this.recoverFromFileSystemError(error);
        
      case OAuthErrorType.ConfigurationError:
        return await this.recoverFromConfigurationError(error);
        
      default:
        console.debug(`No recovery mechanism available for error type: ${error.type}`);
        return false;
    }
  }

  /**
   * Recover from corrupted token storage
   */
  private async recoverFromCorruptedStorage(error: OAuthError): Promise<boolean> {
    try {
      console.warn(`Attempting to recover from corrupted storage for ${error.context.provider}...`);
      
      // Remove corrupted token file
      await this.tokenStore.removeToken(error.context.provider);
      
      console.log(`✅ Cleared corrupted token storage for ${error.context.provider}`);
      console.log(`Please re-authenticate: llxprt auth ${error.context.provider} enable`);
      
      return true;
    } catch (recoveryError) {
      console.error('Failed to recover from corrupted storage:', recoveryError);
      return false;
    }
  }

  /**
   * Recover from file system permission errors
   */
  private async recoverFromFileSystemError(error: OAuthError): Promise<boolean> {
    try {
      console.warn('Detected file system permission error, checking OAuth directory...');
      
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      
      const oauthDir = path.join(os.homedir(), '.llxprt', 'oauth');
      
      // Try to fix directory permissions
      try {
        await fs.chmod(oauthDir, 0o700);
        console.log('✅ Fixed OAuth directory permissions');
        return true;
      } catch (chmodError) {
        console.error('Failed to fix directory permissions:', chmodError);
        console.error(`Please run: chmod 700 ${oauthDir}`);
        return false;
      }
    } catch (recoveryError) {
      console.error('Failed to recover from file system error:', recoveryError);
      return false;
    }
  }

  /**
   * Recover from configuration errors
   */
  private async recoverFromConfigurationError(error: OAuthError): Promise<boolean> {
    console.warn('Configuration error detected, providing guidance...');
    
    const provider = error.context.provider;
    
    console.log(`\n💡 Configuration help for ${provider}:`);
    console.log(`   1. Check OAuth settings: llxprt auth ${provider}`);
    console.log(`   2. Re-enable OAuth: llxprt auth ${provider} enable`);
    console.log(`   3. Check provider documentation: https://docs.llxprt.com/oauth-${provider}`);
    
    // Can't automatically fix configuration errors
    return false;
  }
}
```

### Step 4: User-Friendly Error Display

**File**: `/packages/cli/src/ui/error-display.ts` (new)

```typescript
/**
 * User-friendly error display utilities
 */

import { OAuthError, OAuthErrorSeverity } from '@vybestack/llxprt-code-core';

export class ErrorDisplay {
  /**
   * Display OAuth error to user with appropriate formatting
   */
  static displayError(error: OAuthError): void {
    const icon = this.getErrorIcon(error.severity);
    const color = this.getErrorColor(error.severity);
    
    console.log(`\n${icon} ${color}OAuth Error${this.reset()}`);
    console.log('─'.repeat(50));
    
    // User-friendly message
    console.log(`${error.getUserMessage()}\n`);
    
    // Additional context for debugging
    if (process.env.LLXPRT_DEBUG) {
      console.log(`${this.dim()}Technical Details:${this.reset()}`);
      console.log(this.dim() + error.getTechnicalDetails().split('\n').join('\n' + this.dim()) + this.reset());
    } else {
      console.log(`${this.dim()}For technical details, run with: LLXPRT_DEBUG=auth${this.reset()}`);
    }
    
    // Recovery suggestions
    this.showRecoverySuggestions(error);
  }

  /**
   * Show recovery suggestions based on error type
   */
  private static showRecoverySuggestions(error: OAuthError): void {
    const suggestions: string[] = [];
    
    switch (error.type) {
      case 'authentication_required':
      case 'authentication_expired':
        suggestions.push(`Run: llxprt auth ${error.context.provider} enable`);
        break;
        
      case 'authentication_invalid':
        suggestions.push(`Logout and re-authenticate:`);
        suggestions.push(`  llxprt auth ${error.context.provider} logout`);
        suggestions.push(`  llxprt auth ${error.context.provider} enable`);
        break;
        
      case 'network_error':
        suggestions.push('Check your internet connection');
        suggestions.push('Try again in a few moments');
        break;
        
      case 'storage_error':
      case 'file_system_error':
        suggestions.push(`Check file permissions: ls -la ~/.llxprt/oauth/`);
        suggestions.push(`Fix permissions: chmod 700 ~/.llxprt/oauth/`);
        break;
        
      case 'service_unavailable':
        suggestions.push('The service may be temporarily down');
        suggestions.push('Check service status and try again later');
        break;
    }
    
    if (suggestions.length > 0) {
      console.log(`\n💡 ${this.bold()}Recovery Suggestions:${this.reset()}`);
      for (const suggestion of suggestions) {
        console.log(`   ${suggestion}`);
      }
    }
    
    console.log(); // Empty line for spacing
  }

  /**
   * Get appropriate icon for error severity
   */
  private static getErrorIcon(severity: OAuthErrorSeverity): string {
    switch (severity) {
      case 'info': return 'ℹ️';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      case 'critical': return '🚨';
      default: return '❌';
    }
  }

  /**
   * Get ANSI color code for error severity
   */
  private static getErrorColor(severity: OAuthErrorSeverity): string {
    if (!process.stdout.isTTY) return ''; // No colors for non-TTY
    
    switch (severity) {
      case 'info': return '\x1b[36m'; // Cyan
      case 'warning': return '\x1b[33m'; // Yellow
      case 'error': return '\x1b[31m'; // Red  
      case 'critical': return '\x1b[35m'; // Magenta
      default: return '\x1b[31m'; // Red
    }
  }

  private static reset(): string {
    return process.stdout.isTTY ? '\x1b[0m' : '';
  }

  private static bold(): string {
    return process.stdout.isTTY ? '\x1b[1m' : '';
  }

  private static dim(): string {
    return process.stdout.isTTY ? '\x1b[2m' : '';
  }
}
```

## Testing Strategy

### Error Handling Tests

**File**: `/packages/cli/test/auth/error-handling.test.ts`

```typescript
import { QwenOAuthProvider } from '../../src/auth/qwen-oauth-provider.js';
import { OAuthError, OAuthErrorType } from '@vybestack/llxprt-code-core';

describe('OAuth Error Handling', () => {
  it('should classify network errors correctly', async () => {
    const mockTokenStore = {
      getToken: jest.fn().mockRejectedValue(new Error('ENOTFOUND api.qwen.ai')),
      saveToken: jest.fn(),
      removeToken: jest.fn(),
      listProviders: jest.fn(),
    };

    const provider = new QwenOAuthProvider(mockTokenStore as any);

    try {
      await provider.getToken();
      fail('Should have thrown error');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      expect(error.type).toBe(OAuthErrorType.NetworkError);
      expect(error.userActionable).toBe(false);
      expect(error.retryable).toBe(true);
    }
  });

  it('should provide user-friendly error messages', async () => {
    const error = new OAuthError(
      OAuthErrorType.AuthenticationExpired,
      'Token expired',
      { provider: 'qwen', operation: 'getToken', timestamp: new Date() }
    );

    const userMessage = error.getUserMessage();
    expect(userMessage).toContain('Authentication expired for qwen');
    expect(userMessage).toContain('llxprt auth qwen enable');
  });

  it('should retry transient errors', async () => {
    const mockTokenStore = {
      getToken: jest.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(null),
      saveToken: jest.fn(),
      removeToken: jest.fn(),
      listProviders: jest.fn(),
    };

    const provider = new QwenOAuthProvider(mockTokenStore as any);

    // Should eventually succeed after retries
    const token = await provider.getToken();
    expect(token).toBeNull();
    expect(mockTokenStore.getToken).toHaveBeenCalledTimes(3);
  });

  it('should handle corrupted storage gracefully', async () => {
    const mockTokenStore = {
      getToken: jest.fn().mockRejectedValue(new Error('Unexpected token in JSON')),
      saveToken: jest.fn(),
      removeToken: jest.fn().mockResolvedValue(undefined),
      listProviders: jest.fn(),
    };

    const provider = new QwenOAuthProvider(mockTokenStore as any);

    // Should not throw, should return null
    const token = await provider.getToken();
    expect(token).toBeNull();
  });
});
```

## Success Criteria

1. **User Experience**: Clear, actionable error messages for all user-facing errors
2. **Reliability**: Automatic retry for transient failures
3. **Debugging**: Comprehensive technical details available with debug flag
4. **Recovery**: Automatic recovery from common issues (corrupted storage, permissions)
5. **Consistency**: All providers use same error handling patterns
6. **Logging**: Appropriate log levels (debug, warn, error) for different scenarios

## Deployment Plan

### Week 1: Error Infrastructure
- Deploy error types and classification system
- Add error handling to Qwen provider
- Test error scenarios thoroughly

### Week 2: Provider Updates
- Apply error handling to all OAuth providers
- Add recovery mechanisms
- Update user-facing error displays

### Week 3: Integration Testing
- Test error handling in real scenarios
- Validate user experience improvements
- Monitor error rates and recovery success

### Week 4: Documentation and Monitoring
- Update troubleshooting documentation
- Add error monitoring and alerting
- Train support team on new error messages