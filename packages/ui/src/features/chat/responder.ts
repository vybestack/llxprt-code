import { secureRandomBetween } from '../../lib/random';

export interface ToolCallBlock {
  readonly lines: string[];
  readonly isBatch: boolean;
  readonly scrollable?: boolean;
  readonly maxHeight?: number;
  readonly streaming?: boolean;
}

export interface ShellPlan {
  readonly command: string;
  readonly output: string[];
  readonly maxHeight: number;
}

const OPENERS = [
  'Camus shrugs at the sky,',
  'Nietzsche laughs in the dark,',
  'The void hums quietly while',
  'A hedonist clinks a glass because',
  'Sisyphus pauses mid-push as',
  'Dionysus sings over static and',
] as const;

const DRIVERS = [
  'meaning is negotiated then forgotten,',
  'willpower tastes like rusted metal,',
  'pleasure is an act of rebellion,',
  'every rule is a rumor,',
  'the abyss wants a conversation,',
  'time is a joke with a long punchline,',
] as const;

const SPINS = [
  'so I dance anyway.',
  'yet we still buy coffee at dawn.',
  'and the night market keeps buzzing.',
  'because absurd joy is cheaper than despair.',
  'while the sea keeps no memory.',
  'so breath becomes a quiet manifesto.',
] as const;

export function buildResponderLine(): string {
  return `${pick(OPENERS)} ${pick(DRIVERS)} ${pick(SPINS)}`;
}

const THOUGHTS = [
  'I should tell the user about the abyss.',
  'Perhaps hedonism is the answer.',
  'Maybe the code hides a better metaphor.',
  "I'd like to learn more about the codebase; maybe I'll send a tool call.",
  'Is meaning just another branch to merge?',
  'Should I warn them the void has opinions?',
] as const;

export function buildThinkingLine(): string {
  return pick(THOUGHTS);
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function pick<T>(items: readonly T[]): T {
  return items[secureRandomBetween(0, items.length - 1)];
}

type ToolKind = 'ReadFile' | 'Glob' | 'SearchInFile';

const SAMPLE_FILES = [
  'src/app.tsx',
  'src/modalShell.tsx',
  'src/searchSelectModal.tsx',
  'src/history.ts',
  'scripts/check-limits.ts',
];

const SAMPLE_PATTERNS = [
  'useState',
  'Modal',
  'stream',
  'return',
  'export function',
  'const ',
];

export function maybeBuildToolCalls(): ToolCallBlock | null {
  if (secureRandomBetween(0, 6) !== 0) {
    return null;
  }
  const parallel = secureRandomBetween(0, 1) === 1;
  const count = secureRandomBetween(1, 5);
  const calls = Array.from({ length: count }, () =>
    buildToolCallLines(randomToolKind()),
  ).flat();
  if (parallel) {
    return {
      lines: [
        `[tool batch] ${count} calls`,
        ...calls.map((line) => `  ${line}`),
      ],
      isBatch: true,
    };
  }
  return { lines: calls, isBatch: false };
}

function buildToolCallLines(kind: ToolKind): string[] {
  if (kind === 'ReadFile') {
    const file = pick(SAMPLE_FILES);
    const start = secureRandomBetween(3, 40);
    const end = start + secureRandomBetween(2, 6);
    return [
      formatToolHeader(`ReadFile ${file} ${start}-${end}`),
      `    ${start}: // simulated code line`,
      `    ${start + 1}: // more simulated code`,
      `    ${end}: // eof snippet`,
    ];
  }
  if (kind === 'Glob') {
    const pattern = pick(['./*.ts', './src/*.tsx', './**/*.ts']);
    return [
      formatToolHeader(`Glob ${pattern}`),
      `    -> ${pick(SAMPLE_FILES)}`,
      `    -> ${pick(SAMPLE_FILES)}`,
    ];
  }
  const file = pick(SAMPLE_FILES);
  const pattern = pick(SAMPLE_PATTERNS);
  const first = secureRandomBetween(5, 60);
  return [
    formatToolHeader(`SearchInFile ${file} "${pattern}"`),
    `    ${first}: match: ${pattern}()`,
    `    ${first + secureRandomBetween(1, 10)}: match: ${pattern} // more`,
  ];
}

function formatToolHeader(description: string): string {
  return `[tool] ${description}`;
}

function randomToolKind(): ToolKind {
  const kinds: ToolKind[] = ['ReadFile', 'Glob', 'SearchInFile'];
  return kinds[secureRandomBetween(0, kinds.length - 1)];
}

const SHELL_COMMANDS = [
  'npm run test',
  'find . -name "*.ts"',
  'git status --short',
  'ls -la',
  'npm run lint',
];

export function maybeBuildShellPlan(): ShellPlan | null {
  if (secureRandomBetween(0, 5) !== 0) {
    return null;
  }
  const command = pick(SHELL_COMMANDS);
  const total = secureRandomBetween(24, 80);
  const output: string[] = [];
  for (let index = 0; index < total; index += 1) {
    if (command.startsWith('find')) {
      output.push(
        `./src/${pick(['app.tsx', 'history.ts', 'modalShell.tsx', 'responder.ts'])}:${secureRandomBetween(1, 200)}`,
      );
    } else if (command.startsWith('npm run test')) {
      output.push(randomTestLine(index));
    } else if (command === 'npm run lint') {
      output.push(randomLintLine(index));
    } else if (command === 'git status --short') {
      output.push(
        `${pick(['M', 'A', '??'])} ${pick(['src/app.tsx', 'src/responder.ts', 'src/modalShell.tsx'])}`,
      );
    } else {
      output.push(randomLsLine(index));
    }
  }
  return { command, output, maxHeight: 20 };
}

function randomTestLine(index: number): string {
  const parts = [
    ` PASS  src/${pick(['app.test.ts', 'history.test.ts', 'suggestions.test.ts'])}`,
    `  ✓ scenario ${index + 1} ${pick(['(2 ms)', '(4 ms)', '(1 ms)'])}`,
    `  ✓ renders tool block ${index % 5} ${pick(['(snapshot)', '(dom)', '(cli)'])}`,
    `  ✓ streaming chunk ${index}`,
  ];
  return pick(parts);
}

function randomLintLine(index: number): string {
  return [
    `src/${pick(['app.tsx', 'responder.ts', 'modalShell.tsx'])}:${secureRandomBetween(10, 200)}:${secureRandomBetween(2, 80)}  warning  ${pick(
      [
        'Unexpected console statement',
        'Trailing spaces not allowed',
        'Function has a complexity of 18',
      ],
    )}`,
    `✖ ${index + 1} problem (0 errors, ${secureRandomBetween(1, 2)} warnings)`,
  ][secureRandomBetween(0, 1)];
}

function randomLsLine(index: number): string {
  const size = secureRandomBetween(1, 4096);
  const name = pick([
    'src',
    'scripts',
    'node_modules',
    'README.md',
    `file-${index}.ts`,
  ]);
  return `-rw-r--r--  1 user  staff  ${size.toString().padStart(6, ' ')} Dec  4 12:${(index % 60).toString().padStart(2, '0')} ${name}`;
}
