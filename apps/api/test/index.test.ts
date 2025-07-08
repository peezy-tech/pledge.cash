import { describe, expect, it, beforeEach } from 'bun:test';
import { treaty } from '@elysiajs/eden';
import { createTestApp, type TestApp } from './setup';

describe('API Server', () => {
  let app: TestApp;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('Basic Request/Response Testing', () => {
    it('should respond to health check endpoint', async () => {
      const response = await app
        .handle(new Request('http://localhost/'))
        .then((res) => res.text());

      expect(response).toBe('Test HTML');
    });

    it('should handle CORS preflight requests', async () => {
      const response = await app.handle(
        new Request('http://localhost/', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'http://localhost:3000',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'Content-Type',
          },
        })
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });
  });

  describe('Eden Treaty Type-Safe Testing', () => {
    it('should work with Eden Treaty client', async () => {
      const api = treaty(app);
      
      // This will be type-safe based on your actual routes
      // Add specific route tests here once we identify the actual endpoints
      
      // Example: If you have a health endpoint
      // const { data, error } = await api.health.get();
      // expect(error).toBeNull();
      // expect(data).toBeDefined();
    });
  });

  describe('Static File Serving', () => {
    it('should serve static files with correct headers', async () => {
      const response = await app.handle(
        new Request('http://localhost/some-static-file')
      );

      expect(response.headers.get('Content-Type')).toBe('text/html');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed requests gracefully', async () => {
      const response = await app.handle(
        new Request('http://localhost/invalid-endpoint', {
          method: 'POST',
          body: 'invalid json',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      // Should not crash and should return some response
      expect(response).toBeDefined();
    });
  });
}); 