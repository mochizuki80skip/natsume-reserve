<?php
// 定型投稿を claude.ai（Claude の MAX プランなど）で作って取り込むための、依頼文づくりと貼り付けの読み取り。
// システムから AI を呼び出すことはしない（API の費用はかからない）。人が依頼文を claude.ai に貼り、返ってきた文章をここに貼る。
declare(strict_types=1);

final class SnsTopicImport
{
    private const WD = ['日' => 0, '月' => 1, '火' => 2, '水' => 3, '木' => 4, '金' => 5, '土' => 6];
    private const CH_JA = ['gbp' => 'Google', 'ig' => 'Instagram', 'both' => '両方'];

    /**
     * claude.ai に貼る依頼文を作る。
     * @param array{theme:string, count:int, channel:string, weekdays:string, perStore:bool, area?:string, stores:array<int, array>} $o
     */
    public static function prompt(array $o): string
    {
        $g = Sns::setting();
        $ch = $o['channel'];
        $count = max(1, min(30, (int)$o['count']));
        $wd = $o['weekdays'] !== '' ? implode('・', array_map(fn($d) => array_search((int)$d, self::WD, true), explode(',', $o['weekdays']))) : '';
        $len = $ch === 'ig' ? '200〜600' : '200〜500';
        $vars = ['{店舗名}', '{エリア}', '{メインキーワード}'];
        $extra = array_map(fn($cv) => '{' . $cv['key'] . '}（' . $cv['label'] . '）', $g['customVars']);
        $forbidden = implode('、', $g['forbiddenWords']);

        $L = [];
        $L[] = 'あなたは、静岡県を中心に接骨院を ' . count($o['stores']) . ' 院運営しているグループの SNS 担当者です。';
        $L[] = 'Google ビジネスプロフィール（以下 Google）と Instagram に載せる「定型投稿」の文章を作ってください。';
        $L[] = '';
        $L[] = '# 作るもの';
        $L[] = '- テーマ：' . ($o['theme'] !== '' ? $o['theme'] : '接骨院らしい、地域の方に役立つ話題（季節のケガの予防、来院の流れ、施術の案内など）');
        $L[] = '- 媒体：' . self::CH_JA[$ch] . ($ch === 'both' ? '（Google と Instagram の両方に使える文章）' : ' 用');
        $area = trim((string)($o['area'] ?? ''));
        if ($area !== '') {
            // このエリアの店舗の地域（例：沼津市大岡、三島市谷田）を書き、季節・地域の話題に生かしてもらう
            $local = [];
            foreach ($o['stores'] as $st) { $ss = Sns::storeSetting($st); if (trim($ss['areaGroup']) === $area && $ss['area'] !== '') $local[$ss['area']] = true; }
            $L[] = '- 対象エリア：' . $area . '（このエリアの店舗だけに使う投稿。全部の「エリア：」に「' . $area . '」と書く）';
            if ($local) $L[] = '- ' . $area . 'の店舗の地域：' . implode('、', array_keys($local)) . '（地名は本文に直接書かず {エリア} を使う。季節の様子や暮らしぶりの参考にする）';
        }
        $L[] = '- 本数：' . ($o['perStore'] ? "テーマごとに {$count} 本 × 下の店舗ごと（店舗ごとに書き分ける）" : "{$count} 本（内容がそれぞれ違うもの）");
        if ($wd !== '') $L[] = '- 投稿する曜日：' . $wd . '（曜日ごとに本数がなるべく同じになるように割り振り、名前の先頭に曜日を付ける。例：' . mb_substr($wd, 0, 1) . '_お悩み共感）';
        $L[] = '';
        $L[] = '# 文章のルール（必ず守る）';
        $L[] = "- 本文は {$len} 文字くらい。読みやすいように改行を入れる。絵文字は 1〜2 個まで。";
        $L[] = '- 店名と地域は直接書かず、次の差し込み語を使う：' . implode(' ', $vars) . '。システムが店舗ごとの言葉に置き換えます（{メインキーワード} は「接骨院」などの業種名）。';
        if ($extra) $L[] = '- 必要なときだけ使える差し込み語：' . implode(' ', $extra) . '。これ以外の { } は使わない。';
        else $L[] = '- 差し込み語はこの 3 つだけ。ほかの { } は使わない。';
        $L[] = '- MEO 対策として、本文の中に {エリア} と {メインキーワード} を 1 回ずつ自然に入れる（例：「{エリア}で{メインキーワード}をお探しの方へ」）。';
        if ($ch !== 'ig') {
            $L[] = '- Google のルール：電話番号・住所・営業時間・URL・ハッシュタグは書かない。{電話} {住所} {営業時間} {予約URL} {ハッシュタグ} も使わない。予約は「予約ボタンから」のように書く。';
        } else {
            $L[] = '- Instagram 専用：最後の行に {ハッシュタグ} を置く。電話番号は書かない。予約は「プロフィールのリンクから」と書く。';
        }
        $L[] = '- 接骨院の広告のルール（柔道整復師法）に沿って、効果を言い切らない。次の語は使わない：' . $forbidden;
        $L[] = '- 骨折・脱臼・打撲・捻挫・挫傷などのケガ（外傷）を中心に書き、肩こり・腰痛などの慢性的な症状は「ご相談ください」程度にとどめる。';
        $L[] = '- 料金・割引・キャンペーン・ほかの院との比較は書かない。';
        $groups = [];
        foreach ($o['stores'] as $st) { $g = trim((string)(Sns::storeSetting($st)['areaGroup'] ?? '')); if ($g !== '') $groups[$g] = true; }
        if ($groups && $area === '') $L[] = '- 「エリア：」は、特定のエリアの店舗だけに使う内容のときだけ、次のどれかを書く（空なら全店で使う）：' . implode('、', array_keys($groups));
        if ($o['perStore']) {
            $L[] = '';
            $L[] = '# 店舗（店舗ごとに書き出しや言い回しを変えて、同じ文章にならないようにする）';
            $L[] = '店舗コード｜店舗名｜エリア分け｜エリア｜メインキーワード｜症状・施術のキーワード';
            foreach ($o['stores'] as $st) {
                $ss = Sns::storeSetting($st);
                $L[] = $st['code'] . '｜' . $st['name'] . '｜' . ($ss['areaGroup'] ?: '-') . '｜' . ($ss['area'] ?: '-') . '｜' . (Sns::mainKeyword($ss) ?: '-') . '｜' . ($ss['keywordsRotation'] ?: '-');
            }
        }
        $L[] = '';
        $L[] = '# 出力の形（この形だけを出力する。前置きや説明は書かない）';
        $L[] = '1 本ごとに、「---」だけの行で区切って次の形で書く。';
        $L[] = '---';
        $L[] = '名前：（一覧用の短い名前' . ($wd !== '' ? '。曜日から始める' : '') . '）';
        $L[] = '媒体：' . self::CH_JA[$ch];
        $L[] = '曜日：' . ($wd !== '' ? '（' . $wd . ' のどれか 1 つ）' : '');
        $L[] = '月：（その月だけに使う季節の話題なら、1〜12 の数字。いつでも使えるなら空）';
        $L[] = 'エリア：' . $area;
        $L[] = '店舗：' . ($o['perStore'] ? '（店舗コード）' : '');
        $L[] = '本文：';
        $L[] = '（ここから本文。複数行で書いてよい）';
        $L[] = '---';
        return implode("\n", $L);
    }

