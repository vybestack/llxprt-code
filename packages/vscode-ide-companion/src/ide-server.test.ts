/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IDEServer } from './ide-server.js';
import type { DiffContentProvider } from './diff-manager.js';
import { DiffManager } from './diff-manager.js';

vi.mock('vscode', () => ({
  EventEmitter: vi.fn(() => ({
    event: vi.fn((_listener: () => void) => ({ dispose: vi.fn() })),
    fire: vi.fn(),
    dispose: vi.fn(),
  })),
  window: {
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    tabGroups: { all: [] },
  },
  workspace: {
    onDidDeleteFiles: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidRenameFiles: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
    onDidGrantWorkspaceTrust: vi.fn(() => ({ dispose: vi.fn() })),
    workspaceFolders: undefined,
    isTrusted: true,
  },
  commands: {
    executeCommand: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(() => Promise.resolve(undefined)),
  unlink: vi.fn(() => Promise.resolve(undefined)),
  chmod: vi.fn(() => Promise.resolve(undefined)),
  mkdir: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    tmpdir: vi.fn(() => '/tmp'),
  };
});

describe('IDEServer', () => {
  let mockContext: vscode.ExtensionContext;
  let diffManager: DiffManager;
  let ideServer: IDEServer;
  let logMessages: string[];

  beforeEach(() => {
    logMessages = [];
    const log = (msg: string) => logMessages.push(msg);

    mockContext = {
      subscriptions: [],
      environmentVariableCollection: {
        replace: vi.fn(),
        clear: vi.fn(),
      },
    } as unknown as vscode.ExtensionContext;

    const diffContentProvider = {
      setContent: vi.fn(),
      deleteContent: vi.fn(),
      getContent: vi.fn(),
      onDidChange: vi.fn(),
      provideTextDocumentContent: vi.fn(),
    };

    diffManager = new DiffManager(
      log,
      diffContentProvider as unknown as DiffContentProvider,
    );
    ideServer = new IDEServer(log, diffManager);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (ideServer) {
      try {
        await ideServer.stop();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('R1: Port file consolidation', () => {
    it('should create port directory with recursive flag', async () => {
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/foo/bar' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);

      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join('/tmp', 'llxprt', 'ide'),
        { recursive: true },
      );
    });

    it('should write single port file with ppid and port in filename', async () => {
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/workspace' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);

      const replaceMock = vi.mocked(
        mockContext.environmentVariableCollection.replace,
      );
      const portCall = replaceMock.mock.calls.find(
        (call) => call[0] === 'LLXPRT_CODE_IDE_SERVER_PORT',
      );
      expect(portCall).toBeDefined();
      const port = portCall![1];

      const expectedPortFile = path.join(
        '/tmp',
        'llxprt',
        'ide',
        `llxprt-ide-server-${process.ppid}-${port}.json`,
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        expectedPortFile,
        expect.any(String),
      );
      expect(fs.chmod).toHaveBeenCalledWith(expectedPortFile, 0o600);
    });

    it('should write port file with correct JSON content (no ppid field)', async () => {
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/workspace' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);

      const writeFileMock = vi.mocked(fs.writeFile);
      expect(writeFileMock).toHaveBeenCalled();

      const writeCall = writeFileMock.mock.calls[0];
      const jsonContent = writeCall[1] as string;
      const parsed = JSON.parse(jsonContent);

      expect(parsed).toHaveProperty('port');
      expect(parsed).toHaveProperty('workspacePath');
      expect(parsed).toHaveProperty('authToken');
      expect(parsed).not.toHaveProperty('ppid');
    });

    it('should handle multiple workspace folders with delimiter', async () => {
      const delimiter = process.platform === 'win32' ? ';' : ':';
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/foo/bar' } } as unknown as vscode.WorkspaceFolder,
        { uri: { fsPath: '/baz/qux' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);

      const writeFileMock = vi.mocked(fs.writeFile);
      const jsonContent = writeFileMock.mock.calls[0][1] as string;
      const parsed = JSON.parse(jsonContent);

      expect(parsed.workspacePath).toBe(`/foo/bar${delimiter}/baz/qux`);
    });

    it('should handle empty workspace folders', async () => {
      vi.mocked(vscode.workspace).workspaceFolders = undefined;

      await ideServer.start(mockContext);

      const writeFileMock = vi.mocked(fs.writeFile);
      const jsonContent = writeFileMock.mock.calls[0][1] as string;
      const parsed = JSON.parse(jsonContent);

      expect(parsed.workspacePath).toBe('');
    });

    it('should log error and continue if directory creation fails', async () => {
      vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error('Permission denied'));
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/workspace' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);

      expect(logMessages).toContain(
        'Failed to create IDE port file: Permission denied',
      );
      expect(logMessages).toContain(
        'Missing portFile, cannot write port and workspace info.',
      );
    });

    it('should delete only single port file on stop', async () => {
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/workspace' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);

      const replaceMock = vi.mocked(
        mockContext.environmentVariableCollection.replace,
      );
      const portCall = replaceMock.mock.calls.find(
        (call) => call[0] === 'LLXPRT_CODE_IDE_SERVER_PORT',
      );
      const port = portCall![1];

      const expectedPortFile = path.join(
        '/tmp',
        'llxprt',
        'ide',
        `llxprt-ide-server-${process.ppid}-${port}.json`,
      );

      vi.clearAllMocks();
      await ideServer.stop();

      expect(fs.unlink).toHaveBeenCalledExactlyOnceWith(expectedPortFile);
    });

    it('should clear environment variables on stop', async () => {
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/workspace' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);
      await ideServer.stop();

      expect(
        mockContext.environmentVariableCollection.clear,
      ).toHaveBeenCalled();
    });
  });

  describe('R1: syncEnvVars behavior', () => {
    it('should sync without ppidPortFile parameter', async () => {
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/workspace' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);
      vi.clearAllMocks();

      await ideServer.syncEnvVars();

      expect(fs.writeFile).toHaveBeenCalledOnce();
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[0]).toMatch(/llxprt-ide-server-\d+-\d+\.json$/);
    });

    it('should not require ppidPortFile in condition check', async () => {
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: { fsPath: '/workspace' } } as unknown as vscode.WorkspaceFolder,
      ];

      await ideServer.start(mockContext);
      vi.clearAllMocks();

      await ideServer.syncEnvVars();

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });
});
