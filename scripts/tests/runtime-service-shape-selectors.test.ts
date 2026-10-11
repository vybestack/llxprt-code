/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import { scanRuntimeServiceShapes } from './runtime-service-shape-guard.js';
import { roots, options } from './runtime-service-shape-test-helpers.js';

it('retains concrete constructor type arguments', () => {
  const findings = scanRuntimeServiceShapes(
    {
      ...roots,
      'library.ts': 'export declare class Resource<T> { value: T; }',
      'consumer.ts': `import { Scheduler, Context } from './services.js'; import { Resource } from './library.js'; type Bag = typeof Resource<{ clock: Scheduler; context: Context }>;`,
    },
    options,
  ).filter((f) => f.file === 'consumer.ts');
  expect(findings).toContainEqual(
    expect.objectContaining({ rule: 'runtime-service-bundle' }),
  );
});

it.each([
  'export declare class Resource { static callback: () => { clock: Scheduler; context: Context }; }',
  'export declare class Resource { static acquire(): { clock: Scheduler; context: Context }; }',
  'export declare class Resource { clock: Scheduler; context: Context; }',
  'export declare class Resource {} export declare namespace Resource { namespace Nested { function acquire(): { clock: Scheduler; context: Context }; } }',
  'export declare function Resource(): string; export declare namespace Resource { namespace Nested { function acquire(): { clock: Scheduler; context: Context }; } }',
])('retains value-side exposures: %s', (declaration) => {
  const findings = scanRuntimeServiceShapes(
    {
      ...roots,
      'library.ts': `import { Scheduler, Context } from './services.js'; ${declaration}`,
      'barrel-value.ts': `export { Resource as Renamed } from './library.js';`,
      'consumer.ts': `type Bag = typeof import('./barrel-value.js').Renamed;`,
    },
    options,
  ).filter((f) => f.file === 'consumer.ts');
  expect(findings).toContainEqual(
    expect.objectContaining({ rule: 'runtime-service-bundle' }),
  );
});

it('does not expose class static state through an instance', () => {
  expect(
    scanRuntimeServiceShapes(
      {
        ...roots,
        'library.ts': `import { Scheduler, Context } from './services.js'; export declare class Resource { static acquire(): { clock: Scheduler; context: Context }; data: string; }`,
        'consumer.ts': `type Data = import('./library.js').Resource;`,
      },
      options,
    ).filter((f) => f.file === 'consumer.ts'),
  ).toEqual([]);
});

it('closes recursive qualified namespace aliases without dropping later merged declarations', () => {
  for (const service of [false, true]) {
    const findings = scanRuntimeServiceShapes(
      {
        ...roots,
        'library.ts': `import { Scheduler, Context } from './services.js';
        export declare namespace Resource { function next(): typeof Other; }
        declare namespace Other { function next(): typeof Resource; }
        export declare namespace Resource { namespace Nested { function data(): ${service ? '{ clock: Scheduler; context: Context }' : 'string'}; } }`,
        'consumer.ts': `type Value = typeof import('./library.js').Resource;`,
      },
      options,
    ).filter((f) => f.file === 'consumer.ts');
    if (service)
      expect(findings).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle' }),
      );
    else expect(findings).toEqual([]);
  }
});

it.each([
  `typeof import('./library.js')`,
  `typeof import('./library.js').Outer.Inner`,
  `import('./library.js').Outer.Inner.Instance<string>`,
])(
  'closes literal qualified selectors and retains exact roots: %s',
  (selector) => {
    for (const services of [false, true]) {
      const findings = scanRuntimeServiceShapes(
        {
          ...roots,
          'library.ts': `import { Scheduler, Context } from './services.js';
        export declare namespace Outer.Inner {
          class Instance<T> { next(): Instance<{ value: T }>; data: ${services ? '{ clock: Scheduler; context: Context }' : 'T'}; }
        }`,
          'consumer.ts': `type Value = ${selector};`,
        },
        options,
      ).filter((f) => f.file === 'consumer.ts');
      if (services)
        expect(findings).toContainEqual(
          expect.objectContaining({ rule: 'runtime-service-bundle' }),
        );
      else expect(findings).toEqual([]);
    }
  },
);