    /**
     * 貼り付けた文章を定型投稿に読み分ける（「---」で区切り、「名前：」「媒体：」…「本文：」の形）。
     * @return array<int, array{title:string, channel:string, weekdays:string, areas:string, months:string, store:string, body:string}>
     */
    public static function parse(string $text): array
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        // 返答がコードの枠（```）で囲まれていれば、枠の中だけを読む（前置きや「以上です」を本文に入れない）
        if (preg_match_all('/^\s*```[^\n]*\n(.*?)^\s*```/msu', $text, $fm) && $fm[1]) $text = implode("\n---\n", $fm[1]);
        $text = preg_replace('/^\s*```.*$/mu', '', $text);
        $chunks = preg_split('/^\s*[-－ー─―=＝]{3,}\s*$/mu', $text) ?: [];
        $out = [];
        foreach ($chunks as $chunk) {
            if (trim($chunk) === '') continue;
            $item = ['title' => '', 'channel' => '', 'weekdays' => '', 'areas' => '', 'months' => '', 'store' => '', 'body' => ''];
            $lines = explode("\n", $chunk);
            $bodyStart = null;
            foreach ($lines as $i => $line) {
                if (preg_match('/^\s*[*#]*\s*本文\s*[*]*\s*[：:]\s*(.*)$/u', $line, $m)) { $bodyStart = $i; $first = $m[1]; break; }
                if (!preg_match('/^\s*[*#]*\s*(名前|タイトル|媒体|曜日|対象エリア|エリア|月|店舗コード|店舗)\s*[*]*\s*[：:]\s*(.*)$/u', $line, $m)) continue;
                $v = trim($m[2]);
                if (preg_match('/^[（(].*[)）]$/u', $v)) $v = '';             // 「（空）」のような書き方は空として扱う
                switch ($m[1]) {
                    case '名前': case 'タイトル': $item['title'] = $v; break;
                    case '媒体': $item['channel'] = self::channel($v); break;
                    case '曜日': $item['weekdays'] = self::weekdays($v); break;
                    case 'エリア': case '対象エリア': $item['areas'] = $v; break;
                    case '月': $item['months'] = $v; break;
                    case '店舗': case '店舗コード': $item['store'] = $v; break;
                }
            }
            if ($bodyStart === null) continue;                                  // 本文の無い区切り（前置きなど）は読まない
            // 「月：」が無く、名前に「7月」のような月があれば、その月だけに使う（例：月_7月_01_夏休みの部活）
            if ($item['months'] === '' && preg_match('/(?<![0-9０-９])([0-9０-９]{1,2})月/u', $item['title'], $mm)) {
                $n = (int)mb_convert_kana($mm[1], 'n');
                if ($n >= 1 && $n <= 12) $item['months'] = (string)$n;
            }
            $body = trim($first . "\n" . implode("\n", array_slice($lines, $bodyStart + 1)));
            $item['body'] = trim(preg_replace("/\n{3,}/", "\n\n", $body));
            $out[] = $item;
        }
        return $out;
    }

    private static function channel(string $v): string
    {
        $v = mb_strtolower($v);
        if (str_contains($v, '両方') || str_contains($v, 'both')) return 'both';
        if (preg_match('/instagram|インスタ|^ig$/u', $v)) return 'ig';
        if (preg_match('/google|gbp|グーグル|ビジネスプロフィール/u', $v)) return 'gbp';
        return '';
    }

    private static function weekdays(string $v): string
    {
        if ($v === '' || str_contains($v, '毎日')) return '';
        $v = str_replace(['曜日', '曜'], '', $v);                          // 「水曜日」の「日」を日曜と読まないように
        $out = [];
        foreach (self::WD as $ja => $d) if (str_contains($v, $ja)) $out[] = $d;
        foreach (preg_split('/[,、\s・]+/u', $v) ?: [] as $x) if (is_numeric($x) && (int)$x >= 0 && (int)$x <= 6) $out[] = (int)$x;
        $out = array_values(array_unique($out)); sort($out);
        return implode(',', $out);
    }
}
