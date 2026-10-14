# Claude and Antigravity Protocol
Claude architects and reviews. Antigravity implements. Mohammed decides business and security questions and runs git.

## Prompt order
1. Context
2. Goal
3. Files in scope
4. Non-goals
5. Contract: endpoints, roles, errors
6. Stages, one skill each
7. Evidence required
8. Stop conditions

## Rules
- Design and business questions are answered before the prompt. Every assumption appears in the prompt.
- Risky work uses two prompts: plan only, then implement after approval. Risky means concurrency, security, state transitions and RBAC.
- Thinking level: high for risky work, medium for routine work.
- One feature per chat. One fix prompt per set of findings.
- Docs go stale. Verify docs against the code. Code wins.

## Review
- A prose report never closes a task.
- Required: real diff, full npm test output, git status. Feature close adds a full git log.
- Findings carry one label: BLOCKER or NON-BLOCKING.
- Review follows docs/project/REVIEW_CHECKLIST.md.

## Session start
- Open with real git log and git status output.
- Treat every context document as a claim to verify.
