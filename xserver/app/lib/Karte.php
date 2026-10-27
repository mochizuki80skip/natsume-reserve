<?php
// 初回カルテ集計：予約表の来院チェック済み「（初診）（初）（初自）（再）」から行を自動で作り、店舗が残りを入力する
declare(strict_types=1);

final class Karte
{
    public const KINDS = ['NEW', 'ACCIDENT', 'REVISIT']; // 新患（初診・初）／初自／再
    public const TREATMENTS = ['矯正', 'マッサ'];
    public const VISITS = 5; // 2〜6回目

    /** 選択肢の種類と初期値（本部の画面で変更できる） */
    public const OPTION_DEFAULTS = [
        'trigger' => ['紹介家族', '紹介友人', '紹介職場', '紹介その他', '自院HP', '交通事故HP', 'ママニケアHP', 'Google', 'Yahoo!', 'エキテン', '口コミ', 'のぼり旗', '店前', 'SNS', 'チラシ', 'イベント', 'その他', 'ギフトカード', '紹介他事業', 'キャンペーン', '業者紹介'],
        'otherBiz' => ['やまがた', 'みさき三島', 'みさき沼津', 'あおい', 'かなめ', 'あかり', "ONE'SBODY フレスポ", 'East-one裾野', 'East-one三島', 'East-one長泉', 'リカバリー三島', 'リカバリー裾野', 'なつめ富士原田', 'なつめ淀川町', 'みらい', 'みつき', 'なつめ沼田町', 'なつめ瀬名', 'なつめ竜南', 'あやめ', 'なつめ長田', 'ミツカル', 'アローズ', 'ゆかり', 'なつめ篠ケ瀬', 'なつめ浜松葵西', 'なつめ浜北美薗', 'なつめ大岡', 'なつめ岡宮', 'なつめ富士錦町', 'なつめ東原', 'なつめ島田', "ONE'SBODY 静岡安倍川"],
        'campaign' => ['ワンコイン', 'チャリティー'],
        'symptom' => ['腰', '肩', '首', '上肢', '前腕', '手', '背中', '股関節', '臀部', '大腿', '膝', '下腿', '足首', '足底', '頭', '自賠', '事故第三者'],
        'revisitAction' => ['LINE', 'DM'],
        // 予約表で予約ごとに選ぶメニューと物販（本部が追加・並べ替え・削除できる）。予約表では 2 段に分けて出す
        'menu' => ['矯正', '2回目', '3回目', '6回目', '12回目', 'ワンコイン', '自費', 'ワクスキ'],
        'goods' => ['パイオ', 'テープ', 'プロテイン', 'ODAIJINI', 'サポーター', '湿布', '回答書'],
    ];
    /** 内訳が必要なきっかけ（値＝内訳の選択肢の種類。null は記入のみ） */
    public const DETAIL_FOR = ['紹介他事業' => 'otherBiz', 'キャンペーン' => 'campaign', 'イベント' => null, '業者紹介' => 'partner'];

    public const EDITABLE = ['date', 'karteNo', 'kind', 'trig', 'trigDetail', 'name', 'nameOk', 'age', 'sex', 'symptomCat', 'symptom', 'staff', 'treatment', 'visits', 'stopped', 'transferred', 'survey', 'accidentDate', 'accidentNote'];

    /** @return array<string, string[]> */
    public static function options(): array
    {
        $out = [];
        foreach (Db::all('SELECT category, label FROM karte_option ORDER BY category, sortOrder ASC, id ASC') as $r) $out[$r['category']][] = $r['label'];
        foreach (self::OPTION_DEFAULTS as $cat => $def) {
            if (!isset($out[$cat])) {
                foreach ($def as $i => $label) Db::exec('INSERT INTO karte_option (category, label, sortOrder) VALUES (?, ?, ?)', [$cat, $label, $i]);
                $out[$cat] = $def;
            }
        }
        // 業者紹介の内訳＝本部が登録した紹介元（業者）の名前（本部の「紹介元の QR」で増やす）
        $out['partner'] = array_column(Db::all("SELECT name FROM referral WHERE kind = 'partner' ORDER BY createdAt ASC, name ASC"), 'name');
        return $out;
    }

