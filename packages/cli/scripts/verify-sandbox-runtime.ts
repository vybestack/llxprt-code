/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lang, parse } from '@ast-grep/napi';
import * as nodePty from '@lydell/node-pty';
import { Entry } from '@napi-rs/keyring';
import sharp from 'sharp';

const ast = parse(Lang.TypeScript, 'const sandboxProbe = true;');
if (ast.root().kind() !== 'program') {
  throw new Error('@ast-grep/napi did not parse a TypeScript program');
}

if (typeof sharp !== 'function') {
  throw new Error('sharp did not load its native implementation');
}

if (typeof Entry !== 'function') {
  throw new Error('@napi-rs/keyring did not load its native implementation');
}

if (typeof nodePty.spawn !== 'function') {
  throw new Error('@lydell/node-pty did not load its native implementation');
}

console.log(
  `sandbox_runtime_dependencies=ok platform=${process.platform} architecture=${process.arch} modules=@ast-grep/napi,sharp,@napi-rs/keyring,@lydell/node-pty`,
);
