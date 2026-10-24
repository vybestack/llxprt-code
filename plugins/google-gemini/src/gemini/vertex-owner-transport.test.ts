/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createOwnerTransport,
  type OwnerTransport,
  type RecordedRequest,
  type TransportKind,
} from '../test/vertexOwnerTransport.js';
import { createGeminiApiClient } from './geminiApiClientFactory.js';
import type {
  GeminiApiClientOptions,
  GoogleCredentialEnvironment,
  GoogleCredentialJson,
} from './geminiWireTypes.js';

const PARAMS = {
  model: 'gemini-2.5-flash',
  contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
};

let directory = '';
const transports: OwnerTransport[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'vertex-owner-transport-'));
});

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
  rmSync(directory, { recursive: true, force: true });
});

async function transportFor(root: string): Promise<OwnerTransport> {
  const transport = await createOwnerTransport(root);
  transports.push(transport);
  return transport;
}

function requestsOf(
  transport: OwnerTransport,
  kind: TransportKind,
): RecordedRequest[] {
  return transport.requests.filter((request) => request.kind === kind);
}

function writeJson(name: string, value: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function environment(
  overrides: Partial<GoogleCredentialEnvironment> = {},
): GoogleCredentialEnvironment {
  return { wellKnownFile: join(directory, 'absent.json'), ...overrides };
}

function serviceAccount(email: string): GoogleCredentialJson {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    type: 'service_account',
    client_email: email,
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    private_key_id: 'kid',
    project_id: 'sa-project',
  };
}

function authorizedUser(extra: Record<string, unknown> = {}): unknown {
  return {
    type: 'authorized_user',
    client_id: 'client-id',
    client_secret: 'client-secret',
    refresh_token: 'refresh-token',
    ...extra,
  };
}

function generate(
  transport: OwnerTransport,
  options: Partial<GeminiApiClientOptions>,
): Promise<unknown> {
  return createGeminiApiClient({
    vertexai: true,
    project: 'project',
    location: 'us-central1',
    fetch: transport.fetch,
    ...options,
  }).then((client) => client.models.generateContent(PARAMS));
}

function modelRequest(transport: OwnerTransport): RecordedRequest {
  const models = requestsOf(transport, 'model');
  expect(models).toHaveLength(1);
  return models[0];
}

describe('Vertex owner transport fixture', () => {
  it('answers each kind with its canned response under the right root', async () => {
    const a = await transportFor('a');
    const urls: Array<[TransportKind, string]> = [
      ['token', 'https://oauth2.googleapis.com/token'],
      ['token', 'https://www.googleapis.com/oauth2/v4/token'],
      ['metadata', 'http://169.254.169.254/computeMetadata/v1/instance'],
      ['metadata', 'http://metadata-a.invalid/computeMetadata/v1/instance'],
      ['sts', 'https://sts.googleapis.com/v1/token'],
      ['iam', 'https://iamcredentials.googleapis.com/v1/x:generateAccessToken'],
      ['model', 'https://us-central1-aiplatform.googleapis.com/v1/m'],
      ['subject', 'http://subject-a.invalid/subject'],
    ];
    for (const [, url] of urls) {
      const response = await a.fetch(url);
      expect(response.status).toBe(200);
    }
    expect(a.requests.map((request) => [request.kind, request.url])).toEqual(
      urls,
    );
  });

  it('throws for a host it does not route', async () => {
    const a = await transportFor('a');
    await expect(a.fetch('https://example.com/')).rejects.toThrow(
      'no route for example.com',
    );
    await expect(a.fetch('http://metadata-b.invalid/')).rejects.toThrow(
      'no route',
    );
    expect(a.requests).toHaveLength(0);
  });

  it('rejects later calls after close', async () => {
    const a = await transportFor('a');
    await a.close();
    await expect(
      a.fetch('https://oauth2.googleapis.com/token'),
    ).rejects.toThrow('Owner transport is closed');
  });
});

