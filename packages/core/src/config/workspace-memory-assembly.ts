/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustReadPort } from '../services/workspace-trust-reader.js';
import type { Config } from './config.js';
import type { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import { WorkspaceMemoryOwner } from '../services/workspace-memory-owner.js';

export function assembleWorkspaceMemory(
  config: Pick<
    Config,
    | 'globalConfigRoot'
    | 'getMemorySettings'
    | 'getWorkingDir'
    | 'isJitContextEnabled'
    | 'getDebugMode'
    | 'shouldLoadMemoryFromIncludeDirectories'
    | 'getExtensions'
  >,
  filesystem: Pick<WorkspaceFilesystemOwner, 'paths' | 'ignore' | 'scans'>,
  trust: WorkspaceTrustReadPort,
  readExtensions: () => ReturnType<Config['getExtensions']> = () =>
    config.getExtensions(),
): WorkspaceMemoryOwner {
  const settings = config.getMemorySettings();
  return new WorkspaceMemoryOwner({
    globalMemoryDir: config.globalConfigRoot,
    workingDirectory: config.getWorkingDir(),
    jitEnabled: config.isJitContextEnabled(),
    debugMode: config.getDebugMode(),
    loadIncludes: config.shouldLoadMemoryFromIncludeDirectories(),
    filtering: settings.filtering,
    maxDirectories: settings.maxDirectories,
    maxDepth: settings.maxDepth,
    filenames: settings.filenames,
    importFormat: settings.importFormat,
    paths: filesystem.paths,
    ignore: filesystem.ignore,
    scans: filesystem.scans,
    isTrusted: () => trust.isTrustedFolder(),
    extensions: readExtensions,
  });
}
