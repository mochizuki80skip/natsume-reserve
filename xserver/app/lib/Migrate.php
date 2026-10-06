<?php
// 後から追加した列・表を、既存のデータベースに自動で足す（/install をやり直さなくても更新ファイルを置くだけで反映される）
declare(strict_types=1);

final class Migrate
{
    /** この数字を上げたら run() に処理を足す */
    private const VERSION = 4;
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
            $st = $pdo->prepare("REPLACE INTO app_meta (k, v) VALUES ('schema', ?)");
            $st->execute([self::VERSION]);
        } catch (Throwable $e) {
            error_log('[migrate] ' . $e->getMessage());
        }
    }

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
