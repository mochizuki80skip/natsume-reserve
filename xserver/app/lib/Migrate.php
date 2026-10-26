<?php
// 後から追加した列・表を、既存のデータベースに自動で足す（/install をやり直さなくても更新ファイルを置くだけで反映される）
declare(strict_types=1);

final class Migrate
{
    /** この数字を上げたら run() に処理を足す */
    private const VERSION = 31;
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
            if ($ver < 15) {
                // 初回カルテの氏名を「この氏名で正しい」と確認したか（名字だけ・ひらがなだけ・カタカナだけの確認の表示を消す）
                if (self::hasTable($pdo, 'karte') && !self::hasColumn($pdo, 'karte', 'nameOk')) $pdo->exec('ALTER TABLE `karte` ADD COLUMN `nameOk` TINYINT(1) NOT NULL DEFAULT 0 AFTER `name`');
            }
            if ($ver < 16) {
                // 紹介元（業者）ごとの専用 QR。予約に紹介元を残し、きっかけの選択肢に「業者紹介」を足す
                $pdo->exec(self::REFERRAL_DDL);
                if (self::hasTable($pdo, 'reservation') && !self::hasColumn($pdo, 'reservation', 'refCode')) $pdo->exec('ALTER TABLE `reservation` ADD COLUMN `refCode` VARCHAR(16) NULL');
                if (self::hasTable($pdo, 'karte_option')) {
                    $has = $pdo->query("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'trigger'")->fetch();
                    $dup = $pdo->query("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'trigger' AND label = '業者紹介'")->fetch();
                    if ((int)$has['n'] > 0 && (int)$dup['n'] === 0) {
                        $at = (int)$pdo->query("SELECT COALESCE(MAX(sortOrder), 0) + 1 AS n FROM karte_option WHERE category = 'trigger'")->fetch()['n'];
                        $pdo->exec("INSERT INTO karte_option (category, label, sortOrder) VALUES ('trigger', '業者紹介', $at)");
                    }
                }
            }
            if ($ver < 17) {
                // 物販に「湿布・回答書」を足す（後ろに。すでにあるものは足さない）
                if (self::hasTable($pdo, 'karte_option')) {
                    $has = $pdo->query("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'goods'")->fetch();
                    if ((int)$has['n'] > 0) {
                        foreach (['湿布', '回答書'] as $label) {
                            $dup = $pdo->prepare("SELECT COUNT(*) AS n FROM karte_option WHERE category = 'goods' AND label = ?");
                            $dup->execute([$label]);
                            if ((int)$dup->fetch()['n'] > 0) continue;
                            $at = (int)$pdo->query("SELECT COALESCE(MAX(sortOrder), 0) + 1 AS n FROM karte_option WHERE category = 'goods'")->fetch()['n'];
                            $ins = $pdo->prepare("INSERT INTO karte_option (category, label, sortOrder) VALUES ('goods', ?, ?)");
                            $ins->execute([$label, $at]);
                        }
                    }
                }
            }
            if ($ver < 18) {
                // 再来（1ヶ月以上ご来院の無い方）を同じ時間に WEB で受ける上限（NULL＝制限なし）
                if (self::hasTable($pdo, 'store') && !self::hasColumn($pdo, 'store', 'maxRevisitConcurrent')) $pdo->exec('ALTER TABLE `store` ADD COLUMN `maxRevisitConcurrent` INT NULL DEFAULT NULL AFTER `maxNewConcurrent`');
            }
            if ($ver < 19) {
                // 本部の店舗一覧：エリアの中の並び順と、本部専用（本部の人だけが見る）店舗。特別な営業日（プレオープン・イベント）
                if (self::hasTable($pdo, 'store')) {
                    if (!self::hasColumn($pdo, 'store', 'sortOrder')) {
                        $pdo->exec('ALTER TABLE `store` ADD COLUMN `sortOrder` INT NOT NULL DEFAULT 0');
                        $i = 0;
                        foreach ($pdo->query('SELECT id FROM store ORDER BY code ASC')->fetchAll() as $r) {
                            $u = $pdo->prepare('UPDATE store SET sortOrder = ? WHERE id = ?');
                            $u->execute([++$i, $r['id']]);
                        }
                    }
                    if (!self::hasColumn($pdo, 'store', 'hqOnly')) $pdo->exec('ALTER TABLE `store` ADD COLUMN `hqOnly` TINYINT(1) NOT NULL DEFAULT 0');
                    $pdo->exec(self::SPECIAL_DAY_DDL);
                }
            }
            if ($ver < 20 && self::hasTable($pdo, 'karte')) {
                // 新患継続率（初回カルテ）の氏名に入ってしまった電話番号を外す（予約表のセルに氏名と一緒に書かれていたもの）
                $up = $pdo->prepare('UPDATE karte SET name = ? WHERE id = ?');
                foreach ($pdo->query("SELECT id, name FROM karte WHERE name REGEXP '[0-9０-９]'")->fetchAll() as $r) {
                    $clean = Text::dropPhone((string)$r['name']);
                    if ($clean !== $r['name']) $up->execute([mb_substr($clean, 0, 40), $r['id']]);
                }
            }
            if ($ver < 21 && self::hasTable($pdo, 'cell') && !self::hasColumn($pdo, 'cell', 'phone')) {
                // 電話で取った予約の電話番号（WEB 予約と同じように氏名の下に出す）
                $pdo->exec('ALTER TABLE `cell` ADD COLUMN `phone` VARCHAR(20) NULL');
            }
            if ($ver < 22 && self::hasTable($pdo, 'store') && !self::hasColumn($pdo, 'store', 'jibaiOnly')) {
                // 自賠請求だけに使う店舗（予約表・集計・店舗えらびページ・WEB 予約には出さない）
                $pdo->exec('ALTER TABLE `store` ADD COLUMN `jibaiOnly` TINYINT(1) NOT NULL DEFAULT 0');
            }
            if ($ver < 23 && self::hasTable($pdo, 'karte') && !self::hasColumn($pdo, 'karte', 'stopped')) {
                // 新患継続率の「予後（中止・転院）」「アンケート」（店舗のスプレッドシートと同じチェック欄）
                $pdo->exec('ALTER TABLE `karte` ADD COLUMN `stopped` TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN `transferred` TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN `survey` TINYINT(1) NOT NULL DEFAULT 0');
            }
            if ($ver < 24) {
                // 媒体ごとの店舗えらび URL（紹介元と同じ表。kind=media のときは trig のきっかけを入れる）と、プライバシーポリシーなどの共通ページ
                if (self::hasTable($pdo, 'referral') && !self::hasColumn($pdo, 'referral', 'kind')) $pdo->exec("ALTER TABLE `referral` ADD COLUMN `kind` VARCHAR(10) NOT NULL DEFAULT 'partner', ADD COLUMN `trig` VARCHAR(30) NOT NULL DEFAULT ''");
                $pdo->exec(self::SITE_PAGE_DDL);
            }
            if ($ver < 25) {
                // 管轄MG（エリアの店舗）・経理アカウントと、窓口集計（月間窓口表・物販内訳・返戻）
                if (!self::hasColumn($pdo, 'admin_account', 'area')) $pdo->exec('ALTER TABLE `admin_account` ADD COLUMN `area` VARCHAR(40) NULL');
                foreach ([self::MADOGUCHI_DAY_DDL, self::MADOGUCHI_MONTH_DDL, self::MADOGUCHI_HENREI_DDL, self::GOODS_ITEM_DDL] as $ddl) $pdo->exec($ddl);
            }
            if ($ver < 26 && !self::hasColumn($pdo, 'store', 'stdTherapists')) {
                // 人員基準（施術者・受付の人数）。人員の過不足（採用のための一覧）に使う
                $pdo->exec('ALTER TABLE `store` ADD COLUMN `stdTherapists` INT NULL, ADD COLUMN `stdReception` INT NULL');
            }
            if ($ver < 27) {
                // 離反者リスト・2 週間フォロー（予約表を自動削除する前に来院の記録を残す表も）
                foreach ([self::VISIT_ARCHIVE_DDL, self::CHURN_DDL, self::FOLLOW_DDL] as $ddl) $pdo->exec($ddl);
            }
            if ($ver < 28 && self::hasTable($pdo, 'day_status') && !self::hasColumn($pdo, 'day_status', 'closedPart')) {
                // 臨時休業の午前だけ・午後だけ（closedPart = AM / PM）と、予約ページ・店舗えらびに出すお知らせの一言
                $pdo->exec('ALTER TABLE `day_status` ADD COLUMN `closedPart` VARCHAR(2) NULL, ADD COLUMN `closedNote` VARCHAR(100) NULL');
            }
            if ($ver < 29 && self::hasTable($pdo, 'day_status') && !self::hasColumn($pdo, 'day_status', 'closedBy')) {
                // 本部・管轄MG がまとめて入れた臨時休業（closedBy）と、店舗が「確認しました」を押したか（closedAck）
                $pdo->exec('ALTER TABLE `day_status` ADD COLUMN `closedBy` VARCHAR(60) NULL, ADD COLUMN `closedAck` TINYINT(1) NOT NULL DEFAULT 1');
            }
            if ($ver < 30 && self::hasTable($pdo, 'admin_account') && !self::hasColumn($pdo, 'admin_account', 'sessVer')) {
                // パスワードの変更・停止で、ログイン中の画面も使えなくする（ログインの Cookie に入れて毎回くらべる）
                $pdo->exec('ALTER TABLE `admin_account` ADD COLUMN `sessVer` INT NOT NULL DEFAULT 0');
            }
            if ($ver < 31 && self::hasTable($pdo, 'store') && !self::hasColumn($pdo, 'store', 'pageCity')) {
                // 店舗えらびページ：見出しの地域（空なら住所の市・町）と、並び順（空なら本部の店舗一覧の順）
                $pdo->exec('ALTER TABLE `store` ADD COLUMN `pageCity` VARCHAR(30) NULL, ADD COLUMN `pageOrder` INT NULL');
            }
            $st = $pdo->prepare("REPLACE INTO app_meta (k, v) VALUES ('schema', ?)");
            $st->execute([self::VERSION]);
        } catch (Throwable $e) {
            error_log('[migrate] ' . $e->getMessage());
        }
    }

    public const SPECIAL_DAY_DDL = 'CREATE TABLE IF NOT EXISTS `special_day` (
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `sessions` VARCHAR(200) NOT NULL,
  `memo` VARCHAR(40) NOT NULL DEFAULT \'\',
  PRIMARY KEY (`storeId`, `date`),
  CONSTRAINT `fk_special_day_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const REFERRAL_DDL = 'CREATE TABLE IF NOT EXISTS `referral` (
  `id` VARCHAR(32) NOT NULL,
  `code` VARCHAR(16) NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `referral_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const MADOGUCHI_DAY_DDL = 'CREATE TABLE IF NOT EXISTS `madoguchi_day` (
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `vals` TEXT NOT NULL,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`storeId`, `date`),
  CONSTRAINT `fk_madoguchi_day_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const MADOGUCHI_MONTH_DDL = 'CREATE TABLE IF NOT EXISTS `madoguchi_month` (
  `storeId` VARCHAR(32) NOT NULL,
  `ym` CHAR(7) NOT NULL,
  `target` INT NULL,
  `extra` TEXT NULL,
  `memo` TEXT NULL,
  `goods` TEXT NULL,
  `stockStart` TEXT NULL,
  `editedAt` DATETIME NULL,
  `checkedAt` DATETIME NULL,
  `checkedBy` VARCHAR(60) NOT NULL DEFAULT \'\',
  PRIMARY KEY (`storeId`, `ym`),
  CONSTRAINT `fk_madoguchi_month_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const MADOGUCHI_HENREI_DDL = 'CREATE TABLE IF NOT EXISTS `madoguchi_henrei` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `ym` CHAR(7) NOT NULL,
  `special` TINYINT(1) NOT NULL DEFAULT 0,
  `treatYm` VARCHAR(20) NOT NULL DEFAULT \'\',
  `claimMonth` VARCHAR(20) NOT NULL DEFAULT \'\',
  `patient` VARCHAR(40) NOT NULL DEFAULT \'\',
  `relation` VARCHAR(10) NOT NULL DEFAULT \'\',
  `insurer` VARCHAR(60) NOT NULL DEFAULT \'\',
  `insurerCode` VARCHAR(20) NOT NULL DEFAULT \'\',
  `amount` INT NULL,
  `reamount` INT NULL,
  `place` VARCHAR(60) NOT NULL DEFAULT \'\',
  `action` VARCHAR(20) NOT NULL DEFAULT \'\',
  `reason` VARCHAR(100) NOT NULL DEFAULT \'\',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `madoguchi_henrei_store_ym` (`storeId`, `ym`),
  CONSTRAINT `fk_madoguchi_henrei_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const GOODS_ITEM_DDL = 'CREATE TABLE IF NOT EXISTS `goods_item` (
  `id` VARCHAR(32) NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `price` INT NOT NULL DEFAULT 0,
  `cost` INT NOT NULL DEFAULT 0,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const VISIT_ARCHIVE_DDL = 'CREATE TABLE IF NOT EXISTS `visit_archive` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `storeId` VARCHAR(32) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `staff` VARCHAR(30) NOT NULL DEFAULT \'\',
  `cardNo` VARCHAR(20) NOT NULL DEFAULT \'\',
  PRIMARY KEY (`id`),
  KEY `visit_archive_store_date` (`storeId`, `date`),
  CONSTRAINT `fk_visit_archive_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const CHURN_DDL = 'CREATE TABLE IF NOT EXISTS `churn` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `churnDate` CHAR(10) NOT NULL,
  `patientKey` VARCHAR(60) NOT NULL DEFAULT \'\',
  `lastVisit` CHAR(10) NULL,
  `cardNo` VARCHAR(20) NOT NULL DEFAULT \'\',
  `name` VARCHAR(40) NOT NULL DEFAULT \'\',
  `sex` VARCHAR(2) NOT NULL DEFAULT \'\',
  `age` INT NULL,
  `kind` VARCHAR(10) NOT NULL DEFAULT \'\',
  `visits` VARCHAR(10) NOT NULL DEFAULT \'\',
  `staff` VARCHAR(30) NOT NULL DEFAULT \'\',
  `symptom` VARCHAR(100) NOT NULL DEFAULT \'\',
  `treatment` VARCHAR(10) NOT NULL DEFAULT \'\',
  `manage` VARCHAR(10) NOT NULL DEFAULT \'\',
  `reason` VARCHAR(200) NOT NULL DEFAULT \'\',
  `source` VARCHAR(10) NOT NULL DEFAULT \'auto\',
  `edited` TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `churn_store_date` (`storeId`, `churnDate`),
  CONSTRAINT `fk_churn_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const FOLLOW_DDL = 'CREATE TABLE IF NOT EXISTS `follow` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `listDate` CHAR(10) NOT NULL,
  `patientKey` VARCHAR(60) NOT NULL,
  `lastVisit` CHAR(10) NOT NULL,
  `cardNo` VARCHAR(20) NOT NULL DEFAULT \'\',
  `name` VARCHAR(40) NOT NULL DEFAULT \'\',
  `staff` VARCHAR(30) NOT NULL DEFAULT \'\',
  `contactedAt` CHAR(10) NULL,
  `nextText` VARCHAR(40) NOT NULL DEFAULT \'\',
  `noBooking` TINYINT(1) NOT NULL DEFAULT 0,
  `note` VARCHAR(200) NOT NULL DEFAULT \'\',
  PRIMARY KEY (`id`),
  UNIQUE KEY `follow_store_day_patient` (`storeId`, `listDate`, `patientKey`),
  CONSTRAINT `fk_follow_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    public const SITE_PAGE_DDL = 'CREATE TABLE IF NOT EXISTS `site_page` (
  `k` VARCHAR(30) NOT NULL,
  `body` MEDIUMTEXT NOT NULL,
  `published` TINYINT(1) NOT NULL DEFAULT 0,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedBy` VARCHAR(60) NOT NULL DEFAULT \'\',
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

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
