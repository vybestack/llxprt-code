/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type { Attempt } from './w22-census.ts';

interface FileRule {
  readonly sourceHash: string;
  readonly casesHash: string;
  readonly classification:
    | 'history-independent'
    | 'shared-public-no-native-claim';
  readonly evidence: string;
}

export function caseSetHash(cases: Attempt['cases']): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        cases.map(({ classname, name, status }) => [classname, name, status]),
      ),
    )
    .digest('hex');
}

export function parseFileRules(text: string): ReadonlyMap<string, FileRule> {
  const [header, ...lines] = text.trimEnd().split('\n');
  if (header !== 'path\tsource_sha256\tcases_sha256\trule\tevidence')
    throw new Error('Invalid classification header');
  const rules = new Map<string, FileRule>();
  for (const line of lines) {
    const [path, sourceHash, casesHash, classification, evidence, extra] =
      line.split('\t');
    if (
      classification !== 'history-independent' &&
      classification !== 'shared-public-no-native-claim'
    )
      throw new Error('Unsupported file classification');
    if (
      !path ||
      !sourceHash ||
      !casesHash ||
      !evidence ||
      extra !== undefined ||
      rules.has(path)
    )
      throw new Error('Invalid or duplicate classification rule');
    rules.set(path, { sourceHash, casesHash, classification, evidence });
  }
  return rules;
}

export function applyFileRule(
  row: Attempt,
  rules: ReadonlyMap<string, FileRule>,
): Attempt {
  const rule = rules.get(row.path);
  if (
    !row.accepted ||
    row.state !== 'green' ||
    rule?.sourceHash !== row.sourceHash ||
    rule.casesHash !== caseSetHash(row.cases)
  )
    return row;
  return {
    ...row,
    cases: row.cases.map((test) =>
      test.classification !== 'classification-pending'
        ? test
        : {
            ...test,
            classification: rule.classification,
            classificationProvenance: `W22-CASE-RULES.tsv:${rule.evidence}`,
          },
    ),
  };
}

interface NativeContract {
  readonly sourceHash: string | undefined;
  readonly classification: string;
  readonly provenance: string;
  readonly nativeCounterparts?: ReadonlyArray<{
    batch: string;
    path: string;
    sourceHash: string;
    classname: string;
    name: string;
  }>;
}

function contractKey(
  path: string,
  test: { classname: string; name: string },
): string {
  return JSON.stringify([path, test.classname, test.name]);
}

export function applyNativeClosure(
  row: Attempt,
  contracts: ReadonlyMap<string, NativeContract>,
  evidence: readonly Attempt[],
): Attempt {
  if (!row.accepted || row.backend !== 'journal' || row.state !== 'green')
    return row;
  const matching = row.cases.map((test) =>
    contracts.get(contractKey(row.path, test)),
  );
  if (!matching.some((contract) => contract?.sourceHash === row.sourceHash))
    return row;
  const valid = row.cases.every((test) => {
    const contract = contracts.get(contractKey(row.path, test));
    if (contract?.sourceHash !== row.sourceHash) return false;
    if (
      contract.classification === 'native-history' ||
      contract.classification === 'journal-selected-shared-public'
    )
      return true;
    if (
      contract.classification !== 'explicit-old' ||
      !contract.nativeCounterparts?.length
    )
      return false;
    return contract.nativeCounterparts.every((counterpart) => {
      const native = contracts.get(contractKey(counterpart.path, counterpart));
      return (
        !(
          counterpart.path === row.path &&
          counterpart.classname === test.classname &&
          counterpart.name === test.name
        ) &&
        native?.sourceHash === counterpart.sourceHash &&
        native.classification === 'native-history' &&
        evidence.some(
          (candidate) =>
            candidate.accepted &&
            candidate.backend === 'journal' &&
            candidate.state === 'green' &&
            candidate.rawSummary !== null &&
            candidate.batch === counterpart.batch &&
            candidate.path === counterpart.path &&
            candidate.sourceHash === counterpart.sourceHash &&
            candidate.cases.some(
              (test) =>
                test.status === 'passed' &&
                test.classname === counterpart.classname &&
                test.name === counterpart.name,
            ),
        )
      );
    });
  });
  if (!valid)
    return {
      ...row,
      state: 'unverified',
      evidenceStatus: 'native-closure-unverified',
      issues: [...row.issues, 'missing-source-bound-native-counterpart'],
    };
  return {
    ...row,
    cases: row.cases.map((test) => {
      const contract = contracts.get(contractKey(row.path, test));
      return {
        ...test,
        classification: contract?.classification ?? test.classification,
        classificationProvenance:
          contract?.provenance ?? test.classificationProvenance,
      };
    }),
  };
}
