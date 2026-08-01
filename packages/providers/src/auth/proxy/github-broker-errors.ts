/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error translation and message redaction for the GitHub broker.
 *
 * GitHub failures arrive in three different shapes. All three must become a
 * structured response; none may leak a credential.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-001, REQ-004
 * @pseudocode 003-github-broker.md lines 67-95
 */

/**
 * Structured error codes emitted by the broker.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 67-95
 */
export type BrokerErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'HOST_AUTH_REQUIRED'
  | 'HOST_GH_UNAVAILABLE'
  | 'GITHUB_ERROR'
  | 'INVALID_PARAM'
  | 'UNKNOWN_OP'
  | 'INVALID_REQUEST';

/**
 * Maps a GraphQL error `type` string to a structured broker error code.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 67-74
 */
export function mapGraphQLErrorType(type: string | undefined): BrokerErrorCode {
  switch (type) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'FORBIDDEN':
      return 'PERMISSION_DENIED';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    // GraphQL reports UNAUTHORIZED when the credential is missing or
    // invalid. Letting it fall through to GITHUB_ERROR told the caller
    // "something went wrong" when the actionable answer is "run gh auth
    // login on the host" — the exact case HOST_AUTH_REQUIRED exists for.
    case 'UNAUTHORIZED':
      return 'HOST_AUTH_REQUIRED';
    default:
      return 'GITHUB_ERROR';
  }
}

/**
 * Classifies a gh CLI stderr string into a structured broker error code.
 *
 * This is defensive parsing of genuinely external input (gh stderr), which is
 * the documented exception to the repo's fail-fast preference.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 78-86
 */
export function classifyStderr(stderr: string): BrokerErrorCode {
  const lower = stderr.toLowerCase();
  if (
    lower.includes('rate limit') ||
    lower.includes('api rate limit exceeded')
  ) {
    return 'RATE_LIMITED';
  }
  if (lower.includes('could not resolve to a') || lower.includes('not found')) {
    return 'NOT_FOUND';
  }
  if (lower.includes('gh auth login') || lower.includes('authentication')) {
    return 'HOST_AUTH_REQUIRED';
  }
  if (lower.includes('http 403')) {
    return 'PERMISSION_DENIED';
  }
  return 'GITHUB_ERROR';
}

/**
 * Regex patterns matching token-shaped substrings that must be redacted
 * before any message leaves the broker.
 *
 * - `gh[pousr]_...`: classic GitHub personal access / OAuth / app tokens.
 * - `github_pat_...`: fine-grained personal access tokens.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-001
 * @pseudocode 003-github-broker.md lines 90-95
 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
];

/**
 * Redacts token-shaped substrings from an outbound message. This is
 * belt-and-braces — the broker never holds a token — but stderr comes from
 * an external process we do not control, which is exactly the case where
 * defensive handling is correct.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-001
 * @pseudocode 003-github-broker.md lines 90-95
 */
export function redactTokenShaped(message: string): string {
  let result = message;
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * A structured broker error that can be serialized into a response.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 67-95
 */
export interface BrokerError {
  code: BrokerErrorCode;
  message: string;
}

/**
 * Builds a redacted BrokerError from a raw message.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-001
 * @pseudocode 003-github-broker.md lines 90-95
 */
export function makeBrokerError(
  code: BrokerErrorCode,
  rawMessage: string,
): BrokerError {
  return { code, message: redactTokenShaped(rawMessage) };
}

/**
 * An Error carrying a structured BrokerError.
 *
 * Defined here rather than in github-broker.ts so every module that needs to
 * raise a structured failure throws the SAME class. A module-local
 * look-alike would not satisfy the dispatcher's `instanceof` check, and its
 * code would be silently downgraded to GITHUB_ERROR.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-002
 */
export class BrokerErrorException extends Error {
  readonly brokerError: BrokerError;
  constructor(brokerError: BrokerError) {
    super(brokerError.message);
    this.name = 'BrokerError';
    this.brokerError = brokerError;
  }
}

/**
 * Convenience for throwing a structured broker failure.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-002
 */
export function brokerError(
  code: BrokerErrorCode,
  message: string,
): BrokerErrorException {
  return new BrokerErrorException(makeBrokerError(code, message));
}
