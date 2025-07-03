CREATE TABLE `agent_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`multisigId` text NOT NULL,
	`userId` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1751585516741 NOT NULL,
	FOREIGN KEY (`multisigId`) REFERENCES `multisig_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hyperliquid_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`creatorId` text NOT NULL,
	`payerAddress` text NOT NULL,
	`token` text NOT NULL,
	`amount` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`txHash` text,
	`createdAt` integer DEFAULT 1751585516740 NOT NULL,
	`paidAt` integer,
	`expiresAt` integer,
	FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hyperliquid_invoices_txHash_unique` ON `hyperliquid_invoices` (`txHash`);--> statement-breakpoint
CREATE TABLE `multisig_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`userAddress` text NOT NULL,
	`operatorAddress` text NOT NULL,
	`operatorPrivateKey` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1751585516741 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_userAddress_unique` ON `multisig_accounts` (`userAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_operatorAddress_unique` ON `multisig_accounts` (`operatorAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_operatorPrivateKey_unique` ON `multisig_accounts` (`operatorPrivateKey`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`role` text DEFAULT 'user',
	`evm_address` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_evm_address_unique` ON `users` (`evm_address`);