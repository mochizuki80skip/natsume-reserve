<?php
// 後から追加した列・表を、既存のデータベースに自動で足す（/install をやり直さなくても更新ファイルを置くだけで反映される）
declare(strict_types=1);

final class Migrate
{
    /** この数字を上げたら run() に処理を足す */
    private const VERSION = 14;
    private static bool $done = false;

    public static function run(PDO $pdo): void
    {
        if (self::$done) return;
        self::$done = true;
        try {
            $pdo->exec('CREATE TABLE IF NOT EXISTS `app_meta` (`k` VARCHAR(50) NOT NULL, `v` INT NOT NULL, PRIMARY KEY (`k`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
            $row = $pdo->query("SELECT v FROM app_meta WHERE k = 'schema'")->fetch();
            $ver = $row ? (int)$row['v'] : 0;
            if ($ver >= self::VERSION) return;
            // 初期設定前（表がまだ無い）なら何もしない。/install が schema.sql で最新の形を作る
            if (!self::hasTable($pdo, 'staff_member')) return;

            if ($ver < 1) {
                // スタッフの所属期間（新入社員・異動）と、他店からの応援
                if (!self::hasColumn($pdo, 'staff_member', 'startDate')) $pdo->exec('ALTER TABLE `staff_member` ADD COLUMN `startDate` CHAR(10) NULL');
                if (!self::hasColumn($pdo, 'staff_member', 'endDate')) $pdo->exec('ALTER TABLE `staff_member` ADD COLUMN `endDate` CHAR(10) NULL');
                if (!self::hasColumn($pdo, 'staff_member', 'joinType')) $pdo->exec('ALTER TABLE `staff_member` ADD COLUMN `joinType` VARCHAR(10) NULL');
                $pdo->exec(self::HELP_IN_DDL);
            }
            if ($ver < 2) {
                // 新規の同時対応数（店舗ごと）と、予約表のブロック
                if (!self::hasColumn($pdo, 'store', 'maxNewConcurrent')) $pdo->exec('ALTER TABLE `store` ADD COLUMN `maxNewConcurrent` INT NOT NULL DEFAULT 0');
                $pdo->exec(self::SLOT_BLOCK_DDL);
            }
            if ($ver < 3) {
                // ブロックをベッド単位に
                if (!self::hasColumn($pdo, 'slot_block', 'beds')) $pdo->exec("ALTER TABLE `slot_block` ADD COLUMN `beds` VARCHAR(100) NOT NULL DEFAULT ''");
            }
            if ($ver < 4) {
                // 初回カルテ集計・選択肢・エリア
                $pdo->exec(self::KARTE_DDL);
                $pdo->exec(self::KARTE_OPTION_DDL);
                $pdo->exec(self::AREA_DDL);
            }
            if ($ver < 5) {
                // 本部アカウントを一人ずつ（使用者名・停止・発行権限・最終ログイン）と操作の記録
                if (!self::hasColumn($pdo, 'admin_account', 'name')) $pdo->exec("ALTER TABLE `admin_account` ADD COLUMN `name` VARCHAR(30) NOT NULL DEFAULT ''");
                if (!self::hasColumn($pdo, 'admin_account', 'active')) $pdo->exec('ALTER TABLE `admin_account` ADD COLUMN `active` TINYINT(1) NOT NULL DEFAULT 1');
                if (!self::hasColumn($pdo, 'admin_account', 'canManage')) $pdo->exec('ALTER TABLE `admin_account` ADD COLUMN `canManage` TINYINT(1) NOT NULL DEFAULT 0');
                if (!self::hasColumn($pdo, 'admin_account', 'lastLoginAt')) $pdo->exec('ALTER TABLE `admin_account` ADD COLUMN `lastLoginAt` DATETIME NULL');
                $pdo->exec("UPDATE `admin_account` SET `canManage` = 1, `active` = 1, `name` = IF(`name` = '', '管理者', `name`) WHERE `code` = 'HQ'");
                $pdo->exec(self::AUDIT_DDL);
            }
            if ($ver < 6) {
                // 予約表のメニュー（矯正・2回目 など。JSON の配列）
                if (!self::hasColumn($pdo, 'cell', 'menus')) $pdo->exec("ALTER TABLE `cell` ADD COLUMN `menus` VARCHAR(300) NOT NULL DEFAULT ''");
            }
            if ($ver < 7) {
                // 新規の同時対応数：空欄（NULL）＝制限なし、0＝WEB では受けない。これまでの 0（制限なし）は空欄に置き換える
                $pdo->exec('ALTER TABLE `store` MODIFY COLUMN `maxNewConcurrent` INT NULL DEFAULT NULL');
                $pdo->exec('UPDATE `store` SET `maxNewConcurrent` = NULL WHERE `maxNewConcurrent` = 0');
            }
            if ($ver < 8) {
                // 患者様の「ご予約の確認ページ」用の合言葉（推測できない長い文字列）
                if (!self::hasColumn($pdo, 'reservation', 'viewToken')) $pdo->exec('ALTER TABLE `reservation` ADD COLUMN `viewToken` VARCHAR(40) NULL, ADD UNIQUE KEY `res_view_token` (`viewToken`)');
            }
            if ($ver < 9) {
                // 予約変更の記録（変更先の時刻）と、消した・書き換えた入力の記録（元に戻す用）
                if (!self::hasColumn($pdo, 'cancel_log', 'nextTime')) $pdo->exec('ALTER TABLE `cancel_log` ADD COLUMN `nextTime` INT NULL');
                $pdo->exec(self::CELL_LOG_DDL);
            }
            if ($ver < 10) {
                // 予約ごとの担当者（施術者の名前）
                if (!self::hasColumn($pdo, 'cell', 'staff')) $pdo->exec("ALTER TABLE `cell` ADD COLUMN `staff` VARCHAR(30) NOT NULL DEFAULT ''");
            }
            if ($ver < 11) {
                // 施術者ごとの「初回を担当する」「再来を担当する」と予約表の色。メニューに「12回目」を足す
                if (!self::hasColumn($pdo, 'staff_member', 'canFirst')) $pdo->exec('ALTER TABLE `staff_member` ADD COLUMN `canFirst` TINYINT(1) NOT NULL DEFAULT 0');
                if (!self::hasColumn($pdo, 'staff_member', 'canRevisit')) $pdo->exec('ALTER TABLE `staff_member` ADD COLUMN `canRevisit` TINYINT(1) NOT NULL DEFAULT 0');
                if (!self::hasColumn($pdo, 'staff_member', 'color')) $pdo->exec("ALTER TABLE `staff_member` ADD COLUMN `color` VARCHAR(10) NOT NULL DEFAULT ''");
                if (self::hasTable($pdo, 'karte_option')) {
                    $has = $pdo->query("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'menu'")->fetch();
                    $dup = $pdo->query("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'menu' AND label = '12回目'")->fetch();
                    if ((int)$has['n'] > 0 && (int)$dup['n'] === 0) {
                        $six = $pdo->query("SELECT sortOrder FROM karte_option WHERE category = 'menu' AND label = '6回目'")->fetch();
                        $at = $six ? (int)$six['sortOrder'] + 1 : (int)$pdo->query("SELECT COALESCE(MAX(sortOrder), 0) + 1 AS n FROM karte_option WHERE category = 'menu'")->fetch()['n'];
                        $pdo->exec("UPDATE karte_option SET sortOrder = sortOrder + 1 WHERE category = 'menu' AND sortOrder >= $at");
                        $pdo->exec("INSERT INTO karte_option (category, label, sortOrder) VALUES ('menu', '12回目', $at)");
                    }
                }
            }
            if ($ver < 12) {
                // 診察券番号 → 氏名（レセコンの患者一覧を店舗ごとに取り込む）。取り込んだ日時は store に
                $pdo->exec(self::PATIENT_CARD_DDL);
                if (!self::hasColumn($pdo, 'store', 'patientsImportedAt')) $pdo->exec('ALTER TABLE `store` ADD COLUMN `patientsImportedAt` DATETIME NULL');
                // 店舗えらびページ：住所・地図の位置・載せるか、ページ全体の公開、紹介カード経由の予約
                if (!self::hasColumn($pdo, 'store', 'address')) $pdo->exec("ALTER TABLE `store` ADD COLUMN `address` VARCHAR(200) NOT NULL DEFAULT ''");
                if (!self::hasColumn($pdo, 'store', 'lat')) $pdo->exec('ALTER TABLE `store` ADD COLUMN `lat` DECIMAL(9,6) NULL');
                if (!self::hasColumn($pdo, 'store', 'lng')) $pdo->exec('ALTER TABLE `store` ADD COLUMN `lng` DECIMAL(9,6) NULL');
                if (!self::hasColumn($pdo, 'store', 'listed')) $pdo->exec('ALTER TABLE `store` ADD COLUMN `listed` TINYINT(1) NOT NULL DEFAULT 1');
                if (!self::hasColumn($pdo, 'global_setting', 'storesPageOpen')) $pdo->exec('ALTER TABLE `global_setting` ADD COLUMN `storesPageOpen` TINYINT(1) NOT NULL DEFAULT 0');
                if (!self::hasColumn($pdo, 'reservation', 'viaCard')) $pdo->exec('ALTER TABLE `reservation` ADD COLUMN `viaCard` TINYINT(1) NOT NULL DEFAULT 0');
            }
            if ($ver < 13) {
                // メニューに「自費・ワクスキ・プロテイン・ODAIJINI」を足す（後ろに。すでにあるものは足さない）
                if (self::hasTable($pdo, 'karte_option')) {
                    $has = $pdo->query("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'menu'")->fetch();
                    if ((int)$has['n'] > 0) {
                        foreach (['自費', 'ワクスキ', 'プロテイン', 'ODAIJINI'] as $label) {
                            $dup = $pdo->prepare("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'menu' AND label = ?");
                            $dup->execute([$label]);
                            if ((int)$dup->fetch()['n'] > 0) continue;
                            $at = (int)$pdo->query("SELECT COALESCE(MAX(sortOrder), 0) + 1 AS n FROM karte_option WHERE category = 'menu'")->fetch()['n'];
                            $ins = $pdo->prepare("INSERT INTO karte_option (category, label, sortOrder) VALUES ('menu', ?, ?)");
                            $ins->execute([$label, $at]);
                        }
                    }
                }
            }
            if ($ver < 14) {
                // メニューを「メニュー」と「物販」に分ける：パイオ・テープ・プロテイン・ODAIJINI は物販へ（＋サポーター）。追加メニューは消す
                if (self::hasTable($pdo, 'karte_option')) {
                    $pdo->exec("DELETE FROM karte_option WHERE category = 'menu' AND label IN ('追加メニュー', 'パイオ', 'テープ', 'プロテイン', 'ODAIJINI')");
                    $has = $pdo->query("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'goods'")->fetch();
                    if ((int)$has['n'] === 0) {
                        $ins = $pdo->prepare("INSERT INTO karte_option (category, label, sortOrder) VALUES ('goods', ?, ?)");
                        foreach (['パイオ', 'テープ', 'プロテイン', 'ODAIJINI', 'サポーター'] as $i => $label) $ins->execute([$label, $i]);
                    }
                }
            }
            $st = $pdo->prepare("REPLACE INTO app_meta (k, v) VALUES ('schema', ?)");
            $st->execute([self::VERSION]);
        } catch (Throwable $e) {
            error_log('[migrate] ' . $e->getMessage());
        }
    }

    public const PATIENT_CARD_DDL = 'CREATE TABLE IF NOT EXISTS `patient_card` (
  `storeId` VARCHAR(32) NOT NULL,
  `cardNo` VARCHAR(12) NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `kana` VARCHAR(60) NOT NULL DEFAULT \'\',
  PRIMARY KEY (`storeId`, `cardNo`),
  CONSTRAINT `fk_patient_card_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const CELL_LOG_DDL = 'CREATE TABLE IF NOT EXISTS `cell_log` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `time` INT NOT NULL,
  `bed` INT NOT NULL,
  `before` VARCHAR(100) NOT NULL,
  `after` VARCHAR(100) NOT NULL DEFAULT \'\',
  `byCode` VARCHAR(20) NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cell_log_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_cell_log_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const AUDIT_DDL = 'CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `accountId` VARCHAR(32) NOT NULL DEFAULT \'\',
  `actor` VARCHAR(60) NOT NULL DEFAULT \'\',
  `storeCode` VARCHAR(20) NOT NULL DEFAULT \'\',
  `action` VARCHAR(60) NOT NULL DEFAULT \'\',
  `detail` VARCHAR(120) NOT NULL DEFAULT \'\',
  `status` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `audit_at` (`at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const KARTE_DDL = 'CREATE TABLE IF NOT EXISTS `karte` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `srcTime` INT NULL,
  `srcBed` INT NULL,
  `auto` TINYINT(1) NOT NULL DEFAULT 0,
  `edited` TINYINT(1) NOT NULL DEFAULT 0,
  `karteNo` VARCHAR(20) NOT NULL DEFAULT \'\',
  `kind` VARCHAR(10) NOT NULL DEFAULT \'NEW\',
  `trig` VARCHAR(30) NOT NULL DEFAULT \'\',
  `trigDetail` VARCHAR(60) NOT NULL DEFAULT \'\',
  `name` VARCHAR(40) NOT NULL DEFAULT \'\',
  `age` INT NULL,
  `sex` VARCHAR(2) NOT NULL DEFAULT \'\',
  `symptomCat` VARCHAR(20) NOT NULL DEFAULT \'\',
  `symptom` VARCHAR(100) NOT NULL DEFAULT \'\',
  `staff` VARCHAR(30) NOT NULL DEFAULT \'\',
  `treatment` VARCHAR(10) NOT NULL DEFAULT \'\',
  `visits` TEXT NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `karte_src` (`storeId`, `date`, `srcTime`, `srcBed`),
  KEY `karte_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_karte_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const KARTE_OPTION_DDL = 'CREATE TABLE IF NOT EXISTS `karte_option` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `category` VARCHAR(20) NOT NULL,
  `label` VARCHAR(60) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `karte_option_cat` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const AREA_DDL = 'CREATE TABLE IF NOT EXISTS `area` (
  `id` VARCHAR(32) NOT NULL,
  `name` VARCHAR(30) NOT NULL,
  `storeCodes` TEXT NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const SLOT_BLOCK_DDL = 'CREATE TABLE IF NOT EXISTS `slot_block` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `startTime` INT NOT NULL,
  `endTime` INT NOT NULL,
  `count` INT NOT NULL DEFAULT 0,
  `beds` VARCHAR(100) NOT NULL DEFAULT \'\',
  `label` VARCHAR(30) NOT NULL DEFAULT \'\',
  PRIMARY KEY (`id`),
  KEY `slot_block_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_slot_block_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const HELP_IN_DDL = 'CREATE TABLE IF NOT EXISTS `help_in` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `status` VARCHAR(12) NOT NULL,
  `name` VARCHAR(30) NOT NULL DEFAULT \'\',
  PRIMARY KEY (`id`),
  UNIQUE KEY `help_in_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_help_in_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    private static function hasTable(PDO $pdo, string $t): bool
    {
        $st = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $st->execute([$t]);
        return (bool)$st->fetch();
    }

    private static function hasColumn(PDO $pdo, string $t, string $c): bool
    {
        $st = $pdo->prepare('SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?');
        $st->execute([$t, $c]);
        return (bool)$st->fetch();
    }
}
