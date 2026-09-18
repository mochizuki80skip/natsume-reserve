import { prisma } from '@/lib/prisma';
import { getGlobalSetting } from '@/lib/settings';

export async function loadStore(code: string) {
  const [store, setting] = await Promise.all([prisma.store.findUnique({ where: { code } }), getGlobalSetting()]);
  if (!store || !store.active) return null;
  return { store, setting };
}

export function parseKind(v: string | null): 'NEW' | 'REVISIT' | 'RETURN' {
  return v === 'NEW' ? 'NEW' : v === 'REVISIT' ? 'REVISIT' : 'RETURN';
}
