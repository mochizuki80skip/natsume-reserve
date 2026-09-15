// SMS 送信（Twilio）。環境変数が無い場合は送信せずログに出す。

export type SmsResult = 'SENT' | 'FAILED' | 'SKIPPED';

/** 日本の携帯番号を E.164 (+81...) に正規化。無効なら null */
export function normalizeJpPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^\+81\d{9,10}$/.test(digits)) return digits;
  if (/^0\d{9,10}$/.test(digits)) return `+81${digits.slice(1)}`;
  return null;
}

export function isJpMobile(e164: string): boolean {
  return /^\+81[789]0\d{8}$/.test(e164);
}

/** Twilio の設定が揃っていれば true（SMS を送る） */
export function smsEnabled(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!smsEnabled() || !sid || !token || !from) {
    console.log(`[sms:skipped] to=${to}\n${body}`);
    return 'SKIPPED';
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (!res.ok) {
      console.error('[sms:failed]', res.status, await res.text());
      return 'FAILED';
    }
    return 'SENT';
  } catch (e) {
    console.error('[sms:failed]', e);
    return 'FAILED';
  }
}
