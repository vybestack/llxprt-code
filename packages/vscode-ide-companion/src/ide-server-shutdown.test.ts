/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DiffContentProvider, DiffManager } from './diff-manager.js';
import { IDEServer } from './ide-server.js';

const actualFs = { ...(await import('node:fs/promises')) };

/**
 * A port file write that has begun and is held open, standing in for a slow
 * disk. The hold ends in one of two ways, whichever comes first:
 *
 * - The server asks to remove the port file while the write is still held
 *   (a server that does not wait for its writes). The removal is performed and
 *   the write then completes, which is the order a slow disk can produce.
 * - The server finishes closing its listener and environment variables
 *   without asking for removal (a server that is waiting for its writes), so
 *   the test lets the write complete.
 */
interface PortFileHold {
  writeEntered: boolean;
  removalRequested: boolean;
  settled: boolean;
  enter: () => void;
  settle: () => void;
  gate: Promise<void>;
}

let activeHold: PortFileHold | undefined;

void vi.mock('node:fs/promises', () => ({
  ...actualFs,
  writeFile: async (...args: Parameters<typeof actualFs.writeFile>) => {
    const hold = activeHold;
    if (hold !== undefined) {
      hold.enter();
      await hold.gate;
    }
    return actualFs.writeFile(...args);
  },
  unlink: async (...args: Parameters<typeof actualFs.unlink>) => {
    const hold = activeHold;
    if (hold !== undefined && hold.writeEntered && !hold.settled) {
      hold.removalRequested = true;
      try {
        return await actualFs.unlink(...args);
      } finally {
        hold.settle();
      }
    }
    return actualFs.unlink(...args);
  },
}));

void vi.mock('vscode', () => {
  class TestEventEmitter<T> {
    private readonly listeners = new Set<(event: T) => unknown>();

    readonly event = (listener: (event: T) => unknown) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };

    fire(event: T): void {
      for (const listener of this.listeners) {
        listener(event);
      }
    }

    dispose(): void {
      this.listeners.clear();
    }
  }

  const disposable = () => ({ dispose: () => undefined });

  return {
    EventEmitter: TestEventEmitter,
    Uri: {
      file: (filePath: string) => ({
        scheme: 'file',
        fsPath: filePath,
        path: filePath,
      }),
    },
    window: {
      activeTextEditor: undefined,
      onDidChangeActiveTextEditor: disposable,
      onDidChangeTextEditorSelection: disposable,
      tabGroups: { all: [], close: () => Promise.resolve(true) },
    },
    workspace: {
      isTrusted: true,
      workspaceFolders: undefined,
      onDidCloseTextDocument: disposable,
      onDidDeleteFiles: disposable,
      onDidGrantWorkspaceTrust: disposable,
      onDidRenameFiles: disposable,
    },
    commands: { executeCommand: () => Promise.resolve(undefined) },
  };
});

/**
 * Holds the next port file writes open. `succeed` lets the held write finish
 * normally; `fail` makes it fail as a full disk would.
 */
function holdPortFileWrites(outcome: 'succeed' | 'fail'): {
  entered: Promise<void>;
} {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let settle!: () => void;
  const gate = new Promise<void>((resolve, reject) => {
    settle =
      outcome === 'succeed' ? resolve : () => reject(new Error('disk full'));
  });
  gate.catch(() => undefined);
  const hold: PortFileHold = {
    writeEntered: false,
    removalRequested: false,
    settled: false,
    enter: () => {
      hold.writeEntered = true;
      enter();
    },
    settle: () => {
      hold.settled = true;
      settle();
    },
    gate,
  };
  activeHold = hold;
  return { entered };
}

function settleHoldWhenListenerAndEnvironmentAreClosed(): void {
  const hold = activeHold;
  queueMicrotask(() => {
    if (hold !== undefined && !hold.removalRequested && !hold.settled) {
      hold.settle();
    }
  });
}

interface TestContext {
  context: vscode.ExtensionContext;
  port(): number;
}

