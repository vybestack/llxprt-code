/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import * as path from 'path';
import semver from 'semver';
import { IDEServer } from './ide-server.js';
import { DiffContentProvider, DiffManager } from './diff-manager.js';
import { createLogger } from './utils/logger.js';
import {
  detectIdeFromEnv,
  IDE_DEFINITIONS,
  type IdeInfo,
} from '@vybestack/llxprt-code-core';

const CLI_IDE_COMPANION_IDENTIFIER =
  'vybestack.llxprt-code-vscode-ide-companion';
const INFO_MESSAGE_SHOWN_KEY = 'llxprtCodeInfoMessageShown';
const IDE_WORKSPACE_PATH_ENV_VAR = 'LLXPRT_CODE_IDE_WORKSPACE_PATH';
export const DIFF_SCHEME = 'llxprt-diff';

/**
 * In these environments the companion extension is installed and managed by the IDE instead of the user.
 */
const MANAGED_EXTENSION_SURFACES: ReadonlySet<IdeInfo['name']> = new Set([
  IDE_DEFINITIONS.firebasestudio.name,
  IDE_DEFINITIONS.cloudshell.name,
]);

let ideServer: IDEServer | undefined;
let logger: vscode.OutputChannel | undefined;

let log: (message: string) => void = () => {};

function updateWorkspacePath(context: vscode.ExtensionContext) {
  // console.error('updateWorkspace called with ', context);
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspacePaths = workspaceFolders
      .map((folder) => folder.uri.fsPath)
      .join(path.delimiter);
    context.environmentVariableCollection.replace(
      IDE_WORKSPACE_PATH_ENV_VAR,
      workspacePaths,
    );
  } else {
    context.environmentVariableCollection.replace(
      IDE_WORKSPACE_PATH_ENV_VAR,
      '',
    );
  }
}

async function fetchLatestMarketplaceVersion(
  log: (message: string) => void,
): Promise<string | undefined> {
  // Fetch extension details from the VSCode Marketplace.
  const response = await fetch(
    'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json;api-version=7.1-preview.1',
      },
      body: JSON.stringify({
        filters: [
          {
            criteria: [
              {
                filterType: 7, // Corresponds to ExtensionName
                value: CLI_IDE_COMPANION_IDENTIFIER,
              },
            ],
          },
        ],
        // See: https://learn.microsoft.com/en-us/azure/devops/extend/gallery/apis/hyper-linking?view=azure-devops
        // 946 = IncludeVersions | IncludeFiles | IncludeCategoryAndTags |
        //       IncludeShortDescription | IncludePublisher | IncludeStatistics
        flags: 946,
      }),
    },
  );

  if (!response.ok) {
    log(
      `Failed to fetch latest version info from marketplace: ${response.statusText}`,
    );
    return undefined;
  }

  const data = await response.json();
  const extension = data?.results?.[0]?.extensions?.[0];
  // The versions are sorted by date, so the first one is the latest.
  const latestVersion = extension?.versions?.[0]?.version;
  return typeof latestVersion === 'string' && latestVersion.length > 0
    ? latestVersion
    : undefined;
}

async function promptForExtensionUpdate(latestVersion: string) {
  const selection = await vscode.window.showInformationMessage(
    `A new version (${latestVersion}) of the LLxprt Code Companion extension is available.`,
    'Update to latest version',
  );
  if (selection === 'Update to latest version') {
    // The install command will update the extension if a newer version is found.
    await vscode.commands.executeCommand(
      'workbench.extensions.installExtension',
      CLI_IDE_COMPANION_IDENTIFIER,
    );
  }
}