describe('Vertex credentials through the owner transport', () => {
  it('exchanges an explicit service account JWT on each root', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    await Promise.all([
      generate(a, {
        credentials: serviceAccount('sa-a@example.invalid'),
        credentialEnvironment: environment(),
      }),
      generate(b, {
        credentials: serviceAccount('sa-b@example.invalid'),
        credentialEnvironment: environment(),
      }),
    ]);
    for (const [transport, root] of [
      [a, 'a'],
      [b, 'b'],
    ] as const) {
      const exchanges = requestsOf(transport, 'token');
      expect(exchanges).toHaveLength(1);
      const assertion = new URLSearchParams(exchanges[0].body).get('assertion');
      const payload = JSON.parse(
        Buffer.from(String(assertion).split('.')[1], 'base64url').toString(),
      ) as { iss: string };
      expect(payload.iss).toBe(`sa-${root}@example.invalid`);
      expect(modelRequest(transport).headers['authorization']).toBe(
        `Bearer tok-${root}`,
      );
    }
  });

  it('refreshes an authorized_user file named by credentialsFile on each root', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    const credentialsFile = writeJson('user.json', authorizedUser());
    await Promise.all([
      generate(a, { credentialEnvironment: environment({ credentialsFile }) }),
      generate(b, { credentialEnvironment: environment({ credentialsFile }) }),
    ]);
    for (const [transport, root] of [
      [a, 'a'],
      [b, 'b'],
    ] as const) {
      const refreshes = requestsOf(transport, 'token');
      expect(refreshes).toHaveLength(1);
      expect(refreshes[0].url).toBe('https://oauth2.googleapis.com/token');
      expect(modelRequest(transport).headers['authorization']).toBe(
        `Bearer tok-${root}`,
      );
    }
  });

  it('reads the well-known file and applies the environment quota project only there', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    const wellKnownFile = writeJson('adc.json', authorizedUser());
    await Promise.all([
      generate(a, {
        credentialEnvironment: { wellKnownFile, quotaProject: 'quota-a' },
      }),
      generate(b, { credentialEnvironment: { wellKnownFile } }),
    ]);
    expect(requestsOf(a, 'token')).toHaveLength(1);
    expect(requestsOf(b, 'token')).toHaveLength(1);
    expect(modelRequest(a).headers['authorization']).toBe('Bearer tok-a');
    expect(modelRequest(a).headers['x-goog-user-project']).toBe('quota-a');
    expect(modelRequest(b).headers['x-goog-user-project']).toBeUndefined();
  });

  it('lets an explicit quota project header win in any letter case and uses the credential quota project otherwise', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    const wellKnownFile = writeJson('adc.json', authorizedUser());
    const quotaFile = writeJson(
      'quota.json',
      authorizedUser({ quota_project_id: 'file-quota-b' }),
    );
    await Promise.all([
      generate(a, {
        credentialEnvironment: { wellKnownFile, quotaProject: 'quota-a' },
        httpOptions: { headers: { 'X-Goog-User-Project': 'explicit-a' } },
      }),
      generate(b, {
        credentialEnvironment: environment({ credentialsFile: quotaFile }),
      }),
    ]);
    expect(modelRequest(a).headers['x-goog-user-project']).toBe('explicit-a');
    expect(modelRequest(b).headers['x-goog-user-project']).toBe('file-quota-b');
  });

  it('impersonates through a source client on the same transport', async () => {
    const a = await transportFor('a');
    const credentialsFile = writeJson('impersonated.json', {
      type: 'impersonated_service_account',
      service_account_impersonation_url:
        'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/target@example.invalid:generateAccessToken',
      source_credentials: authorizedUser(),
    });
    await generate(a, {
      credentialEnvironment: environment({ credentialsFile }),
    });
    expect(requestsOf(a, 'token')).toHaveLength(1);
    const impersonation = requestsOf(a, 'iam');
    expect(impersonation).toHaveLength(1);
    expect(impersonation[0].headers['authorization']).toBe('Bearer tok-a');
    expect(modelRequest(a).headers['authorization']).toBe('Bearer iam-a');
  });

  it('ends a held exchange when its owner closes without disturbing another owner', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    a.hold('token');
    const first = generate(a, {
      credentials: serviceAccount('sa-a@example.invalid'),
      credentialEnvironment: environment(),
    });
    const settled = first.then(
      () => 'resolved',
      () => 'rejected',
    );
    await a.waitForRequest('token');
    const second = generate(b, {
      credentials: serviceAccount('sa-b@example.invalid'),
      credentialEnvironment: environment(),
    });
    await a.close();
    expect(await settled).toBe('rejected');
    await second;
    expect(requestsOf(a, 'model')).toHaveLength(0);
    expect(modelRequest(b).headers['authorization']).toBe('Bearer tok-b');
  });

  it('names the file and keeps the parse error when a credentials file is not JSON', async () => {
    const a = await transportFor('a');
    const credentialsFile = join(directory, 'broken.json');
    writeFileSync(credentialsFile, '{ not json');
    const failure = await generate(a, {
      credentialEnvironment: environment({ credentialsFile }),
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(credentialsFile);
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError);
    expect(a.requests).toHaveLength(0);
  });

  it('rejects an unsupported credential type before any request', async () => {
    const a = await transportFor('a');
    const credentialsFile = writeJson('unknown.json', { type: 'unknown' });
    await expect(
      generate(a, { credentialEnvironment: environment({ credentialsFile }) }),
    ).rejects.toThrow('Unsupported Google credential type "unknown"');
    expect(a.requests).toHaveLength(0);
  });
});

