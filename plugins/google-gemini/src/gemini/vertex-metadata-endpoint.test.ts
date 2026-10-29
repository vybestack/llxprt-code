/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Compute } from 'google-auth-library';
import { selectGoogleCredentialClient } from './vertexCredentialSource.js';

describe('Vertex metadata endpoint selection', () => {
  it.each([
    { reachable: 'metadata.google.internal.', metadataHost: undefined },
    { reachable: '169.254.169.254', metadataHost: undefined },
    {
      reachable: 'metadata.example.invalid',
      metadataHost: 'metadata.example.invalid',
    },
  ])(
    'keeps token and identity requests on $reachable',
    async ({ reachable, metadataHost }) => {
      const requests: URL[] = [];
      const client = await selectGoogleCredentialClient({
        environment: { metadataDetection: 'ping-only', metadataHost },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          requests.push(url);
          if (url.hostname !== reachable) {
            throw Object.assign(new Error('Unreachable metadata address'), {
              code: 'EHOSTUNREACH',
            });
          }
          const headers = { 'Metadata-Flavor': 'Google' };
          if (url.pathname.endsWith('/token'))
            return Response.json(
              {
                access_token: 'metadata-token',
                expires_in: 3600,
                token_type: 'Bearer',
              },
              { headers },
            );
          if (url.pathname.endsWith('/identity'))
            return new Response('metadata-identity', { headers });
          return new Response('instance', { headers });
        },
      });
      if (!(client instanceof Compute))
        throw new Error('Expected metadata client');
      await client.getAccessToken();
      await client.fetchIdToken('https://service.example.invalid');
      const credentialRequests = requests.filter((url) =>
        /\/(token|identity)$/.test(url.pathname),
      );
      expect(credentialRequests.map((url) => url.hostname)).toStrictEqual([
        reachable,
        reachable,
      ]);
      expect(credentialRequests[0].searchParams.get('scopes')).toBe(
        'https://www.googleapis.com/auth/cloud-platform',
      );
      expect(credentialRequests[1].searchParams.get('audience')).toBe(
        'https://service.example.invalid',
      );
      expect(credentialRequests[1].searchParams.get('format')).toBe('full');
    },
  );
});
