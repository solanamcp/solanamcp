# API Module

## Overview
The `api` module provides RESTful and WebSocket APIs for external integrations. It handles routing, business logic, and middleware for request validation and authentication.

## Features
- RESTful APIs for interacting with Solana-MCP services.
- WebSocket support for real-time updates.
- Middleware for authentication and request validation.

## Folder Structure
```
api/
├── routes/             # API route definitions
├── controllers/        # Business logic for API endpoints
├── middlewares/        # Middleware for request validation and authentication
└── README.md           # Module overview
```

## Development
1. Define routes in the `routes/` folder.
2. Implement business logic in the `controllers/` folder.
3. Add middleware for validation and authentication in the `middlewares/` folder.
