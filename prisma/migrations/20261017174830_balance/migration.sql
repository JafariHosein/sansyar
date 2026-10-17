/*
  Warnings:

  - Added the required column `amountToman` to the `Registration` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `registration` ADD COLUMN `amountToman` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `paidFromBalance` INTEGER NOT NULL DEFAULT 0,
    MODIFY `paymentStatus` ENUM('UNPAID', 'PAID_ONLINE', 'PAID_IN_PERSON', 'WAIVED', 'PAID_BALANCE') NOT NULL DEFAULT 'UNPAID';

-- Backfill: a seat costs what its session cost — the only price this migration
-- can honestly know. From here on the engine writes the snapshot itself
-- (`registerSeat`), so the column never needs a default again.
UPDATE `registration` r
    JOIN `Session` s ON r.sessionId = s.id
    SET r.amountToman = s.priceToman;

-- The default existed only for the additive step: a seat without an explicit
-- amount must be a compile error, not a free one.
ALTER TABLE `registration` ALTER COLUMN `amountToman` DROP DEFAULT;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `balance` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `BalanceEntry` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `balanceAfter` INTEGER NOT NULL,
    `type` ENUM('REGISTRATION_DEDUCT', 'CANCEL_REFUND', 'ADMIN_ADJUST') NOT NULL,
    `note` VARCHAR(255) NULL,
    `registrationId` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NULL,
    `byAdminId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BalanceEntry_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BalanceEntry` ADD CONSTRAINT `BalanceEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BalanceEntry` ADD CONSTRAINT `BalanceEntry_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `Registration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BalanceEntry` ADD CONSTRAINT `BalanceEntry_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BalanceEntry` ADD CONSTRAINT `BalanceEntry_byAdminId_fkey` FOREIGN KEY (`byAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
