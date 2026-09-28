import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config';
import { person } from './people';
export function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function sessionToken(userId: string) {
  return `${userId}.${sign(userId, config.sessionSecret)}`;
}
export function actor(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('banana_actor='))
    ?.slice('banana_actor='.length);
  if (!token) throw new HttpError(401, 'Select a person to continue.');
  const [id, signature] = token.split('.');
  const p = person(id);
  if (!p || !signature || !equal(signature, sign(id, config.sessionSecret)))
    throw new HttpError(401, 'Invalid session.');
  return p;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.host !== request.headers.get('host')
    )
      throw new HttpError(403, 'Origin not allowed.');
  }
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
