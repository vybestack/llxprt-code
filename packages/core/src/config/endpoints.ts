/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Endpoint validation utilities for provider authentication
 */

/**
 * Known Qwen endpoints that support Qwen OAuth
 */
export const QWEN_ENDPOINTS = [
  'https://dashscope.aliyuncs.com',
  'https://api.qwen.com',
  'https://portal.qwen.ai',
  // Add more Qwen endpoints as needed
] as const;

/**
 * Known OpenAI endpoints
 */
export const OPENAI_ENDPOINTS = [
  'https://api.openai.com/v1',
  'https://api.openai.com',
] as const;

export interface EndpointValidationResult {
  isQwenEndpoint: boolean;
  isOpenAIEndpoint: boolean;
  supportsQwenOAuth: boolean;
  normalizedBaseURL: string;
}

/**
 * Validates and categorizes an endpoint URL
 * @param baseURL The base URL to validate
 * @returns Endpoint validation information
 */
export function validateEndpoint(baseURL: string): EndpointValidationResult {
  // Normalize the URL by removing trailing slashes and ensuring proper format
  const normalizedBaseURL = normalizeBaseURL(baseURL);

  // Check if it's a Qwen endpoint - ensure exact domain match
  const isQwenEndpoint = QWEN_ENDPOINTS.some((endpoint) => {
    const normalizedEndpoint = normalizeBaseURL(endpoint);
    return (
      normalizedBaseURL === normalizedEndpoint ||
      normalizedBaseURL.startsWith(normalizedEndpoint + '/')
    );
  });

  // Check if it's an OpenAI endpoint - ensure exact domain match
  const isOpenAIEndpoint = OPENAI_ENDPOINTS.some((endpoint) => {
    const normalizedEndpoint = normalizeBaseURL(endpoint);
    return (
      normalizedBaseURL === normalizedEndpoint ||
      normalizedBaseURL.startsWith(normalizedEndpoint + '/')
    );
  });

  // Qwen endpoints support Qwen OAuth
  const supportsQwenOAuth = isQwenEndpoint;

  return {
    isQwenEndpoint,
    isOpenAIEndpoint,
    supportsQwenOAuth,
    normalizedBaseURL,
  };
}

/**
 * Checks if a base URL is a Qwen endpoint that supports Qwen OAuth
 * @param baseURL The base URL to check
 * @returns true if the endpoint supports Qwen OAuth
 */
export function isQwenEndpoint(baseURL: string): boolean {
  return validateEndpoint(baseURL).isQwenEndpoint;
}

/**
 * Checks if a base URL is an OpenAI endpoint
 * @param baseURL The base URL to check
 * @returns true if the endpoint is an OpenAI endpoint
 */
export function isOpenAIEndpoint(baseURL: string): boolean {
  return validateEndpoint(baseURL).isOpenAIEndpoint;
}

/**
 * Determines if Qwen OAuth should be used for a given endpoint
 * @param baseURL The base URL to check
 * @param isOAuthEnabled Whether OAuth is enabled in configuration
 * @returns true if Qwen OAuth should be used
 */
export function shouldUseQwenOAuth(
  baseURL: string,
  isOAuthEnabled: boolean,
): boolean {
  if (!isOAuthEnabled) {
    return false;
  }

  const validation = validateEndpoint(baseURL);
  return validation.supportsQwenOAuth;
}

/**
 * Normalizes a base URL by removing trailing slashes and ensuring proper format
 * @param baseURL The base URL to normalize
 * @returns Normalized base URL
 */
function normalizeBaseURL(baseURL: string): string {
  if (!baseURL) {
    return '';
  }

  // Remove trailing slashes
  return baseURL.replace(/\/+$/, '');
}

/**
 * Generates a helpful error message for OAuth endpoint mismatches
 * @param baseURL The base URL that doesn't support the requested OAuth
 * @param oauthProvider The OAuth provider that was requested
 * @returns Helpful error message
 */
export function generateOAuthEndpointMismatchError(
  baseURL: string,
  oauthProvider: string,
): string {
  const validation = validateEndpoint(baseURL);

  if (oauthProvider === 'qwen' && !validation.supportsQwenOAuth) {
    if (validation.isOpenAIEndpoint) {
      return `Qwen OAuth is enabled but baseURL (${baseURL}) is an OpenAI endpoint that doesn't support Qwen OAuth. Either use an API key for OpenAI, or change the baseURL to a Qwen endpoint like ${QWEN_ENDPOINTS[0]}.`;
    } else {
      return `Qwen OAuth is enabled but baseURL (${baseURL}) is not a Qwen endpoint. Either use an API key, or change the baseURL to a Qwen endpoint like ${QWEN_ENDPOINTS[0]}.`;
    }
  }

  return `OAuth provider '${oauthProvider}' is not supported for endpoint ${baseURL}. Please use appropriate authentication for this endpoint.`;
}

/**
 * Gets suggested endpoints for a given OAuth provider
 * @param oauthProvider The OAuth provider
 * @returns Array of suggested endpoints
 */
export function getSuggestedEndpoints(oauthProvider: string): string[] {
  switch (oauthProvider) {
    case 'qwen':
      return [...QWEN_ENDPOINTS];
    default:
      return [];
  }
}
