/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function providerCursorBody(sourceText: string): string | undefined {
  const source = ts.createSourceFile(
    'HistoryService.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  let body: string | undefined;
  function visit(node: ts.Node): void {
    if (
      ts.isMethodDeclaration(node) &&
      node.name.getText(source) === 'getCuratedForProviderStream'
    )
      body = node.body?.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return body;
}
const forbidden =
  /(?:materializeHistory|getCurated|getAll|getCuratedForProvider)\s*\(|Array\.fromAsync\s*\(|\bIContent\[\]|\.push\s*\(/;

describe('incremental provider preparation source controls', () => {
  it('keeps the public cursor free of eager history reads and full-row collections', () => {
    const body = providerCursorBody(
      readFileSync(new URL('./HistoryService.ts', import.meta.url), 'utf8'),
    );
    expect(body).toBeDefined();
    expect(body).not.toMatch(forbidden);
    expect(body).toContain('streamProviderContent');
    const pipeline = readFileSync(
      new URL('./provider-curated-stream.ts', import.meta.url),
      'utf8',
    );
    expect(pipeline).not.toMatch(/\bIContent\[\]\s*=|\b(?:Map|Set)\s*</);
    expect(pipeline).toContain('ProviderNormalizationDisk');
  });

  it('rejects an eager generator and a cursor that caches every input row', () => {
    expect(
      providerCursorBody(
        'class Probe { async *getCuratedForProviderStream() { yield* this.getCurated(); } }',
      ),
    ).toMatch(forbidden);
    expect(
      providerCursorBody(
        'class Probe { async *getCuratedForProviderStream() { const cached: IContent[] = []; for await (const row of input) cached.push(row); yield* cached; } }',
      ),
    ).toMatch(forbidden);
  });
});
