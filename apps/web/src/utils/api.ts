import { edenTreaty } from '@elysiajs/eden'
import type { App } from 'api'

// API configuration
export const API_BASE_URL = location.origin === "http://localhost:5173" ? "http://localhost:3000" : location.origin;

export const api = edenTreaty<App>(API_BASE_URL, { $fetch: { credentials: 'include' } })

console.log(API_BASE_URL);