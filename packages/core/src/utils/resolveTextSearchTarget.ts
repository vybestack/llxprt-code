import fs from 'fs';
import path from 'path';
import { isNodeError } from './errors.js';
import type { WorkspaceContext } from './workspaceContext.js';

export type ResolvedSearchTarget =
  | { readonly kind: 'all-workspaces' }
  | { readonly kind: 'directory'; readonly searchDir: string }
  | {
      readonly kind: 'file';
      readonly filePath: string;
      readonly parentDir: string;
      readonly basename: string;
    };

export function resolveTextSearchTarget(
  targetDir: string,
  workspaceContext: WorkspaceContext,
  relativePath?: string,
): ResolvedSearchTarget {
  if (!relativePath) {
    return { kind: 'all-workspaces' };
  }

  const targetPath = path.resolve(targetDir, relativePath);

  if (!workspaceContext.isPathWithinWorkspace(targetPath)) {
    const directories = workspaceContext.getDirectories();
    throw new Error(
      `Path validation failed: Attempted path "${relativePath}" resolves outside the allowed workspace directories: ${directories.join(', ')}`,
    );
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(targetPath);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(`Path does not exist: ${targetPath}`);
    }
    if (isNodeError(error) && error.code === 'EACCES') {
      throw new Error(`Permission denied: ${targetPath}`);
    }
    throw new Error(
      `Failed to access path stats for ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (stats.isDirectory()) {
    return { kind: 'directory', searchDir: targetPath };
  }

  if (stats.isFile()) {
    return {
      kind: 'file',
      filePath: targetPath,
      parentDir: path.dirname(targetPath),
      basename: path.basename(targetPath),
    };
  }

  throw new Error(`Path is neither a file nor a directory: ${targetPath}`);
}
