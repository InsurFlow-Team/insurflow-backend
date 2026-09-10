# InsurFlow — Claude ↔ Antigravity Collaboration Protocol

> **Companion to [DEVELOPMENT_RULES.md](file:///c:/Users/HP/Desktop/INSURFLOW/docs/project/DEVELOPMENT_RULES.md).**  
> That document governs what Antigravity (or any coding agent) must and must not do. This document governs how Claude selects, scopes, hands off, and verifies each unit of work with it. Written after Sprint 1 + Sprint 2 (auth, claims lifecycle, decision/closure, security hardening) were built this way successfully across many rounds — this is the process that already worked, made explicit and repeatable.

---

### 1. Before Any Prompt Is Written

- **Locate the single relevant feature spec.**  
  One task maps to one `docs/features/NN-*.md` file (or is scoped clearly enough to become a new one). Never point Antigravity at the whole `docs/` folder for a single-feature task — it costs more tokens and raises the odds it reads a stale or unrelated file.
- **Check that spec against the actual code, not just against other docs.**  
  `docs/project/*.md` files can and do go stale relative to `docs/features/*.md` and relative to the repository itself — confirmed on this project already (`MVP.md` and `BUSINESS_RULES.md` still describe decision/close as out-of-scope after they were implemented, ratified, and given their own feature spec). The feature spec plus a direct read of the current code is the real source of truth; the master docs are a summary layer that can lag behind.
- **Resolve every open business or design question before writing the prompt, not during Antigravity's implementation.**  
  If the spec is ambiguous, the answer comes from the person, in this conversation, first. Antigravity is never the one who decides what counts as a security-sensitive default, an error code, or a scope boundary.
- **Identify which established conventions this task must reuse, and name them explicitly in the prompt rather than assuming they carry over silently:**
  - Atomic `findOneAndUpdate({ _id, organizationId, status: expectedStatus, ... })` for every state transition — never a separate check-then-write.
  - Cross-tenant or unauthorized-ownership access → `404`, never `403`, to avoid confirming existence.
  - `organizationId` only ever from `req.user`, never from the client, in every repository query.
  - `camelCase` everywhere, in both directions (request and response).
  - The shared response envelope, the shared error-code table, `asyncWrapper` on every controller export, `validate(schema)` at the route level (not inline in controllers).
  - Route-level `validateObjectId` on every `:id` param.

---

### 2. Writing the Prompt

Every prompt includes, in this order:

1. **Context** — what already exists and works, cited from the actual feature spec, with a one-line pointer to which spec file this task extends or creates.
2. **Exact scope** — the specific files and endpoints in play.
3. **Explicit non-goals** — what NOT to touch, named directly, not implied. Scope creep has been the single most common real defect found in review on this project — not logic bugs.
4. **Task breakdown per file**, with real code where precision matters (exact object shapes, exact status/error codes, exact query filters) — not left to inference.
5. **Model configuration note:** For anything touching concurrency, tenancy isolation, auth, or a state-machine transition, the prompt says explicitly to use Gemini 3.8 Flash's high thinking effort, not the medium default — this class of task is exactly where the model's reasoning depth matters most and the cost difference is trivial. Routine CRUD/formatting tasks can stay on medium.
6. **Test requirements** — specific scenarios to cover, always including the tenant-isolation and role-rejection cases even when they seem obvious.
7. **Acceptance criteria**, ending with:  
   > *"Report back the actual changed files (or a diff) and the real terminal `npm test` output, unabridged. A prose summary of what was done is not sufficient on its own."*

---

### 3. Verifying What Comes Back

- **A prose "all done, all tests pass" report is never the end of the review**, regardless of how detailed or professional it reads. It has been wrong, in a real and specific way, on effectively every occasion it arrived without code attached, across both this Claude thread and evidently the parallel ChatGPT thread. This is not a trust issue with any particular tool — it is a structural fact about reviewing implementation claims without seeing the implementation.
- **Read the actual diff or files.** Confirm each item in the prompt's task list is present, matches the exact shapes specified, and that nothing outside the stated scope changed.
- **Read the real test output, not a summary.** Suite names, individual test names, and timing that looks like genuine execution (not round numbers) are what distinguishes a real run from a fabricated one.
- **Classify every finding as one of two things, and say which:**
  - `BLOCKER` (must fix before this task is considered done)
  - `NON-BLOCKING OBSERVATION` (worth a note, doesn't gate closing the task)  
  *Don't manufacture blockers where the implementation is genuinely sound — this project's TOCTOU fixes, tenant-scoped counters, and rate limiting were all found correct on direct inspection and accepted as such without further rounds.*
- **One fix prompt per set of findings**, scoped only to the fix, never bundled with the next feature. This keeps each round independently verifiable.
- **Close the loop in the docs.** Once verified, update the relevant `docs/features/*.md` (or create it) with what's now true, and check whether any `docs/project/*.md` file makes a claim this contradicts — link to the feature spec instead of restating the fact, so it can't drift out of sync again the way it just did.

---

### 4. Working Across Two Parallel AI Threads

This project is being developed with both this Claude thread and a separate ChatGPT-assisted thread, each producing prompts for the same Antigravity/repository. That's a legitimate way to work, but it means neither thread has continuous visibility into the other's decisions. The working habit that already resolved one real divergence (the decision/close scope question) is the one to keep:

- **At the start of any session picking this back up, lead with the actual current repository state** — a fresh zip or diff and real `git log`/`git status` output — rather than assuming the last known state still holds.
- **Treat any "master context" document from the other thread as a strong, well-organized source of claims to verify**, not as ground truth to build on directly, until cross-checked against the code the same way any other implementation report is.
- **When a real divergence is found (as with decision/close), surface it plainly and get an explicit ruling**, then make sure both the code and every doc that mentions it agree afterward.

---

### 5. What Does Not Change Regardless of Model Quality

Gemini 3.8 Flash is a strong, fast, cost-efficient implementation model, and its output on this project has been consistently solid on direct review. That changes how much re-verification a routine, well-specified task needs — it does not change the following, which stay non-negotiable on every task touching security, multi-tenancy, concurrency, or a state transition:

1. **Real code is read before it's trusted.**
2. **Real test output is read before it's trusted.**
3. **The person makes the business-rule and security-tradeoff calls, not the coding agent.**