function createContext(onEnvironmentCleared: () => void): TestContext {
  let port: number | undefined;
  const environmentVariableCollection: vscode.GlobalEnvironmentVariableCollection =
    {
      persistent: true,
      description: undefined,
      replace: (variable, value) => {
        if (variable === 'LLXPRT_CODE_IDE_SERVER_PORT') {
          port = Number(value);
        }
      },
      append: () => undefined,
      prepend: () => undefined,
      get: () => undefined,
      forEach: () => undefined,
      delete: () => undefined,
      clear: onEnvironmentCleared,
      getScoped: () => environmentVariableCollection,
      *[Symbol.iterator]() {
        yield* [];
      },
    };
  const createMemento = (): vscode.Memento => ({
    keys: () => [],
    get: () => undefined,
    update: async () => undefined,
  });
  const extensionUri = vscode.Uri.file('/test/extension');
  const extension: vscode.Extension<unknown> = {
    id: 'test.extension',
    extensionUri,
    extensionPath: extensionUri.fsPath,
    isActive: true,
    packageJSON: {},
    extensionKind: 1,
    exports: undefined,
    activate: async () => undefined,
  };
  const context: vscode.ExtensionContext = {
    subscriptions: [],
    workspaceState: createMemento(),
    globalState: {
      ...createMemento(),
      setKeysForSync: () => undefined,
    },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
      onDidChange: () => ({ dispose: () => undefined }),
    },
    extensionUri,
    extensionPath: extensionUri.fsPath,
    environmentVariableCollection,
    asAbsolutePath: (relativePath) =>
      path.join(extensionUri.fsPath, relativePath),
    storageUri: undefined,
    storagePath: undefined,
    globalStorageUri: vscode.Uri.file('/test/global-storage'),
    globalStoragePath: '/test/global-storage',
    logUri: vscode.Uri.file('/test/log'),
    logPath: '/test/log',
    extensionMode: 3,
    extension,
    languageModelAccessInformation: {
      onDidChange: () => ({ dispose: () => undefined }),
      canSendRequest: () => undefined,
    },
  };
  return {
    context,
    port: () => {
      if (port === undefined) {
        throw new Error('The server has not published a port');
      }
      return port;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePortFile(content: string): {
  port: number;
  authToken: string;
} {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error('Invalid IDE server port file');
  }
  const { port, authToken } = parsed;
  if (typeof port !== 'number' || typeof authToken !== 'string') {
    throw new Error('Invalid IDE server port file');
  }
  return { port, authToken };
}

describe('IDEServer shutdown and the port file', () => {
  let root: string;
  let originalTemp: Record<'TMPDIR' | 'TEMP' | 'TMP', string | undefined>;
  let logMessages: string[];
  let server: IDEServer;
  let target: TestContext;

  const portFileFor = (port: number) =>
    path.join(
      os.tmpdir(),
      'llxprt',
      'ide',
      `llxprt-ide-server-${process.ppid}-${port}.json`,
    );

  const exists = (file: string) =>
    fs.stat(file).then(
      () => true,
      () => false,
    );

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-ide-shutdown-'));
    originalTemp = {
      TMPDIR: process.env['TMPDIR'],
      TEMP: process.env['TEMP'],
      TMP: process.env['TMP'],
    };
    process.env['TMPDIR'] = root;
    process.env['TEMP'] = root;
    process.env['TMP'] = root;
    logMessages = [];
    activeHold = undefined;
    server = new IDEServer(
      (message) => logMessages.push(message),
      new DiffManager(() => undefined, new DiffContentProvider()),
    );
    target = createContext(settleHoldWhenListenerAndEnvironmentAreClosed);
  });

  afterEach(async () => {
    activeHold?.settle();
    activeHold = undefined;
    await server.stop().catch(() => undefined);
    for (const [name, value] of Object.entries(originalTemp)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes the port file with the server port and token on start', async () => {
    await server.start(target.context);

    const content = parsePortFile(
      await fs.readFile(portFileFor(target.port()), 'utf8'),
    );
    expect(content.port).toBe(target.port());
    expect(content.authToken).not.toBe('');
  });

  it.skipIf(process.platform === 'win32')(
    'keeps the port file readable only by its owner',
    async () => {
      await server.start(target.context);

      const stats = await fs.stat(portFileFor(target.port()));
      expect(stats.mode & 0o777).toBe(0o600);
    },
  );

  it('removes the port file when stopped', async () => {
    await server.start(target.context);
    const portFile = portFileFor(target.port());

    await server.stop();

    expect(await exists(portFile)).toBe(false);
  });

  it('does not recreate the port file from a sync still writing when stop begins', async () => {
    await server.start(target.context);
    const portFile = portFileFor(target.port());
    const hold = holdPortFileWrites('succeed');

    const sync = server.syncEnvVars();
    await hold.entered;
    await Promise.all([sync, server.stop()]);

    expect(await exists(portFile)).toBe(false);
  });

  it('does not recreate the port file from several overlapping syncs queued behind a write', async () => {
    await server.start(target.context);
    const portFile = portFileFor(target.port());
    const hold = holdPortFileWrites('succeed');

    const syncs = [
      server.syncEnvVars(),
      server.syncEnvVars(),
      server.syncEnvVars(),
    ];
    await hold.entered;
    await Promise.all([...syncs, server.stop()]);

    expect(await exists(portFile)).toBe(false);
  });

  it('refuses a sync requested after stop has begun', async () => {
    await server.start(target.context);
    const portFile = portFileFor(target.port());
    const hold = holdPortFileWrites('succeed');

    const sync = server.syncEnvVars();
    await hold.entered;
    const stop = server.stop();
    const lateSync = server.syncEnvVars();
    await Promise.all([sync, lateSync, stop]);

    expect(await exists(portFile)).toBe(false);
    expect(logMessages.some((m) => /closed/i.test(m))).toBe(true);
  });

  it('finishes stopping and leaves no port file when a queued write fails', async () => {
    await server.start(target.context);
    const portFile = portFileFor(target.port());
    const hold = holdPortFileWrites('fail');

    const sync = server.syncEnvVars();
    await hold.entered;
    await Promise.all([sync, server.stop()]);

    expect(await exists(portFile)).toBe(false);
    expect(logMessages.some((m) => /Failed to write port/.test(m))).toBe(true);
  });

  it('ignores syncs after stop has completed', async () => {
    await server.start(target.context);
    const portFile = portFileFor(target.port());
    await server.stop();

    await server.syncEnvVars();

    expect(await exists(portFile)).toBe(false);
  });

  it('writes a fresh port file when the same server is started again after stop', async () => {
    await server.start(target.context);
    const firstPortFile = portFileFor(target.port());
    await server.stop();

    const restarted = createContext(
      settleHoldWhenListenerAndEnvironmentAreClosed,
    );
    await server.start(restarted.context);
    const secondPortFile = portFileFor(restarted.port());

    const content = parsePortFile(await fs.readFile(secondPortFile, 'utf8'));
    expect(content.port).toBe(restarted.port());
    expect(await exists(firstPortFile)).toBe(false);

    await server.syncEnvVars();
    expect(await exists(secondPortFile)).toBe(true);

    await server.stop();
    expect(await exists(secondPortFile)).toBe(false);
  });
});
