import { db } from "db";
import { users, multisigAccounts } from "db/schema";
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface AddressResolution {
  userId: string;
  paymentType: "personal" | "multisig";
  resolvedAddress: string; // The original address that was resolved
  userPersonalAddress: string; // The user's personal wallet address
  multisigAddress?: string; // The multisig address if payment came from multisig
}

/**
 * Resolves any address (personal or multisig) to a user ID and payment context
 * @param address - The address to resolve (can be personal wallet or multisig)
 * @returns AddressResolution if found, null if no user can be determined
 */
export async function resolveAddressToUser(
  address: string
): Promise<AddressResolution | null> {
  const normalizedAddress = getAddress(address);

  // First, try to find a user with this address as their personal wallet
  const directUser = await db
    .select()
    .from(users)
    .where(eq(users.evm_address, normalizedAddress))
    .get();

  if (directUser) {
    return {
      userId: directUser.id,
      paymentType: "personal",
      resolvedAddress: normalizedAddress,
      userPersonalAddress: directUser.evm_address!,
    };
  }

  // If not found directly, check if this is a multisig address
  const multisigMatch = await db
    .select({
      multisigId: multisigAccounts.id,
      multisigAddress: multisigAccounts.address,
      userAddress: multisigAccounts.userAddress,
    })
    .from(multisigAccounts)
    .where(eq(multisigAccounts.address, normalizedAddress))
    .get();

  if (multisigMatch) {
    // Found a multisig match, now get the user associated with it
    const userFromMultisig = await db
      .select()
      .from(users)
      .where(eq(users.evm_address, multisigMatch.userAddress))
      .get();

    if (userFromMultisig) {
      return {
        userId: userFromMultisig.id,
        paymentType: "multisig",
        resolvedAddress: normalizedAddress,
        userPersonalAddress: userFromMultisig.evm_address!,
        multisigAddress: multisigMatch.multisigAddress,
      };
    }
  }

  // Address couldn't be resolved to any user
  return null;
}

/**
 * Checks if a given address is authorized to pay for an invoice on behalf of a specific user
 * @param address - The address attempting to pay
 * @param targetUserId - The user ID that should be considered the payer
 * @returns boolean indicating if the address is authorized
 */
export async function isAddressAuthorizedForUser(
  address: string,
  targetUserId: string
): Promise<boolean> {
  const resolution = await resolveAddressToUser(address);
  return resolution?.userId === targetUserId;
}

/**
 * Gets all addresses (personal + multisig) associated with a user
 * @param userId - The user ID to get addresses for
 * @returns Array of addresses associated with the user
 */
export async function getUserAddresses(userId: string): Promise<{
  personalAddress: string | null;
  multisigAddresses: string[];
}> {
  // Get user's personal address
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!user) {
    return { personalAddress: null, multisigAddresses: [] };
  }

  // Get user's multisig addresses
  const multisigAddresses = await db
    .select({
      address: multisigAccounts.address,
    })
    .from(multisigAccounts)
    .where(eq(multisigAccounts.userAddress, user.evm_address || ""))
    .all();

  return {
    personalAddress: user.evm_address,
    multisigAddresses: multisigAddresses.map((m) => m.address),
  };
}

/**
 * EDGE CASE HANDLERS
 */

/**
 * Checks if an address is a system operator address
 * @param address - The address to check
 * @returns boolean indicating if this is an operator address
 */
export function isOperatorAddress(address: string): boolean {
  if (!process.env.OPERATOR_PRIVATE_KEY) return false;
  const operatorPrivateKey = getAddress(process.env.OPERATOR_PRIVATE_KEY);
  if (!operatorPrivateKey) return false;
  const operatorAddress = privateKeyToAccount(operatorPrivateKey).address;
  if (!operatorAddress) return false;
  
  return address === operatorAddress;
}

