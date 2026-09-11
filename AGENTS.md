# InsurFlow — Agent Directives & Operational Rules

## 1. Continuous Markdown Documentation Synchronization (Non-Negotiable)
Whenever **any** change is made in this repository (e.g., adding a feature, fixing a bug, adjusting schemas, adding/modifying endpoints, changing business rules, or refactoring), **you MUST directly and immediately update the relevant `.md` documentation files** before considering the task complete:

- **`docs/project/CURRENT_STATE.md`**: Update milestone checkboxes, current phase, test counts, completed tasks, and active next steps.
- **`docs/features/*.md`**: Update existing feature specs or create new feature specs covering endpoints, payloads, transitions, and status codes.
- **`docs/API_CONTRACT.md` & `docs/ADMIN_API_FOR_FRONTEND.md`**: Keep request/response schemas, query parameters, headers, and error codes strictly synchronized.
- **`docs/project/ARCHITECTURE.md`**: Update if models, layers, middleware, or system components change.
- **`docs/project/BUSINESS_RULES.md`**: Reflect any clarified domain rules, status transitions, or capacity logic.
- **`README.md`**: Keep high-level project summary, setup instructions, and module status up to date.

---

## 2. Core Engineering Principles
Refer to [DEVELOPMENT_RULES.md](file:///c:/Users/HP/Desktop/INSURFLOW/docs/project/DEVELOPMENT_RULES.md) for the 13 binding project laws:
1. **Do Not Rewrite Working Architecture** (Express 5, Mongoose 9, CommonJS, 5-layer pattern).
2. **Do Not Change API Contracts Without Explicit Approval** (`camelCase` everywhere, standard envelope).
3. **Do Not Modify Unrelated Modules** (Keep changes strictly scoped).
4. **Inspect Existing Implementation Before Changing It** (Read the actual files first).
5. **Implement One Scoped Task at a Time** (Atomic, verifiable increments).
6. **Run Existing Tests Before and After Changes** (`npm test`).
7. **Add Tests for New Behavior** (Multi-tenancy isolation, RBAC, state transitions).
8. **Never Invent Business Rules** (Consult [BUSINESS_RULES.md](file:///c:/Users/HP/Desktop/INSURFLOW/docs/project/BUSINESS_RULES.md) or ask).
9. **Respect Multi-Tenancy Inconditionally** (`organizationId` strictly from `req.user.organizationId`).
10. **Do Not Introduce New Libraries Without Approval**.
11. **Do Not Perform Unprompted Production Hardening**.
12. **Prefer Minimal, Targeted Changes**.
13. **Continuous Documentation Synchronization (Update .md Files Directly)**.
