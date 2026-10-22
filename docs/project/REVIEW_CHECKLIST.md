# Review Checklist
Claude applies this list to every delivery. Blockers come first.

## Evidence
- Real diff or changed files attached.
- Full npm test output attached, with the final Test Suites block.
- git status attached. Full git log attached at feature close.
- Prose-only report: reject.

## Scope
- Only files from the prompt changed.
- No new file, test or library outside the prompt.
- No commit, push or stash by the agent.
- No API contract change outside the prompt.

## Tenancy and security
- organizationId read from the JWT only.
- Every tenant query filters on organizationId.
- Cross-tenant and wrong-owner access return 404.
- No hedged assertion such as toContain([403, 404]).
- No token, secret or personal data in logs or responses.

## State transitions
- Atomic findOneAndUpdate. Filter holds organizationId and the expected status, plus assignedTo where relevant.
- No check-then-write.
- No status skipping. REJECTED and CLOSED stay terminal.
- Timeline entry holds action, performedBy, role, timestamp, previousStatus, newStatus, notes.
- Workload cap 3, counted over ASSIGNED, IN_PROGRESS, CORRECTION_REQUIRED.

## Conventions
- camelCase both ways.
- Shared envelope, asyncWrapper, validate(schema) and validateObjectId at route level.
- Error codes match the contract.

## Tests
- Tenant isolation case and role rejection case present.
- Fixtures go through the real API. Direct database writes hide bugs.
- No test deleted or loosened to pass.

## Docs
- No .md file created or changed outside the prompt.
- No file:// link or absolute path.

## Severity
- BLOCKER: breaks tenancy, security, a state rule, the contract or the evidence rule.
- NON-BLOCKING: naming, style, small gaps. Note without gating.
