/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read-only wrong-platform contamination preflight for protected host
 * dependency trees (#3450), shared by the per-run private dependency
 * volumes planner in sandbox-node-modules.ts.
 *
 * The sandbox shares the workspace with the host as a read-write bind, so
 * host-installed `node_modules` trees leak into the container with host
 * binaries (and vice versa). Before the destinations are replaced by fresh
 * engine-owned volumes, the EXISTING protected host trees are walked in
 * full and the launch fails when a recognized wrong-platform native binary
 * or a `.bin` symlink that only resolves inside the sandbox image is found.
 * Without it, the empty private mounts would silently turn those into
 * confusing breakage after launch. Traversal covers the full protected
 * trees (truncating it could miss contamination), while artifact
 * recognition is bounded: each candidate gets one fixed-size header probe
 * plus at most one positioned follow-up read.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { canonicalizeNearestExistingPath } from './sandbox-path-canonicalization.js';

/**
 * The image-global executable location validated for this sandbox image:
 * its Dockerfile installs bun under BUN_INSTALL=/usr/local/bun and nothing
 * else lives there. A project `.bin` symlink dangling into this prefix can
 * only resolve inside the sandbox image. Generic system prefixes such as
 * /usr/bin or /usr/local/bin are NOT LLxprt image claims; dangling links
 * to unknown targets are left to the package manager that created them.
 */
const IMAGE_GLOBAL_BIN_PREFIX = '/usr/local/bun/bin/';

const MACH_O_THIN_MAGICS = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
]);
/**
 * On-disk universal/fat magics. Apple stores fat structures big-endian,
 * so the FAT_CIGAM constants are byte-swapped host-memory comparison
 * values, not additional little-endian on-disk formats.
 */
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const FAT_HEADER_BYTES = 8;
const FAT_ARCH_BYTES = 20;
const FAT_ARCH_64_BYTES = 32;
/** Universal binaries never carry more than a handful of slices. */
const MAX_FAT_ARCHITECTURES = 128;
const HEADER_PROBE_BYTES = 512;
/** DOS stubs stay far below this; larger e_lfanew values are not PE. */
const MAX_PE_OFFSET = 1 << 24;

interface RecognizedBinary {
  readonly format: 'ELF' | 'Mach-O' | 'PE';
  readonly platform: 'Linux' | 'macOS' | 'Windows';
}

/**
 * Either a positively recognized binary, a PE whose validated e_lfanew
 * lies beyond the bytes read so far and needs one positioned follow-up
 * read, or a universal header whose declared architecture table extends
 * beyond the bytes read so far and needs its final byte proven readable.
 */
type HeaderClassification =
  | { readonly kind: 'recognized'; readonly binary: RecognizedBinary }
  | { readonly kind: 'pe-continuation'; readonly peOffset: number }
  | { readonly kind: 'fat-continuation'; readonly requiredBytes: number };

function hostPlatformName(): 'Linux' | 'macOS' | 'Windows' {
  switch (os.platform()) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    default:
      return 'Linux';
  }
}

function repairGuidance(relTree: string): string {
  return `Remove the affected project-local node_modules at '${relTree}', reinstall on the host, and retry.`;
}

/**
 * Classifies the minimum bytes needed to recognize ELF, Mach-O (thin and
 * universal/fat), and PE headers. Truncated or unknown content is
 * deliberately not an error: the preflight only rejects what it can
 * positively identify as another platform's binary.
 */
function classifyBinaryHeader(
  bytes: Uint8Array,
): HeaderClassification | undefined {
  if (hasMagicPrefix(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
    return { kind: 'recognized', binary: { format: 'ELF', platform: 'Linux' } };
  }
  if (bytes.length >= 4) {
    const magic = readUint32BE(bytes, 0);
    if (MACH_O_THIN_MAGICS.has(magic)) {
      return recognizedMachO();
    }
    if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
      return classifyFatHeader(bytes, magic);
    }
  }
  return classifyPeHeader(bytes);
}

