/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2903: the default sandbox image no longer installs the GitHub CLI
 * (`gh`). Host-side GitHub access now flows through the supported GitHub host
 * broker and the `github` tool, so the sandbox-local binary is redundant.
 *
 * This is a usability and path-clarity regression guard. It is not a
 * containment or network security control. It reads the repository's actual
 * root `Dockerfile` (no fixture, no mock) and proves:
 *   - AC1: `gh` is not requested as an apt-install package.
 *   - AC2: `jq` remains an apt-install package, because its usefulness is not
 *     limited to parsing GitHub responses.
 *
 * Every `apt-get install` invocation is inspected, and only complete Debian
 * package-name tokens are matched, so a `gh` request cannot slip through by
 * being written inline on the install line, chained into the same RUN, or
 * placed in a later block — and unrelated prose or comments containing `gh`
 * can never satisfy or fail the contract.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..', '..');
const dockerfilePath = join(repoRoot, 'Dockerfile');

/**
 * Debian package names: lowercase alphanumerics plus `-`, `+`, `.`, and `~`,
 * starting with an alphanumeric. Version (`package=version`) and release
 * (`package/release`) selectors are removed before matching so the assertion
 * checks the requested package rather than its apt selector.
 */
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9+.~-]*$/;

function readDockerfile(): string {
  return readFileSync(dockerfilePath, 'utf8');
}

/**
 * Extracts every apt package-name token requested by the Dockerfile's
 * `apt-get install` invocations.
 *
 * Backslash-continuation lines are first collapsed into a single logical line
 * per instruction. The resulting token stream is then walked with a small
 * state machine: package tokens are collected only after the literal
 * `apt-get install` sequence and until the next shell separator (`&&`, `||`,
 * or `;`) or the end of the instruction. A `gh` request therefore cannot
 * hide by being written inline, chained via `&&`, or deferred to a later
 * block, while command fragments such as `apt-get clean` and prose in
 * comments — even a bare `install` keyword — are never mistaken for packages.
 */
function extractAptPackages(dockerfile: string): readonly string[] {
  const packages: string[] = [];
  let sawInstall = false;

  for (const logicalLine of collapseContinuations(dockerfile)) {
    let capturing = false;
    let prevAptGet = false;
    for (const token of logicalLine.split(/\s+/)) {
      const outcome = inspectToken(token, capturing, prevAptGet);
      if (outcome.sawInstall) {
        sawInstall = true;
      }
      capturing = outcome.capturing;
      prevAptGet = outcome.prevAptGet;
      if (outcome.packageName !== undefined) {
        packages.push(outcome.packageName);
      }
    }
  }

  if (!sawInstall) {
    throw new Error('Dockerfile contains no apt-get install invocation');
  }
  return packages;
}

/**
 * Outcome of inspecting one token within an `apt-get install` argument list.
 * `capturing` is the state carried into the next token; `packageName` is set
 * when the token is a complete Debian package name worth recording;
 * `sawInstall` flags that the literal `apt-get install` sequence was observed;
 * `prevAptGet` records that the immediately preceding token was `apt-get`, so
 * capture begins only for that exact two-token sequence.
 */
interface TokenOutcome {
  capturing: boolean;
  packageName: string | undefined;
  sawInstall: boolean;
  prevAptGet: boolean;
}

/**
 * Classifies a single token of a collapsed RUN instruction. Encapsulating the
 * decision here keeps the token loop free of multiple `break`/`continue`
 * statements.
 */
function inspectToken(
  token: string,
  capturing: boolean,
  prevAptGet: boolean,
): TokenOutcome {
  if (token === 'apt-get') {
    return {
      capturing: false,
      packageName: undefined,
      sawInstall: false,
      prevAptGet: true,
    };
  }
  if (token === 'install') {
    // Capture begins only for the literal `apt-get install` sequence, so a
    // bare `install` in prose or comments (e.g. `# install gh ...`) cannot
    // start a capture.
    return {
      capturing: prevAptGet,
      packageName: undefined,
      sawInstall: prevAptGet,
      prevAptGet: false,
    };
  }
  if (!capturing) {
    return {
      capturing: false,
      packageName: undefined,
      sawInstall: false,
      prevAptGet: false,
    };
  }
  if (token === '&&' || token === '||' || token === ';') {
    return {
      capturing: false,
      packageName: undefined,
      sawInstall: false,
      prevAptGet: false,
    };
  }
  if (token === '' || token.startsWith('-')) {
    return {
      capturing,
      packageName: undefined,
      sawInstall: false,
      prevAptGet: false,
    };
  }
  const [packageName] = token.split(/[=/]/, 1);
  if (PACKAGE_NAME_PATTERN.test(packageName)) {
    return {
      capturing,
      packageName,
      sawInstall: false,
      prevAptGet: false,
    };
  }
  return {
    capturing,
    packageName: undefined,
    sawInstall: false,
    prevAptGet: false,
  };
}

/**
 * Joins Dockerfile backslash-continuation lines into one logical line per
 * instruction so a single `apt-get install` is seen whole regardless of how
 * its arguments are laid out across lines.
 */
function collapseContinuations(dockerfile: string): readonly string[] {
  const lines = dockerfile.split(/\r?\n/);
  const logicalLines: string[] = [];
  let buffer = '';
  for (const line of lines) {
    const trimmedEnd = line.trimEnd();
    const continued = trimmedEnd.endsWith('\\');
    buffer += ' ' + (continued ? trimmedEnd.slice(0, -1) : line);
    if (!continued) {
      logicalLines.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim() !== '') {
    logicalLines.push(buffer);
  }
  return logicalLines;
}

describe('issue #2903: default Dockerfile apt package set', () => {
  const packages = extractAptPackages(readDockerfile());

  it('parses a non-empty package set from the apt-get install block', () => {
    // Guards against a silently empty parse that would let the `gh`-absent
    // assertion pass vacuously.
    expect(packages.length).toBeGreaterThan(0);
  });

  it('does not request gh as an installed package (AC1)', () => {
    expect(packages).not.toContain('gh');
  });

  it('still requests jq as an installed package (AC2)', () => {
    expect(packages).toContain('jq');
  });
});

describe('issue #2903: extractAptPackages boundary behavior', () => {
  it('detects gh written inline on the apt-get install line', () => {
    const dockerfile = 'RUN apt-get update && apt-get install -y gh';
    expect(extractAptPackages(dockerfile)).toContain('gh');
  });

  it('detects gh requested by a later apt-get install block', () => {
    const dockerfile = `RUN apt-get install -y jq
RUN apt-get install -y gh`;
    expect(extractAptPackages(dockerfile)).toContain('gh');
  });

  it('detects version-pinned and release-targeted gh requests', () => {
    expect(extractAptPackages('RUN apt-get install -y gh=2.40.0')).toContain(
      'gh',
    );
    expect(extractAptPackages('RUN apt-get install -y gh/stable')).toContain(
      'gh',
    );
  });

  it('does not mistake unrelated prose containing gh for a package', () => {
    const dockerfile = `# The gh CLI was removed in favor of the github broker.
# install gh for host documentation only
RUN apt-get install -y jq`;
    const packages = extractAptPackages(dockerfile);
    expect(packages).not.toContain('gh');
    expect(packages).toContain('jq');
  });
});
