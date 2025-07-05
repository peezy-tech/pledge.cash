# WebSocket Client Implementation Plan

## Overview

This document outlines the implementation plan for adding a WebSocket client to the backend that connects to Hyperliquid's WebSocket API to cache spot tokens data and provide it to the frontend via a GET endpoint.

## Requirements Analysis

From the TODO: "websocket client on backend that frontend can GET request some info (spot tokens list)"

### Current State
- Frontend currently calls `infoClient.spotMeta()` directly via REST API
- This creates unnecessary API calls and potential rate limiting issues
- No real-time updates for spot token metadata

### Desired State
- Backend maintains a WebSocket connection to Hyperliquid
- Spot tokens data is cached in memory with periodic updates
- Frontend retrieves cached data via GET request
- Real-time updates when spot tokens change

## Architecture Design

### Components

1. **WebSocket Client Service** (`websocket_client.ts`)
   - Maintains connection to `wss://api.hyperliquid.xyz/ws`
   - Subscribes to `allMids` feed for spot token price updates
   - Handles connection lifecycle (connect, disconnect, reconnect)
   - Implements error handling and heartbeat monitoring

2. **Spot Tokens Cache** (`spot_tokens_cache.ts`)
   - In-memory cache for spot tokens metadata
   - Periodic refresh mechanism
   - Thread-safe access patterns
   - Fallback to database persistence

3. **Database Schema** (extend `packages/db/schema.ts`)
   - New table for spot tokens metadata
   - Backup mechanism for cache recovery

4. **API Endpoints** (`spot_tokens_routes.ts`)
   - GET endpoint for cached spot tokens
   - Health check endpoint for WebSocket status

### Data Flow

1. **Initialization**
   - API server starts WebSocket client service
   - Initial spot tokens data loaded from database or REST API
   - WebSocket connection established

2. **Runtime**
   - WebSocket receives real-time updates
   - Cache updated with new data
   - Periodic backup to database
   - Frontend requests served from cache

3. **Error Handling**
   - Connection failures trigger reconnection logic
   - Stale data detection and refresh
   - Graceful degradation to REST API fallback

## Implementation Strategy

### Phase 1: Core WebSocket Client
- [ ] Create WebSocket client service with connection management
- [ ] Implement subscription to `allMids` feed
- [ ] Add basic error handling and reconnection logic
- [ ] Create in-memory cache for spot tokens data

### Phase 2: Database Integration
- [ ] Extend database schema for spot tokens storage
- [ ] Implement periodic backup mechanism
- [ ] Add data recovery on startup

### Phase 3: API Endpoints
- [ ] Create GET endpoint for cached spot tokens
- [ ] Add health check endpoint
- [ ] Integrate with existing route structure

### Phase 4: Frontend Integration
- [ ] Update frontend hooks to use new endpoint
- [ ] Add loading states and error handling
- [ ] Test end-to-end functionality

## Technical Decisions

### WebSocket Library
- Use native WebSocket API or `ws` library
- Pros: Full control, no additional dependencies
- Cons: Need to implement reconnection logic

### Cache Strategy
- **In-Memory**: Fast access, but lost on restart
- **Database**: Persistent, but slower access
- **Hybrid**: In-memory with database backup (recommended)

### Data Subscription
- Subscribe to `allMids` for price updates
- Periodic refresh of spot metadata via REST API
- Consider subscribing to multiple feeds for comprehensive data

### Error Handling
- Exponential backoff for reconnection attempts
- Circuit breaker pattern for repeated failures
- Fallback to REST API when WebSocket is unavailable

## Schema Changes

```typescript
// packages/db/schema.ts
export const spotTokensCache = table("spot_tokens_cache", {
  id: t.text().primaryKey(),
  tokenData: t.text({ mode: "json" }).notNull(),
  lastUpdated: t.integer().default(Date.now()).notNull(),
  createdAt: t.integer().default(Date.now()).notNull(),
});

export const websocketStatus = table("websocket_status", {
  id: t.text().primaryKey().$default(() => "hyperliquid_ws"),
  isConnected: t.integer({ mode: "boolean" }).default(false).notNull(),
  lastConnected: t.integer(),
  lastError: t.text(),
  reconnectAttempts: t.integer().default(0).notNull(),
  lastUpdated: t.integer().default(Date.now()).notNull(),
});
```