const NO_ADC_FOUND =
  'Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.';
const INSTANCE_URL = 'computeMetadata/v1/instance';
const TOKEN_QUERY =
  'scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform';

function metadataEnvironment(
  root: string,
  overrides: Partial<GoogleCredentialEnvironment> = {},
): GoogleCredentialEnvironment {
  return environment({
    metadataHost: `metadata-${root}.invalid`,
    metadataDetection: 'ping-only',
    ...overrides,
  });
}

async function waitForRequestCount(
  transport: OwnerTransport,
  kind: TransportKind,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (requestsOf(transport, kind).length < count) {
    if (Date.now() > deadline) {
      throw new Error(`No ${String(count)} ${kind} requests were recorded`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function withResponder(
  transport: OwnerTransport,
  respond: (request: Request) => Promise<Response> | undefined,
): OwnerTransport['fetch'] {
  return (input, init) => {
    const request = new Request(input, init);
    return respond(request) ?? transport.fetch(request);
  };
}

describe('Vertex metadata credentials through the owner transport', () => {
  it('discovers the metadata server and fetches the token on each root', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    await Promise.all([
      generate(a, { credentialEnvironment: metadataEnvironment('a') }),
      generate(b, { credentialEnvironment: metadataEnvironment('b') }),
    ]);
    for (const [transport, root] of [
      [a, 'a'],
      [b, 'b'],
    ] as const) {
      const metadata = requestsOf(transport, 'metadata');
      expect(metadata.map((request) => [request.method, request.url])).toEqual([
        ['GET', `http://metadata-${root}.invalid/${INSTANCE_URL}`],
        [
          'GET',
          `http://metadata-${root}.invalid/${INSTANCE_URL}/service-accounts/default/token?${TOKEN_QUERY}`,
        ],
      ]);
      expect(metadata[0].headers['metadata-flavor']).toBe('Google');
      expect(metadata[1].headers['metadata-flavor']).toBe('Google');
      expect(modelRequest(transport).headers['authorization']).toBe(
        `Bearer meta-${root}`,
      );
      expect(
        transport.requests.filter((request) =>
          /169\.254\.169\.254|metadata\.google\.internal/.test(request.url),
        ),
      ).toHaveLength(0);
    }
  });

  it('ends a held discovery when its owner closes with the owner abort, not the missing-credentials error', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    a.hold('metadata');
    const first = failureOf(
      generate(a, { credentialEnvironment: metadataEnvironment('a') }),
    );
    await a.waitForRequest('metadata');
    const second = generate(b, {
      credentialEnvironment: metadataEnvironment('b'),
    });
    await a.close();
    const failure = await first;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Owner transport is closed');
    expect((failure as Error).message).not.toContain(NO_ADC_FOUND);
    await second;
    expect(requestsOf(a, 'metadata')).toHaveLength(1);
    expect(requestsOf(a, 'model')).toHaveLength(0);
    expect(modelRequest(b).headers['authorization']).toBe('Bearer meta-b');
  });

  it('ends a held metadata token request when its owner closes', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    const first = failureOf(
      generate(a, { credentialEnvironment: metadataEnvironment('a') }),
    );
    await a.waitForRequest('metadata');
    a.hold('metadata');
    await waitForRequestCount(a, 'metadata', 2);
    const second = generate(b, {
      credentialEnvironment: metadataEnvironment('b'),
    });
    await a.close();
    const failure = await first;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Owner transport is closed');
    await second;
    expect(requestsOf(a, 'model')).toHaveLength(0);
    expect(modelRequest(b).headers['authorization']).toBe('Bearer meta-b');
  });

  it('treats detection "none" as absent without any request', async () => {
    const a = await transportFor('a');
    const b = await transportFor('b');
    const failures = await Promise.all([
      failureOf(
        generate(a, {
          credentialEnvironment: metadataEnvironment('a', {
            metadataDetection: 'none',
          }),
        }),
      ),
      failureOf(
        generate(b, {
          credentialEnvironment: metadataEnvironment('b', {
            metadataDetection: 'none',
          }),
        }),
      ),
    ]);
    for (const failure of failures) {
      expect((failure as Error).message).toBe(NO_ADC_FOUND);
    }
    expect(a.requests).toHaveLength(0);
    expect(b.requests).toHaveLength(0);
  });

  it('rejects an unknown detection value before any request', async () => {
    const a = await transportFor('a');
    const failure = await failureOf(
      generate(a, {
        credentialEnvironment: metadataEnvironment('a', {
          metadataDetection: 'sometimes',
        }),
      }),
    );
    expect(failure).toBeInstanceOf(RangeError);
    expect((failure as Error).message).toContain('`sometimes`');
    expect(a.requests).toHaveLength(0);
  });

  it('skips discovery when detection is "assume-present"', async () => {
    const a = await transportFor('a');
    await generate(a, {
      credentialEnvironment: metadataEnvironment('a', {
        metadataDetection: 'assume-present',
      }),
    });
    const metadata = requestsOf(a, 'metadata');
    expect(metadata).toHaveLength(1);
    expect(metadata[0].url).toBe(
      `http://metadata-a.invalid/${INSTANCE_URL}/service-accounts/default/token?${TOKEN_QUERY}`,
    );
    expect(modelRequest(a).headers['authorization']).toBe('Bearer meta-a');
  });

  it('reports a 404 discovery as absent and keeps the response as the cause', async () => {
    const a = await transportFor('a');
    const failure = await failureOf(
      createGeminiApiClient({
        vertexai: true,
        project: 'project',
        location: 'us-central1',
        fetch: withResponder(a, (request) =>
          new URL(request.url).pathname === `/${INSTANCE_URL}`
            ? Promise.resolve(
                new Response('missing', {
                  status: 404,
                  headers: { 'metadata-flavor': 'Google' },
                }),
              )
            : undefined,
        ),
        credentialEnvironment: metadataEnvironment('a'),
      }).then((client) => client.models.generateContent(PARAMS)),
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(NO_ADC_FOUND);
    expect(((failure as Error).cause as { status?: number }).status).toBe(404);
    expect(a.requests).toHaveLength(0);
  });

  it('races the default hosts, aborts the slower one and requests the token from the primary', async () => {
    const a = await transportFor('a');
    let primaryDiscoveryAborted = false;
    let primaryHeld = false;
    const fetchWithSlowPrimary = withResponder(a, (request) => {
      const url = new URL(request.url);
      if (url.hostname !== '169.254.169.254' || primaryHeld) {
        return undefined;
      }
      primaryHeld = true;
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => {
            primaryDiscoveryAborted = true;
            reject(request.signal.reason);
          },
          { once: true },
        );
      });
    });
    await createGeminiApiClient({
      vertexai: true,
      project: 'project',
      location: 'us-central1',
      fetch: fetchWithSlowPrimary,
      credentialEnvironment: environment({ metadataDetection: 'ping-only' }),
    }).then((client) => client.models.generateContent(PARAMS));
    expect(primaryDiscoveryAborted).toBe(true);
    const metadata = requestsOf(a, 'metadata');
    expect(metadata.map((request) => request.url)).toEqual([
      `http://metadata.google.internal./${INSTANCE_URL}`,
      `http://169.254.169.254/${INSTANCE_URL}/service-accounts/default/token?${TOKEN_QUERY}`,
    ]);
    expect(modelRequest(a).headers['authorization']).toBe('Bearer meta-a');
  });
});
