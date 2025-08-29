CREATE TABLE `agent_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`pledgeWalletId` text NOT NULL,
	`userId` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	FOREIGN KEY (`pledgeWalletId`) REFERENCES `pledge_wallet_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `donations` (
	`id` text PRIMARY KEY NOT NULL,
	`creatorId` text NOT NULL,
	`payerUserId` text,
	`fromAddress` text,
	`token` text NOT NULL,
	`amount` text NOT NULL,
	`txHash` text,
	`linkedInvoiceId` text,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txHash`) REFERENCES `tx_hashes`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linkedInvoiceId`) REFERENCES `hyperliquid_invoices`(`id`) ON UPDATE no action ON DELETE no action
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
	`createdAt` integer DEFAULT 1756483652144 NOT NULL,
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
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	FOREIGN KEY (`invoiceId`) REFERENCES `hyperliquid_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`sourceId` text NOT NULL,
	`creatorId` text NOT NULL,
	`payerUserId` text,
	`payerAddress` text,
	`token` text NOT NULL,
	`amount` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`txHash` text,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	`paidAt` integer,
	`metadata` text,
	FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txHash`) REFERENCES `tx_hashes`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pledge_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`creatorId` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`goalToken` text NOT NULL,
	`goalAmount` text NOT NULL,
	`raisedAmount` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pledge_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`pledgeId` text,
	`campaignId` text NOT NULL,
	`payerUserId` text,
	`fromAddress` text,
	`token` text NOT NULL,
	`amount` text NOT NULL,
	`txHash` text,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	FOREIGN KEY (`pledgeId`) REFERENCES `pledges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaignId`) REFERENCES `pledge_campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txHash`) REFERENCES `tx_hashes`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pledge_wallet_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`userAddress` text NOT NULL,
	`operatorAddress` text NOT NULL,
	`operatorPrivateKey` text NOT NULL,
	`address` text NOT NULL,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_wallet_accounts_userAddress_unique` ON `pledge_wallet_accounts` (`userAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_wallet_accounts_operatorAddress_unique` ON `pledge_wallet_accounts` (`operatorAddress`);--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_wallet_accounts_operatorPrivateKey_unique` ON `pledge_wallet_accounts` (`operatorPrivateKey`);--> statement-breakpoint
CREATE TABLE `pledges` (
	`id` text PRIMARY KEY NOT NULL,
	`campaignId` text NOT NULL,
	`pledgerUserId` text,
	`pledgerAddress` text,
	`token` text NOT NULL,
	`amountPerCadence` text NOT NULL,
	`cadence` text NOT NULL,
	`autopayEnabled` integer DEFAULT true NOT NULL,
	`nextRunAt` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	FOREIGN KEY (`campaignId`) REFERENCES `pledge_campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pledgerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`planId` text NOT NULL,
	`token` text NOT NULL,
	`amount` text NOT NULL,
	`dueAt` integer NOT NULL,
	`runAt` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`txHash` text,
	`error` text,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	FOREIGN KEY (`planId`) REFERENCES `recurring_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txHash`) REFERENCES `tx_hashes`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`creatorId` text NOT NULL,
	`payerUserId` text,
	`payerAddress` text,
	`token` text NOT NULL,
	`amount` text NOT NULL,
	`cadence` text NOT NULL,
	`startAt` integer DEFAULT 1756483652145 NOT NULL,
	`endAt` integer,
	`autopayEnabled` integer DEFAULT true NOT NULL,
	`nextRunAt` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`createdAt` integer DEFAULT 1756483652145 NOT NULL,
	FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tx_hashes` (
	`hash` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT 1756483652144 NOT NULL,
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