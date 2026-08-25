---
description: 
---

# Verify Current Work

Verify the current implementation thoroughly before it can be considered complete.

1. Inspect `git status` and `git diff`.

2. Determine which project components were affected by the current work.

3. Discover the repository's real validation commands from:
   - package scripts;
   - build configuration;
   - project documentation;
   - existing CI configuration;
   - Gradle/Maven configuration when applicable.

4. Run every relevant validation that exists for the affected components:
   - tests;
   - lint;
   - type checking;
   - build;
   - integration tests;
   - targeted smoke tests when practical.

5. If a validation fails:
   - inspect the actual error;
   - determine whether the current work caused it;
   - fix failures caused by the current work;
   - rerun the failed validation;
   - rerun any dependent validation.

6. Never:
   - disable tests;
   - delete failing tests simply to obtain a green result;
   - weaken compiler/linter settings to hide a problem;
   - suppress exceptions without fixing their cause;
   - claim a command was executed when it was not.

7. Inspect the final diff for:
   - accidental changes;
   - debug logging;
   - temporary files;
   - TODO implementations;
   - secrets or credentials;
   - generated files that should not be tracked;
   - unnecessary dependencies;
   - unrelated refactors.

8. Confirm whether all required validation passes.

Return:
- commands executed;
- pass/fail result of each;
- fixes made during verification;
- any validation that could not be executed and why.

Do not commit, merge, or push failing work.