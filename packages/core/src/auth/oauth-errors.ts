/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OAuth Error Handling System
 *
 * Provides comprehensive error classification, user-friendly messaging,
 * and recovery mechanisms for OAuth providers.
 */

/**
 * OAuth error categories for classification and handling
 */
export enum OAuthErrorCategory {
  /** User must take action (re-authenticate, grant permissions) */
  USER_ACTION_REQUIRED = 'user_action_required',
  /** Network or temporary service issues that can be retried */
  TRANSIENT = 'transient',
  /** System issues (file permissions, storage problems) */
  SYSTEM = 'system',
  /** Critical security or data corruption issues */
  CRITICAL = 'critical',
  /** Configuration or setup problems */
  CONFIGURATION = 'configuration',
}

/**
 * Specific OAuth error types with detailed classification
 */
export enum OAuthErrorType {
  // User-actionable errors
  AUTHENTICATION_REQUIRED = 'authentication_required',
  AUTHORIZATION_EXPIRED = 'authorization_expired',
  INSUFFICIENT_PERMISSIONS = 'insufficient_permissions',
  USER_CANCELLED = 'user_cancelled',
  INVALID_CREDENTIALS = 'invalid_credentials',

  // Transient errors
  NETWORK_ERROR = 'network_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  RATE_LIMITED = 'rate_limited',
  TIMEOUT = 'timeout',

  // System errors
  STORAGE_ERROR = 'storage_error',
  FILE_PERMISSIONS = 'file_permissions',
  CORRUPTED_DATA = 'corrupted_data',

  // Critical errors
  SECURITY_VIOLATION = 'security_violation',
  MALFORMED_TOKEN = 'malformed_token',

  // Configuration errors
  INVALID_CLIENT_ID = 'invalid_client_id',
  INVALID_ENDPOINT = 'invalid_endpoint',
  MISSING_CONFIGURATION = 'missing_configuration',

  // Generic fallback
  UNKNOWN = 'unknown',
}

/**
 * Retry strategy configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay between retries in milliseconds */
  baseDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number;
  /** Whether to add random jitter to delays */
  jitter: boolean;
}

/**
 * Default retry configuration for transient errors
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  jitter: true,
};

/**
 * Comprehensive OAuth error with classification and user guidance
 */
export class OAuthError extends Error {
  readonly category: OAuthErrorCategory;
  readonly type: OAuthErrorType;
  readonly provider: string;
  readonly userMessage: string;
  readonly actionRequired: string | null;
  readonly isRetryable: boolean;
  readonly retryAfterMs: number | null;
  readonly technicalDetails: Record<string, unknown>;
  readonly originalError: Error | null;

  constructor(
    type: OAuthErrorType,
    provider: string,
    message: string,
    options: {
      userMessage?: string;
      actionRequired?: string;
      retryAfterMs?: number;
      technicalDetails?: Record<string, unknown>;
      originalError?: Error;
      cause?: Error;
    } = {},
  ) {
    super(message);
    this.name = 'OAuthError';
    this.type = type;
    this.provider = provider;
    this.category = this.categorizeError(type);
    this.isRetryable = this.determineRetryability(type);
    this.userMessage =
      options.userMessage || this.generateUserMessage(type, provider);
    this.actionRequired =
      options.actionRequired || this.generateActionRequired(type, provider);
    this.retryAfterMs = options.retryAfterMs || null;
    this.technicalDetails = options.technicalDetails || {};
    this.originalError = options.originalError || null;
  }

  /**
   * Categorizes error type into handling categories
   */
  private categorizeError(type: OAuthErrorType): OAuthErrorCategory {
    switch (type) {
      case OAuthErrorType.AUTHENTICATION_REQUIRED:
      case OAuthErrorType.AUTHORIZATION_EXPIRED:
      case OAuthErrorType.INSUFFICIENT_PERMISSIONS:
      case OAuthErrorType.USER_CANCELLED:
      case OAuthErrorType.INVALID_CREDENTIALS:
        return OAuthErrorCategory.USER_ACTION_REQUIRED;

      case OAuthErrorType.NETWORK_ERROR:
      case OAuthErrorType.SERVICE_UNAVAILABLE:
      case OAuthErrorType.RATE_LIMITED:
      case OAuthErrorType.TIMEOUT:
        return OAuthErrorCategory.TRANSIENT;

      case OAuthErrorType.STORAGE_ERROR:
      case OAuthErrorType.FILE_PERMISSIONS:
      case OAuthErrorType.CORRUPTED_DATA:
        return OAuthErrorCategory.SYSTEM;

      case OAuthErrorType.SECURITY_VIOLATION:
      case OAuthErrorType.MALFORMED_TOKEN:
        return OAuthErrorCategory.CRITICAL;

      case OAuthErrorType.INVALID_CLIENT_ID:
      case OAuthErrorType.INVALID_ENDPOINT:
      case OAuthErrorType.MISSING_CONFIGURATION:
        return OAuthErrorCategory.CONFIGURATION;

      default:
        return OAuthErrorCategory.SYSTEM;
    }
  }

