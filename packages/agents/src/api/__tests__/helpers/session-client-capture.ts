/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import { acquireSessionClient } from '../../../session/session-client-binding.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';

const builtClients = new WeakMap<SessionClientOwner, AgentClientContract[]>();
const suppliedClients = new WeakMap<SessionClientOwner, AgentClientContract>();
// `SessionClientOwner.create` as production defines it, captured before a
// test's `spyOn(SessionClientOwner, 'create')` can replace it.
const createSessionOwner = SessionClientOwner.create;

type CreateArgs = Parameters<typeof SessionClientOwner.create>;
type AcquireArgs = Parameters<typeof acquireSessionClient>;

/** `SessionClientOwner.create` without the credential authority and the borrowed-client position. */
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
  messageBus?: CreateArgs[12],
];

/** `acquireSessionClient` without the credential authority. */
export type CapturedAcquisitionArgs = [
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
  messageBus?: AcquireArgs[13],
  imageOperation?: AcquireArgs[14],
];

/**
 * Wraps the owner's client factory parameter so the clients it returns are
 * recorded in creation order. Nothing is patched on the clients.
 */
function recordingFactory<
  Operands extends unknown[],
  Built extends AgentClientContract | undefined,
>(
  factory: (...operands: Operands) => Built,
  built: AgentClientContract[],
): (...operands: Operands) => Built {
  return (...operands) => {
    const client = factory(...operands);
    if (client !== undefined) built.push(client);
    return client;
  };
}

/**
 * Creation with the production signature, for
 * `spyOn(SessionClientOwner, 'create')`: the owner is built by production
 * `create` and its factory-built clients are recorded for `ownerClients`.
 */
export async function captureSessionOwnerCreation(
  ...args: CreateArgs
): Promise<SessionClientOwner> {
  const built: AgentClientContract[] = [];
  args[3] = recordingFactory(args[3], built);
  const owner = await createSessionOwner(...args);
  builtClients.set(owner, built);
  const supplied = args[11];
  if (supplied !== undefined) suppliedClients.set(owner, supplied);
  return owner;
}

/**
 * A `SessionClientOwner` built through production `SessionClientOwner.create`
 * with the parameters production fills; its clients are observed through the
 * client-factory parameter (`ownerClients`).
 */
export async function createCapturedSessionOwner(
  ...args: CapturedOwnerArgs
): Promise<SessionClientOwner> {
  const built: AgentClientContract[] = [];
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
    messageBus,
  ] = args;
  const owner = await createSessionOwner(
    config,
    readTaskSchemaPolicy,
    manager,
    recordingFactory(factory, built),
    mediaStore,
    readMcpInstructions,
    workspacePaths,
    settingsOwner,
    contentGeneratorFactory,
    tokenizerFactory,
    new CredentialAuthority(),
    undefined,
    messageBus,
  );
  builtClients.set(owner, built);
  return owner;
}

/** `acquireSessionClient` with its client factory observed the same way. */
export async function acquireCapturedSessionClient(
  ...args: CapturedAcquisitionArgs
): Promise<SessionClientOwner> {
  const built: AgentClientContract[] = [];
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
    factory,
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
    recordingFactory(factory ?? buildAgentClientFactory(), built),
    readInstructions,
    workspacePaths,
    new CredentialAuthority(),
    messageBus,
    imageOperation,
  );
  builtClients.set(owner, built);
  return owner;
}

/**
 * The clients the owner's client factory returned, in creation order. The
 * factory is the parameter production fills with `buildAgentClientFactory()`;
 * nothing is patched on the clients.
 */
export function ownerClients(
  owner: SessionClientOwner,
): readonly AgentClientContract[] {
  const built = builtClients.get(owner);
  if (built === undefined)
    throw new Error('Session owner was not built by the capture helpers');
  return built;
}

/**
 * The client the owner's conversation currently delegates to. It is found by
 * asking the conversation for its sequence model while each candidate client
 * records that it was asked; the probe is removed again before returning.
 * Remaining importers read the current client after a replacement that may
 * have been rolled back, which `ownerClients` alone does not say; each moves
 * to `ownerClients` with its own batch and this export is deleted with the
 * last one.
 */
export function capturedSessionClient(
  owner: SessionClientOwner,
): AgentClientContract {
  const supplied = suppliedClients.get(owner);
  const candidates = [
    ...ownerClients(owner),
    ...(supplied === undefined ? [] : [supplied]),
  ];
  let receiver: AgentClientContract | undefined;
  const restores = candidates.map((client) => {
    const hadOwn = Object.prototype.hasOwnProperty.call(
      client,
      'getCurrentSequenceModel',
    );
    const previous = client.getCurrentSequenceModel;
    client.getCurrentSequenceModel = () => {
      receiver = client;
      return previous.call(client);
    };
    return () => {
      if (hadOwn) client.getCurrentSequenceModel = previous;
      else Reflect.deleteProperty(client, 'getCurrentSequenceModel');
    };
  });
  try {
    owner.conversation.getCurrentSequenceModel();
  } finally {
    for (const restore of restores) restore();
  }
  if (receiver === undefined)
    throw new Error('No session client received the sequence-model probe');
  return receiver;
}
