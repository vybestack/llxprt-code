/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as glob from 'glob';
import * as path from 'node:path';
import {
  FileCommandLoader,
  FILE_COMMANDS_UNTRUSTED_MESSAGE,
  type FileCommandRuntime,
} from './FileCommandLoader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import { SHORTHAND_ARGS_PLACEHOLDER } from './prompt-processors/types.js';
import { ShellProcessor } from './prompt-processors/shellProcessor.js';
import { DefaultArgumentProcessor } from './prompt-processors/argumentProcessor.js';
import type { CommandContext } from '../ui/commands/types.js';
import { FsMockContext } from './__testhelpers__/mockFs.js';

const RealDefaultArgumentProcessor = DefaultArgumentProcessor;

function assert(condition: unknown, message: string): asserts condition {
  if (condition === undefined || condition === null || condition === false) {
    throw new Error(message);
  }
}

const mockShellProcess = vi.hoisted(() => vi.fn());

vi.mock('./prompt-processors/shellProcessor.js', () => ({
  ShellProcessor: vi.fn().mockImplementation(() => ({
    process: mockShellProcess,
  })),
  ConfirmationRequiredError: class extends Error {
    constructor(
      message: string,
      public commandsToConfirm: string[],
    ) {
      super(message);
      this.name = 'ConfirmationRequiredError';
    }
  },
}));

// Capture the real constructor before Bun patches the live module namespace.
// The mock keeps constructor-call assertions while executing the production
// processor, so changes to argument processing cannot drift from this suite.
vi.mock('./prompt-processors/argumentProcessor.js', () => ({
  DefaultArgumentProcessor: vi
    .fn()
    .mockImplementation(() => new RealDefaultArgumentProcessor()),
}));

// atFileProcessor.js does not exist in the codebase; the hoisted fn is unused.
vi.mock('glob', () => ({
  glob: vi.fn(),
}));

// The settings mock must be available before vi.mock runs (Bun evaluates the
// factory eagerly at vi.mock() call time). Use vi.hoisted with createRequire
// to create the FsMockContext and settingsMock first, then reference them in
// the mock factory.
// Bun does not hoist vi.mock, so the static import above is already evaluated
// by the time this runs and FsMockContext can be used directly. The previous
// createRequire indirection existed only for Vitest's hoisting, which this
// workspace no longer uses.
const fsMock = new FsMockContext();
const settingsMockHoisted = { mock: fsMock.settingsMock() };

vi.mock('@vybestack/llxprt-code-settings', () => settingsMockHoisted.mock);

