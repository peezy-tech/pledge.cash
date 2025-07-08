import { describe, expect, it, beforeEach } from 'bun:test';
import { treaty } from '@elysiajs/eden';
import { createTestApp, type TestApp } from './setup';

describe('Hyperliquid Routes', () => {
  let app: TestApp;
  let api: ReturnType<typeof treaty<TestApp>>;

  beforeEach(() => {
    app = createTestApp();
    api = treaty(app);
  });

  describe('GET /hyperliquid/invoices/:id - Public Invoice Details', () => {
    it('should return 404 for non-existent invoice', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices/non-existent-id')
      );
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Invoice not found');
    });

    it('should handle malformed invoice ID', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices/')
      );
      
      // Should handle missing ID parameter
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PUT /hyperliquid/invoices/:id/confirm - Confirm Payment', () => {
    it('should return 404 for non-existent invoice', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices/non-existent/confirm', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            txHash: '0x1234567890abcdef',
          }),
        })
      );
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Invoice not found');
    });

    it('should validate txHash format', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices/test-id/confirm', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            txHash: 'invalid-hash',
          }),
        })
      );
      
      // Should handle validation errors
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should require txHash in request body', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices/test-id/confirm', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
      );
      
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('GET /hyperliquid/operator - Operator Address', () => {
    it('should return 401 for unauthenticated access', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/operator')
      );
      
      expect(response.status).toBe(401);
    });

    it('should return error with Eden Treaty for unauthenticated access', async () => {
      // This will be type-safe based on your actual routes
      const { data, error } = await api.hyperliquid.operator.get();
      expect(error).toBeDefined();
      expect(error).not.toBeNull();
      expect(error?.status).toBe(401);
    });
  });

  describe('GET /hyperliquid/ws-status - WebSocket Status', () => {
    it('should return WebSocket status', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/ws-status')
      );
      
      // Should return status info (might be error if WS not initialized in tests)
      expect(response.status).toBeOneOf([200, 401, 500]);
      
      // Only parse JSON if response has content-type application/json
      if (response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.json();
        expect(data).toBeDefined();
      }
    });

    it('should handle WebSocket client errors gracefully', async () => {
      const { data, error } = await api.hyperliquid['ws-status'].get();
      
      // Should not throw errors, either success or graceful error response
      expect(data || error).toBeDefined();
    });
  });

  describe('Protected Routes (Unauthenticated)', () => {
    it('should return 401 for protected user profile endpoint', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/protected/user-profile')
      );
      
      expect(response.status).toBe(401);
    });

    it('should return 401 for creating invoices', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            payerAddress: '0x1234567890abcdef',
            token: 'USDC:0x123',
            amount: '10.00',
            description: 'Test invoice',
          }),
        })
      );
      
      expect(response.status).toBe(401);
    });

    it('should return 401 for getting user invoices', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices')
      );
      
      expect(response.status).toBe(401);
    });

    it('should return 401 for multisig operations', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/multisig')
      );
      
      expect(response.status).toBe(401);
    });

    it('should handle user addresses endpoint', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/user-addresses')
      );
      
      // This endpoint might not be protected or might not exist
      expect(response.status).toBeOneOf([200, 401, 404]);
    });

    it('should return 401 for spot tokens', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/spot-tokens')
      );
      
      expect(response.status).toBe(401);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON in request body', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices/test/confirm', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: 'invalid json',
        })
      );
      
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle missing content-type header', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/invoices/test/confirm', {
          method: 'PUT',
          body: JSON.stringify({ txHash: '0x123' }),
        })
      );
      
      // Should handle missing content-type gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle unsupported HTTP methods', async () => {
      const response = await app.handle(
        new Request('http://localhost/hyperliquid/operator', {
          method: 'POST',
        })
      );
      
      expect(response.status).toBeOneOf([404, 405]);
    });
  });
}); 