/**
 * Handles edge cases for payment resolution
 * @param address - The address attempting to pay
 * @param invoicePayerAddress - The designated payer address (if any)
 * @returns Extended resolution information including edge case details
 */
export async function resolvePaymentWithEdgeCases(
  address: string,
  invoicePayerAddress?: string | null
): Promise<{
  resolution: AddressResolution | null;
  edgeCases: {
    isOperatorPayment: boolean;
    isUnauthorizedPayment: boolean;
    isValidPayment: boolean;
    warningMessage?: string;
  };
}> {
  const normalizedAddress = address.toLowerCase();
  const resolution = await resolveAddressToUser(normalizedAddress);
  
  const edgeCases = {
    isOperatorPayment: isOperatorAddress(normalizedAddress),
    isUnauthorizedPayment: false,
    isValidPayment: false,
    warningMessage: undefined as string | undefined,
  };

  // Handle operator payments
  if (edgeCases.isOperatorPayment) {
    edgeCases.warningMessage = "Payment comes from system operator address";
    edgeCases.isValidPayment = false; // Typically we don't want operator addresses paying invoices
    return { resolution, edgeCases };
  }

  // Handle case where address cannot be resolved to any user
  if (!resolution) {
    edgeCases.isUnauthorizedPayment = true;
    
    // Allow registration via payment if:
    // 1. Invoice has no designated payer (open to anyone), OR
    // 2. The actual payer address matches the designated payer address (even if not in system yet)
    if (!invoicePayerAddress) {
      // Open invoice - any address can pay and get registered
      edgeCases.isValidPayment = true;
      edgeCases.warningMessage = "Payment address is not associated with any known user - will register via payment";
    } else if (invoicePayerAddress.toLowerCase() === normalizedAddress) {
      // Designated payer matches actual payer - allow registration via payment
      edgeCases.isValidPayment = true;
      edgeCases.warningMessage = "Payment address is not associated with any known user - will register via payment";
    } else {
      // Wrong address paying - reject
      edgeCases.isValidPayment = false;
      edgeCases.warningMessage = "Payment address is not associated with any known user and does not match designated payer";
    }
    
    return { resolution, edgeCases };
  }

  // Handle case where invoice has a designated payer
  if (invoicePayerAddress) {
    const targetPayerResolution = await resolveAddressToUser(invoicePayerAddress);
    
    if (!targetPayerResolution) {
      edgeCases.isValidPayment = false;
      edgeCases.warningMessage = "Designated payer address cannot be resolved";
      return { resolution, edgeCases };
    }
    
    // Check if the actual payer is authorized for the designated payer
    edgeCases.isValidPayment = resolution.userId === targetPayerResolution.userId;
    
    if (!edgeCases.isValidPayment) {
      edgeCases.isUnauthorizedPayment = true;
      edgeCases.warningMessage = `Payment from ${resolution.paymentType} address is not authorized for designated payer`;
    }
  } else {
    // No designated payer, any valid user address is acceptable
    edgeCases.isValidPayment = true;
  }

  return { resolution, edgeCases };
}

/**
 * Gets detailed information about a multisig account including all authorized users
 * @param multisigAddress - The multisig address to analyze
 * @returns Information about the multisig account
 */
export async function getMultisigDetails(multisigAddress: string): Promise<{
  multisigAccount: any | null;
  primaryUser: any | null;
  operatorAddress: string | null;
}> {
  const multisigAccount = await db
    .select()
    .from(multisigAccounts)
    .where(eq(multisigAccounts.address, multisigAddress.toLowerCase()))
    .get();

  if (!multisigAccount) {
    return { multisigAccount: null, primaryUser: null, operatorAddress: null };
  }

  const primaryUser = await db
    .select()
    .from(users)
    .where(eq(users.evm_address, multisigAccount.userAddress))
    .get();

  return {
    multisigAccount,
    primaryUser,
    operatorAddress: multisigAccount.operatorAddress,
  };
} 