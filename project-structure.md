# Project Structure

```
solana-mcp/
├── api/                # API endpoints for external integrations
│   ├── routes/         # API route definitions
│   ├── controllers/    # Business logic for API endpoints
│   └── middlewares/    # Middleware for request validation and authentication
├── contracts/          # Solana smart contracts
│   ├── tokens/         # Token-related contracts
│   ├── defi/           # DeFi-related contracts
│   └── utils/          # Utility contracts
├── docs/               # Documentation and guides
│   ├── api/            # API documentation
│   ├── architecture/   # System architecture diagrams
│   └── user-guides/    # End-user guides
├── frontend/           # Web and mobile user interfaces
│   ├── public/         # Static assets
│   ├── src/            # Source code
│   │   ├── components/ # Reusable UI components
│   │   ├── pages/      # Application pages
│   │   ├── services/   # API integration logic
│   │   └── styles/     # Global and component-specific styles
├── scripts/            # Deployment and utility scripts
│   ├── deploy/         # Deployment scripts for contracts and services
│   ├── migrate/        # Data migration scripts
│   └── utils/          # Utility scripts for testing and debugging
├── services/           # Backend services for LLM and blockchain interactions
│   ├── llm/            # LLM-related services
│   ├── blockchain/     # Blockchain interaction services
│   └── utils/          # Shared utilities for backend services
├── tests/              # Unit and integration tests
│   ├── api/            # Tests for API endpoints
│   ├── contracts/      # Tests for smart contracts
│   ├── frontend/       # Tests for frontend components
│   └── services/       # Tests for backend services
└── README.md           # Project overview
```

## Module Descriptions
- **api/**: Contains RESTful and WebSocket APIs for third-party integrations.  
- **contracts/**: Includes Solana smart contracts for core functionalities, organized by domain (e.g., tokens, DeFi).  
- **docs/**: Technical documentation, including API references, architecture diagrams, and user guides.  
- **frontend/**: Houses React-based web and mobile apps, with modularized components and pages.  
- **scripts/**: Deployment scripts, data migration tools, and utilities for automation.  
- **services/**: Backend services for LLM parsing, transaction mapping, and wallet management.  
- **tests/**: Comprehensive test cases for all modules, organized by functionality.
