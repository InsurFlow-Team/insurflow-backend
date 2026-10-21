# Sawn Agent Rules
Sawn was InsurFlow. Stack: Node.js, Express 5, Mongoose, MongoDB.
Read this file, then the prompt. Open only the docs/features file the prompt names.

## Hard stops
- Git: run git writes only through /sawn-start, /sawn-ship and /sawn-merge, with the inputs the prompt or Claude's approval gives.
- Never run git add . or git add -A. Never commit or push to main. Never merge outside /sawn-merge. Never rebase, force push, reset, stash, restore, cherry-pick or delete a branch.
- Read-only git commands are always allowed: status, diff, log, show, branch --show-current, rev-parse.
- Never add files, tests or libraries outside the prompt.
- Stop and ask when a requirement is ambiguous. Never invent a business rule.
- Never change an API contract, field name or error code without approval in the prompt.
- Never rename the service URL or the database name without a separate plan.

## Conventions
Full text: docs/project/DEVELOPMENT_RULES.md.
- camelCase in requests and responses.
- organizationId comes from the JWT only.
- Cross-tenant and wrong-owner access return 404.
- Every state transition uses atomic findOneAndUpdate. The filter holds organizationId and the expected status.

## Evidence
- Report the real diff, the full npm test output, git status and git log.
- A prose report is not proof.

## Documentation
- Update only the docs files the prompt lists. Report other gaps. Do not fix them.

## Language
- Plans and reports in English. Code and comments in English.
- End every reply with one Arabic line for Mohammed.
