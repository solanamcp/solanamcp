# API Middlewares

## Overview
The `middlewares` folder contains middleware functions for request validation, authentication, and error handling.

## Folder Structure
```
middlewares/
├── authMiddleware.js   # Middleware for authentication
├── validationMiddleware.js # Middleware for request validation
└── errorMiddleware.js  # Middleware for error handling
```

## Development
1. Implement middleware functions in separate files.
2. Use middleware in routes to handle specific concerns (e.g., authentication).
3. Ensure middleware functions are reusable and modular.
