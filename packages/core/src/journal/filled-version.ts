/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext } from './groupBuildShared.js';
import { readVersionAt } from './trailerAccess.js';
import { MUTATION } from './recordKinds.js';
import type { Version } from './version.js';

export async function filledVersion(
  ctx: BuildContext,
  sequence: number,
  appendOnly = false,
): Promise<Version | undefined> {
  let version = ctx.published;
  if (ctx.access === undefined) return undefined;
  while (version !== undefined && version.commitSeq > sequence) {
    if (
      appendOnly &&
      ![MUTATION.append, MUTATION.fill, MUTATION.state, MUTATION.owner].some(
        (kind) => kind === version?.mutation,
      )
    )
      return undefined;
    let next: Version | undefined;
    const skips = appendOnly
      ? []
      : [...version.skip].reverse().filter((offset) => offset !== 0);
    for (const offset of skips) {
      const ancestor = await readVersionAt(ctx.access, offset);
      if (ancestor.commitSeq >= sequence) {
        next = ancestor;
        break;
      }
    }
    version =
      next ??
      (version.parent === 0
        ? undefined
        : await readVersionAt(ctx.access, version.parent));
  }
  return version?.commitSeq === sequence ? version : undefined;
}