  /**
   * Determines if error type is retryable
   */
  private determineRetryability(type: OAuthErrorType): boolean {
    switch (type) {
      case OAuthErrorType.NETWORK_ERROR:
      case OAuthErrorType.SERVICE_UNAVAILABLE:
      case OAuthErrorType.TIMEOUT:
        return true;
      case OAuthErrorType.RATE_LIMITED:
        return true; // But with specific delay
      default:
        return false;
    }
  }

  /**
   * Generates user-friendly error message
   */
  private generateUserMessage(type: OAuthErrorType, provider: string): string {
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

    switch (type) {
      case OAuthErrorType.AUTHENTICATION_REQUIRED:
        return `You need to sign in to ${providerName} to continue.`;
      case OAuthErrorType.AUTHORIZATION_EXPIRED:
        return `Your ${providerName} session has expired. Please sign in again.`;
      case OAuthErrorType.INSUFFICIENT_PERMISSIONS:
        return `${providerName} access was denied. Please grant the required permissions.`;
      case OAuthErrorType.USER_CANCELLED:
        return `${providerName} authentication was cancelled.`;
      case OAuthErrorType.INVALID_CREDENTIALS:
        return `The ${providerName} credentials are invalid. Please sign in again.`;
      case OAuthErrorType.NETWORK_ERROR:
        return `Unable to connect to ${providerName}. Please check your internet connection.`;
      case OAuthErrorType.SERVICE_UNAVAILABLE:
        return `${providerName} is currently unavailable. Please try again later.`;
      case OAuthErrorType.RATE_LIMITED:
        return `Too many requests to ${providerName}. Please wait a moment and try again.`;
      case OAuthErrorType.TIMEOUT:
        return `Connection to ${providerName} timed out. Please try again.`;
      case OAuthErrorType.STORAGE_ERROR:
        return `Unable to save ${providerName} authentication data. Please check file permissions.`;
      case OAuthErrorType.FILE_PERMISSIONS:
        return `Permission denied when accessing ${providerName} authentication files.`;
      case OAuthErrorType.CORRUPTED_DATA:
        return `${providerName} authentication data is corrupted. Please sign in again.`;
      case OAuthErrorType.SECURITY_VIOLATION:
        return `${providerName} authentication failed due to a security issue.`;
      case OAuthErrorType.MALFORMED_TOKEN:
        return `${providerName} returned invalid authentication data. Please try again.`;
      case OAuthErrorType.INVALID_CLIENT_ID:
        return `${providerName} configuration error: invalid client ID.`;
      case OAuthErrorType.INVALID_ENDPOINT:
        return `${providerName} configuration error: invalid server endpoint.`;
      case OAuthErrorType.MISSING_CONFIGURATION:
        return `${providerName} is not properly configured.`;
      default:
        return `An unexpected error occurred with ${providerName} authentication.`;
    }
  }

  /**
   * Generates actionable guidance for users
   */
  private generateActionRequired(
    type: OAuthErrorType,
    provider: string,
  ): string | null {
    switch (type) {
      case OAuthErrorType.AUTHENTICATION_REQUIRED:
      case OAuthErrorType.AUTHORIZATION_EXPIRED:
      case OAuthErrorType.INVALID_CREDENTIALS:
        return `Run 'llxprt auth login ${provider}' to sign in again.`;
      case OAuthErrorType.INSUFFICIENT_PERMISSIONS:
        return `Grant the required permissions during ${provider} authentication.`;
      case OAuthErrorType.USER_CANCELLED:
        return `Complete the ${provider} authentication process to continue.`;
      case OAuthErrorType.NETWORK_ERROR:
        return 'Check your internet connection and try again.';
      case OAuthErrorType.SERVICE_UNAVAILABLE:
      case OAuthErrorType.RATE_LIMITED:
      case OAuthErrorType.TIMEOUT:
        return 'Wait a few minutes and try again.';
      case OAuthErrorType.STORAGE_ERROR:
      case OAuthErrorType.FILE_PERMISSIONS:
        return 'Check that you have write permissions to ~/.llxprt directory.';
      case OAuthErrorType.CORRUPTED_DATA:
        return `Run 'llxprt auth logout ${provider}' then sign in again.`;
      case OAuthErrorType.SECURITY_VIOLATION:
        return 'Contact support if this problem persists.';
      case OAuthErrorType.MALFORMED_TOKEN:
        return `Sign out and back in to ${provider}.`;
      case OAuthErrorType.INVALID_CLIENT_ID:
      case OAuthErrorType.INVALID_ENDPOINT:
      case OAuthErrorType.MISSING_CONFIGURATION:
        return 'Check your application configuration.';
      default:
        return null;
    }
  }