async function checkForUpdates(
  context: vscode.ExtensionContext,
  log: (message: string) => void,
  isManagedExtensionSurface: boolean,
) {
  try {
    const currentVersion = context.extension.packageJSON.version;
    const latestVersion = await fetchLatestMarketplaceVersion(log);

    if (
      !isManagedExtensionSurface &&
      latestVersion !== undefined &&
      semver.gt(latestVersion, currentVersion)
    ) {
      await promptForExtensionUpdate(latestVersion);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error checking for extension updates: ${message}`);
  }
}

function registerDiffCommands(
  context: vscode.ExtensionContext,
  diffContentProvider: DiffContentProvider,
  diffManager: DiffManager,
) {
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === DIFF_SCHEME) {
        void diffManager.cancelDiff(doc.uri);
      }
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      DIFF_SCHEME,
      diffContentProvider,
    ),
    vscode.commands.registerCommand(
      'llxprt.diff.accept',
      (uri?: vscode.Uri) => {
        const docUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (docUri && docUri.scheme === DIFF_SCHEME) {
          void diffManager.acceptDiff(docUri);
        }
      },
    ),
    vscode.commands.registerCommand(
      'llxprt.diff.cancel',
      (uri?: vscode.Uri) => {
        const docUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (docUri && docUri.scheme === DIFF_SCHEME) {
          void diffManager.cancelDiff(docUri);
        }
      },
    ),
  );
}

async function runLLxprtCodeCommand() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showInformationMessage(
      'No folder open. Please open a folder to run LLxprt Code.',
    );
    return;
  }

  let selectedFolder: vscode.WorkspaceFolder | undefined;
  if (workspaceFolders.length === 1) {
    selectedFolder = workspaceFolders[0];
  } else {
    selectedFolder = await vscode.window.showWorkspaceFolderPick({
      placeHolder: 'Select a folder to run LLxprt Code in',
    });
  }

  if (selectedFolder) {
    const llxprtCmd = 'llxprt';
    const terminal = vscode.window.createTerminal({
      name: `LLxprt Code (${selectedFolder.name})`,
      cwd: selectedFolder.uri.fsPath,
    });
    terminal.show();
    terminal.sendText(llxprtCmd);
  }
}

async function showNoticesCommand(context: vscode.ExtensionContext) {
  const noticePath = vscode.Uri.joinPath(context.extensionUri, 'NOTICES.txt');
  await vscode.window.showTextDocument(noticePath);
}

function registerWorkspaceCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateWorkspacePath(context);
      if (ideServer) {
        void ideServer.syncEnvVars();
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      if (ideServer) {
        void ideServer.syncEnvVars();
      }
    }),
    vscode.commands.registerCommand('llxprt-code.runLLxprtCode', () =>
      runLLxprtCodeCommand(),
    ),
    vscode.commands.registerCommand('llxprt-code.showNotices', () =>
      showNoticesCommand(context),
    ),
  );
}

export async function activate(context: vscode.ExtensionContext) {
  logger = vscode.window.createOutputChannel('LLxprt Code IDE Companion');
  log = createLogger(context, logger);
  log('Extension activated');

  updateWorkspacePath(context);

  const isManagedExtensionSurface = MANAGED_EXTENSION_SURFACES.has(
    detectIdeFromEnv().name,
  );

  await checkForUpdates(context, log, isManagedExtensionSurface);

  const diffContentProvider = new DiffContentProvider();
  const diffManager = new DiffManager(log, diffContentProvider);

  registerDiffCommands(context, diffContentProvider, diffManager);

  ideServer = new IDEServer(log, diffManager);
  try {
    await ideServer.start(context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to start IDE server: ${message}`);
  }

  if (
    context.globalState.get(INFO_MESSAGE_SHOWN_KEY) !== true &&
    !isManagedExtensionSurface
  ) {
    void vscode.window.showInformationMessage(
      'LLxprt Code Companion extension successfully installed.',
    );
    context.globalState.update(INFO_MESSAGE_SHOWN_KEY, true);
  }

  registerWorkspaceCommands(context);
}

export async function deactivate(): Promise<void> {
  log('Extension deactivated');
  try {
    // VS Code lifecycle boundary: ideServer may be undefined if activation failed
    if (ideServer) {
      await ideServer.stop();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to stop IDE server during deactivation: ${message}`);
  } finally {
    // VS Code lifecycle boundary: logger may be undefined if activation failed
    if (logger) {
      logger.dispose();
    }
  }
}
