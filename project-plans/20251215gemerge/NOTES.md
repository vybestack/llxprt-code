# 20251215gemerge Implementation Notes

Keep this as a running log while executing the batches.

Rules:

- Add an entry after every batch (PICK or REIMPLEMENT).
- Keep entries short and factual: what changed, conflicts, decisions, follow-ups.
- If a batch deviates from its playbook, document the reason and what was done instead.
- Always record what verification was run and whether it passed.

Template (copy/paste per batch):

```markdown
## Batch NN — PICK|REIMPLEMENT — <sha(s)>

- Resulting commit(s): <hash(es) on 20251215gemerge>
- Conflicts:
  - <files> (summary of resolution)
- Notes:
  - <important implementation detail / divergence / risk>
- Follow-ups:
  - <things to revisit later>
- Verification:
  - Quick: typecheck ✅ / lint ✅
  - Full (if required): format ✅ / lint ✅ / typecheck ✅ / test ✅ / build ✅ / synthetic ✅
```

