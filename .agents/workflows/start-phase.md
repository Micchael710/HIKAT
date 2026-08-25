---
description: 
---

# Start HiKAT Phase

Prepare the repository for a new implementation phase.

1. Read the complete phase instructions before changing files.

2. Inspect:
   - current branch;
   - `git status`;
   - recent relevant history.

3. Never discard existing uncommitted work.

4. Confirm that the intended base is the current valid `main`.

5. Do not start from an old feature/phase branch.

6. Create one new descriptive branch for this complete phase:

`phase/<number>-<short-description>`

7. Do not create separate branches for individual small changes inside this phase.

8. Inspect all repository areas relevant to the phase before implementing.

9. Identify:
   - existing architecture;
   - existing patterns;
   - tests;
   - build commands;
   - affected contracts;
   - likely integration points.

10. Implement the phase according to its provided instructions and HiKAT Workspace Rules.

Do not merge or push main during implementation.

When implementation is complete, use `/finish-phase`.