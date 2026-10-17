-- Membership approval replaces per-seat approval (the owner's newest round).

-- 1) Regularize the rows that were on the removed seat-approval flow.
--    A seat that was waiting for the manager becomes the seat it was already
--    holding (the person keeps their place, nobody is silently dropped) …
UPDATE `registration` SET `status` = 'CONFIRMED' WHERE `status` = 'PENDING';

--    … and a seat the manager had rejected becomes an admin cancellation:
--    the freed place was promoted inside the same transaction at the time, so
--    this only regularizes the vocabulary.
UPDATE `registration`
    SET `status` = 'CANCELED',
        `cancelType` = 'ADMIN',
        `canceledAt` = COALESCE(`canceledAt`, NOW(3))
    WHERE `status` = 'REJECTED';

-- 2) The two dead values leave the enum, and the column loses its default:
--    every write must now name a status.
ALTER TABLE `registration` MODIFY `status` ENUM('CONFIRMED', 'WAITLIST', 'CANCELED') NOT NULL;

-- 3) The seat-level decision is gone — membership decides, once, on the account.
ALTER TABLE `registration` DROP COLUMN `decidedAt`;

-- 4) The membership gate. Every account that exists today has already passed the
--    only gate there was (an admin, a seeded member), so it starts APPROVED.
ALTER TABLE `user` ADD COLUMN `membershipStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `membershipDecidedAt` DATETIME(3) NULL;

UPDATE `user` SET `membershipStatus` = 'APPROVED', `membershipDecidedAt` = NOW(3);
