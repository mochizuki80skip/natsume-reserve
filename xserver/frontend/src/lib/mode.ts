// 設置の種類。index.php が window.APP_MODE に入れる（full＝予約システム＋SNS 投稿管理、sns＝SNS 投稿管理だけ）
declare global { interface Window { APP_MODE?: string } }
export const APP_MODE: 'full' | 'sns' = typeof window !== 'undefined' && window.APP_MODE === 'sns' ? 'sns' : 'full';
export const SNS_ONLY = APP_MODE === 'sns';
export const APP_TITLE = SNS_ONLY ? 'SNS投稿管理' : '接骨院 WEB予約システム';
