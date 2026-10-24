<?php
// 離反者リスト・2 週間フォローリスト：来院の記録（予約表の来院チェック＋消す前に残した記録）から、患者様ごとに最後の来院・離反を出す
// 患者様はカルテNo で見分ける（WEB 予約の診察券番号 → 新患継続率のカルテNo → 患者一覧（CSV）の順に氏名から探す）。見つからない方は氏名で
declare(strict_types=1);

final class Churn
{
    public const MANAGE = ['治癒', '中止', '転院'];
    /** 離反率の「除く」パターンで外す管理 */
    public const EXCLUDE = ['中止', '転院'];

    /** カルテNo をそろえる（数字だけ・頭の 0 を取る） */
    public static function cardKey(?string $v): string
    {
        $d = preg_replace('/\D/', '', (string)$v) ?? '';
        if ($d === '') return '';
        $d = ltrim($d, '0');
        return $d === '' ? '0' : substr($d, 0, 12);
    }

    /** 最後の来院から離反が確定する日（翌月の同じ日。ない日は月末） */
    public static function churnDate(string $last): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', $last));
        $m++;
        if ($m > 12) { $m = 1; $y++; }
        $dim = (int)date('t', mktime(0, 0, 0, $m, 1, $y));
        return sprintf('%04d-%02d-%02d', $y, $m, min($d, $dim));
    }

    /** 氏名 → カルテNo（氏名が 1 人だけに当たるものだけ） */
    private static function cardMap(string $storeId): array
    {
        $byName = [];
        $add = function (string $name, string $no) use (&$byName) {
            $k = Text::normalizeName($name);
            $no = self::cardKey($no);
            if ($k === '' || $no === '') return;
            $byName[$k][$no] = true;
        };
        foreach (Db::all('SELECT name, cardNo FROM patient_card WHERE storeId = ?', [$storeId]) as $r) $add((string)$r['name'], (string)$r['cardNo']);
        $out = [];
        foreach ($byName as $k => $nos) if (count($nos) === 1) $out[$k] = (string)array_key_first($nos);
        // 新患継続率のカルテNo は患者一覧より優先
        foreach (Db::all("SELECT name, karteNo FROM karte WHERE storeId = ? AND karteNo <> '' AND name <> ''", [$storeId]) as $r) {
            $k = Text::normalizeName((string)$r['name']);
            $no = self::cardKey((string)$r['karteNo']);
            if ($k !== '' && $no !== '') $out[$k] = $no;
        }
        return $out;
    }

    /**
     * 期間の来院（来院チェック済み）。予約表のセル＋消す前に残した記録。
     * @return array<int, array{date:string, name:string, key:string, card:string, staff:string}>
     */
    public static function visits(array $store, string $from, string $to): array
    {
        $sid = $store['id'];
        $map = self::cardMap($sid);
        $rows = [];
        $push = function (string $date, string $text, string $staff, string $card) use (&$rows, $map) {
            if (Text::isContinuationText($text) || Availability::isBlockMark($text)) return;
            $name = Karte::nameOfText($text);
            $nk = Text::normalizeName($name);
            if ($nk === '') return;
            $card = self::cardKey($card) ?: ($map[$nk] ?? '');
            $rows[] = ['date' => $date, 'name' => $name, 'key' => $card !== '' ? $card : 'n:' . $nk, 'card' => $card, 'staff' => $staff];
        };
        foreach (Db::all('SELECT c.date, c.text, c.staff, r.cardNo FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId WHERE c.storeId = ? AND c.date BETWEEN ? AND ? AND c.bed > 0 AND c.visited = 1', [$sid, $from, $to]) as $c) {
            $push($c['date'], (string)$c['text'], (string)($c['staff'] ?? ''), (string)($c['cardNo'] ?? ''));
        }
        foreach (Db::all('SELECT date, name, staff, cardNo FROM visit_archive WHERE storeId = ? AND date BETWEEN ? AND ?', [$sid, $from, $to]) as $v) {
            $push($v['date'], (string)$v['name'], (string)$v['staff'], (string)$v['cardNo']);
        }
        usort($rows, fn($a, $b) => strcmp($a['date'], $b['date']));
        return $rows;
    }

    /** 予約表に入っている予約（来院していないものも）を患者様ごとに：その日より後の最初の予約 */
    public static function bookingsAfter(array $store, string $from): array
    {
        $map = self::cardMap($store['id']);
        $out = [];
        foreach (Db::all('SELECT c.date, c.time, c.text, r.cardNo FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId WHERE c.storeId = ? AND c.date > ? AND c.bed > 0 ORDER BY c.date ASC, c.time ASC', [$store['id'], $from]) as $c) {
            $text = (string)$c['text'];
            if (Text::isContinuationText($text) || Availability::isBlockMark($text)) continue;
            $nk = Text::normalizeName(Karte::nameOfText($text));
            if ($nk === '') continue;
            $card = self::cardKey((string)($c['cardNo'] ?? '')) ?: ($map[$nk] ?? '');
            foreach (array_unique([$card !== '' ? $card : 'n:' . $nk, 'n:' . $nk]) as $key) $out[$key][] = ['date' => $c['date'], 'time' => (int)$c['time']];
        }
        return $out;
    }

    /** 初回（新患継続率の行）：カルテNo か氏名で */
    private static function karteOf(string $storeId): array
    {
        $out = [];
        foreach (Db::all('SELECT * FROM karte WHERE storeId = ? ORDER BY date ASC', [$storeId]) as $k) {
            $no = self::cardKey((string)$k['karteNo']);
            $nk = Text::normalizeName((string)$k['name']);
            if ($no !== '') $out[$no] ??= $k;
            if ($nk !== '') $out['n:' . $nk] ??= $k;
        }
        return $out;
    }

    /** その月に離反した方（自動の行）を作り直す。手で直した行・取り込んだ行はそのまま */
    public static function sync(array $store, string $ym): void
    {
        $dates = Time::datesOfMonth($ym);
        $first = $dates[0];
        $last = end($dates);
        $today = Time::nowJst()['date'];
        // 最後の来院が [月初の 1 か月前, 月末の 1 か月前] にある方。間にほかの来院がないか見るため、月末までの来院を読む
        $visits = self::visits($store, Time::addDays($first, -40), min($last, $today));
        $byKey = [];
        foreach ($visits as $v) $byKey[$v['key']][] = $v;
        $karte = self::karteOf($store['id']);
        $want = [];
        foreach ($byKey as $key => $vs) {
            for ($i = 0; $i < count($vs); $i++) {
                $v = $vs[$i];
                $cd = self::churnDate($v['date']);
                if ($cd < $first || $cd > $last || $cd > $today) continue;
                $next = $vs[$i + 1]['date'] ?? null;
                if ($next !== null && $next < $cd) continue; // 離反の前に来院している
                if ($next !== null && $next === $v['date']) continue;
                $k = $karte[$key] ?? $karte['n:' . Text::normalizeName($v['name'])] ?? null;
                $count = '';
                if ($k) {
                    // 初回から最後の来院までの来院回数（システムに入っている分）
                    $n = count(array_unique(array_column(array_filter(self::visits($store, $k['date'], $v['date']), fn($x) => $x['key'] === $key), 'date')));
                    $count = $n >= 13 ? '13〜' : ($n >= 7 ? '7〜12' : (string)max($n, 1));
                }
                $want[$key . '|' . $v['date']] = [
                    'patientKey' => $key, 'lastVisit' => $v['date'], 'churnDate' => $cd, 'cardNo' => $v['card'], 'name' => mb_substr($v['name'], 0, 40),
                    'sex' => $k['sex'] ?? '', 'age' => isset($k['age']) && $k['age'] !== null ? (int)$k['age'] : null,
                    'kind' => $k ? ($k['kind'] === 'REVISIT' ? '再来' : '新患') : '既存', 'visits' => $count, 'staff' => mb_substr($v['staff'], 0, 30),
                    'symptom' => $k ? mb_substr(trim(($k['symptomCat'] ?? '') . ($k['symptom'] !== '' && $k['symptom'] !== $k['symptomCat'] ? ' ' . $k['symptom'] : '')), 0, 100) : '',
                    'treatment' => $k['treatment'] ?? '',
                    'manage' => $k && (int)($k['stopped'] ?? 0) ? '中止' : ($k && (int)($k['transferred'] ?? 0) ? '転院' : ''),
                ];
            }
        }
        $have = [];
        foreach (Db::all("SELECT id, patientKey, lastVisit, edited, manage FROM churn WHERE storeId = ? AND churnDate BETWEEN ? AND ? AND source = 'auto'", [$store['id'], $first, $last]) as $r) {
            $id = $r['patientKey'] . '|' . $r['lastVisit'];
            $have[$id] = true;
            if (!isset($want[$id])) { if (!(int)$r['edited']) Db::exec('DELETE FROM churn WHERE id = ?', [$r['id']]); continue; }
            // 手で直していなければ、自動の欄を新しくする（管理は空のときだけ入れる）
            if (!(int)$r['edited']) {
                $w = $want[$id];
                Db::exec('UPDATE churn SET cardNo = ?, name = ?, sex = ?, age = ?, kind = ?, visits = ?, staff = ?, symptom = ?, treatment = ?, manage = IF(manage = \'\', ?, manage) WHERE id = ?',
                    [$w['cardNo'], $w['name'], $w['sex'], $w['age'], $w['kind'], $w['visits'], $w['staff'], $w['symptom'], $w['treatment'], $w['manage'], $r['id']]);
            }
        }
        // 取り込んだ行（スプレッドシート）と同じ日・同じ人なら作らない
        $imported = [];
        foreach (Db::all("SELECT churnDate, cardNo, name FROM churn WHERE storeId = ? AND churnDate BETWEEN ? AND ? AND source IN ('import', 'manual')", [$store['id'], $first, $last]) as $r) {
            $imported[$r['churnDate'] . '|' . (self::cardKey($r['cardNo']) ?: 'n:' . Text::normalizeName($r['name']))] = true;
        }
        foreach ($want as $id => $w) {
            if (isset($have[$id]) || isset($imported[$w['churnDate'] . '|' . $w['patientKey']])) continue;
            Db::exec('INSERT INTO churn (id, storeId, churnDate, patientKey, lastVisit, cardNo, name, sex, age, kind, visits, staff, symptom, treatment, manage, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [Db::newId(), $store['id'], $w['churnDate'], $w['patientKey'], $w['lastVisit'], $w['cardNo'], $w['name'], $w['sex'], $w['age'], $w['kind'], $w['visits'], $w['staff'], $w['symptom'], $w['treatment'], $w['manage'], 'auto']);
        }
    }

    /** 前月に来院した実人数（離反率の母数） */
    public static function activeCount(array $store, string $ym): int
    {
        $prev = substr(Time::addDays($ym . '-01', -1), 0, 7);
        $d = Time::datesOfMonth($prev);
        return count(array_unique(array_column(self::visits($store, $d[0], end($d)), 'key')));
    }

    /**
     * 2 週間フォロー：その日の 14 日前に来院し、そのあと来院・予約がない方を、その日のリストとして残す（毎日たまる）。
     * まだ作っていない日（最大 31 日前まで）をまとめて作る
     */
    public static function syncFollow(array $store, string $upTo): void
    {
        $sid = $store['id'];
        $lastMade = Db::one('SELECT MAX(listDate) AS d FROM follow WHERE storeId = ?', [$sid])['d'] ?? null;
        $start = $lastMade ? Time::addDays($lastMade, 1) : $upTo;
        if ($start < Time::addDays($upTo, -31)) $start = Time::addDays($upTo, -31);
        if ($start > $upTo) return;
        $visits = self::visits($store, Time::addDays($start, -14), $upTo);
        $bookings = self::bookingsAfter($store, Time::addDays($start, -15));
        for ($d = $start; $d <= $upTo; $d = Time::addDays($d, 1)) {
            $target = Time::addDays($d, -14);
            $seen = [];
            foreach ($visits as $v) {
                if ($v['date'] !== $target || isset($seen[$v['key']])) continue;
                $seen[$v['key']] = true;
                $nk = 'n:' . Text::normalizeName($v['name']);
                $later = array_filter(array_merge($bookings[$v['key']] ?? [], $v['key'] !== $nk ? ($bookings[$nk] ?? []) : []), fn($b) => $b['date'] > $target);
                if ($later) continue; // 次の来院・予約がある
                Db::exec('INSERT IGNORE INTO follow (id, storeId, listDate, patientKey, lastVisit, cardNo, name, staff) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [Db::newId(), $sid, $d, $v['key'], $target, $v['card'], mb_substr($v['name'], 0, 40), mb_substr($v['staff'], 0, 30)]);
            }
        }
    }
}
