<?php
// 新規・再来ブロックの提案：時間ごとに、新規（初回）・再来を担当できる施術者が全員ふさがっていたら、WEB で新規・再来を止める提案を出す。
// 院長が承認するとブロック（kind_block、auto=1）になり、予約が動いて当てはまらなくなったら自動で外れる。
//
// ふさがっている人：その時間に 2 人以上を担当している、または初診（新患・新自）を担当している。
// 担当がまだ付いていない初診・再来（2・3・6・12 回目を含む）は、空いている「担当できる人」に割り当てて数える。通院中など担当が付かない予約は数えない。
declare(strict_types=1);

final class BlockSuggest
{
    /** 提案を出す日数（今日から 14 日先まで） */
    public const DAYS = 14;

    /**
     * その日の、新規・再来を止めたほうがよい時間（顧客に見せる枠の時刻）
     * @return array{N: int[], R: int[]}
     */
    public static function needed(array $store, array $setting, string $date): array
    {
        $out = ['N' => [], 'R' => []];
        $sid = $store['id'];
        $members = array_values(array_filter(Db::all("SELECT id, name, startDate, endDate, leaveStart, leaveEnd, canFirst, canRevisit FROM staff_member WHERE storeId = ? AND role = 'THERAPIST' AND active = 1", [$sid]),
            fn($m) => Settings::inPeriod($m, $date) && !($m['leaveStart'] && $date >= $m['leaveStart'] && (!$m['leaveEnd'] || $date <= $m['leaveEnd']))));
        if (!array_filter($members, fn($m) => (int)$m['canFirst'] || (int)$m['canRevisit'])) return $out; // 担当のチェックを使っていない店舗
        $shift = [];
        foreach (Db::all('SELECT staffId, status FROM shift WHERE storeId = ? AND date = ?', [$sid, $date]) as $r) $shift[$r['staffId']] = $r['status'];
        $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$sid, $date]));
        $sessions = Settings::storeSessions($store, $setting, $date, Settings::closedOf($day));
        if (!$sessions) return $out;
        $slot = (int)$setting['slotMinutes'];
        // セル：時刻 → [{kind: new|rev, staff}]。2 枠目（上記初診対応など）は 1 枠目の人・種類のまま
        $cells = [];
        foreach (Db::all('SELECT time, bed, text, staff, menus FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$sid, $date]) as $c) $cells[(int)$c['bed']][(int)$c['time']] = $c;
        $byTime = [];
        foreach ($cells as $bed => $list) {
            foreach ($list as $t => $c) {
                $text = trim((string)$c['text']);
                if ($text === '' || !Availability::isPatientText($text)) continue;
                $src = $c;
                if (Text::isContinuationText($text)) { $src = $list[$t - $slot] ?? null; if (!$src) continue; }
                $cat = Text::categorize((string)$src['text']);
                $staff = trim((string)($src['staff'] ?? ''));
                $kind = $cat['isNew'] ? 'new' : (($cat['isRevisit'] || Karte::hasCountMenu(DayData::menusOf((string)($src['menus'] ?? ''))) || $staff !== '') ? 'rev' : null);
                if ($kind === null) continue; // 通院中など、担当が付かない予約
                $byTime[$t][] = ['kind' => $kind, 'staff' => $staff];
            }
        }
        foreach (Hours::slotTimes($sessions, $slot) as $t) {
            $am = Hours::isAm($sessions, $t);
            $on = array_values(array_filter($members, fn($m) => $am ? Settings::worksAm($shift[$m['id']] ?? null) : Settings::worksPm($shift[$m['id']] ?? null)));
            $first = array_values(array_filter($on, fn($m) => (int)$m['canFirst']));
            $rev = array_values(array_filter($on, fn($m) => (int)$m['canRevisit']));
            $load = []; $hasNew = [];
            foreach ($on as $m) { $load[$m['name']] = 0; $hasNew[$m['name']] = false; }
            $unNew = 0; $unRev = 0;
            foreach ($byTime[$t] ?? [] as $p) {
                if ($p['staff'] !== '' && isset($load[$p['staff']])) { $load[$p['staff']]++; if ($p['kind'] === 'new') $hasNew[$p['staff']] = true; }
                elseif ($p['staff'] === '') { if ($p['kind'] === 'new') $unNew++; else $unRev++; }
                // 担当がシフトにいない人（ヘルプなど）の予約は数えない
            }
            // 割り当てで数が変わるので、いまの数を見る（参照で受け取る）
            $busy = function (string $n) use (&$load, &$hasNew): bool { return $load[$n] >= 2 || $hasNew[$n]; };
            // 担当の付いていない初診 → 空いている新規担当（再来ができない人を先に）。再来 → 空いている再来担当（新規ができない人を先に）
            for ($i = 0; $i < $unNew; $i++) {
                $cand = array_values(array_filter($first, fn($m) => !$busy($m['name'])));
                usort($cand, fn($a, $b) => [(int)$a['canRevisit'], $load[$a['name']]] <=> [(int)$b['canRevisit'], $load[$b['name']]]);
                if (!$cand) break;
                $load[$cand[0]['name']]++; $hasNew[$cand[0]['name']] = true;
            }
            for ($i = 0; $i < $unRev; $i++) {
                $cand = array_values(array_filter($rev, fn($m) => !$busy($m['name'])));
                usort($cand, fn($a, $b) => [(int)$a['canFirst'], $load[$a['name']]] <=> [(int)$b['canFirst'], $load[$b['name']]]);
                if (!$cand) break;
                $load[$cand[0]['name']]++;
            }
            if ($first && !array_filter($first, fn($m) => !$busy($m['name']))) $out['N'][] = $t;
            if ($rev && !array_filter($rev, fn($m) => !$busy($m['name']))) $out['R'][] = $t;
        }
        return $out;
    }

    /**
     * その日の提案とブロックを今の予約表に合わせる：当てはまらなくなった自動ブロックは外し、新しく当てはまる時間は提案にする
     * （「止めない」を押した時間は、当てはまっている間は出さない）
     */
    public static function sync(array $store, array $setting, string $date): void
    {
        $sid = $store['id'];
        $need = self::needed($store, $setting, $date);
        $slot = (int)$setting['slotMinutes'];
        $blocks = Db::all('SELECT id, startTime, endTime, kinds, auto FROM kind_block WHERE storeId = ? AND date = ?', [$sid, $date]);
        foreach (['N', 'R'] as $k) {
            $want = array_flip($need[$k]);
            // 自動ブロック：まだ当てはまる時間だけ残す（つながった時間ごとに作り直す）
            foreach ($blocks as $b) {
                if (!(int)$b['auto'] || $b['kinds'] !== $k) continue;
                $keep = [];
                for ($t = (int)$b['startTime']; $t < (int)$b['endTime']; $t += $slot) if (isset($want[$t])) $keep[] = $t;
                if (count($keep) === intdiv((int)$b['endTime'] - (int)$b['startTime'], $slot)) continue;
                Db::exec('DELETE FROM kind_block WHERE id = ?', [$b['id']]);
                foreach (self::ranges($keep, $slot) as [$s, $e]) Db::exec('INSERT INTO kind_block (id, storeId, date, startTime, endTime, label, kinds, auto) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', [Db::newId(), $sid, $date, $s, $e, '提案から', $k]);
            }
            // すでにブロックしている時間（手で入れたもの・自動）は提案しない
            $covered = [];
            foreach (Db::all('SELECT startTime, endTime, kinds FROM kind_block WHERE storeId = ? AND date = ?', [$sid, $date]) as $b) {
                if (!str_contains((string)$b['kinds'], $k)) continue;
                for ($t = (int)$b['startTime']; $t < (int)$b['endTime']; $t += $slot) $covered[$t] = true;
            }
            $existing = [];
            foreach (Db::all('SELECT time, status FROM block_suggest WHERE storeId = ? AND date = ? AND kind = ?', [$sid, $date, $k]) as $r) $existing[(int)$r['time']] = $r['status'];
            foreach ($existing as $t => $stt) if (!isset($want[$t]) || isset($covered[$t])) Db::exec('DELETE FROM block_suggest WHERE storeId = ? AND date = ? AND kind = ? AND time = ?', [$sid, $date, $k, $t]);
            foreach ($need[$k] as $t) if (!isset($covered[$t]) && !isset($existing[$t])) Db::exec('INSERT INTO block_suggest (storeId, date, kind, time, status) VALUES (?, ?, ?, ?, ?)', [$sid, $date, $k, $t, 'open']);
        }
    }

    /** つながった時刻をまとめる [[開始, 終わり（含まない）], …] */
    public static function ranges(array $times, int $slot): array
    {
        sort($times);
        $out = [];
        foreach ($times as $t) {
            if ($out && end($out)[1] === $t) $out[count($out) - 1][1] = $t + $slot;
            else $out[] = [$t, $t + $slot];
        }
        return $out;
    }

    /** 今日から 14 日先までの、まだ決めていない提案（日付・種類ごとにつながった時間でまとめる） */
    public static function open(array $store, array $setting, ?string $only = null): array
    {
        $today = Time::nowJst()['date'];
        $dates = $only ? [$only] : array_map(fn($i) => Time::addDays($today, $i), range(0, self::DAYS));
        foreach ($dates as $d) self::sync($store, $setting, $d);
        $slot = (int)$setting['slotMinutes'];
        $rows = Db::all("SELECT date, kind, time FROM block_suggest WHERE storeId = ? AND status = 'open' AND date BETWEEN ? AND ? ORDER BY date, kind, time", [$store['id'], $dates[0], end($dates)]);
        $group = [];
        foreach ($rows as $r) $group[$r['date'] . '|' . $r['kind']][] = (int)$r['time'];
        $out = [];
        foreach ($group as $key => $times) {
            [$date, $kind] = explode('|', $key);
            foreach (self::ranges($times, $slot) as [$s, $e]) $out[] = ['date' => $date, 'kind' => $kind, 'start' => $s, 'end' => $e];
        }
        usort($out, fn($a, $b) => [$a['date'], $a['start'], $a['kind']] <=> [$b['date'], $b['start'], $b['kind']]);
        return $out;
    }
}
