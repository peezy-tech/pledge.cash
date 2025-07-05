#!/usr/bin/env bun

import { db, orm } from "../packages/db";
import { users } from "../packages/db/schema";

const TARGET_EVM_ADDRESS = "0x5af8516e72b0cbe35dcb1a5af2c3c42c8073c723";

async function removeUser() {
  try {
    console.log(`🔍 Looking for user with EVM address: ${TARGET_EVM_ADDRESS}`);
    
    // First, check if the user exists
    const existingUser = await db
      .select()
      .from(users)
      .where(orm.eq(users.evm_address, TARGET_EVM_ADDRESS))
      .get();
    
    if (!existingUser) {
      console.log(`❌ No user found with EVM address: ${TARGET_EVM_ADDRESS}`);
      return;
    }
    
    console.log(`✅ Found user:`, {
      id: existingUser.id,
      name: existingUser.name,
      role: existingUser.role,
      evm_address: existingUser.evm_address,
    });
    
    // Confirm deletion
    console.log(`🗑️  Deleting user with ID: ${existingUser.id}...`);
    
    // Delete the user
    const result = await db
      .delete(users)
      .where(orm.eq(users.evm_address, TARGET_EVM_ADDRESS))
      .returning();
    
    if (result.length > 0) {
      console.log(`✅ Successfully deleted user:`, result[0]);
    } else {
      console.log(`❌ Failed to delete user`);
    }
    
  } catch (error) {
    console.error(`❌ Error removing user:`, error);
    process.exit(1);
  }
}

// Run the script
removeUser().then(() => {
  console.log(`🎉 Script completed successfully`);
  process.exit(0);
}); 