/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { posix, relative, resolve, win32 } from 'node:path';

export function compilerSourcePath(file: string): string {
  const portable = file.replaceAll('\\', '/');
  return posix.normalize(
    win32.isAbsolute(portable)
      ? portable
      : resolve(portable).replaceAll('\\', '/'),
  );
}

export function portableRelativePath(from: string, to: string): string {
  return relative(from, to).replaceAll('\\', '/');
}
