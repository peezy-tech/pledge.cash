import { Elysia } from "elysia";
import { generateNonce } from "siwe";
import { expect } from "bun:test";

/**
 * Mock authentication utilities for testing
 */
export const mockAuth = {
  /**
   * Creates a mock authenticated user context
   */
  createMockUser(address: string = "0x1234567890AbcdEF1234567890aBcdef12345678") {
    return {
      walletAddress: address,
      id: "test-user-id",
    };
  },

  /**
   * Creates a mock JWT token for testing
   */
  createMockJWT(address: string = "0x1234567890AbcdEF1234567890aBcdef12345678") {
    return {
      address,
      nonce: generateNonce(),
    };
  },

  /**
   * Creates headers with mock authentication cookie
   */
  createAuthHeaders(address?: string) {
    const mockUser = this.createMockUser(address);
    return {
      'Content-Type': 'application/json',
      'Cookie': `siwe=mock-jwt-token-${mockUser.walletAddress}`,
    };
  },
};

/**
 * Database mocking utilities
 */
export const mockDb = {
  /**
   * Creates a mock user record
   */
  createMockUserRecord(address: string = "0x1234567890AbcdEF1234567890aBcdef12345678") {
    return {
      id: "test-user-id",
      evm_address: address,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
  },

  /**
   * Creates a mock invoice record
   */
  createMockInvoice(overrides: any = {}) {
    return {
      id: "test-invoice-id",
      creatorId: "test-user-id",
      payerAddress: "0x1234567890AbcdEF1234567890aBcdef12345678",
      payerUserId: null,
      paymentType: "personal",
      actualPayerAddress: null,
      token: "USDC:0x123",
      amount: "10.00",
      description: "Test invoice",
      status: "pending",
      txHash: null,
      createdAt: Date.now(),
      paidAt: null,
      expiresAt: Date.now() + 86400000, // 24 hours
      ...overrides,
    };
  },

  /**
   * Creates a mock multisig account record
   */
  createMockMultisigAccount(userAddress: string = "0x1234567890AbcdEF1234567890aBcdef12345678") {
    return {
      id: "test-multisig-id",
      userAddress,
      address: "0xMultisig1234567890AbcdEF1234567890aBcdef",
      privateKey: "0xprivatekey123",
      createdAt: Date.now(),
    };
  },
};

/**
 * HTTP request utilities
 */
export const requestUtils = {
  /**
   * Creates a standard GET request
   */
  createGetRequest(path: string, headers: Record<string, string> = {}) {
    return new Request(`http://localhost${path}`, {
      method: 'GET',
      headers,
    });
  },

  /**
   * Creates a standard POST request
   */
  createPostRequest(path: string, body: any, headers: Record<string, string> = {}) {
    return new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  },

  /**
   * Creates a standard PUT request
   */
  createPutRequest(path: string, body: any, headers: Record<string, string> = {}) {
    return new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  },

  /**
   * Creates a standard DELETE request
   */
  createDeleteRequest(path: string, headers: Record<string, string> = {}) {
    return new Request(`http://localhost${path}`, {
      method: 'DELETE',
      headers,
    });
  },
};

/**
 * Assertion utilities
 */
export const assertUtils = {
  /**
   * Asserts that a response is a successful JSON response
   */
  async assertJsonResponse(response: Response, expectedStatus: number = 200) {
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    return await response.json();
  },

  /**
   * Asserts that a response is an error response
   */
  async assertErrorResponse(response: Response, expectedStatus: number, expectedError?: string) {
    expect(response.status).toBe(expectedStatus);
    const data = await response.json();
    expect(data.error || data.msg).toBeDefined();
    
    if (expectedError) {
      expect(data.error || data.msg).toBe(expectedError);
    }
    
    return data;
  },

  /**
   * Asserts that a response is a validation error
   */
  async assertValidationError(response: Response) {
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    return await response.json();
  },
};

/**
 * Mock data generators
 */
export const mockData = {
  /**
   * Generates a mock Ethereum address
   */
  generateEthAddress(): string {
    return `0x${Math.random().toString(16).slice(2, 42).padStart(40, '0')}`;
  },

  /**
   * Generates a mock transaction hash
   */
  generateTxHash(): string {
    return `0x${Math.random().toString(16).slice(2, 66).padStart(64, '0')}`;
  },

  /**
   * Generates a mock SIWE message
   */
  generateSiweMessage(address: string, nonce: string): string {
    return `localhost:3000 wants you to sign in with your Ethereum account:\n${address}\n\nTest message\n\nURI: http://localhost:3000\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  },

  /**
   * Generates a mock signature
   */
  generateMockSignature(): string {
    return `0x${Math.random().toString(16).slice(2, 130).padStart(128, '0')}`;
  },
}; 