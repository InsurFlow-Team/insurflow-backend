---
description: Sawn implement step. Test first, then code, then the full suite, for the approved plan.
---

1. Read AGENTS.md, the prompt that follows this command, and the approved plan.
2. Run git status --short. Paste the raw output. Stop if it shows a change that is neither "?? docs/pitch/" nor a file from an earlier approved stage of this story.
3. Write only the tests the prompt names, with the exact names.
4. Run only those tests. Paste the raw output. They must fail for the expected reason. Stop and ask if one passes before the code exists.
5. Write the code in the files the plan lists. Nothing else.
6. Run the same tests again. Paste the raw output. All must pass.
7. Run /sawn-evidence.
8. Stop. Do not start the next stage or the next story.