    public static function setOptions(string $cat, array $labels): void
    {
        if (!array_key_exists($cat, self::OPTION_DEFAULTS)) throw new HttpError(400, 'bad request');
        $labels = array_values(array_unique(array_filter(array_map(fn($l) => mb_substr(trim((string)$l), 0, 60), $labels), fn($l) => $l !== '')));
        Db::transaction(function () use ($cat, $labels) {
            Db::exec('DELETE FROM karte_option WHERE category = ?', [$cat]);
            foreach ($labels as $i => $l) Db::exec('INSERT INTO karte_option (category, label, sortOrder) VALUES (?, ?, ?)', [$cat, $l, $i]);
        });
    }

    /** セルの文字から区分を決める（対象外なら null） */
    public static function kindOfText(string $text): ?string
    {
        $c = Text::categorize($text);
        if ($c['isNew']) return ($c['isJibai'] ? 'ACCIDENT' : 'NEW');
        if ($c['isRevisit']) return 'REVISIT';
        return null;
    }

    /** 「山田 太郎（初診）」「山田 太郎 初診」→「山田 太郎」 */
    public static function nameOfText(string $text): string
    {
        $t = Text::dropHonorific(Text::dropPhone($text));
        $t = preg_replace('/\s*[（(](初診|初自|初|再|再来|新自)[）)]\s*/u', ' ', $t) ?? $t;
        $t = preg_replace('/\s*(初診|初自|新自|再来|再診)\s*/u', ' ', $t) ?? $t;
        return trim(preg_replace('/\s+/u', ' ', $t) ?? $t);
    }

    /**
     * その月の予約表から、来院チェック済みの初診・初・初自・再を取り込む。
     * 手を加えていない自動の行は、来院チェックが外れたり区分の印が消えたりしたら取り除く。
     */
    public static function sync(array $store, string $ym): void
    {
        $dates = Time::datesOfMonth($ym);
        $first = $dates[0];
        $last = $dates[count($dates) - 1];
        $cells = Db::all('SELECT c.date, c.time, c.bed, c.text, c.visited, c.staff, r.viaCard, rf.name AS refName, rf.kind AS refKind, rf.trig AS refTrig FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId LEFT JOIN referral rf ON rf.code = r.refCode WHERE c.storeId = ? AND c.date BETWEEN ? AND ? AND c.bed > 0', [$store['id'], $first, $last]);
        $want = [];
        $exists = [];
        foreach ($cells as $c) {
            $k = $c['date'] . ':' . (int)$c['time'] . ':' . (int)$c['bed'];
            $exists[$k] = true;
            if (!(int)$c['visited']) continue;
            $kind = self::kindOfText((string)$c['text']);
            if ($kind) $want[$k] = ['date' => $c['date'], 'time' => (int)$c['time'], 'bed' => (int)$c['bed'], 'kind' => $kind, 'name' => self::nameOfText((string)$c['text']), 'staff' => (string)($c['staff'] ?? ''), 'card' => (int)($c['viaCard'] ?? 0) === 1, 'ref' => (string)($c['refName'] ?? ''), 'refTrig' => ($c['refKind'] ?? '') === 'media' ? (string)$c['refTrig'] : '業者紹介'];
        }
        $rows = Db::all('SELECT id, date, srcTime, srcBed, edited FROM karte WHERE storeId = ? AND date BETWEEN ? AND ? AND auto = 1', [$store['id'], $first, $last]);
        $have = [];
        foreach ($rows as $r) {
            $k = $r['date'] . ':' . (int)$r['srcTime'] . ':' . (int)$r['srcBed'];
            $have[$k] = true;
            // 元のセルがあって、もう対象でない（チェックを外した等）なら、手を加えていない行だけ取り除く。
            // 元のセルが無い（保持期間を過ぎて自動削除された等）ときは残す
            if (!isset($want[$k]) && isset($exists[$k]) && !(int)$r['edited']) Db::exec('DELETE FROM karte WHERE id = ?', [$r['id']]);
        }
        $today = Time::nowJst()['date'];
        foreach ($want as $k => $w) {
            if (isset($have[$k])) continue;
            $newId = Db::newId();
            // きっかけ：紹介元（業者）の QR から → 業者紹介（内訳＝業者名）、媒体の URL から → 媒体に決めたきっかけ（内訳＝媒体名）、紹介カードの QR から → ギフトカード
            $added = Db::exec('INSERT IGNORE INTO karte (id, storeId, date, srcTime, srcBed, auto, kind, name, trig, trigDetail, symptomCat, staff, visits) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)', [
                $newId, $store['id'], $w['date'], $w['time'], $w['bed'], $w['kind'], mb_substr($w['name'], 0, 40),
                $w['ref'] !== '' && $w['refTrig'] !== '' ? $w['refTrig'] : ($w['card'] ? 'ギフトカード' : ''), $w['ref'] !== '' && $w['refTrig'] !== '' ? mb_substr($w['ref'], 0, 60) : '', $w['kind'] === 'ACCIDENT' ? '自賠' : '', mb_substr($w['staff'], 0, 30), self::emptyVisits(),
            ]);
            // 新自が来院（来院チェック）したら、エリアMG・本部が決めた人へメールで知らせる。昔の日のチェックでは送らない
            if ($added > 0 && $w['kind'] === 'ACCIDENT' && $w['date'] >= Time::addDays($today, -1)) self::notifyAccident($store, $newId);
        }
    }

