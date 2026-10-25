/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import { acquireSessionClient } from '../../../session/session-client-binding.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { AgentResourceCapture } from './agent-resource-capture.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';

const acquisitions = new WeakMap<SessionClientOwner, AgentResourceCapture>();
const createSessionOwner = SessionClientOwner.create;

type CreateArgs = Parameters<typeof SessionClientOwner.create>;
type AcquireArgs = Parameters<typeof acquireSessionClient>;

/** `SessionClientOwner.create` without the credential authority. */
export type CapturedOwnerArgs = [
  config: CreateArgs[0],
  readTaskSchemaPolicy: CreateArgs[1],
  manager: CreateArgs[2],
  factory: CreateArgs[3],
  mediaStore: CreateArgs[4],
  readMcpInstructions: CreateArgs[5],
  workspacePaths: CreateArgs[6],
  settingsOwner: CreateArgs[7],
  contentGeneratorFactory: CreateArgs[8],
  tokenizerFactory: CreateArgs[9],
  borrowedClient?: CreateArgs[11],
  borrowedBus?: CreateArgs[12],
];

/** `acquireSessionClient` without the credential authority. */
export type CapturedAcquisitionArgs = [
  ...head: [
    config: AcquireArgs[0],
    settings: AcquireArgs[1],
    settingsOwner: AcquireArgs[2],
    providerManager: AcquireArgs[3],
    oauthManager: AcquireArgs[4],
    contentGeneratorFactory: AcquireArgs[5],
    tokenizerFactory: AcquireArgs[6],
    providerFileLifecycle: AcquireArgs[7],
    mediaStore: AcquireArgs[8],
    factory: AcquireArgs[9],
    readInstructions: AcquireArgs[10],
    workspacePaths: AcquireArgs[11],
  ],
  messageBus?: AcquireArgs[13],
  imageOperation?: AcquireArgs[14],
  borrowedClient?: AcquireArgs[15],
];

/** Creation with the production signature, for `spyOn(SessionClientOwner, 'create')`. */
export async function captureSessionOwnerCreation(
  ...args: CreateArgs
): Promise<SessionClientOwner> {
  const capture = new AgentResourceCapture();
  const factory = args[3];
  args[3] = (...operands) => {
    const client = factory(...operands);
    if (client !== undefined) {
      capture.clients.push(client);
      capture.observe(client);
    }
    return client;
  };
  const borrowed = args[11];
  if (borrowed !== undefined) capture.observe(borrowed);
  const owner = await createSessionOwner(...args);
  acquisitions.set(owner, capture);
  return owner;
}

export function createCapturedSessionOwner(
  ...args: CapturedOwnerArgs
): Promise<SessionClientOwner> {
  const [
    config,
    readTaskSchemaPolicy,
    manager,
    factory,
    mediaStore,
    readMcpInstructions,
    workspacePaths,
    settingsOwner,
    contentGeneratorFactory,
    tokenizerFactory,
    borrowedClient,
    borrowedBus,
  ] = args;
  return captureSessionOwnerCreation(
    config,
    readTaskSchemaPolicy,
    manager,
    factory,
    mediaStore,
    readMcpInstructions,
    workspacePaths,
    settingsOwner,
    contentGeneratorFactory,
    tokenizerFactory,
    new CredentialAuthority(),
    borrowedClient,
    borrowedBus,
  );
}

export async function acquireCapturedSessionClient(
  ...args: CapturedAcquisitionArgs
): Promise<SessionClientOwner> {
  const capture = new AgentResourceCapture();
  const factory = args[9] ?? buildAgentClientFactory();
  const borrowed = args[14];
  if (borrowed !== undefined) capture.observe(borrowed);
  const [
    config,
    settings,
    settingsOwner,
    providerManager,
    oauthManager,
    contentGeneratorFactory,
    tokenizerFactory,
    providerFileLifecycle,
    mediaStore,
    ,
    readInstructions,
    workspacePaths,
    messageBus,
    imageOperation,
  ] = args;
  const owner = await acquireSessionClient(
    config,
    settings,
    settingsOwner,
    providerManager,
    oauthManager,
    contentGeneratorFactory,
    tokenizerFactory,
    providerFileLifecycle,
    mediaStore,
    (...operands) => {
      const client = factory(...operands);
      capture.clients.push(client);
      capture.observe(client);
      return client;
    },
    readInstructions,
    workspacePaths,
    new CredentialAuthority(),
    messageBus,
    imageOperation,
    borrowed,
  );
  acquisitions.set(owner, capture);
  return owner;
}

export function capturedSessionClient(
  owner: SessionClientOwner,
): AgentClientContract {
  const capture = acquisitions.get(owner);
  if (capture === undefined)
    throw new Error('Session owner has no actual acquisition capture');
  return capture.publishedClient(owner.conversation);
}