## API Endpoints

### GET /hyperliquid/spot-tokens
```typescript
{
  "tokens": [
    {
      "name": "USDC",
      "szDecimals": 8,
      "weiDecimals": 8,
      "index": 0,
      "tokenId": "0x6d1e7cde53ba9467b783cb7c530ce054",
      "isCanonical": true,
      "lastUpdated": 1703123456789
    }
  ],
  "lastUpdated": 1703123456789,
  "source": "websocket" | "cache" | "fallback"
}
```

### GET /hyperliquid/websocket-status
```typescript
{
  "connected": true,
  "lastConnected": 1703123456789,
  "lastError": null,
  "reconnectAttempts": 0,
  "subscriptions": ["allMids"]
}
```

## Risk Assessment

### Technical Risks
1. **WebSocket Connection Stability**
   - Mitigation: Robust reconnection logic with exponential backoff
   - Fallback: REST API as backup data source

2. **Memory Usage**
   - Risk: Large spot tokens datasets consuming memory
   - Mitigation: Periodic cleanup and size limits

3. **Data Consistency**
   - Risk: Cache and database out of sync
   - Mitigation: Timestamps and validation checks

### Business Risks
1. **API Rate Limiting**
   - Risk: Excessive API calls during failures
   - Mitigation: Circuit breaker and backoff strategies

2. **Stale Data**
   - Risk: Frontend using outdated token information
   - Mitigation: TTL checks and freshness indicators

## Testing Strategy

### Unit Tests
- WebSocket client connection and reconnection logic
- Cache operations and data integrity
- Error handling scenarios

### Integration Tests
- End-to-end data flow from WebSocket to frontend
- Database persistence and recovery
- API endpoint responses

### Performance Tests
- Memory usage under load
- Cache access times
- WebSocket message processing speed

## Monitoring and Observability

### Metrics
- WebSocket connection uptime
- Cache hit/miss rates
- API endpoint response times
- Error rates and types

### Logs
- Connection status changes
- Data update events
- Error conditions and recovery actions

### Health Checks
- WebSocket connection status
- Cache freshness
- Database connectivity

## Migration Strategy

### Backward Compatibility
- Existing frontend code continues to work
- Gradual migration to new endpoint
- Feature flags for rollback capability

### Deployment
- Database migration for new tables
- WebSocket client deployment
- Frontend updates

## Implementation Files

### Backend Files
- `apps/api/src/websocket_client.ts` - WebSocket client service
- `apps/api/src/spot_tokens_cache.ts` - Cache management
- `apps/api/src/spot_tokens_routes.ts` - API endpoints
- `packages/db/schema.ts` - Database schema additions

### Frontend Files
- `apps/web/src/hooks/useHyperliquid.tsx` - Updated hooks
- `apps/web/src/utils/api.ts` - New API client methods

## Success Criteria

1. **Performance**: Frontend spot tokens loading time reduced by 50%
2. **Reliability**: 99.9% uptime for WebSocket connection
3. **Scalability**: Support for 100+ concurrent frontend clients
4. **Monitoring**: Full observability of WebSocket client status
5. **Backwards Compatibility**: No breaking changes to existing frontend code

## Timeline Estimate

- **Phase 1**: 2-3 days (Core WebSocket client)
- **Phase 2**: 1-2 days (Database integration)
- **Phase 3**: 1 day (API endpoints)
- **Phase 4**: 1 day (Frontend integration)
- **Testing & Polish**: 1-2 days

**Total**: 6-9 days

## Next Steps

1. Review and approve this implementation plan
2. Start with Phase 1 implementation
3. Set up monitoring and logging infrastructure
4. Create comprehensive tests
5. Deploy and monitor in production 