import { z } from 'zod';
import type { Route } from './types';
import { bytes, coordinate, Failure, from64, hmacKey, now, url64 } from './utils';
const snapshot = z.object({ version: z.literal(1), expiresAt: z.number().int(), courseId: z.string(), route: z.object({
  status: z.string(), points: z.array(coordinate.extend({ order: z.number().int(), type: z.string(), name: z.string(), source: z.string(), verification: z.string(), originalSnapDistanceMeters: z.number().nullable() })).min(2).max(17)
}) });
export async function issue(id: string, route: Route, secret: string) {
  const payload = bytes(JSON.stringify({ version: 1, expiresAt: now()+300, courseId: id, route: { points: route.points, status: route.status } }));
  return `${url64(payload)}.${url64(await crypto.subtle.sign('HMAC', await hmacKey(secret), payload))}`;
}
export async function resolve(token: string, secret: string) {
  try {
    if (token.length>65536) throw new Error();
    const parts=token.split('.'); if(parts.length!==2) throw new Error();
    const payload=from64(parts[0]);
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), from64(parts[1]), payload)) throw new Error();
    const s = snapshot.parse(JSON.parse(new TextDecoder().decode(payload)));
    if (s.expiresAt<=now() || s.expiresAt>now()+300) throw new Error();
    return { courseId: s.courseId, route: s.route };
  } catch { throw new Failure('INVALID_TICKET'); }
}
