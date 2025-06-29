CREATE TABLE `hyperliquid_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`creatorId` text NOT NULL,
	`payerAddress` text NOT NULL,
	`token` text NOT NULL,
	`amount` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`txHash` text,
	`createdAt` integer DEFAULT 1751163327724 NOT NULL,
	`paidAt` integer,
	`expiresAt` integer,
	FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hyperliquid_invoices_txHash_unique` ON `hyperliquid_invoices` (`txHash`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`feeClaimer` text NOT NULL,
	`leftoverReceiver` text NOT NULL,
	`quoteMint` text NOT NULL,
	`poolFees` text NOT NULL,
	`activationType` text NOT NULL,
	`collectFeeMode` text NOT NULL,
	`migrationOption` text NOT NULL,
	`tokenType` text NOT NULL,
	`tokenDecimal` text NOT NULL,
	`migrationQuoteThreshold` text NOT NULL,
	`partnerLpPercentage` integer NOT NULL,
	`creatorLpPercentage` integer NOT NULL,
	`partnerLockedLpPercentage` integer NOT NULL,
	`creatorLockedLpPercentage` integer NOT NULL,
	`sqrtStartPrice` text NOT NULL,
	`lockedVesting` text NOT NULL,
	`migrationFeeOption` text NOT NULL,
	`tokenSupply` text NOT NULL,
	`creatorTradingFeePercentage` integer NOT NULL,
	`curve` text NOT NULL,
	`creatorWalletAddress` text NOT NULL,
	`userId` text,
	`transactionSignature` text,
	`createdAt` integer DEFAULT 1751163327724 NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_configs`("id", "feeClaimer", "leftoverReceiver", "quoteMint", "poolFees", "activationType", "collectFeeMode", "migrationOption", "tokenType", "tokenDecimal", "migrationQuoteThreshold", "partnerLpPercentage", "creatorLpPercentage", "partnerLockedLpPercentage", "creatorLockedLpPercentage", "sqrtStartPrice", "lockedVesting", "migrationFeeOption", "tokenSupply", "creatorTradingFeePercentage", "curve", "creatorWalletAddress", "userId", "transactionSignature", "createdAt") SELECT "id", "feeClaimer", "leftoverReceiver", "quoteMint", "poolFees", "activationType", "collectFeeMode", "migrationOption", "tokenType", "tokenDecimal", "migrationQuoteThreshold", "partnerLpPercentage", "creatorLpPercentage", "partnerLockedLpPercentage", "creatorLockedLpPercentage", "sqrtStartPrice", "lockedVesting", "migrationFeeOption", "tokenSupply", "creatorTradingFeePercentage", "curve", "creatorWalletAddress", "userId", "transactionSignature", "createdAt" FROM `configs`;--> statement-breakpoint
DROP TABLE `configs`;--> statement-breakpoint
ALTER TABLE `__new_configs` RENAME TO `configs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `configs_transactionSignature_unique` ON `configs` (`transactionSignature`);--> statement-breakpoint
CREATE TABLE `__new_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`uri` text NOT NULL,
	`configAddress` text NOT NULL,
	`baseMintAddress` text NOT NULL,
	`quoteMintAddress` text NOT NULL,
	`creatorWalletAddress` text NOT NULL,
	`userId` text,
	`poolAddress` text NOT NULL,
	`transactionSignature` text,
	`gameServerUrl` text,
	`createdAt` integer DEFAULT 1751163327724 NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pools`("id", "name", "symbol", "uri", "configAddress", "baseMintAddress", "quoteMintAddress", "creatorWalletAddress", "userId", "poolAddress", "transactionSignature", "gameServerUrl", "createdAt") SELECT "id", "name", "symbol", "uri", "configAddress", "baseMintAddress", "quoteMintAddress", "creatorWalletAddress", "userId", "poolAddress", "transactionSignature", "gameServerUrl", "createdAt" FROM `pools`;--> statement-breakpoint
DROP TABLE `pools`;--> statement-breakpoint
ALTER TABLE `__new_pools` RENAME TO `pools`;--> statement-breakpoint
CREATE UNIQUE INDEX `pools_baseMintAddress_unique` ON `pools` (`baseMintAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `pools_poolAddress_unique` ON `pools` (`poolAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `pools_transactionSignature_unique` ON `pools` (`transactionSignature`);--> statement-breakpoint
CREATE TABLE `__new_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`poolId` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`uri` text NOT NULL,
	`type` text DEFAULT 'SPL' NOT NULL,
	`createdAt` integer DEFAULT 1751163327724 NOT NULL,
	FOREIGN KEY (`poolId`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tokens`("id", "poolId", "name", "symbol", "uri", "type", "createdAt") SELECT "id", "poolId", "name", "symbol", "uri", "type", "createdAt" FROM `tokens`;--> statement-breakpoint
DROP TABLE `tokens`;--> statement-breakpoint
ALTER TABLE `__new_tokens` RENAME TO `tokens`;--> statement-breakpoint
CREATE TABLE `__new_worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`description` text,
	`url` text,
	`created_at` integer DEFAULT 1751163327724
);
--> statement-breakpoint
INSERT INTO `__new_worlds`("id", "name", "description", "url", "created_at") SELECT "id", "name", "description", "url", "created_at" FROM `worlds`;--> statement-breakpoint
DROP TABLE `worlds`;--> statement-breakpoint
ALTER TABLE `__new_worlds` RENAME TO `worlds`;