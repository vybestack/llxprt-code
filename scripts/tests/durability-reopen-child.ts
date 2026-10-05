/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeFile } from 'node:fs/promises';
import { JournalResolver } from '../../packages/core/src/recording/journalResolver.js';
import { LocalMediaStore } from '../../packages/core/src/storage/local-media-store.js';
import { reclaimSessionMedia } from '../../packages/core/src/recording/janitor/mediaReclamation.js';
import { collectMediaReferences } from '../../packages/core/src/storage/media-reference-lifecycle.js';

const [file, mediaRoot, projectsRoot, resultFile] = process.argv.slice(2);
if (!file || !mediaRoot || !projectsRoot || !resultFile)
  throw new Error('Missing reopen paths');
const skippedProjects = await reclaimSessionMedia(projectsRoot, undefined);
const store = new LocalMediaStore({
  rootDirectory: mediaRoot,
  quotaBytes: 1024 * 1024,
});
const resolver = await JournalResolver.open(file);
let rows = 0;
let verifiedMedia = 0;
const storedRows: number[] = [];
const chronology: Array<number | undefined> = [];
try {
  for await (const entry of resolver.resolve()) {
    if (entry.content.metadata?.responsesStored) storedRows.push(rows);
    chronology.push(entry.content.metadata?.chronology?.seq);
    for (const reference of collectMediaReferences([entry.content])) {
      await store.readVerified(reference);
      verifiedMedia++;
    }
    rows++;
  }
  await writeFile(
    resultFile,
    JSON.stringify({
      rows,
      storedRows,
      chronology,
      verifiedMedia,
      skippedProjects,
    }),
  );
} finally {
  await resolver.close();
  await store.close();
}
