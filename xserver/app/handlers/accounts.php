<?php
// 本部アカウント（一人ずつ）の発行・停止と、操作の記録（/api/admin/hq/accounts, /api/admin/hq/audit）
declare(strict_types=1);

const OWNER_CODE = 'HQ'; // 最初の管理者アカウント。停止や権限の取り消しはできない

function acc_row(array $a): array
{
    return ['id' => $a['id'], 'code' => $a['code'], 'name' => $a['name'], 'active' => (bool)$a['active'], 'canManage' => (bool)$a['canManage'],
        'lastLoginAt' => $a['lastLoginAt'] ? Time::formatDateTimeShort($a['lastLoginAt']) : '', 'owner' => $a['code'] === OWNER_CODE];
}

function hq_accounts_get(): never
{
    Auth::requireHq();
    $me = Auth::account();
    $rows = Db::all("SELECT * FROM admin_account WHERE role = 'hq' ORDER BY code = ? DESC, active DESC, createdAt ASC", [OWNER_CODE]);
    Http::json(['accounts' => array_map('acc_row', $rows), 'me' => ['id' => $me['id'], 'canManage' => (bool)$me['canManage']]]);
}

function hq_accounts_post(): never
{
    Auth::requireManager();
    Http::requireJson();
    $b = Http::body();
    $code = trim((string)($b['code'] ?? ''));
    $name = mb_substr(trim((string)($b['name'] ?? '')), 0, 30);
    $password = (string)($b['password'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{2,20}$/', $code)) Http::error('ID は英数字 2〜20 文字にしてください', 400);
    if ($name === '') Http::error('名前を入力してください', 400);
    if (strlen($password) < 8) Http::error('パスワードは 8 文字以上にしてください', 400);
    if (Db::one('SELECT 1 AS x FROM admin_account WHERE code = ?', [$code]) || Db::one('SELECT 1 AS x FROM store WHERE code = ?', [$code])) Http::error('この ID はすでに使われています（店舗コードとも重ならないようにしてください）', 400);
    Db::exec("INSERT INTO admin_account (id, code, passwordHash, role, storeId, name, active, canManage) VALUES (?, ?, ?, 'hq', NULL, ?, 1, ?)",
        [Db::newId(), $code, password_hash($password, PASSWORD_BCRYPT), $name, Http::bool($b, 'canManage') ? 1 : 0]);
    Http::json(['ok' => true]);
}

/** 名前・停止／再開・権限・パスワード再設定（{ id, name?, active?, canManage?, password? }） */
function hq_accounts_put(): never
{
    Auth::requireManager();
    Http::requireJson();
    $b = Http::body();
    $me = Auth::account();
    $a = Db::one("SELECT * FROM admin_account WHERE id = ? AND role = 'hq'", [(string)($b['id'] ?? '')]);
    if (!$a) Http::error('not found', 404);
    $set = [];
    $params = [];
    if (array_key_exists('name', $b)) {
        $n = mb_substr(trim((string)$b['name']), 0, 30);
        if ($n === '') Http::error('名前を入力してください', 400);
        $set[] = 'name = ?'; $params[] = $n;
    }
    foreach (['active' => '停止', 'canManage' => '発行・停止の権限の取り消し'] as $k => $what) {
        if (!array_key_exists($k, $b)) continue;
        $v = Http::bool($b, $k);
        if (!$v && $a['code'] === OWNER_CODE) Http::error("管理者アカウント（HQ）は{$what}ができません", 400);
        if (!$v && $a['id'] === $me['id']) Http::error("自分のアカウントは{$what}ができません", 400);
        $set[] = "$k = ?"; $params[] = $v ? 1 : 0;
    }
    if (array_key_exists('password', $b)) {
        $pw = (string)$b['password'];
        if (strlen($pw) < 8) Http::error('パスワードは 8 文字以上にしてください', 400);
        $set[] = 'passwordHash = ?'; $params[] = password_hash($pw, PASSWORD_BCRYPT);
    }
    if ($set) Db::exec('UPDATE admin_account SET ' . implode(', ', $set) . ' WHERE id = ?', array_merge($params, [$a['id']]));
    Http::json(['ok' => true]);
}

function hq_audit_get(): never
{
    Auth::requireManager();
    $rows = Db::all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300');
    Http::json(['rows' => array_map(fn($r) => ['at' => Time::formatDateTimeShort($r['at']), 'actor' => $r['actor'], 'store' => $r['storeCode'], 'action' => $r['action'], 'detail' => $r['detail'], 'ok' => (int)$r['status'] < 400], $rows)]);
}

// ---------- 操作の記録 ----------
const AUDIT_LABEL = [
    'adm_cells_put' => '予約表の入力', 'adm_visit_put' => '来院チェック', 'adm_cancel_post' => 'キャンセル名簿へ移動', 'adm_cancel_delete' => 'キャンセルを戻す',
    'adm_days_put' => '日の設定（公開・休診・枠数）', 'adm_shifts_put' => 'シフト', 'adm_help_in_put' => 'ヘルプ（他店から）',
    'adm_block_post' => 'ブロックの追加', 'adm_block_delete' => 'ブロックの解除', 'adm_staff_post' => 'スタッフ追加', 'adm_staff_put' => 'スタッフ変更', 'adm_staff_delete' => 'スタッフ削除',
    'adm_store_put' => '店舗設定', 'adm_store_patch' => '自分のパスワード変更',
    'karte_post' => 'カルテ集計 行の追加', 'karte_patch' => 'カルテ集計 入力', 'karte_delete' => 'カルテ集計 行の削除',
    'hq_settings_put' => '全店共通設定', 'hq_stores_post' => '店舗の追加', 'hq_karte_options_put' => 'カルテ集計の選択肢', 'hq_areas_put' => 'エリア',
    'hq_accounts_post' => '本部アカウントの発行', 'hq_accounts_put' => '本部アカウントの変更',
    'hq_stores_put' => '店舗の変更・停止・削除', 'hq_jibai_settings_put' => '自賠の設定', 'adm_cancel_patch' => 'キャンセル名簿のメモ', 'adm_reservations_delete' => 'WEB予約の削除',
    'jibai_submit' => '自賠請求の提出', 'jibai_claims_put' => '自賠請求の変更', 'jibai_claims_delete' => '自賠請求の削除', 'jibai_verify' => '自賠請求の確認',
];

/** 管理画面の書き込み操作を記録する（応答のあとに書く。氏名などの個人情報は残さない） */
function audit_register(string $fn, string $method): void
{
    if ($method === 'GET' || in_array($fn, ['adm_login', 'adm_logout', 'adm_switch'], true) || !str_starts_with($fn, 'adm_') && !str_starts_with($fn, 'hq_') && !str_starts_with($fn, 'karte_') && !str_starts_with($fn, 'jibai_')) return;
    $s = Auth::session();
    if (!$s) return;
    $b = json_decode((string)file_get_contents('php://input'), true);
    $detail = [];
    foreach (['date', 'code', 'month'] as $k) if (is_array($b) && is_scalar($b[$k] ?? null) && $b[$k] !== '') $detail[] = (string)$b[$k];
    $ja = ['karteNo' => 'カルテNo', 'kind' => '新・再', 'trig' => 'きっかけ', 'trigDetail' => '内訳', 'name' => '名前', 'age' => '年齢', 'sex' => '性別', 'symptomCat' => '症状カテゴリー',
        'symptom' => '症状', 'staff' => '担当', 'treatment' => '施術', 'visits' => '2〜6回目', 'date' => '日付', 'active' => '利用中／停止', 'canManage' => '発行・停止の権限', 'password' => 'パスワード再設定'];
    $keys = fn(array $x) => implode('・', array_map(fn($k) => $ja[$k] ?? $k, array_keys($x)));
    if (is_array($b) && isset($b['patch']) && is_array($b['patch'])) $detail[] = '項目：' . $keys($b['patch']);
    if ($fn === 'hq_accounts_put' && is_array($b)) {
        $t = Db::one('SELECT code, name FROM admin_account WHERE id = ?', [(string)($b['id'] ?? '')]);
        $detail[] = ($t ? "{$t['name']}（{$t['code']}）：" : '') . $keys(array_diff_key($b, ['id' => 1]));
    }
    register_shutdown_function(function () use ($fn, $s, $detail) {
        try {
            $store = Auth::resolveStore($s);
            $actor = $s['role'] === 'hq' ? ((Auth::account()['name'] ?? '') . '（' . $s['code'] . '）') : $s['code'];
            Db::exec('INSERT INTO audit_log (accountId, actor, storeCode, action, detail, status) VALUES (?, ?, ?, ?, ?, ?)', [
                $s['accountId'], mb_substr($actor, 0, 60), str_starts_with($fn, 'hq_') ? '' : (string)($store['code'] ?? ''), mb_substr(AUDIT_LABEL[$fn] ?? $fn, 0, 60), mb_substr(implode(' ', $detail), 0, 120), (int)http_response_code(),
            ]);
        } catch (Throwable $e) {
            error_log('[audit] ' . $e->getMessage());
        }
    });
}
