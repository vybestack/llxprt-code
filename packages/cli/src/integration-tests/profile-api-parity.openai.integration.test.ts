/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  PAIR_CASE_TIMEOUT_MS,
  credential,
  expectCredentialIdentity,
  installParityFixture,
  openaiParity,
  parityDescription,
  probeCredential,
  registerApiProviderCases,
} from './profile-parity-harness.js';

describe(`${parityDescription}: openai API credentials`, () => {
  const fixture = installParityFixture();
  registerApiProviderCases(fixture, openaiParity);

  it(
    'rejects a wrong synthetic credential at the identity oracle without raw-token observations',
    async () => {
      const pair = await fixture.runPair({
        provider: openaiParity.provider,
        model: openaiParity.model,
        ephemeralSettings: { 'auth-key': probeCredential },
      });
      for (const result of pair) {
        expect(result.exitCode).toBe(0);
        expect(result.requests.length).toBeGreaterThan(0);
        for (const request of result.requests) {
          expectCredentialIdentity(request.credentialHash, probeCredential);
          expect(() =>
            expectCredentialIdentity(request.credentialHash, credential),
          ).toThrow('expect(received).toBe(expected)');
        }
        expect(JSON.stringify(result)).not.toContain(probeCredential);
      }
    },
    PAIR_CASE_TIMEOUT_MS,
  );
});
