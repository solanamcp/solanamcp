# API Routes

## Overview
The `routes` folder contains route definitions for the Solana-MCP API. Each route maps to a specific controller function to handle business logic.

## Folder Structure
```
routes/
├── index.js            # Main entry point for API routes
├── userRoutes.js       # Routes related to user operations
├── transactionRoutes.js# Routes related to transactions
└── ...                 # Additional route files
```

## Development
1. Define new routes in separate files (e.g., `userRoutes.js`).
2. Import and register routes in `index.js`.
3. Ensure each route is linked to a corresponding controller function.
