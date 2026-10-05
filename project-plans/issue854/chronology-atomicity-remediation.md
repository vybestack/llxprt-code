# The ten atomicity failures pass; bounded rollback remains unfinished

The unchanged original suites now pass all 31 cases. Their starting run had
21 passes and 10 failures. No failure-injection fixture or original assertion
was changed. This stage fixes transaction cleanup and partial journal admission;
it does not certify rollback memory bounds.

Evidence is under
`tmp/verify854/p05d/chronology-atomicity-20260930-branch3-sol/`. The preceding
cursor-migration and identity reports and their raw evidence were read without
modification.

## Transaction changes

`HistoryServiceCore.captureChronology` separates the existing rollback capture
from stamping. The transaction captures original marker references and stamper
counters before any input mutation. Stamping, density inheritance, density token
estimation, span derivation, ownership preparation/publication, journal admission,
callbacks and finalization now run in the protected scope. Ordinary batch token
estimation still precedes that scope, before any chronology mutation occurs.

The commit tracks successful `HistoryJournalStore.apply` calls with a scalar
counter. An exception after any admitted prefix triggers compensation, rather
than relying on a flag set only after the complete plan. Compensation uses a
count-only rewind followed by the already captured previous rows. The rewind
count is an upper bound, `previous.length + next.length`, sufficient to empty
any prefix of the supported append, rewind, compression and density plans.
It is not reported as an exact count of removed rows. This avoids constructing
another partial projection or another inverse-plan array and works for both
pending overlays and durable resolver folds. The extra shallow next-history
copy inside the commit was also removed.

Compensation errors are collected without skipping token/span restoration,
stamper restoration, remaining input-row cleanup or ownership rollback. A
callback can make its own metadata unrestorable by freezing it after overwrite;
that error is reported while other rows and ownership still receive cleanup.
An unchanged primary error is rethrown when cleanup succeeds. Otherwise the
`AggregateError` message remains `History mutation and rollback failed`, and
its errors are ordered as primary, journal compensation, row restoration in
input order, then ownership rollback in reverse effect order.

This does not promise successful membership restoration when compensation
admission itself fails. Such a failure can leave a partially compensated journal.
The rejection exposes that failure, while independent local and ownership
cleanup still runs. Four added cases cover compensation/ownership error order,
unrestorable metadata cleanup, and caller-owned marker identity at 512 and
8192 rows.

## Identity scope and the remaining ledger

The transaction still uses the existing context-length strong rollback ledger.
It is temporary and unbounded. The structural finding remains visible under
`captureChronology`, the new name for the capture portion of `stampHistory`.
No weak-handle migration or disk-backed rollback cursor was implemented here.

The earlier WeakSet-only counterexample does not establish that the service
must keep displaced originals alive after every strong owner disappears. A
WeakSet cannot own its members, and a WeakRef cannot resurrect a collected
object. Its disk/weak negative control remains unchanged as an impossible
identity oracle once those originals have been collected. None of its failures
or assertions was suppressed.

Strong caller references give a different requirement. If a caller still owns
an original marker, a weak handle can recover that same live object during
rollback. The two added caller-owned cases keep every original strongly reachable,
overwrite every input marker, cross a timer/GC boundary, and check every restored
reference. They pass with the current ledger. A future cursor migration should
use weak handles for that live-object identity case and serialized values for
collected originals. These tests do not certify the storage bound or lifetime
of that future implementation.

The existing no-external-owner identity tests also still pass: the current
strong ledger itself keeps their displaced originals alive. The six child
measurements retain the disk/weak and disk/strong controls and report zero marker
witnesses after settlement. That is a marker-lifetime observation, not a general
transaction leak certification.

No new context-sized production JavaScript copy was added. Existing previous
projections, forward plans, rollback entries and whole-array media-owner APIs
remain to be migrated. The prior 1 MiB retained-growth, 440-row fixture and
8 MiB fixture failures remain adverse evidence. Those probes and full acceptance
were not rerun, and this stage makes no GREEN claim for them.

## Verification

- Original atomicity/density suites: 31 passes, zero failures; all ten original
  RED cases are now GREEN.
- Added cleanup and strong-caller-identity cases: four passes.
- Unchanged identity and traversal suites: nine passes, including the weak-only
  negative control.
- Isolated adjacent history, recording and child suites: 564 passes across
  59 files. Adjacent density: 23 passes. Media/ownership: 16 passes across
  four files.
- Official root `npm run typecheck`: passes, including declaration builds and
  workspace, script and eval checks.
- Normal root `npm run lint`, forced 800/80 and normal ESLint over all 445
  dirty code files, dirty-file Prettier and `git diff --check`: pass.
- Structural scanner: unchanged source, 17 passes and three production-file
  failures, with seven findings before and after. The only finding-name change
  is `stampHistory` to `captureChronology`; the same unbounded ledger is still
  flagged. No additional retention finding was introduced.
- Test audit: 2,102 unique file/test/flag/detail/area identities before and
  after, with zero added and zero removed findings.

The first forced dirty-tree lint run found the added test's enclosing describe
callback above the existing 80-line limit. It was split into two feature groups
without changing the cases or assertions. Initial production lint failures and
all raw outputs remain in the evidence directory. The first media command used
an incorrect ownership-test path and ran only the other three files; a separate
corrected four-file run supplies the 16-case result above.

No `.llxprt` content or preceding evidence was changed. No commit, push, OCR,
merge, whole-repository test run or full acceptance run was performed.
