import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const args = process.argv.slice(2);
const bunArgs = ['run', 'src/main.tsx', ...args];

const child = spawn('bun', bunArgs, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    DEV: 'true',
  },
});

let cleaned = false;
const cleanup = (code, signal) => {
  if (cleaned) {
    return;
  }
  cleaned = true;
  // Ensure we leave the terminal in cooked mode even on abrupt exits.
  try {
    // Reset modes similar to tput cnorm; clear mouse/alt-screen.
    process.stdout.write(
      '\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[?25h\u001b[?1049l',
    );
  } catch {
    // ignore
  }

  if (signal) {
    const signalCode = 128 + (signal === 'SIGINT' ? 2 : 15);
    process.exit(signalCode);
    return;
  }
  process.exit(code ?? 0);
};

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
  // If the child drags its feet, escalate to SIGKILL then exit.
  const killTimer = setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }, 800);
  killTimer.unref();

  const exitTimer = setTimeout(() => {
    cleanup(undefined, signal);
  }, 1200);
  exitTimer.unref();
};

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => forwardSignal(signal));
});

child.on('exit', (code, signal) => cleanup(code, signal));

child.on('error', (error) => {
  console.error('Failed to start UI process:', error);
  cleanup(1);
});