describe('FileCommandLoader', () => {
  const signal: AbortSignal = new AbortController().signal;

  beforeEach(async () => {
    vi.clearAllMocks();
    fsMock.clear();
    const actualGlob = (await vi.importActual<typeof import('glob')>('glob'))
      .glob;
    vi.mocked(glob.glob).mockImplementation(actualGlob);
    mockShellProcess.mockImplementation(
      (prompt: string, context: CommandContext) => {
        const userArgsRaw = context.invocation?.args ?? '';
        const processedPrompt = prompt.replaceAll(
          SHORTHAND_ARGS_PLACEHOLDER,
          userArgsRaw,
        );
        return Promise.resolve(processedPrompt);
      },
    );
  });

  afterEach(() => {
    fsMock.restore();
  });

  afterAll(() => {
    fsMock.cleanup();
  });

  it('loads a single command from a file', async () => {
    fsMock.mock({
      'test.toml': 'prompt = "This is a test prompt"',
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.name).toBe('test');
    assert(command.action, 'Expected command action');

    const result = await command.action(
      createMockCommandContext({
        invocation: {
          raw: '/test',
          name: 'test',
          args: '',
        },
      }),
      '',
    );
    expect(result?.type).toBe('submit_prompt');
    expect(result.content).toBe('This is a test prompt');
  });

  // Symlink creation on Windows requires special permissions that are not
  // available in the standard CI environment. Therefore, we skip these tests
  // on Windows to prevent CI failures. The core functionality is still
  // validated on Linux and macOS.
  it.skipIf(process.platform === 'win32')(
    'loads commands from a symlinked directory',
    async () => {
      const realCommandsDir = path.join(fsMock.root, 'real-commands');
      fsMock.mockAt(realCommandsDir, {
        'test.toml': 'prompt = "This is a test prompt"',
      });
      // Create symlink from userCommandsDir to realCommandsDir
      const { symlinkSync, rmSync } = await import('node:fs');
      // force makes this idempotent, so no existence check is needed.
      rmSync(fsMock.userCommandsDir, { recursive: true, force: true });
      symlinkSync(realCommandsDir, fsMock.userCommandsDir, 'dir');

      const loader = new FileCommandLoader(null);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(1);
      const command = commands[0];
      expect(command).toBeDefined();
      expect(command.name).toBe('test');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'loads commands from a symlinked subdirectory',
    async () => {
      const realNamespacedDir = path.join(
        fsMock.root,
        'real-namespaced-commands',
      );
      fsMock.mockAt(realNamespacedDir, {
        'my-test.toml': 'prompt = "This is a test prompt"',
      });
      // Create the user commands dir with a symlinked subdirectory
      const { symlinkSync, rmSync } = await import('node:fs');
      // fsMock.mock() already ensures userCommandsDir exists as a real dir.
      const symlinkPath = path.join(fsMock.userCommandsDir, 'namespaced');
      // force makes this idempotent, so no existence check is needed.
      rmSync(symlinkPath, { recursive: true, force: true });
      symlinkSync(realNamespacedDir, symlinkPath, 'dir');

      const loader = new FileCommandLoader(null);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(1);
      const command = commands[0];
      expect(command).toBeDefined();
      expect(command.name).toBe('namespaced:my-test');
    },
  );

  it('loads multiple commands', async () => {
    fsMock.mock({
      'test1.toml': 'prompt = "Prompt 1"',
      'test2.toml': 'prompt = "Prompt 2"',
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(2);
  });

  it('creates deeply nested namespaces correctly', async () => {
    fsMock.mock({
      gcp: {
        pipelines: {
          'run.toml': 'prompt = "run pipeline"',
        },
      },
    });
    const mockConfig = {
      getProjectRoot: vi.fn(() => '/path/to/project'),
      getExtensions: vi.fn(() => []),
      getFolderTrust: vi.fn(() => false),
      isTrustedFolder: vi.fn(() => false),
    } satisfies FileCommandRuntime;
    const loader = new FileCommandLoader(mockConfig);
    const commands = await loader.loadCommands(signal);
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe('gcp:pipelines:run');
  });

  it('creates namespaces from nested directories', async () => {
    fsMock.mock({
      git: {
        'commit.toml': 'prompt = "git commit prompt"',
      },
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.name).toBe('git:commit');
  });

  it('returns both user and project commands in order', async () => {
    fsMock.mock({
      'test.toml': 'prompt = "User prompt"',
    });
    fsMock.mock(
      {
        'test.toml': 'prompt = "Project prompt"',
      },
      'project',
    );

    const mockConfig = {
      getProjectRoot: vi.fn(() => process.cwd()),
      getExtensions: vi.fn(() => []),
      getFolderTrust: vi.fn(() => false),
      isTrustedFolder: vi.fn(() => false),
    } satisfies FileCommandRuntime;
    const loader = new FileCommandLoader(mockConfig);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(2);
    const userResult = await commands[0].action?.(
      createMockCommandContext({
        invocation: {
          raw: '/test',
          name: 'test',
          args: '',
        },
      }),
      '',
    );
    expect(userResult?.type).toBe('submit_prompt');
    expect(userResult.content).toBe('User prompt');
    const projectResult = await commands[1].action?.(
      createMockCommandContext({
        invocation: {
          raw: '/test',
          name: 'test',
          args: '',
        },
      }),
      '',
    );
    expect(projectResult?.type).toBe('submit_prompt');
    assert(
      projectResult?.type === 'submit_prompt',
      'Incorrect action type for project command',
    );
    type _SubmitPromptAction3 = Extract<
      typeof projectResult,
      { type: 'submit_prompt' }
    >;
    const submitResult2 = projectResult;
    expect(submitResult2.content).toBe('Project prompt');
  });

  it('ignores files with TOML syntax errors', async () => {
    fsMock.mock({
      'invalid.toml': 'this is not valid toml',
      'good.toml': 'prompt = "This one is fine"',
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe('good');
  });

  it('ignores files that are semantically invalid (missing prompt)', async () => {
    fsMock.mock({
      'no_prompt.toml': 'description = "This file is missing a prompt"',
      'good.toml': 'prompt = "This one is fine"',
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe('good');
  });

  it('handles filename edge cases correctly', async () => {
    fsMock.mock({
      'test.v1.toml': 'prompt = "Test prompt"',
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.name).toBe('test.v1');
  });

  it('handles file system errors gracefully', async () => {
    fsMock.mock({});
    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);
    expect(commands).toHaveLength(0);
  });

  it('uses a default description if not provided', async () => {
    fsMock.mock({
      'test.toml': 'prompt = "Test prompt"',
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.description).toBe('Custom command from test.toml');
  });

  it('uses the provided description', async () => {
    fsMock.mock({
      'test.toml': 'prompt = "Test prompt"\ndescription = "My test command"',
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.description).toBe('My test command');
  });

  it('should sanitize colons in filenames to prevent namespace conflicts', async () => {
    fsMock.mock({
      'legacy:command.toml': 'prompt = "This is a legacy command"',
    });

    const loader = new FileCommandLoader(null);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toBeDefined();

    // Verify that the ':' in the filename was replaced with an '_'
    expect(command.name).toBe('legacy_command');
  });

  describe('Processor Instantiation Logic', () => {
    it('instantiates only DefaultArgumentProcessor if no {{args}} or !{} are present', async () => {
      fsMock.mock({
        'simple.toml': `prompt = "Just a regular prompt"`,
      });

      const loader = new FileCommandLoader(null);
      await loader.loadCommands(signal);

      expect(ShellProcessor).not.toHaveBeenCalled();
      expect(DefaultArgumentProcessor).toHaveBeenCalledTimes(1);
    });

    it('instantiates only ShellProcessor if {{args}} is present (but not !{})', async () => {
      fsMock.mock({
        'args.toml': `prompt = "Prompt with {{args}}"`,
      });

      const loader = new FileCommandLoader(null);
      await loader.loadCommands(signal);

      expect(ShellProcessor).toHaveBeenCalledTimes(1);
      expect(DefaultArgumentProcessor).not.toHaveBeenCalled();
    });

    it('instantiates ShellProcessor and DefaultArgumentProcessor if !{} is present (but not {{args}})', async () => {
      fsMock.mock({
        'shell.toml': `prompt = "Prompt with !{cmd}"`,
      });

      const loader = new FileCommandLoader(null);
      await loader.loadCommands(signal);

      expect(ShellProcessor).toHaveBeenCalledTimes(1);
      expect(DefaultArgumentProcessor).toHaveBeenCalledTimes(1);
    });

    it('instantiates only ShellProcessor if both {{args}} and !{} are present', async () => {
      fsMock.mock({
        'both.toml': `prompt = "Prompt with {{args}} and !{cmd}"`,
      });

      const loader = new FileCommandLoader(null);
      await loader.loadCommands(signal);

      expect(ShellProcessor).toHaveBeenCalledTimes(1);
      expect(DefaultArgumentProcessor).not.toHaveBeenCalled();
    });
  });

  describe('Extension Command Loading', () => {
    it('loads commands from active extensions', async () => {
      const extensionDir = path.join(
        fsMock.root,
        '.gemini/extensions/test-ext',
      );

      fsMock.mock({
        'user.toml': 'prompt = "User command"',
      });
      fsMock.mock(
        {
          'project.toml': 'prompt = "Project command"',
        },
        'project',
      );
      fsMock.mockAt(extensionDir, {
        'llxprt-extension.json': JSON.stringify({
          name: 'test-ext',
          version: '1.0.0',
        }),
        commands: {
          'ext.toml': 'prompt = "Extension command"',
        },
      });

      const mockConfig = {
        getProjectRoot: vi.fn(() => process.cwd()),
        getExtensions: vi.fn(() => [
          {
            name: 'test-ext',
            version: '1.0.0',
            isActive: true,
            path: extensionDir,
          },
        ]),
        getFolderTrust: vi.fn(() => false),
        isTrustedFolder: vi.fn(() => false),
      } satisfies FileCommandRuntime;
      const loader = new FileCommandLoader(mockConfig);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(3);
      const commandNames = commands.map((cmd) => cmd.name);
      expect(commandNames).toStrictEqual(['user', 'project', 'ext']);

      const extCommand = commands.find((cmd) => cmd.name === 'ext');
      expect(extCommand?.extensionName).toBe('test-ext');
      expect(extCommand?.description).toMatch(/^\[test-ext\]/);
    });

    it('extension commands have extensionName metadata for conflict resolution', async () => {
      const extensionDir = path.join(
        fsMock.root,
        '.gemini/extensions/test-ext',
      );

      fsMock.mock({
        'deploy.toml': 'prompt = "User deploy command"',
      });
      fsMock.mock(
        {
          'deploy.toml': 'prompt = "Project deploy command"',
        },
        'project',
      );
      fsMock.mockAt(extensionDir, {
        'llxprt-extension.json': JSON.stringify({
          name: 'test-ext',
          version: '1.0.0',
        }),
        commands: {
          'deploy.toml': 'prompt = "Extension deploy command"',
        },
      });

      const mockConfig = {
        getProjectRoot: vi.fn(() => process.cwd()),
        getExtensions: vi.fn(() => [
          {
            name: 'test-ext',
            version: '1.0.0',
            isActive: true,
            path: extensionDir,
          },
        ]),
        getFolderTrust: vi.fn(() => false),
        isTrustedFolder: vi.fn(() => false),
      } satisfies FileCommandRuntime;
      const loader = new FileCommandLoader(mockConfig);
      const commands = await loader.loadCommands(signal);

      // Return all commands, even duplicates
      expect(commands).toHaveLength(3);

      expect(commands[0].name).toBe('deploy');
      expect(commands[0].extensionName).toBeUndefined();
      const result0 = await commands[0].action?.(
        createMockCommandContext({
          invocation: {
            raw: '/deploy',
            name: 'deploy',
            args: '',
          },
        }),
        '',
      );
      expect(result0?.type).toBe('submit_prompt');
      assert(
        result0?.type === 'submit_prompt',
        'Incorrect action type for user command',
      );
      expect(result0.content).toBe('User deploy command');

      expect(commands[1].name).toBe('deploy');
      expect(commands[1].extensionName).toBeUndefined();
      const result1 = await commands[1].action?.(
        createMockCommandContext({
          invocation: {
            raw: '/deploy',
            name: 'deploy',
            args: '',
          },
        }),
        '',
      );
      expect(result1?.type).toBe('submit_prompt');
      assert(
        result1?.type === 'submit_prompt',
        'Incorrect action type for project command',
      );
      expect(result1.content).toBe('Project deploy command');

      expect(commands[2].name).toBe('deploy');
      expect(commands[2].extensionName).toBe('test-ext');
      expect(commands[2].description).toMatch(/^\[test-ext\]/);
      const result2 = await commands[2].action?.(
        createMockCommandContext({
          invocation: {
            raw: '/deploy',
            name: 'deploy',
            args: '',
          },
        }),
        '',
      );
      expect(result2?.type).toBe('submit_prompt');
      assert(
        result2?.type === 'submit_prompt',
        'Incorrect action type for extension command',
      );
      expect(result2.content).toBe('Extension deploy command');
    });

    it('only loads commands from active extensions', async () => {
      const extensionDir1 = path.join(
        fsMock.root,
        '.gemini/extensions/active-ext',
      );
      const extensionDir2 = path.join(
        fsMock.root,
        '.gemini/extensions/inactive-ext',
      );

      fsMock.mockAt(extensionDir1, {
        'llxprt-extension.json': JSON.stringify({
          name: 'active-ext',
          version: '1.0.0',
        }),
        commands: {
          'active.toml': 'prompt = "Active extension command"',
        },
      });
      fsMock.mockAt(extensionDir2, {
        'llxprt-extension.json': JSON.stringify({
          name: 'inactive-ext',
          version: '1.0.0',
        }),
        commands: {
          'inactive.toml': 'prompt = "Inactive extension command"',
        },
      });

      const mockConfig = {
        getProjectRoot: vi.fn(() => process.cwd()),
        getExtensions: vi.fn(() => [
          {
            name: 'active-ext',
            version: '1.0.0',
            isActive: true,
            path: extensionDir1,
          },
          {
            name: 'inactive-ext',
            version: '1.0.0',
            isActive: false,
            path: extensionDir2,
          },
        ]),
        getFolderTrust: vi.fn(() => false),
        isTrustedFolder: vi.fn(() => false),
      } satisfies FileCommandRuntime;
      const loader = new FileCommandLoader(mockConfig);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(1);
      expect(commands[0].name).toBe('active');
      expect(commands[0].extensionName).toBe('active-ext');
      expect(commands[0].description).toMatch(/^\[active-ext\]/);
    });

    it('handles missing extension commands directory gracefully', async () => {
      const extensionDir = path.join(
        fsMock.root,
        '.gemini/extensions/no-commands',
      );

      fsMock.mockAt(extensionDir, {
        'llxprt-extension.json': JSON.stringify({
          name: 'no-commands',
          version: '1.0.0',
        }),
        // No commands directory
      });

      const mockConfig = {
        getProjectRoot: vi.fn(() => process.cwd()),
        getExtensions: vi.fn(() => [
          {
            name: 'no-commands',
            version: '1.0.0',
            isActive: true,
            path: extensionDir,
          },
        ]),
        getFolderTrust: vi.fn(() => false),
        isTrustedFolder: vi.fn(() => false),
      } satisfies FileCommandRuntime;
      const loader = new FileCommandLoader(mockConfig);
      const commands = await loader.loadCommands(signal);
      expect(commands).toHaveLength(0);
    });

    it('handles nested command structure in extensions', async () => {
      const extensionDir = path.join(fsMock.root, '.gemini/extensions/a');

      fsMock.mockAt(extensionDir, {
        'llxprt-extension.json': JSON.stringify({
          name: 'a',
          version: '1.0.0',
        }),
        commands: {
          b: {
            'c.toml': 'prompt = "Nested command from extension a"',
            d: {
              'e.toml': 'prompt = "Deeply nested command"',
            },
          },
          'simple.toml': 'prompt = "Simple command"',
        },
      });

      const mockConfig = {
        getProjectRoot: vi.fn(() => process.cwd()),
        getExtensions: vi.fn(() => [
          { name: 'a', version: '1.0.0', isActive: true, path: extensionDir },
        ]),
        getFolderTrust: vi.fn(() => false),
        isTrustedFolder: vi.fn(() => false),
      } satisfies FileCommandRuntime;
      const loader = new FileCommandLoader(mockConfig);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(3);

      const commandNames = commands.map((cmd) => cmd.name).sort();
      expect(commandNames).toStrictEqual(['b:c', 'b:d:e', 'simple']);

      const nestedCmd = commands.find((cmd) => cmd.name === 'b:c');
      expect(nestedCmd?.extensionName).toBe('a');
      expect(nestedCmd?.description).toMatch(/^\[a\]/);
      assert(nestedCmd, 'Expected nested command');
      assert(nestedCmd.action, 'Expected nested command action');
      const result = await nestedCmd.action(
        createMockCommandContext({
          invocation: {
            raw: '/b:c',
            name: 'b:c',
            args: '',
          },
        }),
        '',
      );
      assert(result?.type === 'submit_prompt', 'Incorrect action type');
      expect(result.content).toBe('Nested command from extension a');
    });
  });

  describe('Argument Handling Integration (via ShellProcessor)', () => {
    it('correctly processes a command with {{args}}', async () => {
      fsMock.mock({
        'shorthand.toml':
          'prompt = "The user wants to: {{args}}"\ndescription = "Shorthand test"',
      });

      const loader = new FileCommandLoader(null);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'shorthand');
      assert(command, 'Expected shorthand command');

      const result = await command.action?.(
        createMockCommandContext({
          invocation: {
            raw: '/shorthand do something cool',
            name: 'shorthand',
            args: 'do something cool',
          },
        }),
        'do something cool',
      );
      expect(result?.type).toBe('submit_prompt');
      assert(result?.type === 'submit_prompt', 'Incorrect action type');
      expect(result.content).toBe('The user wants to: do something cool');
    });
  });

  describe('live folder trust', () => {
    function setupLiveTrust(initialTrust: boolean) {
      fsMock.mock({
        'live.toml': 'prompt = "Live prompt"',
      });
      let trusted = initialTrust;
      const config = {
        getProjectRoot: () => process.cwd(),
        getExtensions: () => [],
        getFolderTrust: () => true,
        isTrustedFolder: () => trusted,
      } satisfies FileCommandRuntime;
      return {
        loader: new FileCommandLoader(config),
        setTrusted: (value: boolean) => {
          trusted = value;
        },
      };
    }

    it('gains and revokes file commands from the same loader without an external event', async () => {
      const { loader, setTrusted } = setupLiveTrust(false);

      expect(await loader.loadCommands(signal)).toStrictEqual([]);

      setTrusted(true);
      expect(await loader.loadCommands(signal)).toHaveLength(1);

      setTrusted(false);
      expect(await loader.loadCommands(signal)).toStrictEqual([]);
    });

    it('blocks execution synchronously when trust is revoked after loading', async () => {
      const { loader, setTrusted } = setupLiveTrust(true);
      const [command] = await loader.loadCommands(signal);
      expect(command).toBeDefined();

      setTrusted(false);
      const result = await command.action(
        createMockCommandContext({
          invocation: {
            raw: '/secure',
            name: 'secure',
            args: '',
          },
        }),
        '',
      );

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: FILE_COMMANDS_UNTRUSTED_MESSAGE,
      });
    });
  });
});
