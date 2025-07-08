DROP TABLE `spot_tokens_cache`;--> statement-breakpoint
DROP TABLE `spot_tokens_metadata`;--> statement-breakpoint
DROP TABLE `spot_tokens_mid_prices`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`multisigId` text NOT NULL,
	`userId` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1751984857993 NOT NULL,
	FOREIGN KEY (`multisigId`) REFERENCES `multisig_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agent_wallets`("id", "multisigId", "userId", "address", "createdAt") SELECT "id", "multisigId", "userId", "address", "createdAt" FROM `agent_wallets`;--> statement-breakpoint
DROP TABLE `agent_wallets`;--> statement-breakpoint
ALTER TABLE `__new_agent_wallets` RENAME TO `agent_wallets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_hyperliquid_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`creatorId` text NOT NULL,
	`payerAddress` text,
	`payerUserId` text,
	`paymentType` text,
	`actualPayerAddress` text,
	`token` text NOT NULL,
	`amount` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`txHash` text,
	`createdAt` integer DEFAULT 1751984857993 NOT NULL,
	`paidAt` integer,
	`expiresAt` integer,
	FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txHash`) REFERENCES `tx_hashes`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_hyperliquid_invoices`("id", "creatorId", "payerAddress", "payerUserId", "paymentType", "actualPayerAddress", "token", "amount", "description", "status", "txHash", "createdAt", "paidAt", "expiresAt") SELECT "id", "creatorId", "payerAddress", "payerUserId", "paymentType", "actualPayerAddress", "token", "amount", "description", "status", "txHash", "createdAt", "paidAt", "expiresAt" FROM `hyperliquid_invoices`;--> statement-breakpoint
DROP TABLE `hyperliquid_invoices`;--> statement-breakpoint
ALTER TABLE `__new_hyperliquid_invoices` RENAME TO `hyperliquid_invoices`;--> statement-breakpoint
CREATE TABLE `__new_invoice_hooks` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceId` text NOT NULL,
	`event` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`createdAt` integer DEFAULT 1751984857993 NOT NULL,
	FOREIGN KEY (`invoiceId`) REFERENCES `hyperliquid_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_invoice_hooks`("id", "invoiceId", "event", "type", "url", "createdAt") SELECT "id", "invoiceId", "event", "type", "url", "createdAt" FROM `invoice_hooks`;--> statement-breakpoint
DROP TABLE `invoice_hooks`;--> statement-breakpoint
ALTER TABLE `__new_invoice_hooks` RENAME TO `invoice_hooks`;--> statement-breakpoint
CREATE TABLE `__new_multisig_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`userAddress` text NOT NULL,
	`operatorAddress` text NOT NULL,
	`operatorPrivateKey` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1751984857993 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_multisig_accounts`("id", "userAddress", "operatorAddress", "operatorPrivateKey", "address", "createdAt") SELECT "id", "userAddress", "operatorAddress", "operatorPrivateKey", "address", "createdAt" FROM `multisig_accounts`;--> statement-breakpoint
DROP TABLE `multisig_accounts`;--> statement-breakpoint
ALTER TABLE `__new_multisig_accounts` RENAME TO `multisig_accounts`;--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_userAddress_unique` ON `multisig_accounts` (`userAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_operatorAddress_unique` ON `multisig_accounts` (`operatorAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_operatorPrivateKey_unique` ON `multisig_accounts` (`operatorPrivateKey`);--> statement-breakpoint
CREATE TABLE `__new_tx_hashes` (
	`hash` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT 1751984857992 NOT NULL,
	`metadata` text
);
--> statement-breakpoint
INSERT INTO `__new_tx_hashes`("hash", "createdAt", "metadata") SELECT "hash", "createdAt", "metadata" FROM `tx_hashes`;--> statement-breakpoint
DROP TABLE `tx_hashes`;--> statement-breakpoint
ALTER TABLE `__new_tx_hashes` RENAME TO `tx_hashes`;