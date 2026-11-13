# Sawn | صون

Multi-tenant B2B platform for motor insurance claims, built for Palestinian motor insurers. Formerly InsurFlow.

A claim moves from first report to field inspection, review and final decision. Three clients use one backend: a web dashboard, a Flutter field app and a public tracking page.

Live dashboard: [https://insurflow-dashboard.vercel.app/](https://insurflow-dashboard.vercel.app/)

## Stack

Node.js, Express 5, MongoDB, Mongoose 9, Joi, JWT.
Tests: Jest, Supertest, mongodb-memory-server.
Services: Cloudinary (photos and signatures), Firebase Cloud Messaging (push).

## Modules

auth, users, organizations, incidents, claims, vehicles, policies, customers, garages, letters, notifications.
Each module holds routes, controller, service, repository, model and validation files.

## Highlights

- Tenant isolation: `organizationId` comes from the verified JWT. Cross-tenant access returns 404.
- 10-state claim lifecycle with role-guarded transitions and a timeline event for every status change.
- Atomic state changes: one `findOneAndUpdate` checks tenant, expected status and owner in the same query.
- Roles: Admin, Claims Officer and Field Adjuster.
- Map-based dispatch with a workload cap of 3 active claims per adjuster.
- 1248 automated tests across 63 suites (full run, 11 Nov 2026).

## Run

1. npm install
2. Copy .env.example to .env and fill the values.
3. npm run dev

## Test

npm test

## Demo data

npm run seed:demo
npm run seed:demo:reset

## API

Base path: /api/v1
The code is the contract. Each module defines its endpoints in src/modules/<module>/<module>.routes.js and its request rules in <module>.validation.js.
