---
description: Squash-merge one pull request after Claude verifies it. Needs PR and SHA from Claude.
---
Mohammed pastes Claude's merge line after /sawn-merge. It holds PR (a number) and SHA (40 hex characters).
If either is missing: stop and ask.
Run every command from the repository root. Paste the raw output of every command.
1. gh pr view PR --json state,headRefOid,baseRefName. state must be OPEN, baseRefName must be main, headRefOid must equal SHA. Otherwise: stop and ask.
2. gh pr merge PR --squash --match-head-commit SHA
3. git status --short. The only allowed line is "?? docs/pitch/". Otherwise: stop and ask.
4. git checkout main
5. git pull --ff-only origin main
6. git log --oneline -3
7. End with this Arabic line: ابعت لكلود: تم الدمج
