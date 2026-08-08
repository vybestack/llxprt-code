import fs from 'node:fs'; import zlib from 'node:zlib';
const DIR='/tmp/boundary2';
const SRC = DIR+'/perf-20260807-4102-000.jsonl', GZ = SRC+'.gz';
const GRACE = 60*60*1000;

function reset(){
  fs.rmSync(DIR,{recursive:true,force:true}); fs.mkdirSync(DIR,{recursive:true});
  let s=''; for(let i=0;i<2000;i++) s+=JSON.stringify({turn:i})+'\n';
  fs.writeFileSync(SRC,s); return 2000;
}
const ageOf = (p) => Math.max(0, Date.now() - fs.statSync(p).mtimeMs);  // clamp: mtime can lead Date.now()
function makeOld(p, hours){ const t=(Date.now()-hours*3600e3)/1000; fs.utimesSync(p,t,t); }

function compress(){
  if (!fs.existsSync(SRC)) return 'no source';
  if (fs.existsSync(GZ))   return 'SKIP: archive exists (refuse to overwrite)';
  const age = ageOf(SRC);
  if (age < GRACE)         return `SKIP: only ${(age/1000).toFixed(1)}s since last write (< 1h grace)`;
  const tmp=`${GZ}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(fs.readFileSync(SRC),{level:6}));
  fs.renameSync(tmp,GZ); fs.unlinkSync(SRC);
  return 'COMPRESSED';
}
function readAll(){
  let n=0;
  for(const f of fs.readdirSync(DIR)){
    if (f.endsWith('.tmp')) continue;
    const p=DIR+'/'+f;
    const b = f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(p)) : fs.readFileSync(p);
    n += b.toString().split('\n').filter(Boolean).length;
  }
  return n;
}

let total = reset();
console.log('=== GUARDED, with the guard actually exercised ===');
console.log(`  pass 1 (file is fresh)        -> ${compress()}`);
makeOld(SRC, 3);                                  // pretend nobody has written for 3h
console.log(`  pass 2 (file now 3h idle)     -> ${compress()}`);
console.log(`     readable: ${readAll()} of ${total}   files: ${fs.readdirSync(DIR).join(', ')}`);

// the hazard: a late record for yesterday arrives AFTER the archive exists
fs.appendFileSync(SRC, JSON.stringify({turn:9999,late:true})+'\n'); total++;
console.log(`  late record appended          -> readable ${readAll()} of ${total}, files: ${fs.readdirSync(DIR).length}`);
console.log(`  pass 3 (archive exists)       -> ${compress()}`);
makeOld(SRC, 3);
console.log(`  pass 4 (stray now 3h idle)    -> ${compress()}`);
const final = readAll();
console.log(`     FINAL readable: ${final} of ${total}   lost: ${total-final}`);
console.log(`  files: ${fs.readdirSync(DIR).join(', ')}`);
console.log(`\n  VERDICT: ${final===total ? 'no loss — archive never overwritten' : 'LOSS'}`);
fs.rmSync(DIR,{recursive:true,force:true});
