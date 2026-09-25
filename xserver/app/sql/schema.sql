-- 接骨院 WEB予約システム（Xserver / MySQL・MariaDB 版）テーブル定義
-- 日付は "YYYY-MM-DD" の文字列、時刻は 0:00 からの分（9:00 = 540）で持つ

CREATE TABLE IF NOT EXISTS `global_setting` (
  `id` INT NOT NULL,
  `slotMinutes` INT NOT NULL DEFAULT 15,
  `newVisitSlots` INT NOT NULL DEFAULT 2,
  `returnVisitSlots` INT NOT NULL DEFAULT 1,
  `webCutoffMinutes` INT NOT NULL DEFAULT 30,
  `phoneCutoffMinutes` INT NOT NULL DEFAULT 15,
  `phoneMarkRemaining` INT NOT NULL DEFAULT 1,
  `closeOnHolidays` TINYINT(1) NOT NULL DEFAULT 1,
  `adminExtraSlots` INT NOT NULL DEFAULT 1,
  `retentionDays` INT NOT NULL DEFAULT 60,
  `hours` LONGTEXT NOT NULL,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `store` (
  `id` VARCHAR(32) NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `beds` INT NOT NULL DEFAULT 8,
  `defaultActiveBeds` INT NOT NULL DEFAULT 3,
  `maxTherapists` INT NOT NULL DEFAULT 6,
  `maxReception` INT NOT NULL DEFAULT 4,
  `publishDaysAhead` INT NOT NULL DEFAULT 30,
  `hoursOverride` LONGTEXT NULL,
  `notifyPhone` VARCHAR(20) NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `store_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_account` (
  `id` VARCHAR(32) NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(10) NOT NULL DEFAULT 'store',
  `storeId` VARCHAR(32) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admin_code` (`code`),
  KEY `admin_store` (`storeId`),
  CONSTRAINT `fk_admin_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `day_status` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `published` TINYINT(1) NULL,
  `closed` TINYINT(1) NOT NULL DEFAULT 0,
  `memo` TEXT NULL,
  `capacityAm` INT NULL,
  `capacityPm` INT NULL,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `day_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_day_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `staff_member` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `name` VARCHAR(30) NOT NULL,
  `role` VARCHAR(10) NOT NULL DEFAULT 'THERAPIST',
  `sortOrder` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `staff_store` (`storeId`),
  CONSTRAINT `fk_staff_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `shift` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `staffId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `status` VARCHAR(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `shift_staff_date` (`staffId`, `date`),
  KEY `shift_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_shift_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_shift_staff` FOREIGN KEY (`staffId`) REFERENCES `staff_member` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reservation` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `time` INT NOT NULL,
  `bed` INT NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `cardNo` VARCHAR(20) NULL,
  `name` VARCHAR(40) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'BOOKED',
  `smsStatus` VARCHAR(10) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `res_store_date` (`storeId`, `date`),
  KEY `res_created` (`createdAt`),
  CONSTRAINT `fk_res_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cell` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `time` INT NOT NULL,
  `bed` INT NOT NULL,
  `text` VARCHAR(100) NOT NULL,
  `visited` TINYINT(1) NOT NULL DEFAULT 0,
  `reservationId` VARCHAR(32) NULL,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cell_pos` (`storeId`, `date`, `time`, `bed`),
  KEY `cell_store_date` (`storeId`, `date`),
  KEY `cell_res` (`reservationId`),
  CONSTRAINT `fk_cell_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cell_res` FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cancel_log` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `time` INT NOT NULL,
  `bed` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `contText` VARCHAR(100) NULL,
  `kind` VARCHAR(10) NOT NULL,
  `source` VARCHAR(10) NOT NULL,
  `reservationId` VARCHAR(32) NULL,
  `byCode` VARCHAR(20) NOT NULL,
  `memo` VARCHAR(200) NULL,
  `nextDate` CHAR(10) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cancel_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_cancel_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rate_limit` (
  `k` VARCHAR(191) NOT NULL,
  `cnt` INT NOT NULL DEFAULT 0,
  `resetAt` INT NOT NULL,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
