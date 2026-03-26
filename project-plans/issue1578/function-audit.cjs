const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const files = [
  'packages/cli/src/auth/oauth-manager.ts',
  'packages/cli/src/auth/provider-registry.ts',
  'packages/cli/src/auth/proactive-renewal-manager.ts',
  'packages/cli/src/auth/token-access-coordinator.ts',
  'packages/cli/src/auth/auth-flow-orchestrator.ts',
  'packages/cli/src/auth/auth-status-service.ts',
  'packages/cli/src/auth/provider-usage-info.ts',
  'packages/cli/src/auth/OAuthBucketManager.ts',
  'packages/cli/src/auth/oauth-provider-base.ts',
  'packages/cli/src/auth/types.ts',
  'packages/cli/src/auth/anthropic-oauth-provider.ts',
  'packages/cli/src/auth/codex-oauth-provider.ts',
  'packages/cli/src/auth/gemini-oauth-provider.ts',
  'packages/cli/src/auth/qwen-oauth-provider.ts',
];

function walk(node, sf, out) {
  const kinds = new Set([
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.FunctionExpression,
  ]);

  if (kinds.has(node.kind)) {
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const len = end - start + 1;

    if (len > 80) {
      let name = '(anonymous)';
      if (node.name && typeof node.name.getText === 'function') {
        name = node.name.getText(sf);
      } else if (
        ts.isArrowFunction(node) &&
        node.parent &&
        ts.isVariableDeclaration(node.parent)
      ) {
        name = node.parent.name.getText(sf);
      }
      out.push({ name, start, end, len });
    }
  }

  ts.forEachChild(node, (c) => walk(c, sf, out));
}

for (const rel of files) {
  const abs = path.resolve(rel);
  const src = fs.readFileSync(abs, 'utf8');
  const lineCount = src.split('\n').length;
  const sf = ts.createSourceFile(
    abs,
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const out = [];
  walk(sf, sf, out);

  const fileFlag = lineCount > 800 ? 'FILE>800' : 'file-ok';
  console.log(`\n${rel} (${lineCount}) ${fileFlag}`);
  if (out.length === 0) {
    console.log('  no funcs >80');
  } else {
    for (const item of out) {
      console.log(`  ${item.name} ${item.start}-${item.end} (${item.len})`);
    }
  }
}
