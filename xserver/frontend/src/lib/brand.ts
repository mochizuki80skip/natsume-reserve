// 患者様向けページのロゴと「なつめ接骨院」の店舗か（名の付かない店舗はグループ院として表示する）
export const NATSUME_LOGO = '/brand/natsume-logo-yoko.svg';

/** 「なつめ接骨院」と名の付く店舗か（全角・半角や空白の違いは見ない） */
export const isNatsume = (name: string) => name.normalize('NFKC').replace(/[\s　]/g, '').includes('なつめ接骨院');