    /** 新自（交通事故）の行で、事故日・事故内容のどちらかが空の数（前の月も含めてすべて） */
    public static function accidentMissing(string $storeId): int
    {
        return (int)(Db::one("SELECT COUNT(*) AS n FROM karte WHERE storeId = ? AND kind = 'ACCIDENT' AND (accidentDate IS NULL OR accidentNote = '')", [$storeId])['n'] ?? 0);
    }

    /** 店舗の入っているエリアの名前 */
    public static function areasOf(array $store): array
    {
        $areas = [];
        foreach (Db::all('SELECT name, storeCodes FROM area') as $a) if (in_array($store['code'], explode(',', (string)$a['storeCodes']), true)) $areas[] = $a['name'];
        return $areas;
    }

    /** 新自の通知のメールの送り先：全店の分（エリア空）と、その店舗のエリアの分 */
    public static function notifyRecipients(array $store): array
    {
        $areas = self::areasOf($store);
        $out = [];
        foreach (Db::all('SELECT area, email FROM jibai_notify ORDER BY sortOrder ASC') as $r) if ($r['area'] === '' || in_array($r['area'], $areas, true)) $out[] = $r['email'];
        return $out;
    }

    /** 新自が来院したことをメール・LINE で知らせる（患者様の氏名は書かない）。一度送った行は送らない */
    public static function notifyAccident(array $store, string $karteId): void
    {
        try {
            $r = Db::one('SELECT date, srcTime, staff, trig, notifiedAt FROM karte WHERE id = ?', [$karteId]);
            if (!$r || $r['notifiedAt'] !== null) return;
            $to = self::notifyRecipients($store);
            $lines = Line::targetsFor(self::areasOf($store));
            Db::exec('UPDATE karte SET notifiedAt = NOW() WHERE id = ?', [$karteId]);
            if (!$to && !$lines) return;
            // 来院チェックを外して付け直すと行が作り直されるので、同じ予約（日・時刻・ベッド）は 3 日のあいだ 1 回だけ送る
            $src = Db::one('SELECT srcTime, srcBed FROM karte WHERE id = ?', [$karteId]);
            if (!RateLimit::allow('accnotify:' . $store['id'] . ':' . $r['date'] . ':' . ($src['srcTime'] ?? '') . ':' . ($src['srcBed'] ?? ''), 1, 3 * 86400)) return;
            $wd = ['日', '月', '火', '水', '木', '金', '土'][(int)date('w', strtotime($r['date'] . ' 12:00:00'))];
            $md = (int)substr($r['date'], 5, 2) . '/' . (int)substr($r['date'], 8, 2);
            $time = $r['srcTime'] !== null ? ' ' . Time::minToHm((int)$r['srcTime']) : '';
            $url = rtrim(Config::str('APP_URL'), '/');
            $body = "交通事故（新自）の患者様が来院しました。\n\n"
                . "店舗：{$store['name']}\n"
                . "初診日：{$md}（{$wd}）{$time}\n"
                . ($r['staff'] !== '' ? "担当：{$r['staff']}\n" : '')
                . ($r['trig'] !== '' ? "きっかけ：{$r['trig']}\n" : '')
                . "\n事故日・事故内容は、店舗の「新患継続率」の下の「新自（交通事故）」で入れてください。\n"
                . ($url !== '' ? "{$url}/admin/karte\n" : '')
                . "\n※このメールは送信専用です。";
            if ($to) Mail::send($to, "【新自】{$store['name']} {$md} 交通事故の初診がありました", $body);
            if ($lines) {
                $text = "【新自】{$store['name']}\n{$md}（{$wd}）{$time} 交通事故の初診がありました。"
                    . ($r['staff'] !== '' ? "\n担当：{$r['staff']}" : '') . ($r['trig'] !== '' ? "\nきっかけ：{$r['trig']}" : '')
                    . "\n事故日・事故内容は新患継続率の下で入れてください。" . ($url !== '' ? "\n{$url}/admin/karte" : '');
                foreach ($lines as $t) Line::push($t, $text);
            }
        } catch (Throwable $e) {
            error_log('[notifyAccident] ' . $e->getMessage());
        }
    }

