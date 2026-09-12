/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isIP } from 'node:net';
import { normalizeBaseUrl } from './codexBaseUrl.js';

/** Loopback profiles use the deployed MLX image dialect. */
export function isLocalImageEndpoint(baseUrl: string): boolean {
  if (!URL.canParse(baseUrl)) return false;
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  const ipv4Loopback = isIP(hostname) === 4 && hostname.startsWith('127.');
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    ipv4Loopback
  );
}

export class ImageBackendBaseUrlError extends Error {
  readonly profileName: string;
  readonly baseUrl: string;

  constructor(profileName: string, baseUrl: string, options?: ErrorOptions) {
    const parsed = URL.canParse(baseUrl) ? new URL(baseUrl) : undefined;
    const safeUrl = parsed
      ? `${parsed.origin}${parsed.pathname}`
      : '<invalid URL>';
    super(
      `Image profile '${profileName}' has an invalid base URL: ${safeUrl}`,
      options,
    );
    this.name = 'ImageBackendBaseUrlError';
    this.profileName = profileName;
    this.baseUrl = safeUrl;
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
  } catch (cause) {
    throw new ImageBackendBaseUrlError(profileName, baseUrl, { cause });
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    normalizeBaseUrl(url.href) !==
      normalizeBaseUrl('https://chatgpt.com/backend-api/codex')
  ) {
    throw new ImageBackendBaseUrlError(profileName, baseUrl);
  }
}
