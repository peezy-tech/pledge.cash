CREATE TABLE `avatars` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text
);
--> statement-breakpoint
CREATE TABLE `configs` (
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
	`createdAt` integer DEFAULT 1748290871073 NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `configs_transactionSignature_unique` ON `configs` (`transactionSignature`);--> statement-breakpoint
CREATE TABLE `pools` (
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
	`createdAt` integer DEFAULT 1748290871073 NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pools_baseMintAddress_unique` ON `pools` (`baseMintAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `pools_poolAddress_unique` ON `pools` (`poolAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `pools_transactionSignature_unique` ON `pools` (`transactionSignature`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`poolId` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`uri` text NOT NULL,
	`type` text DEFAULT 'SPL' NOT NULL,
	`createdAt` integer DEFAULT 1748290871073 NOT NULL,
	FOREIGN KEY (`poolId`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`role` text DEFAULT 'user',
	`solana_account` text,
	`evm_address` text,
	`selected_avatar_id` text,
	FOREIGN KEY (`selected_avatar_id`) REFERENCES `avatars`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_solana_account_unique` ON `users` (`solana_account`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_evm_address_unique` ON `users` (`evm_address`);--> statement-breakpoint
CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`description` text,
	`url` text,
	`created_at` integer DEFAULT 1748290871073
);
