CREATE TABLE `agent_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`pledgeWalletId` text NOT NULL,
	`userId` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1752849040934 NOT NULL,
	FOREIGN KEY (`pledgeWalletId`) REFERENCES `pledge_wallet_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
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
	`createdAt` integer DEFAULT 1752849040934 NOT NULL,
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
	`createdAt` integer DEFAULT 1752849040934 NOT NULL,
	FOREIGN KEY (`invoiceId`) REFERENCES `hyperliquid_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pledge_wallet_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`userAddress` text NOT NULL,
	`operatorAddress` text NOT NULL,
	`operatorPrivateKey` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1752849040934 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_wallet_accounts_userAddress_unique` ON `pledge_wallet_accounts` (`userAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_wallet_accounts_operatorAddress_unique` ON `pledge_wallet_accounts` (`operatorAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_wallet_accounts_operatorPrivateKey_unique` ON `pledge_wallet_accounts` (`operatorPrivateKey`);--> statement-breakpoint
CREATE TABLE `tx_hashes` (
	`hash` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT 1752849040934 NOT NULL,
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