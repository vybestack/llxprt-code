#!/usr/bin/env node
/**
 * Reconcile open Dependabot alerts against the actual installed versions in
 * the regenerated package-lock.json. For each alert we determine whether every
 * installed copy of the package satisfies the advisory's patched range (i.e. is
 * no longer in the vulnerable range). Produces an authoritative FIXED/REMAINING
 * verdict with evidence.
 *
 * Usage: node project-plans/20260624/_reconcile.cjs
 */
const fs = require('fs');
const path = require('path');
const semver = require('semver');

const REPO = path.resolve(__dirname, '..', '..');
// Prefer the committed snapshot (reproducible from a clean checkout); fall back
// to a freshly-fetched /tmp/dependabot_full.json if present.
const SNAPSHOT = path.join(__dirname, '_dependabot_alerts_snapshot.json');
const alertsFile = fs.existsSync(SNAPSHOT)
  ? SNAPSHOT
  : '/tmp/dependabot_full.json';
const alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
const lock = JSON.parse(
  fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8'),
);

// Build map: package name -> Set of installed versions (from lockfile packages map)
const installed = new Map();
for (const [pkgPath, meta] of Object.entries(lock.packages || {})) {
  if (!pkgPath.includes('node_modules')) continue;
  if (!meta || !meta.version) continue;
  // derive package name from the path tail after the last node_modules/
  const name = pkgPath.split('node_modules/').pop();
  if (!installed.has(name)) installed.set(name, new Set());
  installed.get(name).add(meta.version);
}

function patchedRange(adv) {
  // Prefer the first_patched_version from the matching vulnerability entry.
  const vulns = adv.security_advisory?.vulnerabilities || [];
  return vulns;
}

const results = [];
for (const a of alerts) {
  const num = a.number;
  const pkg = a.dependency?.package?.name;
  const manifest = a.dependency?.manifest_path;
  const ghsa = a.security_advisory?.ghsa_id;
  const sev = a.security_advisory?.severity;
  const vulns = a.security_advisory?.vulnerabilities || [];
  // find the vulnerability entry matching this package
  const v = vulns.find((x) => x.package?.name === pkg) || vulns[0];
  const vulnRange = v?.vulnerable_version_range || '';
  const firstPatched = v?.first_patched_version?.identifier || null;

  const have = [...(installed.get(pkg) || [])].sort(semver.compare);

  let verdict;
  let detail;
  if (have.length === 0) {
    verdict = 'NOT-INSTALLED';
    detail = 'package not present in lockfile';
  } else {
    // For each installed version: is it still vulnerable?
    const stillVuln = have.filter((ver) => {
      try {
        // vulnerable if it satisfies the vulnerable range
        return semver.satisfies(ver, vulnRange.replace(/,/g, ' '), {
          includePrerelease: true,
        });
      } catch {
        // fall back to firstPatched comparison
        if (firstPatched) return semver.lt(ver, firstPatched);
        return true; // unknown -> flag
      }
    });
    if (stillVuln.length === 0) {
      verdict = 'FIXED';
      detail = `installed=[${have.join(', ')}] none in vuln range "${vulnRange}"`;
    } else {
      verdict = 'REMAINING';
      detail = `installed=[${have.join(', ')}] STILL VULN=[${stillVuln.join(', ')}] range="${vulnRange}" firstPatched=${firstPatched}`;
    }
  }
  results.push({ num, pkg, sev, ghsa, manifest, verdict, detail });
}

// Sort: REMAINING first, then by severity, then pkg
const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
results.sort((a, b) => {
  if (a.verdict !== b.verdict) {
    if (a.verdict === 'REMAINING') return -1;
    if (b.verdict === 'REMAINING') return 1;
  }
  return (sevOrder[a.sev] ?? 9) - (sevOrder[b.sev] ?? 9);
});

const counts = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;

console.log('=== RECONCILIATION SUMMARY ===');
console.log(JSON.stringify(counts, null, 2));
console.log('\n=== REMAINING / NOT-INSTALLED (need attention) ===');
for (const r of results.filter((x) => x.verdict !== 'FIXED')) {
  console.log(
    `[${r.verdict}] alert ${r.num} ${r.pkg} (${r.sev}) ${r.ghsa}\n    ${r.detail}\n    manifest=${r.manifest}`,
  );
}
console.log('\n=== FIXED (count ' + (counts.FIXED || 0) + ') ===');
for (const r of results.filter((x) => x.verdict === 'FIXED')) {
  console.log(`[FIXED] alert ${r.num} ${r.pkg} (${r.sev}) ${r.ghsa}`);
}

// write machine-readable
fs.writeFileSync(
  path.join(__dirname, '_reconcile_result.json'),
  JSON.stringify(results, null, 2),
);
