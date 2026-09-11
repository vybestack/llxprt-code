/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeBaseUrl } from './codexBaseUrl.js';

/** Loopback profiles use the deployed MLX image dialect. */
export function isLocalImageEndpoint(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.startsWith('127.')
  );
}

export class ImageBackendBaseUrlError extends Error {
  readonly profileName: string;
  readonly baseUrl: string;

  constructor(profileName: string, baseUrl: string) {
    super(`Image profile '${profileName}' has an invalid base URL: ${baseUrl}`);
    this.name = 'ImageBackendBaseUrlError';
    this.profileName = profileName;
    this.baseUrl = baseUrl;
  }
}

/** Reject profile destinations before OAuth credentials are resolved. */
export function validateCodexImageProfileBaseUrl(
  baseUrl: string,
  profileName = '<active>',
): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ImageBackendBaseUrlError(profileName, baseUrl);
  }
  if (normalizeBaseUrl(url.href) !== 'https://chatgpt.com/backend-api/codex') {
    throw new ImageBackendBaseUrlError(profileName, baseUrl);
  }
}
