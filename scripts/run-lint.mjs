#!/usr/bin/env node
/**
 * Stateless hardening lint runner.
 * Ensures forwarded CLI arguments (e.g., workspace filters) don't leak into eslint invocations.
 */
import { execa } from 'execa';

async function runLint() {
  const commands = [
    ['eslint', ['.', '--ext', '.ts,.tsx']],
    ['eslint', ['integration-tests']],
  ];

  for (const [cmd, args] of commands) {
    await execa(cmd, args, { stdio: 'inherit' });
  }
}

runLint().catch((error) => {
  if (error?.exitCode) {
    process.exit(error.exitCode);
  }
  console.error(error);
  process.exit(1);
});
