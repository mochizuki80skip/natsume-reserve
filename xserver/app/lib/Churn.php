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
            $k = Karte::personKey($name);
            $no = self::cardKey($no);
            if ($k === '' || $no === '') return;
            $byName[$k][$no] = true;
        };
        foreach (Db::all('SELECT name, cardNo FROM patient_card WHERE storeId = ?', [$storeId]) as $r) $add((string)$r['name'], (string)$r['cardNo']);
        $out = [];
        foreach ($byName as $k => $nos) if (count($nos) === 1) $out[$k] = (string)array_key_first($nos);
        // 新患継続率のカルテNo は患者一覧より優先
        foreach (Db::all("SELECT name, karteNo FROM karte WHERE storeId = ? AND karteNo <> '' AND name <> ''", [$storeId]) as $r) {
            $k = Karte::personKey((string)$r['name']);
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
            // 氏名のあとの「様」「様6」（回数）や、前に書いたカルテNo（「1600 山田」）は外して同じ人と見る
            $name = Karte::nameOfText($text);
            $nk = Karte::personKey($text);
            if ($nk === '') return;
            $card = self::cardKey($card) ?: self::cardKey(Karte::leadingCardNo($text)) ?: ($map[$nk] ?? '');
            $rows[] = ['date' => $date, 'name' => $name, 'key' => $card !== '' ? $card : 'n:' . $nk, 'card' => $card, 'staff' => $staff, 'nk' => $nk];
        };
        foreach (Db::all('SELECT c.date, c.text, c.staff, r.cardNo FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId WHERE c.storeId = ? AND c.date BETWEEN ? AND ? AND c.bed > 0 AND c.visited = 1', [$sid, $from, $to]) as $c) {
            $push($c['date'], (string)$c['text'], (string)($c['staff'] ?? ''), (string)($c['cardNo'] ?? ''));
        }
        foreach (Db::all('SELECT date, name, staff, cardNo FROM visit_archive WHERE storeId = ? AND date BETWEEN ? AND ?', [$sid, $from, $to]) as $v) {
            $push($v['date'], (string)$v['name'], (string)$v['staff'], (string)$v['cardNo']);
        }
        // 番号と氏名をつなぐ：番号のある来院で「この氏名＝この番号」が 1 つに決まる氏名は、氏名だけの来院も同じ番号の人にまとめる
        $cardsOf = [];
        foreach ($rows as $r) if ($r['card'] !== '') $cardsOf[$r['nk']][$r['card']] = true;
        foreach ($rows as &$r) {
            if ($r['card'] === '' && isset($cardsOf[$r['nk']]) && count($cardsOf[$r['nk']]) === 1) { $r['card'] = (string)array_key_first($cardsOf[$r['nk']]); $r['key'] = $r['card']; }
        }
        unset($r);
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
            $nk = Karte::personKey($text);
            if ($nk === '') continue;
            $card = self::cardKey((string)($c['cardNo'] ?? '')) ?: self::cardKey(Karte::leadingCardNo($text)) ?: ($map[$nk] ?? '');
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
            $nk = Karte::personKey((string)$k['name']);
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
        $want = self::wanted($store, $ym);
        self::save($store, $first, $last, $want);
    }

    /** その月に離反した方（自動で出す行）を計算する（保存はしない）。キーは「患者|最後の来院日」 */
    public static function wanted(array $store, string $ym): array
    {
        $dates = Time::datesOfMonth($ym);
        $first = $dates[0];
        $last = end($dates);
        $today = Time::nowJst()['date'];
        // 最後の来院が [月初の 1 か月前, 月末の 1 か月前] にある方。間にほかの来院がないか見るため、月末までの来院を読む
        $visits = self::visits($store, Time::addDays($first, -40), min($last, $today));
        $byKey = [];
        $datesOf = []; // 同じ人の来院日（カルテNo でも氏名でも。番号のある来院と氏名だけの来院が分かれても、あとの来院を見落とさないように）
        foreach ($visits as $v) { $byKey[$v['key']][] = $v; $datesOf[$v['key']][$v['date']] = true; $datesOf['n:' . $v['nk']][$v['date']] = true; }
        $karte = self::karteOf($store['id']);
        $want = [];
        $cands = [];
        $seen = [];
        uksort($byKey, fn($a, $b) => (str_starts_with((string)$a, 'n:') <=> str_starts_with((string)$b, 'n:')) ?: strcmp((string)$a, (string)$b));
        foreach ($byKey as $key => $vs) {
            foreach ($vs as $v) {
                $cd = self::churnDate($v['date']);
                if ($cd < $first || $cd > $last || $cd > $today) continue;
                // 最後の来院から離反の日の前日までに、同じ人の来院があれば離反ではない（離反の日の当日の来院は離反。集計API の説明と同じ）
                $later = false;
                foreach (array_unique([$key, 'n:' . $v['nk']]) as $kk) foreach (array_keys($datesOf[$kk] ?? []) as $d) if ($d > $v['date'] && $d < $cd) { $later = true; break 2; }
                if ($later) continue;
                // 同じ人・同じ日の来院は 1 行に（番号のある方を先に）
                $sk = $v['nk'] . '|' . $v['date'];
                if (isset($seen[$sk])) continue;
                $seen[$sk] = true;
                $k = $karte[$key] ?? $karte['n:' . $v['nk']] ?? null;
                $cands[] = [$key, $v, $cd, $k];
            }
        }
        // 初回から最後の来院までの来院回数（システムに入っている分）。来院の記録は 1 回だけまとめて読む（患者様ごとに読むと遅いため）
        $hist = [];
        $ks = array_filter($cands, fn($c) => $c[3] !== null);
        if ($ks) {
            $from = min(array_map(fn($c) => (string)$c[3]['date'], $ks));
            $to = max(array_map(fn($c) => $c[1]['date'], $ks));
            foreach (self::visits($store, $from, $to) as $x) $hist[$x['key']][$x['date']] = true;
        }
        foreach ($cands as [$key, $v, $cd, $k]) {
            $count = '';
            if ($k) {
                // カルテNo（数字だけ）の患者様も数える（配列のキーが数値になっても同じ患者様として引けるようにする）
                $n = count(array_filter(array_keys($hist[(string)$key] ?? []), fn($d) => $d >= $k['date'] && $d <= $v['date']));
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
        return $want;
    }

    private static function save(array $store, string $first, string $last, array $want): void
    {
        $have = [];
        foreach (Db::all("SELECT id, patientKey, lastVisit, edited, manage, cardNo, name FROM churn WHERE storeId = ? AND churnDate BETWEEN ? AND ? AND source = 'auto'", [$store['id'], $first, $last]) as $r) {
            $id = $r['patientKey'] . '|' . $r['lastVisit'];
            // 手で直した行で、人の見分け方が変わった（「様6」を外した・番号と氏名をまとめた）ものは、同じ人・同じ最後の来院の新しい見分け方に付け替える（2 行にしない）
            if (!isset($want[$id]) && (int)$r['edited']) {
                $ck = self::cardKey((string)$r['cardNo']); $nk = Karte::personKey((string)$r['name']);
                foreach ($want as $wid => $w) {
                    if ($w['lastVisit'] !== $r['lastVisit'] || isset($have[$wid])) continue;
                    if (($ck !== '' && $ck === self::cardKey($w['cardNo'])) || ($nk !== '' && $nk === Karte::personKey($w['name']))) {
                        if (!Db::one("SELECT id FROM churn WHERE storeId = ? AND source = 'auto' AND patientKey = ? AND lastVisit = ? AND id <> ?", [$store['id'], $w['patientKey'], $w['lastVisit'], $r['id']])) {
                            Db::exec('UPDATE churn SET patientKey = ? WHERE id = ?', [$w['patientKey'], $r['id']]);
                            $id = $wid;
                        }
                        break;
                    }
                }
            }
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
            $imported[$r['churnDate'] . '|' . (self::cardKey($r['cardNo']) ?: 'n:' . Karte::personKey((string)$r['name']))] = true;
        }
        foreach ($want as $id => $w) {
            if (isset($have[$id]) || isset($imported[$w['churnDate'] . '|' . $w['patientKey']])) continue;
            Db::exec('INSERT INTO churn (id, storeId, churnDate, patientKey, lastVisit, cardNo, name, sex, age, kind, visits, staff, symptom, treatment, manage, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [Db::newId(), $store['id'], $w['churnDate'], $w['patientKey'], $w['lastVisit'], $w['cardNo'], $w['name'], $w['sex'], $w['age'], $w['kind'], $w['visits'], $w['staff'], $w['symptom'], $w['treatment'], $w['manage'], 'auto']);
        }
    }

    /**
     * 離反者リストの画面を開いたときと同じ行（sync したあとの行）を、保存せずに出す（集計API 用）。
     * 返すのは数えるのに使う kind・manage だけ（氏名などは返さない）
     * @return array<int, array{kind:string, manage:string}>
     */
    public static function rowsView(array $store, string $ym): array
    {
        $dates = Time::datesOfMonth($ym);
        $first = $dates[0];
        $last = end($dates);
        $want = self::wanted($store, $ym);
        $out = [];
        $have = [];
        foreach (Db::all('SELECT patientKey, lastVisit, edited, manage, kind, source, churnDate, cardNo, name, dismissed FROM churn WHERE storeId = ? AND churnDate BETWEEN ? AND ?', [$store['id'], $first, $last]) as $r) {
            if ((int)$r['dismissed']) { $have[$r['patientKey'] . '|' . $r['lastVisit']] = true; continue; }
            if ($r['source'] !== 'auto') { $out[] = ['kind' => (string)$r['kind'], 'manage' => (string)$r['manage']]; continue; }
            $id = $r['patientKey'] . '|' . $r['lastVisit'];
            $have[$id] = true;
            if (!isset($want[$id])) { if ((int)$r['edited']) $out[] = ['kind' => (string)$r['kind'], 'manage' => (string)$r['manage']]; continue; }
            if ((int)$r['edited']) { $out[] = ['kind' => (string)$r['kind'], 'manage' => (string)$r['manage']]; continue; }
            $w = $want[$id];
            $out[] = ['kind' => $w['kind'], 'manage' => (string)$r['manage'] !== '' ? (string)$r['manage'] : $w['manage']];
        }
        $imported = [];
        foreach (Db::all("SELECT churnDate, cardNo, name FROM churn WHERE storeId = ? AND churnDate BETWEEN ? AND ? AND source IN ('import', 'manual')", [$store['id'], $first, $last]) as $r) {
            $imported[$r['churnDate'] . '|' . (self::cardKey($r['cardNo']) ?: 'n:' . Karte::personKey((string)$r['name']))] = true;
        }
        foreach ($want as $id => $w) {
            if (isset($have[$id]) || isset($imported[$w['churnDate'] . '|' . $w['patientKey']])) continue;
            $out[] = ['kind' => $w['kind'], 'manage' => $w['manage']];
        }
        return $out;
    }

    /**
     * リストの行ごとに、最後の来院のあとの様子：来院（来院チェックあり）・来院チェックのない予約表の名前（過去の日）・これからの予約。
     * 「まだ通院している方が載っている」を画面で見分けるため。キーは行の id
     * @return array<string, array{seenAfter:?string, uncheckedAfter:?string, nextBooking:?string}>
     */
    public static function afterOf(array $store, array $rows): array
    {
        if (!$rows) return [];
        $today = Time::nowJst()['date'];
        $from = $today;
        foreach ($rows as $r) $from = min($from, $r['lastVisit'] ?: Time::addMonths($r['churnDate'], -1));
        $map = self::cardMap($store['id']);
        $byPerson = [];
        foreach (Db::all('SELECT c.date, c.text, c.visited, r.cardNo FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId WHERE c.storeId = ? AND c.date > ? AND c.bed > 0', [$store['id'], $from]) as $c) {
            $text = (string)$c['text'];
            if (Text::isContinuationText($text) || Availability::isBlockMark($text)) continue;
            $nk = Karte::personKey($text);
            if ($nk === '') continue;
            $card = self::cardKey((string)($c['cardNo'] ?? '')) ?: self::cardKey(Karte::leadingCardNo($text)) ?: ($map[$nk] ?? '');
            $t = $c['date'] > $today ? 'book' : ((int)$c['visited'] ? 'seen' : 'unchecked');
            foreach (array_unique(array_filter([$card, 'n:' . $nk])) as $k) $byPerson[$k][] = [$c['date'], $t];
        }
        foreach (Db::all('SELECT date, name, cardNo FROM visit_archive WHERE storeId = ? AND date > ?', [$store['id'], $from]) as $v) {
            $nk = Karte::personKey((string)$v['name']);
            $card = self::cardKey((string)$v['cardNo']) ?: ($map[$nk] ?? '');
            foreach (array_unique(array_filter([$card, $nk !== '' ? 'n:' . $nk : ''])) as $k) $byPerson[$k][] = [$v['date'], 'seen'];
        }
        $out = [];
        foreach ($rows as $r) {
            $base = $r['lastVisit'] ?: Time::addMonths($r['churnDate'], -1);
            $keys = array_unique(array_filter([self::cardKey((string)$r['cardNo']), str_starts_with((string)$r['patientKey'], 'n:') || $r['patientKey'] === '' ? '' : (string)$r['patientKey'], Karte::personKey((string)$r['name']) !== '' ? 'n:' . Karte::personKey((string)$r['name']) : '']));
            $o = ['seenAfter' => null, 'uncheckedAfter' => null, 'nextBooking' => null];
            foreach ($keys as $k) foreach ($byPerson[$k] ?? [] as [$d, $t]) {
                if ($d <= $base) continue;
                if ($t === 'seen') $o['seenAfter'] = max($o['seenAfter'] ?? '', $d);
                elseif ($t === 'unchecked') $o['uncheckedAfter'] = max($o['uncheckedAfter'] ?? '', $d);
                elseif ($o['nextBooking'] === null || $d < $o['nextBooking']) $o['nextBooking'] = $d;
            }
            $out[$r['id']] = $o;
        }
        return $out;
    }

    /**
     * 患者様を調べる：氏名（一部でも）かカルテNo で、システムが見ている来院（予約表の名前・来院チェックの有無）と、離反の見え方を返す
     */
    public static function lookup(array $store, string $q): array
    {
        $q = trim($q);
        $today = Time::nowJst()['date'];
        $from = Time::addDays($today, -150);
        $digits = self::cardKey(preg_match('/^[\d０-９]+$/u', $q) ? mb_convert_kana($q, 'n') : '');
        $qk = Karte::personKey($q);
        if ($digits === '' && mb_strlen($qk) < 2) return ['error' => '氏名は 2 文字以上、またはカルテNo を入れてください'];
        $map = self::cardMap($store['id']);
        $hits = [];
        $add = function (string $date, string $text, ?int $visited, string $card, string $src) use (&$hits, $map, $digits, $qk) {
            if (Text::isContinuationText($text) || Availability::isBlockMark($text)) return;
            $nk = Karte::personKey($text);
            if ($nk === '') return;
            $ck = self::cardKey($card) ?: self::cardKey(Karte::leadingCardNo($text)) ?: ($map[$nk] ?? '');
            if ($digits !== '' ? $ck !== $digits : !str_contains($nk, $qk)) return;
            $hits[] = ['date' => $date, 'text' => mb_substr($text, 0, 40), 'visited' => $visited, 'cardNo' => $ck, 'src' => $src];
        };
        foreach (Db::all('SELECT c.date, c.text, c.visited, r.cardNo FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId WHERE c.storeId = ? AND c.date >= ? AND c.bed > 0', [$store['id'], $from]) as $c) {
            $add($c['date'], (string)$c['text'], (int)$c['visited'], (string)($c['cardNo'] ?? ''), $c['date'] > $today ? 'book' : 'cell');
        }
        foreach (Db::all('SELECT date, name, cardNo FROM visit_archive WHERE storeId = ? AND date >= ?', [$store['id'], $from]) as $v) $add($v['date'], (string)$v['name'], 1, (string)$v['cardNo'], 'archive');
        usort($hits, fn($a, $b) => strcmp($b['date'], $a['date']));
        $hits = array_slice($hits, 0, 80);
        // 離反の見え方（来院チェックのある最後の来院から）
        $lastSeen = null;
        foreach ($hits as $h) if ($h['src'] !== 'book' && $h['visited']) { $lastSeen = $h['date']; break; }
        $listed = $lastSeen ? Db::all('SELECT churnDate, name, dismissed FROM churn WHERE storeId = ? AND lastVisit = ? ', [$store['id'], $lastSeen]) : [];
        return ['rows' => $hits, 'lastSeen' => $lastSeen, 'churnDate' => $lastSeen ? self::churnDate($lastSeen) : null, 'today' => $today,
            'onList' => (bool)array_filter($listed, fn($l) => !(int)$l['dismissed'] && ($digits !== '' || str_contains(Karte::personKey((string)$l['name']), $qk)))];
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
                $nk = 'n:' . $v['nk'];
                $later = array_filter(array_merge($bookings[$v['key']] ?? [], $v['key'] !== $nk ? ($bookings[$nk] ?? []) : []), fn($b) => $b['date'] > $target);
                if ($later) continue; // 次の来院・予約がある
                Db::exec('INSERT IGNORE INTO follow (id, storeId, listDate, patientKey, lastVisit, cardNo, name, staff) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [Db::newId(), $sid, $d, $v['key'], $target, $v['card'], mb_substr($v['name'], 0, 40), mb_substr($v['staff'], 0, 30)]);
            }
        }
    }
}
