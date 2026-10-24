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
  `storesPageOpen` TINYINT(1) NOT NULL DEFAULT 0, -- 店舗えらびページを公開する（それまでは「準備中」）
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
  `stdTherapists` INT NULL,   -- 人員基準（施術者の人数）。本部・管轄MG が決める
  `stdReception` INT NULL,    -- 人員基準（受付の人数）
  `publishDaysAhead` INT NOT NULL DEFAULT 30,
  `hoursOverride` LONGTEXT NULL,
  `notifyPhone` VARCHAR(20) NULL,
  `patientsImportedAt` DATETIME NULL,          -- 患者一覧（診察券番号）を取り込んだ日時
  `address` VARCHAR(200) NOT NULL DEFAULT '',   -- 店舗えらびページの住所
  `lat` DECIMAL(9,6) NULL,                      -- 地図の位置（近い順に使う）
  `lng` DECIMAL(9,6) NULL,
  `listed` TINYINT(1) NOT NULL DEFAULT 1,       -- 店舗えらびページに載せる
  `maxNewConcurrent` INT NULL DEFAULT NULL, -- 新規（初診・初自）を同じ時間に WEB で受ける上限。NULL＝制限なし、0＝WEB では受けない（電話のみ）
  `sortOrder` INT NOT NULL DEFAULT 0,  -- 本部の店舗一覧・切り替えでのエリアの中の並び順
  `hqOnly` TINYINT(1) NOT NULL DEFAULT 0,
  `jibaiOnly` TINYINT(1) NOT NULL DEFAULT 0,  -- 1＝自賠請求だけに使う店舗（本部の店舗一覧・集計・店舗えらびページ・WEB 予約には出さない）  -- 1＝本部専用（本部の人だけが見る。店舗のアカウントではログインできない）
  `maxRevisitConcurrent` INT NULL DEFAULT NULL, -- 再来（1ヶ月以上ご来院の無い方）を同じ時間に WEB で受ける上限。NULL＝制限なし
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
  `area` VARCHAR(40) NULL,                     -- 管轄MG（role = mg）の管轄エリアの名前
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
  `canFirst` TINYINT(1) NOT NULL DEFAULT 0,   -- 初回（初診・新自）を担当する
  `canRevisit` TINYINT(1) NOT NULL DEFAULT 0, -- 再来を担当する
  `color` VARCHAR(10) NOT NULL DEFAULT '',    -- 予約表の色（空＝自動）
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
  `viewToken` VARCHAR(40) NULL,
  `viaCard` TINYINT(1) NOT NULL DEFAULT 0,  -- 紹介カード（店舗えらびページ）から来た予約
  `refCode` VARCHAR(16) NULL,  -- 紹介元（業者）の専用 QR から来た予約（referral.code）
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `res_view_token` (`viewToken`),
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
  `phone` VARCHAR(20) NULL,  -- 電話で取った予約の電話番号（+81…。氏名の下に出す。セルの文字には入れない）
  `visited` TINYINT(1) NOT NULL DEFAULT 0,
  `reservationId` VARCHAR(32) NULL,
  `menus` VARCHAR(300) NOT NULL DEFAULT '',
  `staff` VARCHAR(30) NOT NULL DEFAULT '',
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
  `nextTime` INT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cancel_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_cancel_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cell_log` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `time` INT NOT NULL,
  `bed` INT NOT NULL,
  `before` VARCHAR(100) NOT NULL,
  `after` VARCHAR(100) NOT NULL DEFAULT '',
  `byCode` VARCHAR(20) NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cell_log_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_cell_log_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `patient_card` (
  `storeId` VARCHAR(32) NOT NULL,
  `cardNo` VARCHAR(12) NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `kana` VARCHAR(60) NOT NULL DEFAULT '',
  PRIMARY KEY (`storeId`, `cardNo`),
  CONSTRAINT `fk_patient_card_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 紹介元（業者）。専用の QR（/stores?ref=code）から来た初診は、初回カルテのきっかけが「業者紹介」、内訳がこの名前になる
