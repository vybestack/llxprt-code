/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  applyFileRule,
  applyNativeClosure,
  parseFileRules,
} from './w22-case-rules.ts';
import {
  attemptSchema,
  inspectEvidence,
  reconcile,
  type Attempt,
  type AttemptInput,
  type CensusCase,
  type Provenance,
} from './w22-census.ts';

const BEFORE_SHA256 =
  '61780e2313d471bf6acf26568a53306ddfa1b17d90245d4b6193c93dad1029fc';
const OBSERVATION_BATCHES = ['observation-final-journal-l-b'];
const CORE_FAULT_BATCHES = [
  'fault-final-journal-m-a',
  'fault-deferred-final-journal-m-b',
  'fault-changed-final-journal-m-c',
];
const CHILD_OWNERSHIP_BATCHES = ['child-final-journal-n-e'];
const RETAINED_BATCHES = ['retained-final-journal-o-a'];
const RETAINED_PATHS = new Set(
  [
    'journal-retained-growth.test.ts',
    'journal-retained-growth-retaining-trap.test.ts',
    'journal-retained-growth-release-trap.test.ts',
    'send-journal-opens.test.ts',
  ].map((name) => `packages/agents/src/core/__tests__/${name}`),
);
const OBSERVATION_CONTRACT_BATCHES = [
  ...OBSERVATION_BATCHES,
  ...CORE_FAULT_BATCHES,
  ...CHILD_OWNERSHIP_BATCHES,
  ...RETAINED_BATCHES,
];
const REQUEST_BATCHES = [
  'request-middle-final-journal-k-b',
  'request-one-final-journal-k-b',
];
const REQUEST_NATIVE_BATCHES = [
  ...REQUEST_BATCHES,
  ...CORE_FAULT_BATCHES,
  ...CHILD_OWNERSHIP_BATCHES,
  ...RETAINED_BATCHES,
  'request-related-final-journal-k-b',
  'request-related-completion-journal-k-e',
  'request-media-final-journal-k-h',
  'request-supplement-final-journal-k-f',
];
const nativeCounterpartSchema = z.object({
  batch: z.string(),
  path: z.string(),
  sourceHash: z.string(),
  classname: z.string(),
  name: z.string(),
});
const checkpointSchema = z
  .object({
    rows: z.array(
      z
        .object({
          path: z.string(),
          sourceHash: z.string().optional(),
          cases: z.array(
            z
              .object({
                classname: z.string(),
                name: z.string(),
                classification: z.string(),
                nativeCounterparts: z.array(nativeCounterpartSchema).optional(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const inventorySchema = z.array(z.object({ path: z.string() }).passthrough());

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function text(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
function caseKey(
  path: string,
  test: { classname: string; name: string },
): string {
  return JSON.stringify([path, test.classname, test.name]);
}

function acceptedBatches(
  names: readonly string[],
): { batch: string; reference: string }[] {
  const groups = (pattern: RegExp): string[] =>
    names.filter((name) => pattern.test(name)).sort();
  const layers = [
    {
      reference: 'progress.ts.before-census',
      batches: [
        'unobstructed-20',
        'final-system-carry-journal',
        'package-next-20',
        'fixed-boundary-export',
        'package-36-55',
        ...groups(/^package-auto-\d+$/),
      ],
    },
    {
      reference: 'next-run-20261019-b/progress.ts',
      batches: [
        'fixed-profile-disposal-journal',
        'final-profile-disposal-journal',
        ...groups(/^package-resume-b-\d+$/),
        'fixed-node-runtime-exports',
        ...groups(/^package-resume-c-\d+$/),
      ],
    },
    {
      reference: 'facade-run-20261019-a/progress.ts',
      batches: [
        'facade-run-final-journal-b',
        'facade-run-profiles-journal-b',
        ...groups(/^package-resume-d-\d+$/),
      ],
    },
    {
      reference: 'finalizer-run-20261019-a/progress.ts',
      batches: [
        'finalizer-run-final-journal-a',
        'finalizer-run-restored-journal-a',
        ...groups(/^package-resume-e-\d+$/),
      ],
    },
    {
      reference: 'instance-run-20261019-a/progress-g.ts.before-census',
      batches: [
        'instance-run-final-journal-a',
        'instance-run-final-journal-b',
        ...groups(/^package-resume-f-\d+$/),
        'instance-nodefix-final-journal-a',
        ...groups(/^package-resume-g-\d+$/),
      ],
    },
    {
      reference: 'pending-window-run-g/verify-current.json',
      batches: ['pending-final-journal-g-a'],
    },
    {
      reference: 'provider-fallback-run-h/verify-current.json',
      batches: ['provider-final-journal-h-a'],
    },
    {
      reference: 'attempt-value-run-i/verify-current.json',
      batches: ['attempt-final-journal-i-a'],
    },
    {
      reference: 'density-run-j/final-b-current.json',
      batches: [
        'density-core-b-final-journal-j-a',
        'density-final-journal-j-a',
      ],
    },
    {
      reference: 'request-publication-run-k/verify-f-current.json',
      batches: REQUEST_BATCHES,
    },
    {
      reference: 'core-observation-run-l/verify-current.json',
      batches: OBSERVATION_BATCHES,
    },
    {
      reference: 'core-fault-run-m/verify-current.json',
      batches: CORE_FAULT_BATCHES,
    },
    {
      reference: 'childownership-run-n/verify-current.json',
      batches: CHILD_OWNERSHIP_BATCHES,
    },
    {
      reference: 'retained-run-o/verify-current.json',
      batches: RETAINED_BATCHES,
    },
    {
      reference: 'client-closure-q/final-values-refactored.json',
      batches: ['client-values-refactored-final-journal-q'],
    },
  ];
  return layers.flatMap((layer) =>
    layer.batches.map((batch) => ({ batch, reference: layer.reference })),
  );
}

function resultFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory())
        return [
          'llxprt-tests',
          'held-generated',
          'continuation-run-c',
          'node_modules',
          '.git',
        ].includes(entry.name)
          ? []
          : resultFiles(path);
      return entry.name === 'results.json' ||
        entry.name === 'stopped-after-failure.json' ||
        entry.name.endsWith('-result.json')
        ? [path]
        : [];
    })
    .sort();
}

function resultRows(value: unknown): AttemptInput[] {
  const container = z.object({ rows: z.array(z.unknown()) }).safeParse(value);
  const values = Array.isArray(value)
    ? value
    : container.success
      ? container.data.rows
      : [value];
  return values.flatMap((item) => {
    const candidate = z
      .object({ path: z.string(), junit: z.string() })
      .passthrough()
      .safeParse(item);
    return candidate.success ? [attemptSchema.parse(item)] : [];
  });
}

function normalize(
  input: AttemptInput,
  run: string,
): { input: AttemptInput; backendProvenance: string; batch: string } {
  const batch = basename(dirname(input.junit));
  const earlyDefault =
    ['initial-20', 'unobstructed-20'].includes(batch) &&
    dirname(dirname(input.junit)) === run;
  const backend = input.backend ?? (earlyDefault ? 'journal' : 'unknown');
  return {
    input: { ...input, backend },
    backendProvenance: input.backend
      ? 'result.backend'
      : earlyDefault
        ? 'driver.ts recorded journal default; early result omitted backend'
        : 'backend-not-recorded',
    batch,
  };
}

function classificationContracts(
  w22: string,
  names: readonly string[] = [
    'instance-run-20261019-a/census-before.json',
    'run-20261019-a/accounting-after-boundary.json',
    'next-run-20261019-b/classification-b.json',
    'facade-run-20261019-a/classification.json',
    'finalizer-run-20261019-a/classification.json',
    'finalizer-run-20261019-a/hook-classification.json',
    'pending-window-run-g/classification.json',
    'provider-fallback-run-h/classification.json',
  ],
): Map<
  string,
  {
    classification: string;
    provenance: string;
    sourceHash: string | undefined;
    nativeCounterparts?: Array<z.infer<typeof nativeCounterpartSchema>>;
  }
> {
  const contracts = new Map<
    string,
    {
      classification: string;
      provenance: string;
      sourceHash: string | undefined;
      nativeCounterparts?: Array<z.infer<typeof nativeCounterpartSchema>>;
    }
  >();
  for (const name of names) {
    const path = join(w22, name);
    if (!existsSync(path)) continue;
    for (const row of checkpointSchema.parse(json(path)).rows) {
      for (const test of row.cases) {
        const key = caseKey(row.path, test);
        if (
          test.classification !== 'classification-pending' ||
          !contracts.has(key)
        )
          contracts.set(key, {
            classification: test.classification,
            provenance: path,
            sourceHash: row.sourceHash,
            nativeCounterparts: test.nativeCounterparts,
          });
      }
    }
  }
  return contracts;
}

function classify(
  row: Attempt,
  contracts: ReturnType<typeof classificationContracts>,
  attemptContracts: ReturnType<typeof classificationContracts>,
  densityContracts: ReturnType<typeof classificationContracts>,
  requestContracts: ReturnType<typeof classificationContracts>,
  observationContracts: ReturnType<typeof classificationContracts>,
  w22: string,
  evidence: readonly Attempt[],
): Attempt {
  const cases: CensusCase[] = row.cases.map((test) => {
    const attempt = attemptContracts.get(caseKey(row.path, test));
    const density = densityContracts.get(caseKey(row.path, test));
    const densityMatches =
      row.accepted &&
      row.backend === 'journal' &&
      [
        'density-core-b-final-journal-j-a',
        'density-final-journal-j-a',
      ].includes(row.batch) &&
      density?.sourceHash === row.sourceHash;
    const request = requestContracts.get(caseKey(row.path, test));
    const requestMatches =
      row.accepted &&
      row.backend === 'journal' &&
      [
        'request-middle-final-journal-k-b',
        'request-one-final-journal-k-b',
      ].includes(row.batch) &&
      request?.sourceHash === row.sourceHash;
    const observation = observationContracts.get(caseKey(row.path, test));
    const observationMatches =
      row.accepted &&
      row.backend === 'journal' &&
      OBSERVATION_CONTRACT_BATCHES.includes(row.batch) &&
      observation?.sourceHash === row.sourceHash;
    const known = observationMatches
      ? observation
      : requestMatches
        ? request
        : densityMatches
          ? density
          : row.accepted &&
              row.batch === 'attempt-final-journal-i-a' &&
              attempt?.sourceHash === row.sourceHash
            ? attempt
            : contracts.get(caseKey(row.path, test));
    const instanceOverride =
      row.accepted &&
      /^instance-(?:run-final-journal-[ab]|nodefix-final-journal-a)$/.test(
        row.batch,
      ) &&
      row.path.endsWith('/recording-instance-resume.behavior.test.ts');
    const shellOverride =
      row.accepted &&
      row.batch === 'instance-nodefix-final-journal-a' &&
      row.path.endsWith('/shell-owner-exit.behavior.test.ts');
    const contract = instanceOverride
      ? {
          classification: test.classname.startsWith('native ')
            ? 'native-history'
            : 'explicit-old',
          provenance: join(
            w22,
            'continuation-run-c/progress-g.ts.before-census',
          ),
        }
      : shellOverride
        ? {
            classification: 'journal-selected-shared-public',
            provenance: join(
              w22,
              'continuation-run-c/progress-g.ts.before-census',
            ),
          }
        : known;
    return {
      ...test,
      classification: contract?.classification ?? 'classification-pending',
      classificationProvenance:
        contract?.provenance ?? 'no-exact-case-contract',
    };
  });
  const coverageContracts = OBSERVATION_CONTRACT_BATCHES.includes(row.batch)
    ? observationContracts
    : requestContracts;
  const missingCoverage =
    row.accepted &&
    [...REQUEST_BATCHES, ...OBSERVATION_CONTRACT_BATCHES].includes(row.batch) &&
    row.cases.some((test) => {
      const contract = coverageContracts.get(caseKey(row.path, test));
      if (
        contract?.sourceHash !== row.sourceHash ||
        ![
          'native-history',
          'journal-selected-shared-public',
          'explicit-old',
        ].includes(contract.classification)
      )
        return true;
      if (contract.classification !== 'explicit-old') return false;
      const counterparts = contract.nativeCounterparts ?? [];
      return (
        counterparts.length === 0 ||
        counterparts.some(
          (counterpart) =>
            (counterpart.path === row.path &&
              counterpart.classname === test.classname &&
              counterpart.name === test.name) ||
            !REQUEST_NATIVE_BATCHES.includes(counterpart.batch) ||
            !evidence.some(
              (candidate) =>
                candidate.batch === counterpart.batch &&
                candidate.path === counterpart.path &&
                candidate.sourceHash === counterpart.sourceHash &&
                candidate.backend === 'journal' &&
                candidate.state === 'green' &&
                candidate.rawSummary !== null &&
                candidate.cases.some(
                  (native) =>
                    native.classname === counterpart.classname &&
                    native.name === counterpart.name &&
                    native.status === 'passed',
                ),
            ),
        )
      );
    });
  if (missingCoverage && row.state === 'green')
    return {
      ...row,
      cases,
      state: 'unverified',
      evidenceStatus: 'request-coverage-unverified',
      issues: [...row.issues, 'missing-exact-request-native-coverage'],
    };
  return { ...row, cases };
}

function atomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.${randomUUID()}.publishing`;
  writeFileSync(staging, content, { flag: 'wx' });
  renameSync(staging, path);
}

export function runCensus(root: string): ReturnType<typeof reconcile> & {
  generation: string;
  timestamp: string;
  inventory: number;
  executedFiles: number;
  greenFiles: number;
  redFiles: number;
  unverifiedFiles: number;
  unexecutedFiles: number;
  pass: number;
  fail: number;
  skip: number;
  supervisor: unknown;
  current: unknown;
} {
  const w22 = resolve(root, 'tmp/854-notes/p4/w22');
  const run = join(w22, 'run-20261019-a');
  const out = join(w22, 'continuation-run-c');
  const snapshot = join(out, 'current-progress.before.json');
  if (existsSync(snapshot) && digest(readFileSync(snapshot)) !== BEFORE_SHA256)
    throw new Error('Readonly before snapshot checksum mismatch');
  const inventory = inventorySchema
    .parse(json(join(run, 'inventory.json')))
    .map((entry) => entry.path);
  const inventorySet = new Set(inventory);
  const order = new Map(
    acceptedBatches(readdirSync(run)).map((entry, index) => [
      entry.batch,
      { ...entry, index },
    ]),
  );
  const contracts = classificationContracts(w22);
  const attemptContracts = classificationContracts(w22, [
    'attempt-value-run-i/classification.json',
  ]);
  const densityContracts = classificationContracts(w22, [
    'density-run-j/classification.json',
  ]);
  const requestContracts = classificationContracts(w22, [
    'request-publication-run-k/classification.json',
  ]);
  const observationContracts = classificationContracts(w22, [
    'core-observation-run-l/classification.json',
    'core-fault-run-m/classification.json',
    'childownership-run-n/classification.json',
    'retained-run-o/classification.json',
  ]);
  const checkpoints = [
    join(run, 'accounting.json'),
    join(run, 'accounting-after-boundary.json'),
    join(w22, 'instance-run-20261019-a/census-before.json'),
    snapshot,
  ].filter(existsSync);
  const references = [...new Set([...resultFiles(w22), ...checkpoints])];
  const gathered = references.flatMap((reference) =>
    resultRows(json(reference)).map((input) => {
      const normalized = normalize(input, run);
      const boundary =
        RETAINED_BATCHES.includes(normalized.batch) &&
        !RETAINED_PATHS.has(normalized.input.path)
          ? undefined
          : order.get(normalized.batch);
      const inPrimaryRun = dirname(dirname(normalized.input.junit)) === run;
      const provenance: Provenance = {
        batch: normalized.batch,
        acceptedOrder: inPrimaryRun && boundary ? boundary.index : null,
        acceptanceReference: boundary
          ? join(
              w22,
              boundary.reference.startsWith('progress.ts') ||
                boundary.reference.endsWith('before-census')
                ? `continuation-run-c/${boundary.reference.startsWith('progress.ts') ? 'progress.ts.before-census' : 'progress-g.ts.before-census'}`
                : boundary.reference,
            )
          : null,
        references: [reference],
        backendProvenance: normalized.backendProvenance,
      };
      return { input: normalized.input, provenance };
    }),
  );
  const deduplicated = new Map<
    string,
    { input: AttemptInput; provenance: Provenance }
  >();
  for (const item of gathered) {
    const key = JSON.stringify([
      item.input.path,
      item.input.pid,
      item.input.junit,
    ]);
    const prior = deduplicated.get(key);
    const rawResult =
      basename(item.provenance.references[0] ?? '') === 'results.json';
    const chosen = !prior || rawResult ? item : prior;
    deduplicated.set(key, {
      input: chosen.input,
      provenance: {
        ...chosen.provenance,
        references: [
          ...new Set([
            ...(prior?.provenance.references ?? []),
            ...item.provenance.references,
          ]),
        ],
      },
    });
  }
  const evidence = [...deduplicated.values()].map(({ input, provenance }) =>
    inspectEvidence(input, provenance, text(input.junit), text(input.log)),
  );
  const fileRulesPath = join(
    root,
    'project-plans/issue854/recovery-2026-10-19/recovered-control/W22-CASE-RULES.tsv',
  );
  const fileRules = existsSync(fileRulesPath)
    ? parseFileRules(readFileSync(fileRulesPath, 'utf8'))
    : new Map();
  const closureContracts = classificationContracts(root, [
    'project-plans/issue854/recovery-2026-10-19/recovered-control/W22-NATIVE-CLOSURE.json',
  ]);
  const attempts = evidence
    .filter((row) => inventorySet.has(row.path))
    .map((row) =>
      classify(
        row,
        contracts,
        attemptContracts,
        densityContracts,
        requestContracts,
        observationContracts,
        w22,
        evidence,
      ),
    )
    .map((row) => applyNativeClosure(row, closureContracts, evidence))
    .map((row) => applyFileRule(row, fileRules));
  const census = reconcile(inventory, attempts);
  const supervisorPath = join(run, 'sweep-supervisor.json');
  const supervisor = existsSync(supervisorPath) ? json(supervisorPath) : null;
  const supervisorRecord = z
    .object({ currentFilePath: z.string().optional() })
    .passthrough()
    .safeParse(supervisor);
  const currentPath = supervisorRecord.success
    ? supervisorRecord.data.currentFilePath
    : undefined;
  const current =
    currentPath && existsSync(currentPath) ? json(currentPath) : null;
  const totals = census.rows.reduce(
    (sum, row) => ({
      pass: sum.pass + (row.counts?.pass ?? 0),
      fail: sum.fail + (row.counts?.fail ?? 0),
      skip: sum.skip + (row.counts?.skip ?? 0),
    }),
    { pass: 0, fail: 0, skip: 0 },
  );
  const generation = randomUUID();
  const result = {
    ...census,
    generation,
    timestamp: new Date().toISOString(),
    inventory: inventory.length,
    executedFiles: census.rows.length,
    greenFiles: census.partition.green,
    redFiles: census.partition.red,
    unverifiedFiles: census.partition.unverified,
    unexecutedFiles: census.partition.unrun,
    attemptedFilesAllHistory: new Set(census.attempts.map((row) => row.path))
      .size,
    historicalMissingAttemptCount: census.historicalMissingAttempts.length,
    latestMissingFileCount: census.latestMissingFiles.length,
    ...totals,
    supervisor,
    current,
    sourceBoundaryPolicy:
      'Per-attempt test source hashes and recorded accepted progress-layer order; retained results are not a final whole-package source run. No source tree scan on refresh.',
    sourceProofReferences: [
      'run-20261019-a/after-boundary-source-comparison.json',
      'next-run-20261019-b/source-comparison.json',
      'facade-run-20261019-a/source-comparison.json',
      'finalizer-run-20261019-a/source-comparison.json',
      'instance-run-20261019-a/source-comparison.json',
      'instance-run-20261019-a/full-final-source-hashes-b.json',
    ]
      .map((path) => join(w22, path))
      .filter(existsSync),
    inputReferences: references,
    beforeSnapshotSha256: existsSync(snapshot) ? BEFORE_SHA256 : null,
  };
  if (
    Object.values(result.partition).reduce((a, b) => a + b, 0) !==
    inventory.length
  )
    throw new Error('Inventory partition does not reconcile');
  const failures = census.rows
    .filter((row) => row.state !== 'green')
    .map((row) => ({
      ...row,
      failureType:
        row.failureType ??
        (row.state === 'unverified'
          ? row.evidenceStatus
          : 'historical-test-error'),
      failures: row.cases.filter((test) => test.status !== 'passed'),
    }));
  const table = [
    `Generation: ${generation}`,
    '',
    '| File | State | Pass | Fail | Skip | PID | Batch | Source hash |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
    ...inventory.map((path) => {
      const row = census.rows.find((row) => row.path === path);
      return row
        ? `| \`${path}\` | ${row.state} | ${row.counts?.pass ?? '?'} | ${row.counts?.fail ?? '?'} | ${row.counts?.skip ?? '?'} | ${row.pid} | ${row.batch} | ${row.sourceHash} |`
        : `| \`${path}\` | unrun | | | | | | |`;
    }),
    '',
  ].join('\n');
  const { attempts: allAttempts, ...progress } = result;
  const documents = new Map<string, string>([
    [
      join(run, 'current-progress.json'),
      JSON.stringify(
        { ...progress, allAttemptsPath: join(out, 'all-attempts.json') },
        null,
        2,
      ) + '\n',
    ],
    [
      join(run, 'current-not-run.txt'),
      census.pending.length ? census.pending.join('\n') + '\n' : '',
    ],
    [join(run, 'current-files-table.md'), table],
    [
      join(w22, 'instance-run-20261019-a/failure-table.json'),
      JSON.stringify(failures, null, 2) + '\n',
    ],
    [
      join(out, 'all-attempts.json'),
      JSON.stringify(
        { generation, timestamp: result.timestamp, attempts: allAttempts },
        null,
        2,
      ) + '\n',
    ],
    [
      join(out, 'missing-evidence.json'),
      JSON.stringify(
        {
          generation,
          historicalMissingAttempts: census.historicalMissingAttempts,
          latestMissingFiles: census.latestMissingFiles,
        },
        null,
        2,
      ) + '\n',
    ],
    [
      join(out, 'census-counts-final.json'),
      JSON.stringify(
        {
          generation,
          timestamp: result.timestamp,
          inventory: result.inventory,
          partition: result.partition,
          executedFiles: result.executedFiles,
          ...totals,
          classifications: result.classifications,
          attempts: allAttempts.length,
          historicalMissingAttempts: result.historicalMissingAttemptCount,
          latestMissingFiles: result.latestMissingFileCount,
          supervisor,
          current,
        },
        null,
        2,
      ) + '\n',
    ],
  ]);
  for (const [path, content] of documents) atomic(path, content);
  atomic(
    join(out, 'publication.json'),
    JSON.stringify(
      {
        generation,
        timestamp: result.timestamp,
        files: [...documents].map(([path, content]) => ({
          path: relative(root, path),
          sha256: digest(content),
        })),
      },
      null,
      2,
    ) + '\n',
  );
  return result;
}

export function printCensus(root: string): void {
  const result = runCensus(root);
  console.log(
    JSON.stringify({
      generation: result.generation,
      timestamp: result.timestamp,
      inventory: result.inventory,
      executedFiles: result.executedFiles,
      partition: result.partition,
      pass: result.pass,
      fail: result.fail,
      skip: result.skip,
      classifications: result.classifications,
      attempts: result.attempts.length,
      historicalMissingAttempts: result.historicalMissingAttempts.length,
      latestMissingFiles: result.latestMissingFiles.length,
    }),
  );
}
