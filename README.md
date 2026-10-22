# Sawn | صون

Multi-tenant B2B platform for motor insurance claims, built for Palestinian motor insurers. Formerly InsurFlow.

## Stack

Node.js, Express 5, MongoDB, Mongoose 9, Joi, JWT.
Tests: Jest, Supertest, mongodb-memory-server.

## Modules

auth, users, organizations, incidents, claims, vehicles, policies, customers, notifications.
Each module holds routes, controller, service, repository, model and validation files.

## Run

1. npm install
2. Copy .env.example to .env and fill the values.
3. npm run dev

## Test

npm test

## API

Base path: /api/v1
The code is the contract. Each module defines its endpoints in src/modules/<module>/<module>.routes.js and its request rules in <module>.validation.js.