CREATE TABLE IF NOT EXISTS `referral` (
  `id` VARCHAR(32) NOT NULL,
  `code` VARCHAR(16) NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `kind` VARCHAR(10) NOT NULL DEFAULT 'partner',
  `trig` VARCHAR(30) NOT NULL DEFAULT '',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `referral_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- プライバシーポリシーなど、本部が文章を書く共通のページ（k = 'privacy'）
CREATE TABLE IF NOT EXISTS `site_page` (
  `k` VARCHAR(30) NOT NULL,
  `body` MEDIUMTEXT NOT NULL,
  `published` TINYINT(1) NOT NULL DEFAULT 0,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedBy` VARCHAR(60) NOT NULL DEFAULT '',
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 特別な営業日（プレオープン・イベントなど）。その日だけこの時間で営業する（sessions は [["10:00","12:30"],...]。受付の最後の時刻まで）
CREATE TABLE IF NOT EXISTS `special_day` (
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `sessions` VARCHAR(200) NOT NULL,
  `memo` VARCHAR(40) NOT NULL DEFAULT '',
  PRIMARY KEY (`storeId`, `date`),
  CONSTRAINT `fk_special_day_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
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
  `nameOk` TINYINT(1) NOT NULL DEFAULT 0,
  `age` INT NULL,
  `sex` VARCHAR(2) NOT NULL DEFAULT '',
  `symptomCat` VARCHAR(20) NOT NULL DEFAULT '',
  `symptom` VARCHAR(100) NOT NULL DEFAULT '',
  `staff` VARCHAR(30) NOT NULL DEFAULT '',
  `treatment` VARCHAR(10) NOT NULL DEFAULT '',
  `visits` TEXT NOT NULL,
  `stopped` TINYINT(1) NOT NULL DEFAULT 0,
  `transferred` TINYINT(1) NOT NULL DEFAULT 0,
  `survey` TINYINT(1) NOT NULL DEFAULT 0,
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

-- 窓口集計（日ごとの入力・月の欄と経理確認・返戻・物販の商品）
CREATE TABLE IF NOT EXISTS `madoguchi_day` (
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `vals` TEXT NOT NULL,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`storeId`, `date`),
  CONSTRAINT `fk_madoguchi_day_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `madoguchi_month` (
  `storeId` VARCHAR(32) NOT NULL,
  `ym` CHAR(7) NOT NULL,
  `target` INT NULL,
  `extra` TEXT NULL,
  `memo` TEXT NULL,
  `goods` TEXT NULL,
  `stockStart` TEXT NULL,
  `editedAt` DATETIME NULL,
  `checkedAt` DATETIME NULL,
  `checkedBy` VARCHAR(60) NOT NULL DEFAULT '',
  PRIMARY KEY (`storeId`, `ym`),
  CONSTRAINT `fk_madoguchi_month_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `madoguchi_henrei` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `ym` CHAR(7) NOT NULL,
  `special` TINYINT(1) NOT NULL DEFAULT 0,
  `treatYm` VARCHAR(20) NOT NULL DEFAULT '',
  `claimMonth` VARCHAR(20) NOT NULL DEFAULT '',
  `patient` VARCHAR(40) NOT NULL DEFAULT '',
  `relation` VARCHAR(10) NOT NULL DEFAULT '',
  `insurer` VARCHAR(60) NOT NULL DEFAULT '',
  `insurerCode` VARCHAR(20) NOT NULL DEFAULT '',
  `amount` INT NULL,
  `reamount` INT NULL,
  `place` VARCHAR(60) NOT NULL DEFAULT '',
  `action` VARCHAR(20) NOT NULL DEFAULT '',
  `reason` VARCHAR(100) NOT NULL DEFAULT '',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `madoguchi_henrei_store_ym` (`storeId`, `ym`),
  CONSTRAINT `fk_madoguchi_henrei_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `goods_item` (
  `id` VARCHAR(32) NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `price` INT NOT NULL DEFAULT 0,
  `cost` INT NOT NULL DEFAULT 0,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