    /** メニューの「2回目」〜「6回目」から回数を返す（初回カルテ集計の到達に数えるのは 2〜6 回目まで） */
    public static function visitNo(array $menus): ?int
    {
        foreach ($menus as $m) {
            if (preg_match('/^(\d+)回目$/u', trim((string)$m), $mm)) {
                $n = (int)$mm[1];
                if ($n >= 2 && $n <= 1 + self::VISITS) return $n;
            }
        }
        return null;
    }

    /** 回数のメニュー（2回目・3回目・12回目 など）が付いているか */
    public static function hasCountMenu(array $menus): bool
    {
        foreach ($menus as $m) if (preg_match('/^\d+回目$/u', trim((string)$m))) return true;
        return false;
    }

    /**
     * その患者様の初回（初診・再来）の行。同じ店舗で名前が同じ、その日より前の初回のうち一番新しいもの。
     * 半年以内に別の担当の同じ名前の初回があるとき（同姓同名の可能性）は ambiguous
     * @return array{row: ?array, ambiguous: bool}
     */
    public static function firstVisitOf(array $store, string $text, string $date): array
    {
        $name = self::nameOfText($text);
        if ($name === '') return ['row' => null, 'ambiguous' => false];
        $rows = Db::all('SELECT id, date, staff, visits, edited FROM karte WHERE storeId = ? AND name = ? AND date < ? ORDER BY date DESC LIMIT 5', [$store['id'], $name, $date]);
        if (!$rows) return ['row' => null, 'ambiguous' => false];
        $amb = false;
        foreach (array_slice($rows, 1) as $r) {
            if ($r['date'] >= Time::addDays($rows[0]['date'], -183) && $r['staff'] !== '' && $rows[0]['staff'] !== '' && $r['staff'] !== $rows[0]['staff']) $amb = true;
        }
        return ['row' => $rows[0], 'ambiguous' => $amb];
    }