  /**
   * Creates a sanitized version of the error for logging
   */
  toLogEntry(): Record<string, unknown> {
    return {
      type: this.type,
      category: this.category,
      provider: this.provider,
      isRetryable: this.isRetryable,
      retryAfterMs: this.retryAfterMs,
      message: this.message,
      userMessage: this.userMessage,
      actionRequired: this.actionRequired,
      technicalDetails: this.technicalDetails,
      stack: this.stack,
      originalError: this.originalError
        ? {
            name: this.originalError.name,
            message: this.originalError.message,
            stack: this.originalError.stack,
          }
        : null,
    };
  }
}

/**
 * Error factory for common OAuth error scenarios
 */
export class OAuthErrorFactory {
  /**
   * Creates an authentication required error
   */
  static authenticationRequired(
    provider: string,
    details?: Record<string, unknown>,
  ): OAuthError {
    return new OAuthError(
      OAuthErrorType.AUTHENTICATION_REQUIRED,
      provider,
      `Authentication required for ${provider}`,
      { technicalDetails: details },
    );
  }

  /**
   * Creates an expired authorization error
   */
  static authorizationExpired(
    provider: string,
    details?: Record<string, unknown>,
  ): OAuthError {
    return new OAuthError(
      OAuthErrorType.AUTHORIZATION_EXPIRED,
      provider,
      `Authorization expired for ${provider}`,
      { technicalDetails: details },
    );
  }

  /**
   * Creates a network error with retry capability
   */
  static networkError(
    provider: string,
    originalError?: Error,
    details?: Record<string, unknown>,
  ): OAuthError {
    return new OAuthError(
      OAuthErrorType.NETWORK_ERROR,
      provider,
      `Network error connecting to ${provider}`,
      {
        originalError,
        technicalDetails: details,
        retryAfterMs: 1000, // Retry after 1 second
      },
    );
  }

  /**
   * Creates a rate limited error with specific retry delay
   */
  static rateLimited(
    provider: string,
    retryAfterSeconds: number = 60,
    details?: Record<string, unknown>,
  ): OAuthError {
    return new OAuthError(
      OAuthErrorType.RATE_LIMITED,
      provider,
      `Rate limited by ${provider}`,
      {
        technicalDetails: details,
        retryAfterMs: retryAfterSeconds * 1000,
      },
    );
  }

  /**
   * Creates a storage error
   */
  static storageError(
    provider: string,
    originalError?: Error,
    details?: Record<string, unknown>,
  ): OAuthError {
    return new OAuthError(
      OAuthErrorType.STORAGE_ERROR,
      provider,
      `Storage error for ${provider}`,
      { originalError, technicalDetails: details },
    );
  }

  /**
   * Creates a corrupted data error
   */
  static corruptedData(
    provider: string,
    details?: Record<string, unknown>,
  ): OAuthError {
    return new OAuthError(
      OAuthErrorType.CORRUPTED_DATA,
      provider,
      `Corrupted data for ${provider}`,
      { technicalDetails: details },
    );
  }

  /**
   * Creates an error from an unknown error, attempting classification
   */
  static fromUnknown(
    provider: string,
    error: unknown,
    context?: string,
  ): OAuthError {
    let originalError: Error | null = null;
    let message = 'Unknown error';
    let type = OAuthErrorType.UNKNOWN;

    if (error instanceof Error) {
      originalError = error;
      message = error.message;

      // Attempt to classify based on error message or type
      const errorWithCode = error as Error & { code?: string };
      if (
        error.message.toLowerCase().includes('network') ||
        error.message.toLowerCase().includes('connection') ||
        errorWithCode.code === 'ENOTFOUND' ||
        errorWithCode.code === 'ECONNREFUSED'
      ) {
        type = OAuthErrorType.NETWORK_ERROR;
      } else if (error.message.toLowerCase().includes('timeout')) {
        type = OAuthErrorType.TIMEOUT;
      } else if (
        error.message.toLowerCase().includes('permission') ||
        errorWithCode.code === 'EACCES' ||
        errorWithCode.code === 'EPERM'
      ) {
        type = OAuthErrorType.FILE_PERMISSIONS;
      } else if (
        error.message.toLowerCase().includes('unauthorized') ||
        error.message.toLowerCase().includes('invalid_grant') ||
        error.message.toLowerCase().includes('expired')
      ) {
        type = OAuthErrorType.AUTHORIZATION_EXPIRED;
      } else if (
        error.message.toLowerCase().includes('rate') ||
        error.message.toLowerCase().includes('too many')
      ) {
        type = OAuthErrorType.RATE_LIMITED;
      }
    } else if (typeof error === 'string') {
      message = error;
    } else {
      message = String(error);
    }

    return new OAuthError(
      type,
      provider,
      context ? `${context}: ${message}` : message,
      {
        originalError: originalError || undefined,
        technicalDetails: { context, originalErrorType: typeof error },
      },
    );
  }
}

