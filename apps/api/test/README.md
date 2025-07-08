# API Testing Setup

This directory contains the testing infrastructure for the Drama Haus API server built with Elysia.

## Overview

The testing setup uses:
- **Bun Test**: Built-in test runner with Jest-like API
- **Eden Treaty**: Type-safe client for testing API endpoints
- **Elysia Handle**: Direct request/response testing without network calls

## File Structure

```
test/
├── README.md           # This file
├── setup.ts           # Test app factory and configuration
├── test-utils.ts      # Reusable testing utilities
├── index.test.ts      # Main integration tests
├── auth.test.ts       # Authentication endpoint tests
└── hyperliquid.test.ts # Hyperliquid route tests
```

## Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage

# Run specific test file
bun test auth.test.ts
```

## Test Architecture

### Test App Factory (`setup.ts`)

The `createTestApp()` function creates a clean Elysia instance for testing that:
- Excludes database migrations
- Excludes WebSocket initialization
- Includes all route handlers
- Provides a controlled environment

```typescript
import { createTestApp } from './setup';

const app = createTestApp();
```

### Testing Approaches

#### 1. Direct Request/Response Testing

```typescript
const response = await app.handle(
  new Request('http://localhost/api/endpoint', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  })
);

expect(response.status).toBe(200);
const data = await response.json();
```

#### 2. Eden Treaty Type-Safe Testing

```typescript
import { treaty } from '@elysiajs/eden';

const api = treaty(app);
const { data, error } = await api.endpoint.get();

expect(error).toBeNull();
expect(data).toBeDefined();
```

## Test Utilities

### Mock Authentication (`test-utils.ts`)

```typescript
import { mockAuth } from './test-utils';

// Create mock user
const user = mockAuth.createMockUser('0x123...');

// Create auth headers
const headers = mockAuth.createAuthHeaders('0x123...');
```

### Request Utilities

```typescript
import { requestUtils } from './test-utils';

// Create standard requests
const getRequest = requestUtils.createGetRequest('/api/endpoint');
const postRequest = requestUtils.createPostRequest('/api/endpoint', { data: 'value' });
```

### Assertion Utilities

```typescript
import { assertUtils } from './test-utils';

// Assert JSON response
const data = await assertUtils.assertJsonResponse(response, 200);

// Assert error response
const error = await assertUtils.assertErrorResponse(response, 404, 'Not found');
```

### Mock Data Generators

```typescript
import { mockData } from './test-utils';

const address = mockData.generateEthAddress();
const txHash = mockData.generateTxHash();
const siweMessage = mockData.generateSiweMessage(address, nonce);
```

## Test Categories

### Authentication Tests (`auth.test.ts`)

Tests for SIWE (Sign-In With Ethereum) authentication flow:
- Nonce generation
- Signature verification
- Authentication status
- Logout functionality

### Hyperliquid Tests (`hyperliquid.test.ts`)

Tests for Hyperliquid-specific endpoints:
- Public invoice operations
- Payment confirmation
- Protected route authorization
- Error handling

### Integration Tests (`index.test.ts`)

General API tests:
- CORS handling
- Static file serving
- Error responses
- Eden Treaty compatibility

## Testing Best Practices

### 1. Use Descriptive Test Names

```typescript
describe('Authentication Routes', () => {
  it('should return null address when not authenticated', async () => {
    // Test implementation
  });
});
```

### 2. Group Related Tests

```typescript
describe('Invoice Management', () => {
  describe('Creating Invoices', () => {
    it('should create invoice with valid data', async () => {});
    it('should reject invalid token format', async () => {});
  });
});
```

### 3. Test Both Success and Error Cases

```typescript
it('should return 200 for valid invoice ID', async () => {});
it('should return 404 for non-existent invoice', async () => {});
```

### 4. Use Test Utilities for Common Operations

```typescript
// Good: Use utilities
const response = await app.handle(
  requestUtils.createPostRequest('/api/invoices', mockDb.createMockInvoice())
);

// Avoid: Inline request creation
const response = await app.handle(
  new Request('http://localhost/api/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ /* ... */ })
  })
);
```

## Testing Without Database

The test setup excludes database operations to ensure tests are:
- Fast and isolated
- Not dependent on external services
- Deterministic

For testing database interactions, consider:
- Mocking database calls
- Using in-memory databases
- Testing database operations separately

## Type Safety

With Eden Treaty, you get full type safety in tests:

```typescript
const api = treaty(app);
const response = await api.hyperliquid.invoices.get();

// TypeScript knows the response structure
expect(response.data?.created).toBeDefined();
```

## Error Handling Tests

Always test error scenarios:

```typescript
describe('Error Handling', () => {
  it('should handle invalid JSON gracefully', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/endpoint', {
        method: 'POST',
        body: 'invalid json'
      })
    );
    
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
```

## Performance Considerations

- Tests run in isolation without network calls
- Database operations are excluded
- WebSocket connections are not initialized
- Tests should complete quickly

## Contributing

When adding new tests:

1. Follow the existing patterns
2. Use the test utilities
3. Test both success and error cases
4. Include type-safe Eden Treaty tests
5. Update this README if needed

## Additional Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Eden Treaty Documentation](https://elysiajs.com/eden/treaty/overview.html)
- [Elysia Testing Guide](https://elysiajs.com/patterns/unit-test.html) 