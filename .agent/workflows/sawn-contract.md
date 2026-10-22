---
description: Print the API contract of one module from the code. Writes no file.
---
MODULE comes after the command, for example: /sawn-contract incidents. If it is missing or src/modules/MODULE/ does not exist: stop and ask.
Read only: src/app.js (mount path), src/middlewares/role.middleware.js, src/middlewares/auth.middleware.js and every file in src/modules/MODULE/.
1. Find the mount path of the module in src/app.js.
2. For every route in MODULE.routes.js print, in English:
   - method and full path
   - roles allowed, and whether auth is required
   - params, query and body fields with type, required or optional, and every Joi rule
   - success status and the response keys, taken from the service formatter
   - every error status and code the route can return, taken from the service and validation
3. Put file:line after every fact. Write NOT FOUND when a fact is absent from the code.
4. Print the contract in the chat only. Create or edit no file. Run no git write and no npm test.
5. End with this Arabic line: انسخ الكونتراكت وابعته للفريق
