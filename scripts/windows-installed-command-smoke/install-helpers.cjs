'use strict';

/**
 * npm install helpers for the Windows smoke: global install, local install,
 * and local cmd version verification. These are separated from the behavioral
 * checks so the install lifecycle can be reused independently.
 */

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const { assert, runStep } = require('./assert.cjs');
const { CONSTRAINED_PATH } = require('./constants.cjs');
const { npmInvocation } = require('../lib/npm-command.cjs');

function globalInstall(tempDir, replicaTarball) {
  let prefix;
  runStep('global-install', () => {
    prefix = join(tempDir, 'global-prefix');
    mkdirSync(prefix, { recursive: true });
    const { command, args } = npmInvocation([
      'install',
      '--global',
      '--prefix',
      prefix,
      '--cache',
      join(tempDir, 'npm-cache'),
      '--loglevel',
      'error',
      replicaTarball,
    ]);
    const r = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) {
      throw new Error(`npm global install spawn failed: ${r.error.message}`);
    }
    if (r.status !== 0) {
      throw new Error(
        `npm global install failed (exit ${r.status}, signal=${r.signal ?? 'none'}): ${r.stderr || r.stdout}`,
      );
    }
  });
  return prefix;
}

function localInstall(tempDir, replicaTarball) {
  let consumerDir;
  runStep('local-install', () => {
    consumerDir = join(tempDir, 'consumer');
    mkdirSync(consumerDir, { recursive: true });
    writeFileSync(
      join(consumerDir, 'package.json'),
      JSON.stringify({ name: 'consumer', version: '0.0.0' }, null, 2),
    );
    const { command, args } = npmInvocation([
      'install',
      '--cache',
      join(tempDir, 'npm-cache-local'),
      '--loglevel',
      'error',
      replicaTarball,
    ]);
    const r = spawnSync(command, args, {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) {
      throw new Error(`npm local install spawn failed: ${r.error.message}`);
    }
    if (r.status !== 0) {
      throw new Error(
        `npm local install failed (exit ${r.status}, signal=${r.signal ?? 'none'}): ${r.stderr || r.stdout}`,
      );
    }
  });
  return consumerDir;
}

function checkLocalCmdVersion(consumerDir) {
  runStep('local-cmd-version', () => {
    const cmdPath = join(consumerDir, 'node_modules', '.bin', 'llxprt.cmd');
    assert(existsSync(cmdPath), `local cmd launcher not found: ${cmdPath}`);
    const r = spawnSync('cmd', ['/c', cmdPath, '--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PATH: CONSTRAINED_PATH },
    });
    if (r.status !== 0) {
      throw new Error(`local cmd --version exited ${r.status}: ${r.stderr}`);
    }
  });
}

function checkPackageLocalBun(
  prefix,
  findInstalledPackageRoot,
  findBundledBun,
) {
  runStep('package-local-bun-exists', () => {
    const packageRoot = findInstalledPackageRoot(prefix);
    const bunExe = findBundledBun(packageRoot);
    assert(existsSync(bunExe), `package-local bun.exe not found: ${bunExe}`);
  });
}

module.exports = {
  globalInstall,
  localInstall,
  checkLocalCmdVersion,
  checkPackageLocalBun,
};
