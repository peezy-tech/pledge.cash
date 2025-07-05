# Address Abstraction Test Scenarios

## Overview
This document outlines comprehensive test scenarios for the address abstraction feature that allows invoices to be paid from either personal wallet addresses or associated multisig addresses.

## Test Categories

### 1. Basic Address Resolution Tests

#### Test 1.1: Personal Address Resolution
- **Setup**: User with personal wallet address `0xPersonal123`
- **Action**: Resolve address `0xPersonal123`
- **Expected**: Returns user ID, paymentType: "personal"

#### Test 1.2: Multisig Address Resolution
- **Setup**: User with multisig address `0xMultisig456`
- **Action**: Resolve address `0xMultisig456`
- **Expected**: Returns user ID, paymentType: "multisig"

#### Test 1.3: Unknown Address Resolution
- **Setup**: Random address `0xUnknown789`
- **Action**: Resolve address `0xUnknown789`
- **Expected**: Returns null

### 2. Invoice Payment Tests

#### Test 2.1: Personal Address Payment (Open Invoice)
- **Setup**: 
  - Invoice with no designated payer
  - User pays from personal address
- **Action**: Confirm payment with personal address transaction
- **Expected**: Payment accepted, invoice marked as paid

#### Test 2.2: Multisig Address Payment (Open Invoice)
- **Setup**: 
  - Invoice with no designated payer
  - User pays from multisig address
- **Action**: Confirm payment with multisig address transaction
- **Expected**: Payment accepted, invoice marked as paid

#### Test 2.3: Personal Address Payment (Designated Payer)
- **Setup**: 
  - Invoice with designated payer `0xPersonal123`
  - User pays from same personal address
- **Action**: Confirm payment
- **Expected**: Payment accepted

#### Test 2.4: Multisig Address Payment (Designated Payer)
- **Setup**: 
  - Invoice with designated payer `0xPersonal123`
  - User pays from associated multisig address
- **Action**: Confirm payment
- **Expected**: Payment accepted (address abstraction working)

#### Test 2.5: Cross-User Payment Rejection
- **Setup**: 
  - Invoice with designated payer `0xPersonal123`
  - Different user attempts to pay from `0xPersonal456`
- **Action**: Confirm payment
- **Expected**: Payment rejected, error message

### 3. Edge Case Tests

#### Test 3.1: Operator Address Payment
- **Setup**: 
  - Invoice with any payer
  - Operator address attempts payment
- **Action**: Confirm payment
- **Expected**: Payment rejected, operator warning

#### Test 3.2: Unregistered Address Payment
- **Setup**: 
  - Invoice with no designated payer
  - New address attempts payment
- **Action**: Confirm payment
- **Expected**: New user created, payment accepted

#### Test 3.3: Multisig Operator Payment
- **Setup**: 
  - Invoice with designated payer
  - Multisig operator address attempts payment
- **Action**: Confirm payment
- **Expected**: Payment validation based on primary user

#### Test 3.4: Invalid Designated Payer
- **Setup**: 
  - Invoice with designated payer `0xInvalid123` (not in database)
  - User attempts payment
- **Action**: Confirm payment
- **Expected**: Payment rejected, payer resolution error

### 4. Database Integrity Tests

#### Test 4.1: Invoice Metadata Population
- **Setup**: Successful payment from multisig address
- **Action**: Check invoice record after payment
- **Expected**: 
  - `payerUserId` populated correctly
  - `paymentType` = "multisig"
  - `actualPayerAddress` = multisig address
  - `payerAddress` = designated payer (if any)

#### Test 4.2: User Registration Via Payment
- **Setup**: New address pays invoice
- **Action**: Check users table after payment
- **Expected**: New user record created with correct address

### 5. API Endpoint Tests

#### Test 5.1: User Addresses Endpoint
- **Setup**: User with personal + multisig addresses
- **Action**: Call `/user/addresses`
- **Expected**: Returns personal address and array of multisig addresses

#### Test 5.2: Invoice Listing with Address Abstraction
- **Setup**: User has invoices paid via personal and multisig
- **Action**: Call `/invoices`
- **Expected**: Returns all invoices with payment metadata

#### Test 5.3: Invoice Details with Payment Context
- **Setup**: Invoice paid via multisig
- **Action**: Call `/invoices/:id`
- **Expected**: Returns payment type and actual payer address

### 6. Error Handling Tests

#### Test 6.1: Malformed Address
- **Setup**: Invalid address format
- **Action**: Attempt payment confirmation
- **Expected**: Proper error handling, no system crash

#### Test 6.2: Database Connection Error
- **Setup**: Database unavailable
- **Action**: Attempt address resolution
- **Expected**: Graceful error handling

#### Test 6.3: Multiple Concurrent Payments
- **Setup**: Same invoice, multiple payment attempts
- **Action**: Concurrent payment confirmations
- **Expected**: Only one succeeds, others rejected

### 7. Performance Tests

#### Test 7.1: Address Resolution Performance
- **Setup**: 1000 users with multisig accounts
- **Action**: Resolve addresses in batch
- **Expected**: Performance within acceptable limits

#### Test 7.2: Invoice Listing Performance
- **Setup**: User with 1000 invoices
- **Action**: List invoices with address resolution
- **Expected**: Response time under 2 seconds

### 8. Security Tests

#### Test 8.1: Address Spoofing Prevention
- **Setup**: Attacker tries to pay with spoofed address
- **Action**: Payment confirmation with invalid transaction
- **Expected**: Payment rejected, no security bypass

#### Test 8.2: Multisig Unauthorized Payment
- **Setup**: Address not authorized on multisig attempts payment
- **Action**: Payment confirmation
- **Expected**: Payment rejected

### 9. Integration Tests

#### Test 9.1: End-to-End Personal Payment Flow
- **Setup**: User creates invoice, pays from personal address
- **Action**: Complete payment flow
- **Expected**: Invoice created → payment → webhooks triggered → status updated

#### Test 9.2: End-to-End Multisig Payment Flow
- **Setup**: User creates invoice, pays from multisig address
- **Action**: Complete payment flow
- **Expected**: Invoice created → payment → webhooks triggered → status updated

### 10. Webhook Tests

#### Test 10.1: Webhook Payload Includes Payment Context
- **Setup**: Invoice paid via multisig
- **Action**: Check webhook payload
- **Expected**: Webhook includes payment type and actual payer address

## Test Data Requirements

### Users
- User A: Personal address `0xPersonalA`, Multisig address `0xMultisigA`
- User B: Personal address `0xPersonalB`, Multisig address `0xMultisigB`
- User C: Personal address `0xPersonalC`, No multisig

### Invoices
- Open invoice (no designated payer)
- Personal payer invoice (designated payer: User A personal)
- Multisig payer invoice (designated payer: User A multisig)

### Test Environment
- Test blockchain with controlled transaction creation
- Database with test data
- Webhook endpoints for testing

## Success Criteria
- All payment scenarios work correctly
- Edge cases are handled gracefully
- Database integrity is maintained
- API endpoints return correct data
- Performance is acceptable
- Security is not compromised

## Automation
- Unit tests for address resolution functions
- Integration tests for payment flows
- Performance benchmarks
- Security scanning 