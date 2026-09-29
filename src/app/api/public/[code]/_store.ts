import { KINDS, type Kind } from '@/lib/public';
import { prisma } from '@/lib/prisma';
import { getGlobalSetting } from '@/lib/settings';

export async function loadStore(code: string) {
  const [store, setting] = await Promise.all([prisma.store.findUnique({ where: { code } }), getGlobalSetting()]);
  if (!store || !store.active) return null;
  return { store, setting };
}

export function parseKind(v: string | null): Kind {
  return KINDS.includes(v as Kind) ? (v as Kind) : 'RETURN';
}
