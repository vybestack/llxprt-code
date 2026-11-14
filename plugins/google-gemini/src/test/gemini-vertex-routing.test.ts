/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { withFetchPreconnect } from '../../../../packages/test-utils/src/fetch-test-helpers.js';
import { createGeminiApiClient } from '../gemini/geminiApiClientFactory.js';

describe('Gemini Vertex request routing', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([false, true])(
    'uses Vertex credentials and streamed contents for streaming=%s',
    async (streaming) => {
      const requests: Array<{ url: URL; headers: Headers; body: unknown }> = [];
      globalThis.fetch = withFetchPreconnect(
        async (input, init): Promise<Response> => {
          if (new URL(String(input)).hostname === 'oauth2.googleapis.com') {
            return Response.json({
              access_token: 'vertex-access-token',
              expires_in: 3600,
              token_type: 'Bearer',
            });
          }
          requests.push({
            url: new URL(String(input)),
            headers: new Headers(init?.headers),
            body: JSON.parse(await new Response(init?.body).text()),
          });
          const response = {
            candidates: [
              {
                content: { role: 'model', parts: [{ text: 'vertex reply' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 2,
              totalTokenCount: 3,
            },
          };
          return streaming
            ? new Response(`data: ${JSON.stringify(response)}\n\n`, {
                headers: { 'content-type': 'text/event-stream' },
              })
            : Response.json(response);
        },
      );
      const client = await createGeminiApiClient({
        fetch: globalThis.fetch,
        vertexai: true,
        project: 'configured-project',
        location: 'us-central1',
        apiKey: 'USE_VERTEX_AI',
        credentialEnvironment: {},
        credentials: {
          type: 'authorized_user',
          client_id: 'vertex-client',
          client_secret: 'vertex-secret',
          refresh_token: 'vertex-refresh',
          quota_project_id: 'billing-project',
        },
        requestContents: async function* () {
          yield { role: 'user', parts: [{ text: 'disk-backed question' }] };
        },
      });
      const params = { model: 'gemini-2.5-flash', contents: [] };
      if (streaming) {
        const chunks = await client.models.generateContentStream(params);
        const text: string[] = [];
        for await (const chunk of chunks)
          for (const candidate of chunk.candidates ?? [])
            for (const part of candidate.content?.parts ?? [])
              if (part.text) text.push(part.text);
        expect(text.join('')).toBe('vertex reply');
      } else {
        const response = await client.models.generateContent(params);
        expect(response.candidates?.[0]?.content?.parts?.[0]?.text).toBe(
          'vertex reply',
        );
      }
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request.url.hostname).toBe(
        'us-central1-aiplatform.googleapis.com',
      );
      expect(request.url.pathname).toContain(
        '/projects/configured-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:',
      );
      expect(request.headers.get('authorization')).toBe(
        'Bearer vertex-access-token',
      );
      expect(request.headers.get('x-goog-api-key')).toBeNull();
      expect(request.headers.get('x-goog-user-project')).toBe(
        'billing-project',
      );
      expect(request.body).toMatchObject({
        contents: [{ role: 'user', parts: [{ text: 'disk-backed question' }] }],
      });
    },
  );
});
