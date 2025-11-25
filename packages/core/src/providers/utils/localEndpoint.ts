/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20251125-LOCALAUTH.P01
 * @requirement REQ-LOCAL-001
 *
 * Utility to detect local/private network endpoints that don't require authentication.
 * Used to fix Issue #598 where Ollama and other local AI servers were incorrectly
 * requiring authentication.
 */

/**
 * Checks if a URL points to a local or private network endpoint.
 *
 * Local endpoints include:
 * - localhost
 * - 127.0.0.0/8 (IPv4 loopback range - 127.0.0.0 - 127.255.255.255)
 * - [::1] (IPv6 loopback)
 * - Private IP ranges (RFC 1918):
 *   - 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
 *   - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
 *   - 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
 *
 * @param url - The URL to check (can be undefined or empty)
 * @returns true if the URL points to a local/private endpoint, false otherwise
 */
export function isLocalEndpoint(url: string | undefined): boolean {
  if (!url || url.trim() === '') {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Check for localhost
    if (hostname === 'localhost') {
      return true;
    }

    // Check for IPv4 loopback range (127.0.0.0/8)
    // The entire 127.x.x.x range is reserved for loopback
    if (isIPv4LoopbackRange(hostname)) {
      return true;
    }

    // Check for IPv6 loopback (::1)
    // URL parser represents [::1] as just ::1 in hostname
    if (hostname === '::1' || hostname === '[::1]') {
      return true;
    }

    // Check for private IP ranges
    if (isPrivateIPv4(hostname)) {
      return true;
    }

    return false;
  } catch {
    // Invalid URL
    return false;
  }
}

/**
 * Checks if an IPv4 address is in the loopback range (127.0.0.0/8).
 * The entire 127.x.x.x range is reserved for loopback (RFC 1122).
 */
function isIPv4LoopbackRange(ip: string): boolean {
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const firstOctet = Number(ipv4Match[1]);
  return firstOctet === 127;
}

/**
 * Checks if an IPv4 address is in a private range.
 *
 * Private ranges (RFC 1918):
 * - 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
 * - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
 * - 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
 */
function isPrivateIPv4(ip: string): boolean {
  // Match IPv4 pattern
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map(Number);

  // Validate octets are in valid range
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;

  // 10.0.0.0/8
  if (first === 10) {
    return true;
  }

  // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  // 192.168.0.0/16
  if (first === 192 && second === 168) {
    return true;
  }

  return false;
}
