/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the shared source-development predicate (#3455).
 *
 * Ambient NODE_ENV=development exported in an unrelated shell must not make
 * the sandbox select the llxprt source entrypoint: an arbitrary repository
 * gets the sandbox image's installed `llxprt` command and the #3450 private
 * dependency volumes. A positively identified llxprt-code source checkout
 * still execs the checked-out source command over the shared workspace
 * bind, because bootstrapping the source CLI needs the repository's own
 * dependencies.
 *
 * The command-selection cases execute the REAL generated entrypoint script
 * with PATH-recorded `llxprt`/`bun` stand-ins; the isolation cases drive
 * the REAL planning code against the PATH-installed fake container engine.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { entrypoint } from './sandbox-entrypoint.js';
import { addPrivateDependencyMounts } from './sandbox-node-modules.js';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';

/** The checked-out CLI source entrypoint a real llxprt-code checkout has. */
const SOURCE_ENTRY = path.join('packages', 'cli', 'index.ts');

function makeWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedArbitraryRepository(workdir: string): void {
  fs.mkdirSync(path.join(workdir, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(workdir, 'node_modules', 'left-pad'),
    'an arbitrary host dependency tree\n',
  );
}

function seedSourceCheckout(workdir: string): void {
  fs.mkdirSync(path.join(workdir, path.dirname(SOURCE_ENTRY)), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(workdir, SOURCE_ENTRY),
    '// checked-out CLI source entrypoint\n',
  );
}

/** Saves/restores NODE_ENV around one test-controlled assignment. */
function setNodeEnv(value: string | undefined): () => void {
  const saved = process.env.NODE_ENV;
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
  return () => {
    if (saved === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = saved;
    }
  };
}

interface ShimInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Installs PATH-recorded `llxprt` and `bun` executables. The one the
 * generated entrypoint execs appends its command name and forwarded
 * arguments, one per line, to the recording file.
 */
function installRecordingShims(binDir: string, recordPath: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ['llxprt', 'bun']) {
    const shimPath = path.join(binDir, name);
    fs.writeFileSync(
      shimPath,
      [
        '#!/usr/bin/env bash',
        'printf \'%s\\n\' "$(basename "$0")" "$@" >> ' +
          JSON.stringify(recordPath),
      ].join('\n'),
    );
    fs.chmodSync(shimPath, 0o755);
  }
}

function readShimInvocation(recordPath: string): ShimInvocation | undefined {
  if (!fs.existsSync(recordPath)) return undefined;
  const lines = fs.readFileSync(recordPath, 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const [command, ...args] = lines;
  if (command === '') return undefined;
  return { command, args };
}

describe('#3455 entrypoint command selection', () => {
  let root = '';
  let repo = '';
  let binDir = '';
  let recordPath = '';

  beforeEach(() => {
    root = makeWorkspace('issue3455-cmd-');
    repo = path.join(root, 'repo');
    binDir = path.join(root, 'bin');
    recordPath = path.join(root, 'invocation.txt');
    fs.mkdirSync(repo);
    installRecordingShims(binDir, recordPath);
    delete process.env.DEBUG;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Executes the real generated entrypoint inside the seeded repository. */
  function runEntrypoint(): ShimInvocation | undefined {
    // cliArgs is [cli, subcommand, ...userArgs]; nothing after index 1 means
    // the final exec is the bare CLI command with no forwarded arguments.
    const cmd = entrypoint(repo, ['llxprt', 'chat']);
    const result = spawnSync(cmd[0], cmd.slice(1), {
      encoding: 'utf8',
      cwd: repo,
      env: {
        ...process.env,
        BASH_ENV: '',
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    return readShimInvocation(recordPath);
  }

  it
    .skipIf(process.platform === 'win32')
    .each(['development', 'production', 'test', undefined])(
    'arbitrary repository with NODE_ENV=%s execs the image-installed llxprt',
    (nodeEnv) => {
      seedArbitraryRepository(repo);
      const restore = setNodeEnv(nodeEnv);
      try {
        expect(runEntrypoint()).toStrictEqual({
          command: 'llxprt',
          args: [],
        });
      } finally {
        restore();
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'source checkout with NODE_ENV=development execs the checked-out source command',
    () => {
      seedSourceCheckout(repo);
      const restore = setNodeEnv('development');
      try {
        expect(runEntrypoint()).toStrictEqual({
          command: 'bun',
          args: ['./packages/cli/index.ts'],
        });
      } finally {
        restore();
      }
    },
  );

  it
    .skipIf(process.platform === 'win32')
    .each(['production', 'test', undefined])(
    'source checkout with NODE_ENV=%s execs the image-installed llxprt',
    (nodeEnv) => {
      seedSourceCheckout(repo);
      const restore = setNodeEnv(nodeEnv);
      try {
        expect(runEntrypoint()).toStrictEqual({
          command: 'llxprt',
          args: [],
        });
      } finally {
        restore();
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'a directory named packages/cli/index.ts is not a source checkout',
    () => {
      fs.mkdirSync(path.join(repo, SOURCE_ENTRY), { recursive: true });
      const restore = setNodeEnv('development');
      try {
        expect(runEntrypoint()).toStrictEqual({
          command: 'llxprt',
          args: [],
        });
      } finally {
        restore();
      }
    },
  );
});

describe('#3455 shared predicate drives private dependency isolation', () => {
  const engine = useFakeEngine();
  let workdir = '';

  beforeEach(() => {
    workdir = makeWorkspace('issue3455-iso-');
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function mountValues(args: readonly string[]): readonly string[] {
    return args.filter(
      (token, index) => index > 0 && args[index - 1] === '--mount',
    );
  }

  /** Runs the real mount planning under NODE_ENV and returns the argv. */
  function planWithEngine(
    config: { command: 'docker' | 'podman'; image: string },
    nodeEnv: string | undefined,
  ): { args: string[]; release: () => void } {
    const restore = setNodeEnv(nodeEnv);
    const args: string[] = ['--volume', `${workdir}:${workdir}`];
    const lifecycle = addPrivateDependencyMounts(config, args, workdir);
    let released = false;
    return {
      args,
      release: () => {
        restore();
        if (!released) {
          released = true;
          lifecycle.release();
        }
      },
    };
  }

  it('arbitrary repository with NODE_ENV=development cannot bypass private dependency volumes (docker)', () => {
    seedArbitraryRepository(workdir);
    const planned = planWithEngine(engine.config, 'development');
    try {
      expect(mountValues(planned.args)).toHaveLength(1);
      expect(mountValues(planned.args)[0]).toMatch(/^type=volume,/);
      expect(engine.volumeNames()).toHaveLength(1);
    } finally {
      planned.release();
    }
  });

  it('arbitrary repository with NODE_ENV=development cannot bypass private dependency volumes (podman)', () => {
    seedArbitraryRepository(workdir);
    const planned = planWithEngine(engine.podmanConfig, 'development');
    try {
      expect(mountValues(planned.args)).toStrictEqual([
        `type=volume,src=${engine.volumeNames()[0]},dst=${path.join(workdir, 'node_modules')}`,
      ]);
      expect(engine.volumeNames()).toHaveLength(1);
    } finally {
      planned.release();
    }
  });

  it('arbitrary repository without development NODE_ENV still gets private dependency volumes', () => {
    seedArbitraryRepository(workdir);
    const planned = planWithEngine(engine.config, undefined);
    try {
      expect(mountValues(planned.args)).toHaveLength(1);
      expect(engine.volumeNames()).toHaveLength(1);
    } finally {
      planned.release();
    }
  });

  it('source checkout with NODE_ENV=development keeps the shared workspace bind', () => {
    seedSourceCheckout(workdir);
    fs.mkdirSync(path.join(workdir, 'node_modules'), { recursive: true });
    const planned = planWithEngine(engine.config, 'development');
    try {
      expect(planned.args).toStrictEqual(['--volume', `${workdir}:${workdir}`]);
      expect(engine.snapshot().invocations).toStrictEqual([]);
      expect(engine.volumeNames()).toStrictEqual([]);
    } finally {
      planned.release();
    }
  });

  it.each(['production', undefined])(
    'source checkout with NODE_ENV=%s still gets private dependency volumes',
    (nodeEnv) => {
      seedSourceCheckout(workdir);
      fs.mkdirSync(path.join(workdir, 'node_modules'), { recursive: true });
      const planned = planWithEngine(engine.config, nodeEnv);
      try {
        expect(mountValues(planned.args)).toHaveLength(1);
        expect(engine.volumeNames()).toHaveLength(1);
      } finally {
        planned.release();
      }
    },
  );
});
