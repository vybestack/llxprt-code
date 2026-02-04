/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseAndFormatApiError } from './errorParsing.js';
import { isProQuotaExceededError } from './quotaErrorDetection.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { UserTierId } from '../code_assist/types.js';
import { StructuredError } from '../core/turn.js';
import { STREAM_INTERRUPTED_ERROR_CODE } from './retry.js';

describe('parseAndFormatApiError', () => {
  it('should format a valid API error JSON', () => {
    const errorMessage =
      'got status: 400 Bad Request. {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}';
    const expected =
      '[API Error: API key not valid. Please pass a valid API key. (Status: 400, INVALID_ARGUMENT)]';
    expect(parseAndFormatApiError(errorMessage)).toBe(expected);
  });

  it('should format a 429 API error with the default message', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Rate limit exceeded","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      undefined,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      '[API Error: Rate limit exceeded (Status: 429, RESOURCE_EXHAUSTED)]',
    );
    expect(result).toContain(
      'Possible quota limitations in place or slow response times detected. Switching to the gemini-2.5-flash model',
    );
  });

  it('should format a 429 API error with the personal message', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Rate limit exceeded","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      undefined,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      '[API Error: Rate limit exceeded (Status: 429, RESOURCE_EXHAUSTED)]',
    );
    expect(result).toContain(
      'Possible quota limitations in place or slow response times detected. Switching to the gemini-2.5-flash model',
    );
  });

  it('should format a 429 API error with the vertex message', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Rate limit exceeded","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(errorMessage);
    expect(result).toContain(
      '[API Error: Rate limit exceeded (Status: 429, RESOURCE_EXHAUSTED)]',
    );
    expect(result).toContain(
      'Possible quota limitations in place or slow response times detected. Switching to the gemini-2.5-flash model',
    );
  });

  it('should return the original message if it is not a JSON error', () => {
    const errorMessage = 'This is a plain old error message';
    expect(parseAndFormatApiError(errorMessage)).toBe(
      `[API Error: ${errorMessage}]`,
    );
  });

  it('should return the original message for malformed JSON', () => {
    const errorMessage = '[Stream Error: {"error": "malformed}';
    expect(parseAndFormatApiError(errorMessage)).toBe(
      `[API Error: ${errorMessage}]`,
    );
  });

  it('should handle JSON that does not match the ApiError structure', () => {
    const errorMessage = '[Stream Error: {"not_an_error": "some other json"}]';
    expect(parseAndFormatApiError(errorMessage)).toBe(
      `[API Error: ${errorMessage}]`,
    );
  });

  it('should format a nested API error', () => {
    const nestedErrorMessage = JSON.stringify({
      error: {
        code: 429,
        message:
          "Gemini 2.5 Pro Preview doesn't have a free quota tier. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.",
        status: 'RESOURCE_EXHAUSTED',
      },
    });

    const errorMessage = JSON.stringify({
      error: {
        code: 429,
        message: nestedErrorMessage,
        status: 'Too Many Requests',
      },
    });

    const result = parseAndFormatApiError(errorMessage);
    expect(result).toContain('Gemini 2.5 Pro Preview');
    expect(result).toContain('Switching to the gemini-2.5-flash model');
  });

  it('should format a StructuredError', () => {
    const error: StructuredError = {
      message: 'A structured error occurred',
      status: 500,
    };
    const expected = '[API Error: A structured error occurred (Status: 500)]';
    expect(parseAndFormatApiError(error)).toBe(expected);
  });

  it('should format a 429 StructuredError with the vertex message', () => {
    const error: StructuredError = {
      message: 'Rate limit exceeded',
      status: 429,
    };
    const result = parseAndFormatApiError(error);
    expect(result).toContain('[API Error: Rate limit exceeded (Status: 429)]');
    expect(result).toContain(
      'Possible quota limitations in place or slow response times detected. Switching to the gemini-2.5-flash model',
    );
  });

  it('should handle an unknown error type', () => {
    const error = 12345;
    const expected = '[API Error: An unknown error occurred.]';
    expect(parseAndFormatApiError(error)).toBe(expected);
  });

  it('should include status for unknown error types when available', () => {
    const error = { status: 503 };
    const expected = '[API Error: An unknown error occurred. (Status: 503)]';
    expect(parseAndFormatApiError(error)).toBe(expected);
  });

  it('should format stream interruption errors distinctly', () => {
    const error = new Error(
      'Streaming parse error while reading model output.',
    );
    (error as { code?: string }).code = STREAM_INTERRUPTED_ERROR_CODE;
    const result = parseAndFormatApiError(error);
    expect(result).toContain(
      '[API Error: Streaming parse error while reading model output. (Status: STREAM_INTERRUPTED)]',
    );
    expect(result).toContain(
      'Streaming data from the provider became invalid before the response completed.',
    );
  });

  it('should format a 429 API error with Pro quota exceeded message for Google auth (Free tier)', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric \'Gemini 2.5 Pro Requests\' and limit \'RequestsPerDay\' of service \'generativelanguage.googleapis.com\' for consumer \'project_number:123456789\'.","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      undefined,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      "[API Error: Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'",
    );
    expect(result).toContain(
      'You have reached your daily gemini-2.5-pro quota limit',
    );
    expect(result).toContain(
      'For more information about authentication and quota limits, see',
    );
  });

  it('should format a regular 429 API error with standard message for Google auth', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Rate limit exceeded","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      undefined,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      '[API Error: Rate limit exceeded (Status: 429, RESOURCE_EXHAUSTED)]',
    );
    expect(result).toContain(
      'Possible quota limitations in place or slow response times detected. Switching to the gemini-2.5-flash model',
    );
    expect(result).not.toContain(
      'You have reached your daily gemini-2.5-pro quota limit',
    );
  });

  it('should format a 429 API error with generic quota exceeded message for Google auth', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric \'GenerationRequests\' and limit \'RequestsPerDay\' of service \'generativelanguage.googleapis.com\' for consumer \'project_number:123456789\'.","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      undefined,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      "[API Error: Quota exceeded for quota metric 'GenerationRequests'",
    );
    expect(result).toContain('You have reached your daily quota limit');
    expect(result).not.toContain(
      'You have reached your daily Gemini 2.5 Pro quota limit',
    );
  });

  it('should prioritize Pro quota message over generic quota message for Google auth', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric \'Gemini 2.5 Pro Requests\' and limit \'RequestsPerDay\' of service \'generativelanguage.googleapis.com\' for consumer \'project_number:123456789\'.","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      undefined,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      "[API Error: Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'",
    );
    expect(result).toContain(
      'You have reached your daily gemini-2.5-pro quota limit',
    );
    expect(result).not.toContain('You have reached your daily quota limit');
  });

  it('should format a 429 API error with Pro quota exceeded message for Google auth (Standard tier)', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric \'Gemini 2.5 Pro Requests\' and limit \'RequestsPerDay\' of service \'generativelanguage.googleapis.com\' for consumer \'project_number:123456789\'.","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      UserTierId.STANDARD,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      "[API Error: Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'",
    );
    expect(result).toContain(
      'You have reached your daily gemini-2.5-pro quota limit',
    );
    expect(result).toContain(
      'We appreciate you for choosing Gemini Code Assist and the Gemini CLI',
    );
    expect(result).not.toContain(
      'upgrade to a Gemini Code Assist Standard or Enterprise plan',
    );
  });

  it('should format a 429 API error with Pro quota exceeded message for Google auth', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric \'Gemini 2.5 Pro Requests\' and limit \'RequestsPerDay\' of service \'generativelanguage.googleapis.com\' for consumer \'project_number:123456789\'.","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      undefined,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      "[API Error: Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'",
    );
    expect(result).toContain(
      'You have reached your daily gemini-2.5-pro quota limit',
    );
    expect(result).not.toContain(
      'We appreciate you for choosing Gemini Code Assist and the Gemini CLI',
    );
    expect(result).not.toContain(
      'upgrade to a Gemini Code Assist Standard or Enterprise plan',
    );
  });

  it('should handle different Gemini 2.5 version strings in Pro quota exceeded errors', () => {
    const errorMessage25 =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric \'Gemini 2.5 Pro Requests\' and limit \'RequestsPerDay\' of service \'generativelanguage.googleapis.com\' for consumer \'project_number:123456789\'.","status":"RESOURCE_EXHAUSTED"}}';
    const errorMessagePreview =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric \'Gemini 2.5-preview Pro Requests\' and limit \'RequestsPerDay\' of service \'generativelanguage.googleapis.com\' for consumer \'project_number:123456789\'.","status":"RESOURCE_EXHAUSTED"}}';

    const result25 = parseAndFormatApiError(
      errorMessage25,
      undefined,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    const resultPreview = parseAndFormatApiError(
      errorMessagePreview,
      undefined,
      'gemini-2.5-preview-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );

    expect(result25).toContain(
      'You have reached your daily gemini-2.5-pro quota limit',
    );
    expect(resultPreview).toContain(
      'You have reached your daily gemini-2.5-preview-pro quota limit',
    );
    expect(result25).toContain(
      'For more information about authentication and quota limits, see',
    );
    expect(resultPreview).toContain(
      'For more information about authentication and quota limits, see',
    );
  });

  it('should not match non-Pro models with similar version strings', () => {
    // Test that Flash models with similar version strings don't match
    expect(
      isProQuotaExceededError(
        "Quota exceeded for quota metric 'Gemini 2.5 Flash Requests' and limit",
      ),
    ).toBe(false);
    expect(
      isProQuotaExceededError(
        "Quota exceeded for quota metric 'Gemini 2.5-preview Flash Requests' and limit",
      ),
    ).toBe(false);

    // Test other model types
    expect(
      isProQuotaExceededError(
        "Quota exceeded for quota metric 'Gemini 2.5 Ultra Requests' and limit",
      ),
    ).toBe(false);
    expect(
      isProQuotaExceededError(
        "Quota exceeded for quota metric 'Gemini 2.5 Standard Requests' and limit",
      ),
    ).toBe(false);

    // Test generic quota messages
    expect(
      isProQuotaExceededError(
        "Quota exceeded for quota metric 'GenerationRequests' and limit",
      ),
    ).toBe(false);
    expect(
      isProQuotaExceededError(
        "Quota exceeded for quota metric 'EmbeddingRequests' and limit",
      ),
    ).toBe(false);
  });

  it('should format a generic quota exceeded message for Google auth (Standard tier)', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric \'GenerationRequests\' and limit \'RequestsPerDay\' of service \'generativelanguage.googleapis.com\' for consumer \'project_number:123456789\'.","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      UserTierId.STANDARD,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      "[API Error: Quota exceeded for quota metric 'GenerationRequests'",
    );
    expect(result).toContain('You have reached your daily quota limit');
    expect(result).toContain(
      'We appreciate you for choosing Gemini Code Assist and the Gemini CLI',
    );
    expect(result).not.toContain(
      'upgrade to a Gemini Code Assist Standard or Enterprise plan',
    );
  });

  it('should format a regular 429 API error with standard message for Google auth (Standard tier)', () => {
    const errorMessage =
      'got status: 429 Too Many Requests. {"error":{"code":429,"message":"Rate limit exceeded","status":"RESOURCE_EXHAUSTED"}}';
    const result = parseAndFormatApiError(
      errorMessage,
      UserTierId.STANDARD,
      'gemini-2.5-pro',
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(result).toContain(
      '[API Error: Rate limit exceeded (Status: 429, RESOURCE_EXHAUSTED)]',
    );
    expect(result).toContain(
      'We appreciate you for choosing Gemini Code Assist and the Gemini CLI',
    );
    expect(result).not.toContain(
      'upgrade to a Gemini Code Assist Standard or Enterprise plan',
    );
  });
});
