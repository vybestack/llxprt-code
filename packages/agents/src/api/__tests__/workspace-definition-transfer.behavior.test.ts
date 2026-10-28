import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createAgent } from '../createAgent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { gateReadFile } from './helpers/gated-read-file.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('public Agent workspace definition lifetime', () => {
  let promptDirectory: string;

  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;

  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('multi-turn-text.jsonl');
  const callerCredentials = useOwnedCredentials();

  let root: string;

  const directories: string[] = [];

  let previousHome: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'llxprt-public-definitions-'));
    directories.push(root);
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(root, 'config');
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
  });

  afterAll(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('closes and drains a transferred definition root', async () => {
    const definitions = new WorkspaceDefinitionOwner(
      join(root, 'owned/profiles'),
      join(root, 'owned/subagents'),
    );
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: root,
      harness: { includeProcessCwd: false, forceConfirmations: false },
      credentialAuthority: callerCredentials().authority,
      definitionOwner: definitions,
      definitionOwnership: 'agent',
    });
    await mkdir(join(root, 'owned/profiles'), { recursive: true });
    await writeFile(
      join(root, 'owned/profiles/held.json'),
      JSON.stringify(agent.captureProfile()),
    );
    const read = gateReadFile((file) => basename(String(file)) === 'held.json');
    try {
      const accepted = agent.workspace.profileDefinitions.loadProfile('held');
      await read.entered;
      let finished = false;
      const closing = agent.dispose().then(() => {
        finished = true;
      });
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(finished).toBe(false);
      read.release();
      await accepted;
      await closing;
      expect(finished).toBe(true);
    } finally {
      read.restore();
      await agent.dispose();
      await definitions.dispose();
    }
  }, 30000);

  it('closes a transferred definition root at Agent disposal and keeps the saved profile on disk', async () => {
    const definitions = new WorkspaceDefinitionOwner(
      join(root, 'config/profiles'),
      join(root, 'config/subagents'),
    );
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: root,
      credentialAuthority: callerCredentials().authority,
      definitionOwner: definitions,
      definitionOwnership: 'agent',
    });
    try {
      await agent.saveProfileSnapshot('transferred');
      await agent.dispose();
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
      expect(
        JSON.parse(
          await readFile(
            join(root, 'config/profiles/transferred.json'),
            'utf8',
          ),
        ).version,
      ).toBe(1);
    } finally {
      await agent.dispose();
      await definitions.dispose();
    }
  }, 30000);

  it('cleans a transferred definition root when adoption fails before session preparation', async () => {
    const definitions = new WorkspaceDefinitionOwner(
      join(root, 'failure/profiles'),
      join(root, 'failure/subagents'),
    );
    try {
      await expect(
        createAgent({
          provider: 'fake',
          model: 'fake-model',
          workingDir: root,
          sessionId: '',
          credentialAuthority: callerCredentials().authority,
          definitionOwner: definitions,
          definitionOwnership: 'agent',
        }),
      ).rejects.toThrow('non-empty');
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
    } finally {
      await definitions.dispose();
    }
  }, 30000);
});
