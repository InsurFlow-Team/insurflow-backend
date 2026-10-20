# Sawn workspace rule

Always read AGENTS.md in the repository root before any task. It holds all project rules.

## Roles
- Claude, the architect and reviewer, writes every prompt. Mohammed delivers it.
- Mohammed approves plans and answers business questions.
- Git writes run only through /sawn-start and /sawn-ship. AGENTS.md holds the full git rule.
- You implement exactly what the prompt says. You do not design, invent business rules or treat your own review as final.

## Reports
- Write every plan and report in English.
- End every reply with one Arabic line telling Mohammed exactly what to send to Claude.
- Evidence is raw command output. Never summarize output. Never paste output before the command finishes.
- Every file:line comes from a file you opened in this session. Write NOT FOUND when a fact is absent.
- When the prompt names a report file, save the report there and paste the same content.

## Terminal
- Run npm test in the foreground. Wait for the final Test Suites block.
- If npm test fails only with a mongodb-memory-server EACCES error or a beforeAll hook timeout, rerun once and report both runs. Any other failure: stop and ask.
- Never open .env. Never print a secret, a token or personal data.

## Memory
- After context compaction or a long pause, re-read the prompt and this rule before you continue.
- Never act on a decision you remember but cannot find in the prompt or in AGENTS.md.
