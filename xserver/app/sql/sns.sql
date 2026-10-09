-- SNS 投稿管理（Instagram・Google ビジネスプロフィール）。下書き → 承認 → 予定時刻に自動投稿 → 数字の取り込み
-- 初期設定（/install）で作成されるほか、API 側でも無ければ自動作成する（Sns::ensureTables）

-- 全店共通の設定（1 行）
CREATE TABLE IF NOT EXISTS `sns_setting` (
  `id` INT NOT NULL,
  `forbiddenWords` LONGTEXT NOT NULL,       -- 広告規制で使わない語（JSON 配列）
  `patterns` LONGTEXT NOT NULL,             -- 文章の型（JSON：{ig:{openings,closings}, gbp:{openings,closings,keywordLines}}）
  `defaultIgSchedule` LONGTEXT NOT NULL,    -- 店舗設定が無いときの Instagram の頻度（JSON）
  `defaultGbpSchedule` LONGTEXT NOT NULL,   -- 同 Google
  `daysAhead` INT NOT NULL DEFAULT 60,      -- 何日先まで下書きを作るか
  `remindHours` INT NOT NULL DEFAULT 24,    -- 承認待ちの通知を何時間前から出すか
  `hashtagBase` VARCHAR(300) NOT NULL DEFAULT '',
  `lineTargets` LONGTEXT NOT NULL,          -- 通知先の LINE userId（JSON 配列）
  `customVars` LONGTEXT NULL,               -- 店舗ごとに値を入れる差し込み語の定義（JSON：[{key, label, default}]。例 最寄駅・駐車場）
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗ごとの設定
CREATE TABLE IF NOT EXISTS `sns_store_setting` (
  `storeId` VARCHAR(32) NOT NULL,
  `igEnabled` TINYINT(1) NOT NULL DEFAULT 0,
  `igSchedule` LONGTEXT NULL,               -- NULL なら全店共通の既定
  `gbpEnabled` TINYINT(1) NOT NULL DEFAULT 0,
  `gbpSchedule` LONGTEXT NULL,
  `area` VARCHAR(50) NOT NULL DEFAULT '',   -- 地域（例：沼津市）
  `address` VARCHAR(100) NOT NULL DEFAULT '',
  `hoursText` VARCHAR(200) NOT NULL DEFAULT '',
  `hashtags` VARCHAR(500) NOT NULL DEFAULT '',
  `keywordsFixed` VARCHAR(300) NOT NULL DEFAULT '',     -- 毎回入れる検索キーワード（読点区切り）
  `keywordsRotation` VARCHAR(500) NOT NULL DEFAULT '',  -- 日替わりのキーワード
  `memo` TEXT NULL,                          -- 運用メモ（下書きを作る人・確認する人へのルール）
  `vars` LONGTEXT NULL,                      -- 差し込み語の値（JSON：{key: value}。本部が定義した項目に店舗が値を入れる）
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`storeId`),
  CONSTRAINT `fk_sss_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 連携アカウント（店舗 × 媒体）。Google の本部連携は storeId が NULL の 1 行
CREATE TABLE IF NOT EXISTS `sns_account` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NULL,
  `channel` VARCHAR(5) NOT NULL,            -- ig / gbp
  `externalId` VARCHAR(100) NOT NULL DEFAULT '',   -- ig: ユーザーID / gbp: accounts/xxx
  `username` VARCHAR(100) NOT NULL DEFAULT '',     -- ig: @ユーザー名 / gbp: 拠点名
  `locationName` VARCHAR(100) NOT NULL DEFAULT '', -- gbp: locations/xxx
  `accessToken` TEXT NULL,                  -- 暗号化して保存
  `refreshToken` TEXT NULL,                 -- 暗号化して保存（Google）
  `tokenExpiresAt` DATETIME NULL,
  `tokenRefreshedAt` DATETIME NULL,
  `lastError` VARCHAR(300) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sa_store_channel` (`storeId`, `channel`),
  CONSTRAINT `fk_sa_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 定型投稿（文章＋画像）。storeId が NULL なら全店共通。文章には {店舗名} {エリア} などの差し込み語を書ける
CREATE TABLE IF NOT EXISTS `sns_topic` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NULL,
  `channel` VARCHAR(5) NOT NULL DEFAULT 'both', -- ig / gbp / both
  `title` VARCHAR(100) NOT NULL,             -- 定型投稿の名前（一覧用。standalone のときは投稿文には入らない）
  `body` TEXT NOT NULL,                      -- 投稿文（差し込み語入り）
  `standalone` TINYINT(1) NOT NULL DEFAULT 1, -- 1: 本文をそのまま投稿文にする（差し込みのみ） / 0: 書き出し・締めの型で囲む
  `imagePath` VARCHAR(200) NULL,             -- アップロードした画像（public/media/sns/）。下書きを作るときにコピーされる
  `months` VARCHAR(40) NOT NULL DEFAULT '',  -- 使う月（例 "12,1,2"）。空なら通年
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `useCount` INT NOT NULL DEFAULT 0,
  `lastUsedAt` DATETIME NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `st_store` (`storeId`),
  CONSTRAINT `fk_st_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 画像ライブラリ（量産した画像を保管。定型投稿や下書きに割り当てる。storeId NULL は全店共通）
CREATE TABLE IF NOT EXISTS `sns_media` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NULL,
  `path` VARCHAR(200) NOT NULL,              -- public/media/sns/ 以下のファイル名
  `label` VARCHAR(100) NOT NULL DEFAULT '',  -- メモ（例：腰痛・冬）
  `channel` VARCHAR(5) NOT NULL DEFAULT 'both', -- ig / gbp / both（自動割り当ての対象）
  `width` INT NOT NULL DEFAULT 0,
  `height` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `useCount` INT NOT NULL DEFAULT 0,
  `lastUsedAt` DATETIME NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `sm_store` (`storeId`),
  CONSTRAINT `fk_sm_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 投稿（下書き）。status: draft → approved（承認）→ publishing → posted／failed
CREATE TABLE IF NOT EXISTS `sns_post` (
  `id` VARCHAR(32) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `channel` VARCHAR(5) NOT NULL,
  `scheduledAt` DATETIME NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'draft',
  `topicId` VARCHAR(32) NULL,
  `title` VARCHAR(100) NOT NULL DEFAULT '',
  `body` TEXT NOT NULL,
  `closing` VARCHAR(300) NOT NULL DEFAULT '',
  `hashtags` VARCHAR(500) NOT NULL DEFAULT '',
  `postText` TEXT NOT NULL,                 -- 実際に投稿する文章（本文＋締め＋タグなどを組み立てたもの）
  `patternIdx` INT NOT NULL DEFAULT 0,      -- 「別のパターン」で切り替える文章の型の番号
  `standalone` TINYINT(1) NOT NULL DEFAULT 0, -- 1: 本文をそのまま投稿文にする（定型投稿）
  `imagePath` VARCHAR(200) NULL,            -- public/media/sns/ 以下のファイル名
  `imageKind` VARCHAR(10) NOT NULL DEFAULT 'none', -- none / template / upload / topic（定型投稿の画像をコピー）
  `source` VARCHAR(10) NOT NULL DEFAULT 'auto',    -- auto（自動生成）/ manual（手で作成）
  `publishMode` VARCHAR(10) NOT NULL DEFAULT 'api', -- api / manual（Google の許可待ちなど）
  `checkedAt` DATETIME NULL,                -- （未使用。以前の 2 人チェックの名残）
  `checkedBy` VARCHAR(20) NULL,
  `approvedAt` DATETIME NULL,
  `approvedBy` VARCHAR(20) NULL,
  `postedAt` DATETIME NULL,
  `externalId` VARCHAR(200) NULL,
  `permalink` VARCHAR(300) NULL,
  `error` VARCHAR(500) NULL,
  `manualNotifiedAt` DATETIME NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `sp_store_sched` (`storeId`, `channel`, `scheduledAt`),
  KEY `sp_status_sched` (`status`, `scheduledAt`),
  CONSTRAINT `fk_sp_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 投稿ごとの数字（最新値を上書き）
CREATE TABLE IF NOT EXISTS `sns_post_stat` (
  `postId` VARCHAR(32) NOT NULL,
  `reach` INT NULL,
  `likes` INT NULL,
  `comments` INT NULL,
  `saved` INT NULL,
  `shares` INT NULL,
  `views` INT NULL,
  `fetchedAt` DATETIME NOT NULL,
  PRIMARY KEY (`postId`),
  CONSTRAINT `fk_sps_post` FOREIGN KEY (`postId`) REFERENCES `sns_post` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗 × 媒体 × 日 × 指標（Instagram：followers / reach / profile_views、Google：impressions_maps / impressions_search / calls / directions / website_clicks / conversations / bookings）
CREATE TABLE IF NOT EXISTS `sns_insight_daily` (
  `storeId` VARCHAR(32) NOT NULL,
  `channel` VARCHAR(5) NOT NULL,
  `date` CHAR(10) NOT NULL,
  `metric` VARCHAR(30) NOT NULL,
  `value` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`storeId`, `channel`, `date`, `metric`),
  CONSTRAINT `fk_sid_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Google のクチコミ
CREATE TABLE IF NOT EXISTS `sns_review` (
  `id` VARCHAR(32) NOT NULL,                -- reviewId のハッシュ
  `storeId` VARCHAR(32) NOT NULL,
  `reviewName` VARCHAR(200) NOT NULL,       -- accounts/x/locations/y/reviews/z
  `reviewer` VARCHAR(100) NOT NULL DEFAULT '',
  `rating` INT NOT NULL DEFAULT 0,
  `comment` TEXT NULL,
  `createTime` DATETIME NULL,
  `replyComment` TEXT NULL,
  `replyTime` DATETIME NULL,
  `fetchedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `sr_store` (`storeId`, `createTime`),
  CONSTRAINT `fk_sr_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LINE で話しかけてきた人（通知先の候補）
CREATE TABLE IF NOT EXISTS `sns_line_user` (
  `userId` VARCHAR(50) NOT NULL,
  `displayName` VARCHAR(100) NOT NULL DEFAULT '',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 定期処理の実行記録（1 日 1 回の処理を二重に動かさない）
CREATE TABLE IF NOT EXISTS `sns_job` (
  `k` VARCHAR(60) NOT NULL,
  `ranAt` DATETIME NOT NULL,
  `note` VARCHAR(300) NULL,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 店舗ごとの SNS のログイン情報（本部だけが見られる）。パスワードは暗号化して保存（鍵は config.php の SNS_SECRET）
CREATE TABLE IF NOT EXISTS `sns_credential` (
  `storeId` VARCHAR(32) NOT NULL,
  `channel` VARCHAR(5) NOT NULL,            -- ig / gbp
  `loginId` VARCHAR(200) NOT NULL DEFAULT '',
  `passwordEnc` TEXT NULL,
  `email` VARCHAR(200) NOT NULL DEFAULT '',
  `phone` VARCHAR(50) NOT NULL DEFAULT '',
  `note` TEXT NULL,
  `updatedBy` VARCHAR(20) NULL,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `revealedBy` VARCHAR(20) NULL,
  `revealedAt` DATETIME NULL,
  PRIMARY KEY (`storeId`, `channel`),
  CONSTRAINT `fk_scr_store` FOREIGN KEY (`storeId`) REFERENCES `store` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