/**
 * Classifies a universal/fat Mach-O header. A universal binary is only
 * recognized when its COMPLETE declared architecture table is readable:
 * a bare magic-plus-nfat_arch prefix is a truncated file, which the
 * preflight treats as benign. The architecture count stays bounded so
 * random bytes (or a same-magic foreign format) are not mistaken for a
 * universal binary.
 */
function classifyFatHeader(
  bytes: Uint8Array,
  magic: number,
): HeaderClassification | undefined {
  if (bytes.length < FAT_HEADER_BYTES) return undefined;
  const architectureCount = readUint32BE(bytes, 4);
  if (architectureCount < 1 || architectureCount > MAX_FAT_ARCHITECTURES) {
    return undefined;
  }
  const recordBytes =
    magic === FAT_MAGIC_64 ? FAT_ARCH_64_BYTES : FAT_ARCH_BYTES;
  const requiredBytes = FAT_HEADER_BYTES + architectureCount * recordBytes;
  return requiredBytes <= bytes.length
    ? recognizedMachO()
    : { kind: 'fat-continuation', requiredBytes };
}

function recognizedMachO(): HeaderClassification {
  return {
    kind: 'recognized',
    binary: { format: 'Mach-O', platform: 'macOS' },
  };
}

/** PE needs the MZ magic, a sane readable e_lfanew, and a `PE\0\0`. */
function classifyPeHeader(bytes: Uint8Array): HeaderClassification | undefined {
  if (!hasMagicPrefix(bytes, [0x4d, 0x5a]) || bytes.length < 0x40) {
    return undefined;
  }
  const peOffset = readUint32LE(bytes, 0x3c);
  if (peOffset < 0x40 || peOffset > MAX_PE_OFFSET) {
    return undefined;
  }
  if (peOffset + 4 <= bytes.length) {
    return hasMagicPrefix(bytes.subarray(peOffset), [0x50, 0x45, 0x00, 0x00])
      ? { kind: 'recognized', binary: { format: 'PE', platform: 'Windows' } }
      : undefined;
  }
  // The validated offset lies beyond the probe buffer; the caller must read
  // the signature at the offset itself.
  return { kind: 'pe-continuation', peOffset };
}

function hasMagicPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] * 0x01_00_00_00 +
      bytes[offset + 1] * 0x1_00_00 +
      bytes[offset + 2] * 0x1_00 +
      bytes[offset + 3]) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] +
      bytes[offset + 1] * 0x1_00 +
      bytes[offset + 2] * 0x1_00_00 +
      bytes[offset + 3] * 0x01_00_00_00) >>>
    0
  );
}

function readHeaderBytes(filePath: string): Uint8Array | undefined {
  return readBytesAt(filePath, 0, HEADER_PROBE_BYTES);
}

function readBytesAt(
  filePath: string,
  offset: number,
  length: number,
): Uint8Array | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
    if (bytesRead === 0) return undefined;
    return buffer.subarray(0, bytesRead);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function assertHeaderMatchesHost(
  filePath: string,
  relPath: string,
  relTree: string,
): void {
  const header = readHeaderBytes(filePath);
  if (header === undefined) return;
  const classification = classifyBinaryHeader(header);
  if (classification === undefined) return;
  const recognized = completeClassification(filePath, classification);
  if (recognized === undefined) return;
  const host = hostPlatformName();
  if (recognized.platform !== host) {
    throw new FatalSandboxError(
      `Sandbox dependency preflight failed: '${relPath}' is a ` +
        `${recognized.format} binary for ${recognized.platform}, which does ` +
        `not match this host (${host}). ${repairGuidance(relTree)}`,
    );
  }
}

function completeClassification(
  filePath: string,
  classification: HeaderClassification,
): RecognizedBinary | undefined {
  if (classification.kind === 'recognized') return classification.binary;
  if (classification.kind === 'fat-continuation') {
    // Reading the table's final byte proves the complete declared
    // architecture table exists in the file; a short read means the file
    // is truncated and stays benign.
    const tail = readBytesAt(filePath, classification.requiredBytes - 1, 1);
    return tail === undefined
      ? undefined
      : { format: 'Mach-O', platform: 'macOS' };
  }
  const signature = readBytesAt(filePath, classification.peOffset, 4);
  if (signature === undefined) return undefined;
  return hasMagicPrefix(signature, [0x50, 0x45, 0x00, 0x00])
    ? { format: 'PE', platform: 'Windows' }
    : undefined;
}

