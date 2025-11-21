import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('App quittingMessages block', () => {
  it('defines showTodoPanel before it is used', () => {
    const appSource = readFileSync(
      path.resolve(__dirname, './App.tsx'),
      'utf8',
    );
    const quittingBlockIndex = appSource.indexOf('if (quittingMessages)');
    expect(quittingBlockIndex).toBeGreaterThan(0);

    const showTodoDeclarationIndex = appSource.lastIndexOf(
      'const [showTodoPanel',
      quittingBlockIndex,
    );
    expect(showTodoDeclarationIndex).toBeGreaterThanOrEqual(0);
    expect(showTodoDeclarationIndex).toBeLessThan(quittingBlockIndex);
  });
});
