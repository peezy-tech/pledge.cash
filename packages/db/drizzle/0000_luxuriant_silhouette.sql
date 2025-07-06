CREATE TABLE `agent_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`multisigId` text NOT NULL,
	`userId` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1751738692466 NOT NULL,
	FOREIGN KEY (`multisigId`) REFERENCES `multisig_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hyperliquid_invoices` (
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
	`createdAt` integer DEFAULT 1751738692464 NOT NULL,
	`paidAt` integer,
	`expiresAt` integer,
	FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txHash`) REFERENCES `tx_hashes`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoice_hooks` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceId` text NOT NULL,
	`event` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`createdAt` integer DEFAULT 1751738692466 NOT NULL,
	FOREIGN KEY (`invoiceId`) REFERENCES `hyperliquid_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `multisig_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`userAddress` text NOT NULL,
	`operatorAddress` text NOT NULL,
	`operatorPrivateKey` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1751738692466 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_userAddress_unique` ON `multisig_accounts` (`userAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_operatorAddress_unique` ON `multisig_accounts` (`operatorAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `multisig_accounts_operatorPrivateKey_unique` ON `multisig_accounts` (`operatorPrivateKey`);--> statement-breakpoint
CREATE TABLE `spot_tokens_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cacheKey` text NOT NULL,
	`lastUpdated` integer DEFAULT 1751738692466 NOT NULL,
	`lastUpdateSource` text DEFAULT 'rest' NOT NULL,
	`dataCount` integer DEFAULT 0 NOT NULL,
	`isValid` integer DEFAULT true NOT NULL,
	`expiresAt` integer,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spot_tokens_cache_cacheKey_unique` ON `spot_tokens_cache` (`cacheKey`);--> statement-breakpoint
CREATE TABLE `spot_tokens_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenName` text NOT NULL,
	`szDecimals` integer NOT NULL,
	`weiDecimals` integer NOT NULL,
	`tokenId` text NOT NULL,
	`isCanonical` integer DEFAULT false NOT NULL,
	`fullName` text,
	`evmContract` text,
	`index` integer NOT NULL,
	`createdAt` integer DEFAULT 1751738692466 NOT NULL,
	`updatedAt` integer DEFAULT 1751738692466 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spot_tokens_metadata_tokenName_unique` ON `spot_tokens_metadata` (`tokenName`);--> statement-breakpoint
CREATE TABLE `spot_tokens_mid_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenName` text NOT NULL,
	`midPrice` text NOT NULL,
	`timestamp` integer DEFAULT 1751738692466 NOT NULL,
	`source` text DEFAULT 'websocket' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tx_hashes` (
	`hash` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT 1751738692463 NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`role` text DEFAULT 'user',
	`evm_address` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_evm_address_unique` ON `users` (`evm_address`);