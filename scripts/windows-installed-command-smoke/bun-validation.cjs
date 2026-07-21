'use strict';

/**
 * Validation helpers for the bundled bun.exe on Windows.
 *
 * Background (CI run 29850614559, root cause B):
 *   A timed-out npm install left a PARTIALLY installed package. The fixture
 *   was copied BEFORE Bun's postinstall completed, yielding a bun.exe that was
 *   not a real Windows PE binary — launching it produced "not compatible with
 *   the version of Windows you're running" (exit 216).
 *
 * These helpers verify, before a fixture is used, that:
 *   1. bun.exe is a valid Windows PE binary (MZ + PE signature), and
 *   2. `bun.exe --version` reports the exact expected version.
 *
 * They are pure (read-only) so they can be unit-tested with synthetic files
 * without spawning the real binary.
 */

const { spawnSync } = require('node:child_process');

/**
 * DOS MZ header magic ("MZ").
 */
const MZ_MAGIC = Buffer.from([0x4d, 0x5a]);

/**
 * PE signature ("PE\0\0") is located at the offset stored in the e_lfanew
 * field (a little-endian uint32 at offset 0x3c).
 */
const PE_SIGNATURE = Buffer.from([0x50, 0x45, 0x00, 0x00]);
const ELFANEW_OFFSET = 0x3c;

/**
 * Reads the first N bytes of a file (default 4KB) and returns them. Throws with
 * the path on any I/O error so a missing/unreadable binary is reported clearly
 * rather than as an opaque "not a PE" failure.
 *
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @returns {Buffer}
 */
function readHeader(filePath, maxBytes = 4096) {
  let fd;
  try {
    // Use readFileSync with a smaller read by opening, reading a slice, then
    // closing. Node's readFileSync reads the whole file; for a multi-MB binary
    // we only need the first 4KB. Use fs.openSync/readSync for efficiency.
    const fs = require('node:fs');
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } catch (e) {
    throw new Error(
      `bun-validation: could not read header of ${filePath}: ${e.message}`,
    );
  } finally {
    if (fd !== undefined) {
      try {
        require('node:fs').closeSync(fd);
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Returns true when the file at filePath begins with the DOS MZ magic AND
 * contains a PE signature at the e_lfanew offset. This is the minimal check
 * that the file is a Windows PE-family binary (not, e.g., a partial download
 * or a POSIX shell script).
 *
 * @param {string} filePath
 * @param {{ readHeader?: (p: string, n?: number) => Buffer }} [options]
 * @returns {boolean}
 */
function isWindowsPe(filePath, options) {
  const reader = (options && options.readHeader) || readHeader;
  let header;
  try {
    header = reader(filePath);
  } catch {
    return false;
  }
  if (header.length < ELFANEW_OFFSET + 4) return false;
  if (header.subarray(0, 2).compare(MZ_MAGIC) !== 0) return false;
  const peOffset = header.readUInt32LE(ELFANEW_OFFSET);
  if (peOffset <= 0 || peOffset + PE_SIGNATURE.length > header.length) {
    return false;
  }
  return (
    header
      .subarray(peOffset, peOffset + PE_SIGNATURE.length)
      .compare(PE_SIGNATURE) === 0
  );
}

/**
 * Spawns `bun.exe --version` and returns the trimmed stdout. Throws on spawn
 * failure, nonzero exit, or non-version output so callers can distinguish a
 * corrupt/incompatible binary from a healthy one.
 *
 * @param {string} bunExePath
 * @param {{ spawnSync?: typeof import('node:child_process').spawnSync, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {string}
 */
function bunVersion(bunExePath, options) {
  const spawn = (options && options.spawnSync) || spawnSync;
  const env = (options && options.env) || process.env;
  const timeoutMs = (options && options.timeoutMs) || 15_000;
  const r = spawn(bunExePath, ['--version'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env,
  });
  if (r.error) {
    throw new Error(
      `bun-validation: '${bunExePath} --version' spawn failed: ${r.error.message}`,
    );
  }
  if (r.signal) {
    throw new Error(
      `bun-validation: '${bunExePath} --version' terminated by signal ${r.signal}`,
    );
  }
  if (r.status !== 0) {
    throw new Error(
      `bun-validation: '${bunExePath} --version' exited ${r.status}: ${(r.stderr || '').trim()}`,
    );
  }
  return String(r.stdout).trim();
}

/**
 * Asserts that bunExePath is a Windows PE binary AND reports the expected
 * version. Throws an aggregate Error (with isWindowsPe/bunVersion details) on
 * any failure so a single clear diagnostic surfaces. This is the "before using
 * fixture" gate described in root cause B.
 *
 * @param {string} bunExePath
 * @param {string} expectedVersion
 * @param {{ readHeader?: (p: string, n?: number) => Buffer, spawnSync?: typeof import('node:child_process').spawnSync, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @throws {Error}
 */
function assertBundledBunHealthy(bunExePath, expectedVersion, options) {
  const reasons = [];
  if (!isWindowsPe(bunExePath, options)) {
    reasons.push(`not a valid Windows PE binary (expected MZ+PE signature)`);
  }
  // Even if the PE check failed, attempt --version to produce the concrete
  // incompatibility error (e.g. exit 216 "not compatible with Windows") which
  // is far more actionable than a bare magic-number mismatch.
  let actualVersion = null;
  try {
    actualVersion = bunVersion(bunExePath, options);
  } catch (e) {
    reasons.push(`--version failed: ${e.message}`);
  }
  if (actualVersion !== null && actualVersion !== expectedVersion) {
    reasons.push(
      `version ${JSON.stringify(actualVersion)} != expected ${JSON.stringify(expectedVersion)}`,
    );
  }
  if (reasons.length > 0) {
    throw new Error(
      `bun-validation: bundled bun.exe at ${bunExePath} failed health check:\n  - ` +
        reasons.join('\n  - '),
    );
  }
}

module.exports = {
  isWindowsPe,
  bunVersion,
  assertBundledBunHealthy,
  readHeader,
  MZ_MAGIC,
  PE_SIGNATURE,
  ELFANEW_OFFSET,
};
