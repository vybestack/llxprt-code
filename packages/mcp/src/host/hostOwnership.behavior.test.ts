/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  KeychainTokenStorage,
  type KeytarLoader,
} from '../auth/token-storage/keychain-token-storage.js';
import type { OAuthCredentials } from '../auth/token-storage/index.js';
import type { HostFeedbackSink } from './hostServices.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function hostRecorder(): {
  emitFeedback: HostFeedbackSink;
  events: () => ReadonlyArray<Parameters<HostFeedbackSink>>;
} {
  let events: ReadonlyArray<Parameters<HostFeedbackSink>> = [];
  return {
    emitFeedback: (...args): void => {
      events = [...events, args];
    },
    events: () => events,
  };
}

function delayedKeyring(): {
  loader: KeytarLoader;
  entered: Promise<void>;
  response: ReturnType<
    typeof deferred<Array<{ account: string; password: string }>>
  >;
} {
  const entered = deferred<void>();
  const response = deferred<Array<{ account: string; password: string }>>();
  const passwords = new Map<string, string>();
  const loader: KeytarLoader = async () => ({
    getPassword: async (service, account) =>
      passwords.get(`${service}/${account}`) ?? null,
    setPassword: async (service, account, password): Promise<void> => {
      passwords.set(`${service}/${account}`, password);
    },
    deletePassword: async (service, account) =>
      passwords.delete(`${service}/${account}`),
    findCredentials: async () => {
      entered.resolve();
      return response.promise;
    },
  });
  return { loader, entered: entered.promise, response };
}

const validCredentials: OAuthCredentials = {
  serverName: 'valid-server',
  token: { accessToken: 'fixture-token', tokenType: 'Bearer' },
  updatedAt: 1,
};

function mixedKeyringEntries(): Array<{ account: string; password: string }> {
  return [
    { account: 'broken-server', password: 'not-json' },
    { account: 'valid-server', password: JSON.stringify(validCredentials) },
  ];
}

function expectValidCredentials(result: Map<string, OAuthCredentials>): void {
  expect([...result.entries()]).toStrictEqual([
    ['valid-server', validCredentials],
  ]);
}

describe('MCP keychain host notice ownership', () => {
  it('delivers the malformed-entry notice to A without interleaving', async () => {
    const hostA = hostRecorder();
    const keyring = delayedKeyring();
    const storageA = new KeychainTokenStorage(
      'shared-service',
      hostA.emitFeedback,
      keyring.loader,
    );

    const operationA = storageA.getAllCredentials();
    await keyring.entered;
    expect(hostA.events()).toStrictEqual([]);
    keyring.response.resolve(mixedKeyringEntries());

    expectValidCredentials(await operationA);
    expect(hostA.events()).toStrictEqual([
      [
        'error',
        'Failed to parse credentials for broken-server',
        expect.any(SyntaxError),
      ],
    ]);
  }, 30000);

  it('keeps A malformed-entry notice with A when B is constructed during enumeration', async () => {
    const hostA = hostRecorder();
    const hostB = hostRecorder();
    const keyring = delayedKeyring();
    const storageA = new KeychainTokenStorage(
      'shared-service',
      hostA.emitFeedback,
      keyring.loader,
    );

    const operationA = storageA.getAllCredentials();
    await keyring.entered;
    const storageB = new KeychainTokenStorage(
      'shared-service',
      hostB.emitFeedback,
      keyring.loader,
    );
    await storageB.isAvailable();
    const beforeB = hostB.events();
    keyring.response.resolve(mixedKeyringEntries());

    expectValidCredentials(await operationA);
    expect({ owner: hostA.events(), other: hostB.events() }).toStrictEqual({
      owner: [
        [
          'error',
          'Failed to parse credentials for broken-server',
          expect.any(SyntaxError),
        ],
      ],
      other: beforeB,
    });
  }, 30000);

  it('preserves the external enumeration error identity and arity without interleaving', async () => {
    const hostA = hostRecorder();
    const keyring = delayedKeyring();
    const failure = new Error('keyring enumeration failed');
    const storageA = new KeychainTokenStorage(
      'shared-service',
      hostA.emitFeedback,
      keyring.loader,
    );

    const operationA = storageA.getAllCredentials();
    await keyring.entered;
    keyring.response.reject(failure);

    expect([...(await operationA)]).toStrictEqual([]);
    expect(hostA.events()).toStrictEqual([
      ['error', 'Failed to get all credentials from keychain', failure],
    ]);
    expect(hostA.events()[0]?.[2]).toBe(failure);
  }, 30000);

  it('keeps A enumeration failure with A when B is constructed during the external wait', async () => {
    const hostA = hostRecorder();
    const hostB = hostRecorder();
    const keyring = delayedKeyring();
    const failure = new Error('keyring enumeration failed');
    const storageA = new KeychainTokenStorage(
      'shared-service',
      hostA.emitFeedback,
      keyring.loader,
    );

    const operationA = storageA.getAllCredentials();
    await keyring.entered;
    const storageB = new KeychainTokenStorage(
      'shared-service',
      hostB.emitFeedback,
      keyring.loader,
    );
    await storageB.isAvailable();
    const beforeB = hostB.events();
    keyring.response.reject(failure);

    expect([...(await operationA)]).toStrictEqual([]);
    expect({ owner: hostA.events(), other: hostB.events() }).toStrictEqual({
      owner: [
        ['error', 'Failed to get all credentials from keychain', failure],
      ],
      other: beforeB,
    });
    expect(hostA.events()[0]?.[2]).toBe(failure);
  }, 30000);

  it('continues parsing valid credentials after the external feedback sink throws', async () => {
    const hostA = hostRecorder();
    const keyring = delayedKeyring();
    const storageA = new KeychainTokenStorage(
      'shared-service',
      (...args): void => {
        hostA.emitFeedback(...args);
        throw new Error('host UI unavailable');
      },
      keyring.loader,
    );

    const operationA = storageA.getAllCredentials();
    await keyring.entered;
    keyring.response.resolve(mixedKeyringEntries());

    expectValidCredentials(await operationA);
    expect(hostA.events()).toStrictEqual([
      [
        'error',
        'Failed to parse credentials for broken-server',
        expect.any(SyntaxError),
      ],
    ]);
  }, 30000);
});
