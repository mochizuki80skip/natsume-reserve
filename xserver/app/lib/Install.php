<?php
// 初期設定：テーブル作成と初期データ（本部アカウント・サンプル店舗）
declare(strict_types=1);

final class Install
{
    /** @return string[] 実行したことのメッセージ */
    public static function run(bool $withSamples = true): array
    {
        $log = [];
        $sql = file_get_contents(dirname(__DIR__) . '/sql/schema.sql');
        $sql = preg_replace('/^\s*--.*$/m', '', $sql); // コメント行を除く
        $pdo = Db::pdo();
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            if ($stmt !== '') $pdo->exec($stmt);
        }
        Jibai::ensureTables(true);
        $log[] = 'テーブルを作成（または確認）しました';

        Settings::global();
        $log[] = '全店共通設定を用意しました';

        $hq = Db::one('SELECT id FROM admin_account WHERE code = ?', ['HQ']);
        if (!$hq) {
            $pw = Config::str('HQ_PASSWORD') !== '' ? Config::str('HQ_PASSWORD') : 'hq-pass';
            Db::exec('INSERT INTO admin_account (id, code, passwordHash, role, storeId) VALUES (?, ?, ?, ?, NULL)', [Db::newId(), 'HQ', password_hash($pw, PASSWORD_BCRYPT), 'hq']);
            $log[] = '本部アカウント HQ を作成しました（パスワードは config.php の HQ_PASSWORD）';
        } else {
            $log[] = '本部アカウント HQ は作成済みです';
        }

        if ($withSamples && (int)Db::one('SELECT COUNT(*) AS n FROM store')['n'] === 0) {
            foreach ([['S001', 'サンプル本店', '055-000-0001'], ['S002', 'サンプル駅前院', '055-000-0002']] as [$code, $name, $phone]) {
                $id = Db::newId();
                Db::exec('INSERT INTO store (id, code, name, phone, beds) VALUES (?, ?, ?, ?, 8)', [$id, $code, $name, $phone]);
                Db::exec('INSERT INTO admin_account (id, code, passwordHash, role, storeId) VALUES (?, ?, ?, ?, ?)', [Db::newId(), $code, password_hash('password', PASSWORD_BCRYPT), 'store', $id]);
            }
            $log[] = 'サンプル店舗 S001 / S002 を作成しました（パスワード: password）。本番では本部画面から実店舗を追加し、サンプルは削除してください';
        }
        return $log;
    }
}
