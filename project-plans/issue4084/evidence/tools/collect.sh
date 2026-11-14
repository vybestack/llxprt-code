#!/bin/bash
# Copies the Phase E run directories into project-plans/issue4084/evidence/.
# pane-output.log (the raw terminal byte stream, redraws included) is left out;
# so is any other file over 2 MB. The tools themselves live in evidence/tools/.
set -eu
cd "$(dirname "$0")/../../../.."
src=tmp/verify4084/phaseE
dst=project-plans/issue4084/evidence
mkdir -p "$dst/tools"
for dir in "$src"/runs/*/; do
  name=$(basename "$dir")
  rm -rf "${dst:?}/$name"
  mkdir -p "$dst/$name"
  find "$dir" -maxdepth 1 -type f ! -name pane-output.log -size -2048k -exec cp {} "$dst/$name/" \;
done
cp "$src/ground-truth.json" "$dst/ground-truth.json"
cp "$src"/chain.log "$dst/tools/chain.log"
# Encrypted reasoning blobs are opaque and large; the evidence copies drop them.
bun -e '
const fs = require("fs"), path = require("path");
const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "encryptedContent" ? "(removed from evidence copy)" : strip(x)]))
  : v;
const dst = process.argv[1];
for (const d of fs.readdirSync(dst)) {
  const f = path.join(dst, d, "session.jsonl");
  if (!fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(strip(JSON.parse(l)))).join("\n") + "\n");
}' "$dst"
