#!/usr/bin/env node
/**
 * Patches solid-js package.json files to use client-side builds instead of server builds.
 * Bun runs in "node" condition which defaults to SSR server.js - we need the client solid.js.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const nodeModules = join(import.meta.dirname, '..', 'node_modules');

function patchPackage(pkgPath) {
  const fullPath = join(nodeModules, pkgPath);
  try {
    const content = readFileSync(fullPath, 'utf-8');
    // Replace all server.js/cjs references with their client equivalents
    const patched = content
      .replaceAll('/server.js', '/solid.js')
      .replaceAll('/server.cjs', '/solid.cjs')
      .replaceAll('store/dist/solid.js', 'store/dist/store.js')
      .replaceAll('store/dist/solid.cjs', 'store/dist/store.cjs')
      .replaceAll('web/dist/solid.js', 'web/dist/web.js')
      .replaceAll('web/dist/solid.cjs', 'web/dist/web.cjs')
      .replaceAll('web/storage/dist/solid.js', 'web/storage/dist/storage.js')
      .replaceAll('web/storage/dist/solid.cjs', 'web/storage/dist/storage.cjs');
    writeFileSync(fullPath, patched);
    console.log(`Patched ${pkgPath}`);
  } catch (e) {
    console.error(`Failed to patch ${pkgPath}:`, e.message);
  }
}

// Patch all solid-js package.json files
patchPackage('solid-js/package.json');
patchPackage('solid-js/store/package.json');
patchPackage('solid-js/web/package.json');

console.log('Solid.js patched for client-side rendering');
