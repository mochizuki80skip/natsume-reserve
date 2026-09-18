import { prisma } from '@/lib/prisma';
import { getGlobalSetting } from '@/lib/settings';

export async function loadStore(code: string) {
  const store = await prisma.store.findUnique({ where: { code } });
  if (!store || !store.active) return null;
  const setting = await getGlobalSetting();
  return { store, setting };
}

export function parseKind(v: string | null): 'NEW' | 'REVISIT' | 'RETURN' {
  return v === 'NEW' ? 'NEW' : v === 'REVISIT' ? 'REVISIT' : 'RETURN';
}
