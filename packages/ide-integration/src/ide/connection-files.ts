/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { terminalAnnouncesSupportedIde, type IdeInfo } from './detect-ide.js';

/** Companions publish `llxprt-ide-server-<pid>[-<port>].json` under the temp dir. */
const CONNECTION_FILE_PREFIX = 'llxprt-ide-server-';

function isConnectionFileName(name: string): boolean {
  return name.startsWith(CONNECTION_FILE_PREFIX) && name.endsWith('.json');
}

/**
 * Whether the process ancestry could identify an IDE: the terminal announces a
 * supported IDE, or some companion has published a connection file whose pid
 * the ancestry would be matched against. A directory that cannot be listed for
 * any reason other than not existing leaves the question open, so the lookup
 * runs.
 */
export async function mayBeInsideIde(): Promise<boolean> {
  if (terminalAnnouncesSupportedIde()) {
    return true;
  }
  for (const directory of [
    path.join(os.tmpdir(), 'llxprt', 'ide'),
    os.tmpdir(),
  ]) {
    let names: string[];
    try {
      names = await fs.promises.readdir(directory);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        continue;
      return true;
    }
    if (names.some(isConnectionFileName)) {
      return true;
    }
  }
  return false;
}

export interface PublishedConnection {
  port?: string;
  authToken?: string;
  workspacePath?: string;
  ideInfo?: IdeInfo;
}

function toPublishedConnection(contents: string): PublishedConnection {
  const data = JSON.parse(contents);
  return {
    port: data?.port?.toString(),
    workspacePath: data?.workspacePath,
    authToken: data?.authToken,
    ideInfo: data?.ideInfo,
  };
}

/**
 * Reads the connection file the companion of IDE process `pid` published,
 * from the current location (`<tmp>/llxprt/ide/llxprt-ide-server-<pid>-<port>.json`)
 * or the legacy one (`<tmp>/llxprt-ide-server-<pid>.json`). Absent or
 * unreadable files mean no companion is running: the result is empty.
 */
export async function readPublishedConnection(
  pid: number,
): Promise<PublishedConnection> {
  try {
    const directory = path.join(os.tmpdir(), 'llxprt', 'ide');
    const prefix = `${CONNECTION_FILE_PREFIX}${pid}-`;
    const published = (await fs.promises.readdir(directory)).find(
      (name) => name.startsWith(prefix) && name.endsWith('.json'),
    );
    if (published) {
      return toPublishedConnection(
        await fs.promises.readFile(path.join(directory, published), 'utf8'),
      );
    }
  } catch {
    // Not in the current location; try the legacy one.
  }
  try {
    return toPublishedConnection(
      await fs.promises.readFile(
        path.join(os.tmpdir(), `${CONNECTION_FILE_PREFIX}${pid}.json`),
        'utf8',
      ),
    );
  } catch {
    return {};
  }
}
