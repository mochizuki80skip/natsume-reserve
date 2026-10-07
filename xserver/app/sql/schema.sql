-- 接骨院 WEB予約システム（Xserver / MySQL・MariaDB 版）テーブル定義
-- 日付は "YYYY-MM-DD" の文字列、時刻は 0:00 からの分（9:00 = 540）で持つ

CREATE TABLE IF NOT EXISTS `global_setting` (
  `id` INT NOT NULL,
  `slotMinutes` INT NOT NULL DEFAULT 15,
  `newVisitSlots` INT NOT NULL DEFAULT 2,
  `returnVisitSlots` INT NOT NULL DEFAULT 1,
  `webCutoffMinutes` INT NOT NULL DEFAULT 30,
  `phoneCutoffMinutes` INT NOT NULL DEFAULT 0,
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
  `maxNewConcurrent` INT NOT NULL DEFAULT 0, -- 新規（初診・初自）を同じ時間に受ける上限。0＝制限なし
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
  `name` VARCHAR(30) NOT NULL DEFAULT '',      -- 本部アカウントの使用者名
  `active` TINYINT(1) NOT NULL DEFAULT 1,      -- 0＝停止（ログインできない）
  `canManage` TINYINT(1) NOT NULL DEFAULT 0,   -- 1＝本部アカウントの発行・停止ができる
  `lastLoginAt` DATETIME NULL,
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
  `startDate` CHAR(10) NULL,  -- 所属開始日（新入社員の入社日・異動してきた日）。空なら制限なし
  `endDate` CHAR(10) NULL,    -- 所属終了日（異動で出ていく前日など）。空なら制限なし
  `joinType` VARCHAR(10) NULL, -- NEW=新入社員 / TRANSFER=異動（開始日から 1 か月シフト表に印を出す）
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

-- 予約表のブロック（打合せ・ミーティングなど）。startTime〜endTime（終了は含まない）の間、beds（"1,2" 形式。空＝全ベッド）を使えなくする。count は旧版の名残（未使用）
CREATE TABLE IF NOT EXISTS `slot_block` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `startTime` INT NOT NULL,
  `endTime` INT NOT NULL,
  `count` INT NOT NULL DEFAULT 0,
  `beds` VARCHAR(100) NOT NULL DEFAULT '',
  `label` VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `slot_block_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_slot_block_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 他店からの応援（1 店舗 1 日 1 行。誰が来るか未定なら名前は空）
CREATE TABLE IF NOT EXISTS `help_in` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `status` VARCHAR(12) NOT NULL,  -- HELP_IN=終日 / AM_HELP_IN=午前 / PM_HELP_IN=午後
  `name` VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `help_in_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_help_in_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
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

-- 初回カルテ集計（予約の自動削除の対象外。消さずに残す）
CREATE TABLE IF NOT EXISTS `karte` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `srcTime` INT NULL,
  `srcBed` INT NULL,
  `auto` TINYINT(1) NOT NULL DEFAULT 0,
  `edited` TINYINT(1) NOT NULL DEFAULT 0,
  `karteNo` VARCHAR(20) NOT NULL DEFAULT '',
  `kind` VARCHAR(10) NOT NULL DEFAULT 'NEW',
  `trig` VARCHAR(30) NOT NULL DEFAULT '',
  `trigDetail` VARCHAR(60) NOT NULL DEFAULT '',
  `name` VARCHAR(40) NOT NULL DEFAULT '',
  `age` INT NULL,
  `sex` VARCHAR(2) NOT NULL DEFAULT '',
  `symptomCat` VARCHAR(20) NOT NULL DEFAULT '',
  `symptom` VARCHAR(100) NOT NULL DEFAULT '',
  `staff` VARCHAR(30) NOT NULL DEFAULT '',
  `treatment` VARCHAR(10) NOT NULL DEFAULT '',
  `visits` TEXT NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `karte_src` (`storeId`, `date`, `srcTime`, `srcBed`),
  KEY `karte_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_karte_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- カルテ集計の選択肢（きっかけ・他事業紹介・キャンペーン・症状カテゴリー・再来アクション）
CREATE TABLE IF NOT EXISTS `karte_option` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `category` VARCHAR(20) NOT NULL,
  `label` VARCHAR(60) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `karte_option_cat` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 本部の集計のエリア（storeCodes は店舗コードをカンマ区切り）
CREATE TABLE IF NOT EXISTS `area` (
  `id` VARCHAR(32) NOT NULL,
  `name` VARCHAR(30) NOT NULL,
  `storeCodes` TEXT NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 操作の記録（誰が・いつ・何をしたか。患者の氏名などは残さない）
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `accountId` VARCHAR(32) NOT NULL DEFAULT '',
  `actor` VARCHAR(60) NOT NULL DEFAULT '',
  `storeCode` VARCHAR(20) NOT NULL DEFAULT '',
  `action` VARCHAR(60) NOT NULL DEFAULT '',
  `detail` VARCHAR(120) NOT NULL DEFAULT '',
  `status` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `audit_at` (`at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
