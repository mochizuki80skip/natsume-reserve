-- 自賠責請求の速報集計（店舗が月末にレセコン画面のスクショから金額を登録し、本部が全店合計を見る）
-- 初期設定（/install）で作成されるほか、API 側でも無ければ自動作成する（Jibai::ensureTables）

CREATE TABLE IF NOT EXISTS `jibai_setting` (
  `id` INT NOT NULL,
  `nameRetentionDays` INT NOT NULL DEFAULT 180,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `jibai_month` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `ym` CHAR(7) NOT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
  `submittedAt` DATETIME NULL,
  `submittedBy` VARCHAR(20) NULL,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `jm_store_ym` (`storeId`, `ym`),
  CONSTRAINT `fk_jm_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `jibai_claim` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `ym` CHAR(7) NOT NULL,
  `seq` INT NOT NULL DEFAULT 0,
  `patientNo` VARCHAR(20) NOT NULL DEFAULT '',
  `patientName` VARCHAR(40) NULL,
  `days` INT NULL,
  `amount` INT NOT NULL DEFAULT 0,
  `source` VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
  `verifiedAmount` INT NULL,
  `verifiedAt` DATETIME NULL,
  `verifiedBy` VARCHAR(20) NULL,
  `note` VARCHAR(200) NULL,
  `createdBy` VARCHAR(20) NOT NULL DEFAULT '',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `jc_store_ym` (`storeId`, `ym`),
  KEY `jc_ym` (`ym`),
  CONSTRAINT `fk_jc_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `jibai_log` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `ym` CHAR(7) NOT NULL,
  `claimId` VARCHAR(32) NULL,
  `action` VARCHAR(20) NOT NULL,
  `detail` VARCHAR(300) NULL,
  `byCode` VARCHAR(20) NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `jl_store_ym` (`storeId`, `ym`),
  CONSTRAINT `fk_jl_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
