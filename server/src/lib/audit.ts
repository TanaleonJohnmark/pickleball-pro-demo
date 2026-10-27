import type { Request } from 'express';
import { db, type Tx } from '../db/index.js';
import { auditLogs, notifications } from '../db/schema.js';

export async function audit(req: Request | null, action: string, entity: string, entityId: string | null, details?: unknown, tx?: Tx) {
  await (tx ?? db).insert(auditLogs).values({ actorId: req?.user?.id ?? null, action, entity, entityId, details: details ?? null, ip: req?.ip ?? null });
}

export async function notify(userIds: string | string[], n: { type: string; title: string; body: string; link?: string }, tx?: Tx) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
  if (!ids.length) return;
  await (tx ?? db).insert(notifications).values(ids.map((userId) => ({ userId, ...n })));
}
