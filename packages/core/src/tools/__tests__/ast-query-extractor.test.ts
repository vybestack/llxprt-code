/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ASTQueryExtractor } from '../ast-edit/ast-query-extractor.js';

describe('ASTQueryExtractor', () => {
  const extractor = new ASTQueryExtractor();

  it('should extract TypeScript declarations correctly', async () => {
    const code = `
      import { foo } from "./bar";
      const x: number = 10;
      function hello(name: string): string {
        return "Hello " + name;
      }
      class MyClass {
        constructor() {}
        public method() {}
        private secret = "shh";
      }
    `;
    const results = await extractor.extractDeclarations('test.ts', code);
    expect(results).toMatchSnapshot();
  });

  it('should extract Python declarations correctly', async () => {
    const code = `
      import os
      def my_func():
          pass
      class PythonClass:
          def __init__(self):
              pass
    `;
    const results = await extractor.extractDeclarations('test.py', code);
    expect(results).toMatchSnapshot();
  });

  it('should extract signatures', async () => {
    const code = `function test(a: number): void {}`;
    const results = await extractor.extractDeclarations('test.ts', code);
    expect(results[0].signature).toBe('(a: number): void');
  });
});
