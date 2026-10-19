---
description: Sawn plan-only step. Produce a plan for the prompt that follows, change nothing.
---

1. Read AGENTS.md and the prompt that follows this command.
2. Read every file the prompt lists under "Files in scope". Read no other file unless the prompt allows it.
3. Run git status --short and git log --oneline -5. Paste the raw output.
4. Write the plan in English with these sections, in this order:
   - Files to change, one line each, with the reason.
   - Functions to add or change, with file:line of the current code.
   - Tests, using the exact test names from the prompt, each mapped to the acceptance criterion it proves.
   - Risks: tenancy, atomicity, contract changes, data shape changes.
   - Questions: every point the prompt leaves open. Write NONE if none.
5. Do not edit, create or delete any file.
6. Stop. Wait for Mohammed to approve the plan.
