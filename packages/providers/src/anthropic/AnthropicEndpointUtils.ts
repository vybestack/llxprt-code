/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Determines whether a base URL points to the native Anthropic API
 * (anthropic.com or a subdomain thereof, e.g. api.anthropic.com).
 *
 * Returns `true` for an undefined/empty base URL (the default endpoint is
 * Anthropic). Returns `false` for third-party Anthropic-compatible endpoints
 * such as z.ai, suffix-spoofing hosts, and malformed URLs.
 *
 * Note: the bare apex domain `anthropic.com` (the marketing site) also
 * matches. This is intentional for backwards compatibility — OAuth
 * credentials are scoped to the Anthropic account, not a specific subdomain.
 *
 * Used by OAuth eligibility gating (#2411) and prompt-cache format gating
 * (#2410): third-party endpoints reject the Anthropic cache_control array
 * format and must not receive OAuth handshakes.
 */
export function isAnthropicOAuthBaseURL(baseURL?: string): boolean {
  if (baseURL === undefined || baseURL.trim() === '') {
    return true;
  }
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === 'anthropic.com' || host.endsWith('.anthropic.com');
  } catch {
    return false;
  }
}
