# InsurFlow — Engineering & Development Rules (The Project Law)

> **MANDATORY INSTRUCTIONS FOR AI AGENTS & ENGINEERS:**  
> This document governs all development activities in the InsurFlow codebase. It acts as the operational constitution for AI coding assistants (such as Antigravity) and human contributors alike. Violating these rules causes architectural churn, regressions, and lost engineering velocity.

---

### Rule 1: Do Not Rewrite Working Architecture
- **Directive:** Preserve existing architectural frameworks, directory structures, and design patterns.
- **Context:** The system uses Express 5, Mongoose 9, CommonJS modules, and a 5-layer pattern (Route → Controller → Service → Repository → Model).
- **Prohibition:** Never suggest or execute wholesale refactoring to NestJS, TypeScript, clean architecture/DDD boilerplate, or alternative ORMs. Targeted surgical improvements are required; architecture churn is forbidden.

---

### Rule 2: Do Not Change API Contracts Without Explicit Approval
- **Directive:** Existing endpoint paths, HTTP verbs, query parameters, request body schemas, and response JSON envelopes are legally binding contracts with Web and Mobile frontend teams.
- **Context:** Mobile (Flutter) and Web apps depend on exact field names (e.g., `plateNumber`, `customerName`, `incidentType`).
- **Prohibition:** Never rename fields, change wrapper structures, or alter HTTP status codes unless fixing an explicitly verified defect with stakeholder alignment.

---

### Rule 3: Do Not Modify Unrelated Modules
- **Directive:** Keep changes strictly scoped to the files and modules directly relevant to the assigned task.
- **Prohibition:** If assigned a task in the `claims` module, do not "clean up" the `auth`, `users`, or `vehicles` modules. Do not reformat files outside the scope of your work.

---

### Rule 4: Inspect Existing Implementation Before Changing It
- **Directive:** Always read and verify the actual source code, database models, and active tests before forming hypotheses or proposing modifications.
- **Prohibition:** Never assume how an endpoint is implemented based solely on third-party audits or memory. Validate reality against the code on disk.

---

### Rule 5: Implement One Scoped Task at a Time
- **Directive:** Break complex objectives into small, isolated, verifiable increments.
- **Prohibition:** Do not attempt to fix validation, rewrite queries, update configuration, and add new features in a single monolithic edit. Complete, verify, and test each step before advancing.

---

### Rule 6: Run Existing Tests Before and After Changes
- **Directive:** Ensure zero regression. Verify that the test suite passes before introducing changes, and immediately verify that all tests continue to pass after edits are made.
- **Command:** `npm test` or `npx jest --runInBand`.
- **Requirement:** If a change breaks an existing test, investigate whether the test was asserting a legacy defect or if your change introduced a regression. Never delete tests to make a build pass.

---

### Rule 7: Add Tests for New Behavior
- **Directive:** Add the tests the prompt lists. Do not add other tests.
- **Focus Areas:**
  - Tenant boundary isolation (cross-organization rejections).
  - RBAC authorization (rejection of unauthorized roles).
  - Concurrency safety (atomic state transitions, race conditions).
  - Malformed or boundary inputs.

---

### Rule 8: Never Invent Business Rules
- **Directive:** Consult `docs/project/BUSINESS_RULES.md` for all domain decisions.
- **Prohibition:** If a requirement appears ambiguous or underspecified, **stop and ask the user or project lead**. Never extrapolate, speculate, or invent business logic out of thin air.

---

### Rule 9: Respect Multi-Tenancy Inconditionally
- **Directive:** Multi-tenancy is the foundational security pillar of InsurFlow.
- **Mandatory Standards:**
  1. `organizationId` must **always** be extracted from `req.user.organizationId`.
  2. Every database query that accesses or mutates tenant data must include `organizationId` in its filter.
  3. Never accept an `organizationId` from client request bodies.
  4. Cross-tenant access must always yield an HTTP 404 response to avoid information leakage.

---

### Rule 10: Do Not Introduce New Libraries Without Approval
- **Directive:** Maximize the use of the existing, vetted dependency tree.
- **Approved Dependencies:** Every package listed in package.json.
- **Prohibition:** Do not install alternative validation libraries (e.g., Zod), utility packages (e.g., Lodash), or ORMs without explicit user request.

---

### Rule 11: Do Not Perform Unprompted Production Hardening
- **Directive:** Distinguish between MVP blockers (critical functional/integrity defects) and non-blocking production hardening.
- **Prohibition:** Do not divert time to setting up complex rate-limiting algorithms, Redis session stores, Kubernetes manifests, or clustering unless explicitly instructed in the current task.

---

### Rule 12: Prefer Minimal, Targeted Changes
- **Directive:** Strive for the smallest possible diff that completely, safely, and cleanly solves the problem.
- **Prohibition:** Avoid unnecessary cosmetic line rearrangements, comment stripping, or blanket stylistic rewrites. Preserve existing codebase conventions and comments.

---

### Rule 13: Prompt-Scoped Documentation Updates
- **Directive:** Update only the documentation files the prompt lists.
- **Prohibition:** Do not fix other documentation gaps. Report them in the final report.
