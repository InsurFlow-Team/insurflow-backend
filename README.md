# InsurFlow Backend Foundation
// 2:40
This is the backend foundation for the InsurFlow project. It is built using Node.js, Express, and MongoDB.

## Architecture

The project follows a **Modular Layered Architecture**. The application is divided into business modules (`auth`, `users`, `organizations`, `claims`, `vehicles`, `policies`), which are located in `src/modules`.

### Module Structure

Inside each module, code should be separated into layers with clear responsibilities:7

- `controller/`: Handles HTTP request/response. No business logic.
- `service/`: Contains business/use-case logic. Coordinates operations.
- `repository/`: Responsible for database access (Mongoose queries).
- `model/`: Mongoose schemas and models.
- `validation/`: Validates incoming request data (e.g., using Joi).
- `routes.js`: Defines endpoints and maps them to controllers and middlewares.

### Folder Responsibilities

- `src/app.js`: Configures the Express application, applies global middlewares, routes, and error handlers.
- `src/server.js`: The main entry point. Loads config, connects to the DB, and starts the HTTP server.
- `src/config/`: Contains environment variable loading (`env.js`) and database connection logic (`database.js`).
- `src/middlewares/`: Contains global middlewares like `errorHandler.js` and `notFound.js`.
- `src/utils/`: Contains utility functions like `apiResponse.js` for formatting responses.

## Configuration & Environment Variables

Environment variables are managed centrally in `src/config/env.js`. The following variables are supported (see `.env.example`):

- `PORT`: The port the server runs on (default: 3000).
- `DATABASE_URL`: MongoDB connection string.
- `CORS_ORIGIN`: Allowed origins for CORS (default: `*`).
- `JWT_SECRET`: Secret key for JWT authentication.
- `NODE_ENV`: The environment (development/production).

## Database Connection

The database connection logic is centralized in `src/config/database.js`. It uses Mongoose to connect to MongoDB and is called exactly once when `server.js` starts. Repositories should simply require Mongoose models and assume the connection is already established.

## Global Error Handling

Errors are handled centrally using the `errorHandler` middleware in `src/middlewares/errorHandler.js`.
Instead of putting `try/catch` with response logic in every controller, controllers should use `express-async-errors` (or standard `next(err)`) to pass errors to this global handler.

The application also includes a `notFoundHandler` middleware to return a formatted 404 response for undefined routes.

## CORS Configuration

CORS is configured globally in `src/app.js` using the `cors` package. The allowed origin is driven by the `CORS_ORIGIN` environment variable.

## Multi-Tenancy Preparation

The architecture is prepared for organization isolation. Future endpoints will require an authenticated user context containing `userId`, `role`, and `organizationId`, which should be extracted in an authentication middleware and attached to `req.user`.

## Running the Application

1. Create a `.env` file based on `.env.example`.
2. Install dependencies: `npm install`
3. Run in development mode: `npm run dev`
4. Run in production mode: `npm start`
