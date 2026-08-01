/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Handshake helpers for the credential proxy server: version negotiation
 * and capability-token validation.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-006, REQ-015
 * @pseudocode 002-frame-and-cancel.md lines 67-76
 */

import * as crypto from 'node:crypto';

/**
 * Computes the negotiated protocol version from the client's advertised
 * range. The server supports versions [1..serverProtocolVersion]. If the
 * client's range [minVersion..maxVersion] overlaps the server's supported
 * range, the negotiated version is the highest version both can speak.
 * Returns undefined if there is no overlap.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-006
 * @pseudocode 002-frame-and-cancel.md lines 67-76
 */
export function computeNegotiatedVersion(
  frame: Record<string, unknown>,
  serverProtocolVersion: number,
): number | undefined {
  const payload = frame.payload as Record<string, unknown> | undefined;
  const min = payload?.minVersion as number | undefined;
  const max = payload?.maxVersion as number | undefined;

  if (min !== undefined && max !== undefined) {
    const serverMin = 1;
    if (max >= serverMin && min <= serverProtocolVersion) {
      return Math.min(serverProtocolVersion, max);
    }
    return undefined;
  }

  const v = frame.v as number | undefined;
  if (v !== undefined && v >= 1 && v <= serverProtocolVersion) return v;
  return undefined;
}

/**
 * Constant-time comparison of the presented capability token against the
 * expected value. Both values are SHA-256 hashed first so the comparison
 * buffers are always the same length, eliminating timing side-channels.
 *
 * @plan PLAN-20250214-CREDPROXY.P15
 * @requirement REQ-015
 */
export function validateCapabilityToken(
  presentedToken: string,
  expectedTokenHash: Buffer,
): boolean {
  const presentedHash = crypto
    .createHash('sha256')
    .update(presentedToken)
    .digest();
  return crypto.timingSafeEqual(presentedHash, expectedTokenHash);
}
