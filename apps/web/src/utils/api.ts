import { edenTreaty } from '@elysiajs/eden'
import type { App } from 'api'

// API configuration
export const API_BASE_URL = import.meta.env.VITE_BASE_DOMAIN ? `https://${import.meta.env.VITE_BASE_DOMAIN}` : 'http://localhost:3000/';

export const api = edenTreaty<App>(API_BASE_URL, { $fetch: { credentials: 'include' } })

// Helper function for making authenticated API calls
export const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions: RequestInit = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  const response = await fetch(url, { ...defaultOptions, ...options });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.msg || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}; 