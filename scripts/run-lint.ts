#!/usr/bin/env bun
/**
 * Stateless hardening lint runner.
 * Runs root and integration ESLint sequentially so diagnostics stay grouped,
 * forwarding CLI arguments to both invocations.
 */
import { constants as osConstants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { messageOf, propertyValue } from './utils/error-guards.ts';

function nodeOptionsWithoutMemoryLimit(): string[] {
  const options = (process.env.NODE_OPTIONS ?? '')
    .split(/\s+/)
    .filter((option) => option.length > 0);
  const keptOptions: string[] = [];
  let skipNext = false;
  for (const option of options) {
    if (skipNext) {
      skipNext = false;
    } else if (option === '--max-old-space-size') {
      skipNext = true;
    } else if (!/^--max-old-space-size=/.test(option)) {
      keptOptions.push(option);
    }
  }
  return keptOptions;
}

function nodeOptionsWithMemoryLimit(): string {
  return [...nodeOptionsWithoutMemoryLimit(), '--max-old-space-size=8192'].join(
    ' ',
  );
}

async function runLint(): Promise<void> {
  const eslintBin = fileURLToPath(
    new URL('../node_modules/.bin/eslint', import.meta.url),
  );
  const forwardedArgs = process.argv.slice(2);
  const commands: ReadonlyArray<readonly [string, readonly string[]]> = [
    // Flat config owns file selection; --ext is intentionally omitted because it is invalid with ESLint flat config.
    [eslintBin, ['.', ...forwardedArgs]],
    [eslintBin, ['integration-tests', ...forwardedArgs]],
  ];

  const nodeOptions = nodeOptionsWithMemoryLimit();

  // Match package-script fail-fast (&&) behavior: stop at the first failing scope.
  // When used with --fix, fail-fast means later scopes are not fixed if an
  // earlier scope still exits non-zero.
  for (const [cmd, args] of commands) {
    await execa(cmd, [...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
      },
    });
  }
}

function signalToExitCode(signal: unknown): number | undefined {
  if (typeof signal !== 'string') {
    return undefined;
  }
  const signalNumber = (
    osConstants.signals as Record<string, number | undefined>
  )[signal];
  return typeof signalNumber === 'number' ? 128 + signalNumber : undefined;
}

runLint().catch((error: unknown) => {
  const exitCode = propertyValue(error, 'exitCode');
  if (typeof exitCode === 'number') {
    process.exit(exitCode);
  }

  const signalExitCode = signalToExitCode(
    propertyValue(error, 'signalCode') ?? propertyValue(error, 'signal'),
  );
  if (signalExitCode !== undefined) {
    process.exit(signalExitCode);
  }

  console.error(`Lint runner failed unexpectedly: ${messageOf(error)}`);
  if (error instanceof Error && error.stack !== undefined) {
    console.error(error.stack);
  }
  process.exit(1);
});
