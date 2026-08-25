---
description: 
---

# Finish HiKAT Phase

Finalize the current HiKAT implementation phase.

## 1. Confirm scope

Review the original requirements for the current phase.

Verify that every required item has actually been implemented.

Do not mark the phase complete while required functionality remains unfinished.

## 2. Verify

Execute the `/verify` workflow.

If `/verify` reports any failure:
- remain on the phase branch;
- fix the failure;
- run `/verify` again.

Continue until all required validation passes or a genuine blocker is identified.

If a blocker cannot safely be resolved, stop and report it.
Do not merge.

## 3. Final Git review

Run and inspect:
- `git status`;
- the final diff;
- recent relevant commit history.

Confirm:
- no unrelated files are included;
- no secrets are present;
- no temporary/debug artifacts remain;
- no user work was accidentally removed.

## 4. Commit phase

Create a clear commit representing the completed phase.

Use a descriptive commit message reflecting the actual implementation.

Do not use meaningless messages such as:
- final;
- fix;
- changes;
- update;
- done.

## 5. Push phase branch

Push the current phase branch to the configured remote.

Do not force push.

Report and stop if the push cannot be completed safely.

## 6. Merge to main

Only after:
- implementation is complete;
- `/verify` passes;
- the phase commit exists;
- the phase branch has been pushed successfully;

merge the phase branch into the current intended `main`.

Do not rewrite main history.

If there are ambiguous merge conflicts, stop and report them rather than making destructive assumptions.

## 7. Post-merge verification

After merging locally into main:

run the most important relevant tests/build/smoke validation again.

If post-merge validation fails:
- do not push a known broken main;
- report the failure;
- correct it safely using the appropriate branch workflow.

## 8. Push main

If the merged state passes validation, push main normally.

Never force push main.

## 9. Report and stop

Provide:

### Phase
Phase name and objective.

### Git
- phase branch;
- phase commit SHA;
- main commit SHA;
- branch push status;
- main push status.

### Implementation
Concise summary.

### Validation
Each command actually executed and its result.

### Important files
Main files created or modified.

### Notes
Known limitations, pre-existing failures, or architectural concerns.

Then STOP.

Do not begin another phase without a new explicit instruction.