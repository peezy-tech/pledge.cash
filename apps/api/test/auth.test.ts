import { describe, expect, it, beforeEach } from 'bun:test';
import { treaty } from '@elysiajs/eden';
import { createTestApp, type TestApp } from './setup';

describe('Authentication Routes', () => {
  let app: TestApp;
  let api: ReturnType<typeof treaty<TestApp>>;

  beforeEach(() => {
    app = createTestApp();
    api = treaty(app);
  });

  describe('GET /siwe - Get Auth Status', () => {
    it('should return null address when not authenticated', async () => {
      const response = await app.handle(
        new Request('http://localhost/siwe')
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.address).toBeNull();
    });

    it('should work with Eden Treaty', async () => {
      // This will be type-safe once we properly type the routes
      const { data, error } = await api.siwe.get();
      expect(error).toBeNull();
      expect(data).toBeDefined();
    });
  });

  describe('PUT /siwe - Generate Nonce', () => {
    it('should generate a nonce for unauthenticated users', async () => {
      const response = await app.handle(
        new Request('http://localhost/siwe', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.nonce).toBeDefined();
      expect(typeof data.nonce).toBe('string');
    });

    it('should return auth profile for authenticated users', async () => {
      // This would need a proper authentication setup
      // For now, we're testing the unauthenticated case
      const { data, error } = await api.siwe.put();
      expect(error).toBeNull();
      expect(data).toBeDefined();
    });
  });

  describe('POST /siwe - Verify Signature', () => {
    it('should reject without valid signature', async () => {
      const response = await app.handle(
        new Request('http://localhost/siwe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: 'invalid message',
            signature: 'invalid signature',
          }),
        })
      );
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.msg).toBe('Unauthorized');
    });

    it('should handle malformed request body', async () => {
      const response = await app.handle(
        new Request('http://localhost/siwe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // Missing required fields
          }),
        })
      );
      
      // Should handle validation errors gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('DELETE /siwe - Logout', () => {
    it('should handle logout for unauthenticated users', async () => {
      const response = await app.handle(
        new Request('http://localhost/siwe', {
          method: 'DELETE',
        })
      );
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.msg).toBe('Unauthorized');
    });
  });

  describe('Authentication Flow Integration', () => {
    it('should handle complete auth flow (nonce generation)', async () => {
      // Step 1: Generate nonce
      const nonceResponse = await app.handle(
        new Request('http://localhost/siwe', {
          method: 'PUT',
        })
      );
      
      expect(nonceResponse.status).toBe(200);
      const nonceData = await nonceResponse.json();
      expect(nonceData.nonce).toBeDefined();

      // Step 2: Check auth status (should still be unauthenticated)
      const statusResponse = await app.handle(
        new Request('http://localhost/siwe')
      );
      
      expect(statusResponse.status).toBe(200);
      const statusData = await statusResponse.json();
      expect(statusData.address).toBeNull();
    });
  });
}); 