/** True when the resolved target stays inside the real workspace tree. */
function isContainedTarget(
  workspaceRealRoot: string,
  resolvedTarget: string,
): boolean {
  const nearest = canonicalizeNearestExistingPath(
    resolvedTarget,
    'resolve the sandbox dependency symlink target',
  );
  return isInsideWorkspace(workspaceRealRoot, nearest);
}

function assertBinSymlinkResolvesOnHost(
  linkPath: string,
  relPath: string,
  relTree: string,
  workspaceRealRoot: string,
): void {
  let target: string;
  try {
    target = fs.readlinkSync(linkPath);
  } catch {
    return;
  }
  if (path.isAbsolute(target)) {
    // Only a dangling link into the validated image-global bun location is
    // a recognizable LLxprt-image-only target; every other absolute target
    // is an unknown host-side claim this preflight does not judge.
    const isImageGlobalTarget = target.startsWith(IMAGE_GLOBAL_BIN_PREFIX);
    if (isImageGlobalTarget && !fs.existsSync(target)) {
      throw new FatalSandboxError(
        `Sandbox dependency preflight failed: '${relPath}' is a symlink to ` +
          `'${target}', which only exists inside the LLxprt sandbox image, ` +
          `not on this host (${hostPlatformName()}). ${repairGuidance(relTree)}`,
      );
    }
    return;
  }
  // Relative targets are only inspected while they stay inside the real
  // workspace tree; escaping targets belong to the host, not this launch.
  const resolved = path.resolve(path.dirname(linkPath), target);
  if (!isContainedTarget(workspaceRealRoot, resolved)) return;
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return;
  }
  if (stat.isFile()) {
    assertHeaderMatchesHost(resolved, relPath, relTree);
  }
}

function assertNodeSymlinkMatchesHost(
  linkPath: string,
  relPath: string,
  relTree: string,
  workspaceRealRoot: string,
): void {
  let target: string;
  try {
    target = fs.readlinkSync(linkPath);
  } catch {
    return;
  }
  const resolved = path.isAbsolute(target)
    ? target
    : path.resolve(path.dirname(linkPath), target);
  if (!isContainedTarget(workspaceRealRoot, resolved)) return;
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return;
  }
  if (stat.isFile()) {
    assertHeaderMatchesHost(resolved, relPath, relTree);
  }
}

export function preflightProtectedTree(
  tree: string,
  workdir: string,
  workspaceRealRoot: string,
): void {
  const relTree = path.relative(workdir, tree);
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Unreadable or absent trees are not contamination; the empty private
      // mount replaces them anyway.
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(workdir, fullPath);
      if (entry.isDirectory()) {
        // node-gyp-build `prebuilds/` directories deliberately ship binaries
        // for many platforms in one install; only the loader for the current
        // platform is ever used, so foreign entries there are inert data, not
        // contamination. Other directories are walked in place (directory
        // symlinks are never followed out of the tree).
        if (entry.name !== 'prebuilds') {
          walk(fullPath);
        }
      } else if (entry.isSymbolicLink()) {
        if (path.basename(dir) === '.bin') {
          assertBinSymlinkResolvesOnHost(
            fullPath,
            relPath,
            relTree,
            workspaceRealRoot,
          );
        } else if (entry.name.endsWith('.node')) {
          assertNodeSymlinkMatchesHost(
            fullPath,
            relPath,
            relTree,
            workspaceRealRoot,
          );
        }
      } else if (
        entry.isFile() &&
        (path.basename(dir) === '.bin' || entry.name.endsWith('.node'))
      ) {
        // Regular executables sitting directly in `.bin` are inspected like
        // native addons: they are what the container would try to run.
        assertHeaderMatchesHost(fullPath, relPath, relTree);
      }
    }
  };
  walk(tree);
}

export function isInsideWorkspace(workdir: string, candidate: string): boolean {
  const relative = path.relative(workdir, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
