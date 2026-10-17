-- AlterTable
ALTER TABLE `registration` ADD COLUMN `promotedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `phone` VARCHAR(15) NULL;
