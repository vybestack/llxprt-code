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
  messageBus?: CreateArgs[11],
];

/** `acquireSessionClient` without the credential authority. */
export type CapturedAcquisitionArgs = [
  config: AcquireArgs[0]['config'],
  settings: AcquireArgs[1]['settings'],
  settingsOwner: AcquireArgs[1]['settingsOwner'],
  providerManager: AcquireArgs[2],
  oauthManager: AcquireArgs[3],
  contentGeneratorFactory: AcquireArgs[4]['contentGeneratorFactory'],
  tokenizerFactory: AcquireArgs[4]['tokenizerFactory'],
  providerFileLifecycle: AcquireArgs[4]['providerFiles'],
  mediaStore: AcquireArgs[4]['mediaStore'],
  factory: AcquireArgs[4]['clientFactory'],
  readInstructions: AcquireArgs[0]['readInstructions'],
  workspacePaths: AcquireArgs[0]['workspacePaths'],
  messageBus?: AcquireArgs[0]['messageBus'],
  imageOperation?: AcquireArgs[0]['imageOperation'],
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
    {
      config,
      messageBus,
      workspacePaths,
      readInstructions,
      imageOperation,
    },
    { settings, settingsOwner },
    providerManager,
    oauthManager,
    {
      contentGeneratorFactory,
      tokenizerFactory,
      providerFiles: providerFileLifecycle,
      mediaStore,
      authority: new CredentialAuthority(),
      clientFactory: recordingFactory(
        factory ?? buildAgentClientFactory(),
        built,
      ),
    },
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
