import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_HOURS } from '../src/lib/hours';

const prisma = new PrismaClient();

async function main() {
  await prisma.globalSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, hours: DEFAULT_HOURS as object, settingsVersion: 1 },
  });
  // 2026-09-29：当日は開始 30 分前から開始時刻まで電話マークにする（電話受付の締切 15 分 → 0 分）。既存の設定に一度だけ適用
  const moved = await prisma.globalSetting.updateMany({ where: { id: 1, settingsVersion: { lt: 1 } }, data: { phoneCutoffMinutes: 0, settingsVersion: 1 } });
  if (moved.count) console.log('電話受付の締切を 0 分（開始時刻まで電話マーク）に更新しました');

  const hqPassword = process.env.HQ_PASSWORD || 'hq-pass';
  await prisma.adminAccount.upsert({
    where: { code: 'HQ' },
    update: {},
    create: { code: 'HQ', role: 'hq', passwordHash: await bcrypt.hash(hqPassword, 10) },
  });

  // サンプル店舗（店舗が 1 つも無いときだけ作成）。本番では本部画面から追加する
  if ((await prisma.store.count()) === 0) {
    const samples = [
      { code: 'S001', name: 'サンプル本店', phone: '055-000-0001' },
      { code: 'S002', name: 'サンプル駅前院', phone: '055-000-0002' },
    ];
    for (const s of samples) {
      const store = await prisma.store.create({ data: { ...s, beds: 8 } });
      await prisma.adminAccount.create({
        data: { code: s.code, role: 'store', storeId: store.id, passwordHash: await bcrypt.hash('password', 10) },
      });
    }
    console.log('サンプル店舗 S001 / S002 を作成しました（パスワード: password）');
  }
  console.log('seed 完了。本部ログイン: HQ /', hqPassword);
}

main().finally(() => prisma.$disconnect());