    /**
     * 予約表のセルの内容を初回カルテ集計に反映する。
     * - 初診・再来のセル：来院チェック済みなら行を作り、担当を「担当」に入れる（手で直した行は、担当が空のときだけ入れる）
     * - 2〜6回目のセル：来院チェック済みなら、その患者様の初回の行の「n回目」に日付と担当を入れる（空のときだけ。チェックを外したら消す）
     */
    public static function reflectCell(array $store, string $date, int $time, int $bed): void
    {
        $c = Db::one('SELECT text, visited, menus, staff FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$store['id'], $date, $time, $bed]);
        if (!$c) return;
        $text = (string)$c['text'];
        $staff = (string)$c['staff'];
        if (self::kindOfText($text)) {
            self::sync($store, substr($date, 0, 7));
            if ($staff !== '') Db::exec("UPDATE karte SET staff = ? WHERE storeId = ? AND date = ? AND srcTime = ? AND srcBed = ? AND (edited = 0 OR staff = '')", [$staff, $store['id'], $date, $time, $bed]);
            return;
        }
        $n = self::visitNo(DayData::menusOf((string)$c['menus']));
        if ($n === null) return;
        $fv = self::firstVisitOf($store, $text, $date);
        if (!$fv['row'] || $fv['ambiguous']) return;
        $v = json_decode((string)$fv['row']['visits'], true);
        if (!is_array($v)) $v = [];
        for ($i = 0; $i < self::VISITS; $i++) $v[$i] = ['d' => (string)($v[$i]['d'] ?? ''), 's' => (string)($v[$i]['s'] ?? ''), 't' => (string)($v[$i]['t'] ?? '')];
        $i = $n - 2;
        $changed = false;
        if ((int)$c['visited']) {
            if ($v[$i]['d'] === '') { $v[$i]['d'] = $date; $changed = true; }
            if ($v[$i]['d'] === $date && $staff !== '' && $v[$i]['s'] !== $staff) { $v[$i]['s'] = $staff; $changed = true; }
        } elseif ($v[$i]['d'] === $date) {
            $v[$i]['d'] = ''; $changed = true;
        }
        if ($changed) Db::exec('UPDATE karte SET visits = ? WHERE id = ?', [json_encode($v, JSON_UNESCAPED_UNICODE), $fv['row']['id']]);
    }

    public static function emptyVisits(): string
    {
        return json_encode(array_fill(0, self::VISITS, ['d' => '', 's' => '', 't' => '']), JSON_UNESCAPED_UNICODE);
    }

    public static function rowOut(array $r): array
    {
        $v = json_decode((string)$r['visits'], true);
        if (!is_array($v)) $v = [];
        $visits = [];
        for ($i = 0; $i < self::VISITS; $i++) $visits[] = ['d' => (string)($v[$i]['d'] ?? ''), 's' => (string)($v[$i]['s'] ?? ''), 't' => (string)($v[$i]['t'] ?? '')];
        return [
            'id' => $r['id'], 'date' => $r['date'], 'auto' => (bool)$r['auto'], 'karteNo' => $r['karteNo'], 'kind' => $r['kind'],
            'trig' => $r['trig'], 'trigDetail' => $r['trigDetail'], 'name' => $r['name'], 'nameOk' => (bool)($r['nameOk'] ?? 0), 'age' => $r['age'] === null ? null : (int)$r['age'], 'sex' => $r['sex'],
            'symptomCat' => $r['symptomCat'], 'symptom' => $r['symptom'], 'staff' => $r['staff'], 'treatment' => $r['treatment'], 'visits' => $visits,
            'stopped' => (bool)($r['stopped'] ?? 0), 'transferred' => (bool)($r['transferred'] ?? 0), 'survey' => (bool)($r['survey'] ?? 0),
            'accidentDate' => $r['accidentDate'] ?? null, 'accidentNote' => (string)($r['accidentNote'] ?? ''),
        ];
    }

    /** 入力値を検証して、DB に書く値に直す */
    public static function cleanPatch(array $patch): array
    {
        $set = [];
        foreach ($patch as $k => $v) {
            if (!in_array($k, self::EDITABLE, true)) throw new HttpError(400, 'bad request');
            switch ($k) {
                case 'date':
                    if (!Time::isValidDate((string)$v)) throw new HttpError(400, '日付が正しくありません');
                    $set[$k] = (string)$v; break;
                case 'kind':
                    if (!in_array($v, self::KINDS, true)) throw new HttpError(400, 'bad request');
                    $set[$k] = $v; break;
                case 'accidentDate':
                    if ($v === null || $v === '') { $set[$k] = null; break; }
                    if (!Time::isValidDate((string)$v)) throw new HttpError(400, '日付が正しくありません');
                    $set[$k] = (string)$v; break;
                case 'nameOk':
                case 'stopped':
                case 'transferred':
                case 'survey':
                    $set[$k] = $v ? 1 : 0; break;
                case 'age':
                    if ($v === null || $v === '') { $set[$k] = null; break; }
                    if (!preg_match('/^\d{1,3}$/', (string)$v) || (int)$v > 120) throw new HttpError(400, '年齢が正しくありません');
                    $set[$k] = (int)$v; break;
                case 'sex':
                    if (!in_array($v, ['', '♂', '♀'], true)) throw new HttpError(400, 'bad request');
                    $set[$k] = $v; break;
                case 'treatment':
                    if ($v !== '' && !in_array($v, self::TREATMENTS, true)) throw new HttpError(400, 'bad request');
                    $set[$k] = $v; break;
                case 'visits':
                    if (!is_array($v) || count($v) !== self::VISITS) throw new HttpError(400, 'bad request');
                    $out = [];
                    foreach ($v as $x) {
                        $d = (string)($x['d'] ?? '');
                        if ($d !== '' && !Time::isValidDate($d)) throw new HttpError(400, '日付が正しくありません');
                        $t = (string)($x['t'] ?? '');
                        if ($t !== '' && !in_array($t, self::TREATMENTS, true)) throw new HttpError(400, 'bad request');
                        $out[] = ['d' => $d, 's' => mb_substr(trim((string)($x['s'] ?? '')), 0, 30), 't' => $t];
                    }
                    $set[$k] = json_encode($out, JSON_UNESCAPED_UNICODE); break;
                default:
                    $max = ['accidentNote' => 200, 'karteNo' => 20, 'trig' => 30, 'trigDetail' => 60, 'name' => 40, 'symptomCat' => 20, 'symptom' => 100, 'staff' => 30][$k];
                    $set[$k] = mb_substr(trim((string)$v), 0, $max);
            }
        }
        // 氏名を直したら、確認済みの印は外す（直した氏名をもう一度見る）
        if (isset($set['name']) && !array_key_exists('nameOk', $set)) $set['nameOk'] = 0;
        return $set;
    }
}