/**
 * Retry handler with exponential backoff and jitter
 */
export class RetryHandler {
  constructor(private config: RetryConfig = DEFAULT_RETRY_CONFIG) {}

  /**
   * Executes operation with retry logic for transient errors
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    provider: string,
    context?: string,
  ): Promise<T> {
    let lastError: OAuthError | null = null;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        // Convert to OAuthError if not already
        const oauthError =
          error instanceof OAuthError
            ? error
            : OAuthErrorFactory.fromUnknown(provider, error, context);

        lastError = oauthError;

        // Don't retry non-transient errors
        if (!oauthError.isRetryable) {
          throw oauthError;
        }

        // Don't retry on the last attempt
        if (attempt >= this.config.maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        let delay =
          oauthError.retryAfterMs ||
          Math.min(
            this.config.baseDelayMs *
              Math.pow(this.config.backoffMultiplier, attempt - 1),
            this.config.maxDelayMs,
          );

        if (this.config.jitter) {
          delay = delay * (0.5 + Math.random() * 0.5); // 50-100% of calculated delay
        }

        console.debug(
          `${provider} operation failed (attempt ${attempt}/${this.config.maxAttempts}), retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    throw (
      lastError ||
      OAuthErrorFactory.fromUnknown(
        provider,
        new Error('Max retries exceeded'),
        context,
      )
    );
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Graceful error handler for OAuth operations
 */
export class GracefulErrorHandler {
  constructor(private retryHandler: RetryHandler = new RetryHandler()) {}

  /**
   * Handles errors gracefully, providing fallback behavior when possible
   */
  async handleGracefully<T>(
    operation: () => Promise<T>,
    fallback: T | (() => T | Promise<T>),
    provider: string,
    context?: string,
  ): Promise<T> {
    try {
      return await this.retryHandler.executeWithRetry(
        operation,
        provider,
        context,
      );
    } catch (error) {
      const oauthError =
        error instanceof OAuthError
          ? error
          : OAuthErrorFactory.fromUnknown(provider, error, context);

      // Log the error for debugging
      console.debug(
        'OAuth operation failed gracefully:',
        oauthError.toLogEntry(),
      );

      // Critical errors should not be handled gracefully
      if (oauthError.category === OAuthErrorCategory.CRITICAL) {
        throw oauthError;
      }

      // Return fallback for non-critical errors
      if (typeof fallback === 'function') {
        return await (fallback as () => T | Promise<T>)();
      }
      return fallback;
    }
  }

  /**
   * Wraps a method to handle errors gracefully with logging
   */
  wrapMethod<TArgs extends unknown[], TReturn>(
    method: (...args: TArgs) => Promise<TReturn>,
    provider: string,
    methodName: string,
    fallback?: TReturn | ((...args: TArgs) => TReturn | Promise<TReturn>),
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs): Promise<TReturn> => {
      try {
        return await this.retryHandler.executeWithRetry(
          () => method(...args),
          provider,
          methodName,
        );
      } catch (error) {
        const oauthError =
          error instanceof OAuthError
            ? error
            : OAuthErrorFactory.fromUnknown(provider, error, methodName);

        // Always show user-friendly error message for user-actionable errors
        if (oauthError.category === OAuthErrorCategory.USER_ACTION_REQUIRED) {
          console.error(oauthError.userMessage);
          if (oauthError.actionRequired) {
            console.error(`Action required: ${oauthError.actionRequired}`);
          }
        }

        // Log technical details for debugging
        console.debug(
          `${provider}.${methodName} failed:`,
          oauthError.toLogEntry(),
        );

        // Use fallback if provided and error is not critical
        if (
          fallback !== undefined &&
          oauthError.category !== OAuthErrorCategory.CRITICAL
        ) {
          if (typeof fallback === 'function') {
            return await (
              fallback as (...args: TArgs) => TReturn | Promise<TReturn>
            )(...args);
          }
          return fallback;
        }

        throw oauthError;
      }
    };
  }
}
