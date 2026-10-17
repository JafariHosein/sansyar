-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `eitaaId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_eitaaId_key`(`eitaaId`),
    INDEX `User_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Venue` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `mapUrl` VARCHAR(500) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Venue_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `venueId` VARCHAR(191) NOT NULL,
    `addressOverride` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `registrationOpensAt` DATETIME(3) NOT NULL,
    `registrationClosesAt` DATETIME(3) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `priceToman` INTEGER NOT NULL,
    `paymentMode` ENUM('AT_REGISTRATION', 'IN_PERSON') NOT NULL DEFAULT 'IN_PERSON',
    `status` ENUM('DRAFT', 'PUBLISHED', 'CANCELED') NOT NULL DEFAULT 'DRAFT',
    `freeCancelHours` INTEGER NULL,
    `lateCancelEnabled` BOOLEAN NULL,
    `lateCancelPenaltyDays` INTEGER NULL,
    `lateCancelFirstWarning` BOOLEAN NULL,
    `lateCancelWarningWindowDays` INTEGER NULL,
    `noShowEnabled` BOOLEAN NULL,
    `noShowPenaltyDays` INTEGER NULL,
    `lateStrikesEnabled` BOOLEAN NULL,
    `lateThresholdMinutes` INTEGER NULL,
    `lateStrikeCount` INTEGER NULL,
    `lateStrikeWindowDays` INTEGER NULL,
    `lateStrikePenaltyDays` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Session_startsAt_registrationOpensAt_idx`(`startsAt`, `registrationOpensAt`),
    INDEX `Session_status_startsAt_idx`(`status`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Registration` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` ENUM('CONFIRMED', 'WAITLIST', 'CANCELED') NOT NULL DEFAULT 'CONFIRMED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `canceledAt` DATETIME(3) NULL,
    `cancelType` ENUM('FREE', 'LATE', 'ADMIN', 'WINDOW_CLOSED') NULL,
    `paymentStatus` ENUM('UNPAID', 'PAID_ONLINE', 'PAID_IN_PERSON', 'WAIVED') NOT NULL DEFAULT 'UNPAID',
    `paidAt` DATETIME(3) NULL,
    `attendance` ENUM('PENDING', 'PRESENT', 'LATE', 'ABSENT') NOT NULL DEFAULT 'PENDING',
    `lateMinutes` INTEGER NULL,
    `markedAt` DATETIME(3) NULL,

    INDEX `Registration_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Registration_sessionId_status_createdAt_idx`(`sessionId`, `status`, `createdAt`),
    UNIQUE INDEX `Registration_sessionId_userId_key`(`sessionId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Penalty` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('LATE_CANCEL', 'NO_SHOW', 'LATE_STRIKES', 'MANUAL') NOT NULL,
    `days` INTEGER NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `issuedByAdminId` VARCHAR(191) NULL,
    `waivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Penalty_userId_endsAt_idx`(`userId`, `endsAt`),
    INDEX `Penalty_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `freeCancelHours` INTEGER NOT NULL DEFAULT 12,
    `lateCancelEnabled` BOOLEAN NOT NULL DEFAULT true,
    `lateCancelPenaltyDays` INTEGER NOT NULL DEFAULT 3,
    `lateCancelFirstWarning` BOOLEAN NOT NULL DEFAULT true,
    `lateCancelWarningWindowDays` INTEGER NOT NULL DEFAULT 14,
    `noShowEnabled` BOOLEAN NOT NULL DEFAULT true,
    `noShowPenaltyDays` INTEGER NOT NULL DEFAULT 7,
    `lateStrikesEnabled` BOOLEAN NOT NULL DEFAULT true,
    `lateThresholdMinutes` INTEGER NOT NULL DEFAULT 15,
    `lateStrikeCount` INTEGER NOT NULL DEFAULT 3,
    `lateStrikeWindowDays` INTEGER NOT NULL DEFAULT 30,
    `lateStrikePenaltyDays` INTEGER NOT NULL DEFAULT 7,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_venueId_fkey` FOREIGN KEY (`venueId`) REFERENCES `Venue`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Registration` ADD CONSTRAINT `Registration_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Registration` ADD CONSTRAINT `Registration_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Penalty` ADD CONSTRAINT `Penalty_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Penalty` ADD CONSTRAINT `Penalty_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Penalty` ADD CONSTRAINT `Penalty_issuedByAdminId_fkey` FOREIGN KEY (`issuedByAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
