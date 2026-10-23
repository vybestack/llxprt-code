/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

function queryPane(format: string): string {
  const result = spawnSync(
    'tmux',
    ['display-message', '-p', '-t', process.env['TMUX_PANE'] ?? '', format],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

const destination = process.argv[2];
if (!destination || !process.stdin.isTTY) {
  throw new Error('A recording path and native terminal are required');
}
process.stdin.setRawMode(true);
process.stdout.write(
  `\u001b[?2004${process.argv[3] === 'off' ? 'l' : 'h'}Type your shell command\r\nMODE_REQUESTED\r\n`,
);
const deadline = Date.now() + 5000;
while (true) {
  const screen = spawnSync(
    'tmux',
    ['capture-pane', '-p', '-t', process.env['TMUX_PANE'] ?? ''],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (screen.error) throw screen.error;
  if (screen.status !== 0) throw new Error(screen.stderr);
  if (screen.stdout.includes('MODE_REQUESTED')) break;
  if (Date.now() >= deadline)
    throw new Error('Terminal did not consume mode request');
  await new Promise((resolve) => setTimeout(resolve, 10));
}
writeFileSync(
  `${destination}.tmux.json`,
  JSON.stringify({
    version: queryPane('#{version}'),
    bracket_paste_flag: queryPane('#{bracket_paste_flag}'),
    buffer_size: queryPane('#{buffer_size}'),
    pane_in_mode: queryPane('#{pane_in_mode}'),
    pane_active: queryPane('#{pane_active}'),
  }),
);
process.stdout.write('FIXTURE_READY\r\n');
process.stdin.on('data', (data: Buffer) => {
  appendFileSync(destination, data);
  if (data.includes(13)) {
    process.stdout.write('NATIVE_INPUT_RECEIVED\r\n');
  }
  if (data.includes(4)) {
    process.stdin.setRawMode(false);
    process.exit(0);
  }
});
