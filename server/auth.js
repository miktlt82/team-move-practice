import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const sessionSeconds = 7 * 24 * 60 * 60;
export const cookieName = 'team_move_session';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}

export function sessionToken(request) {
  const cookie = request.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='));
  const token = cookie?.slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token ?? '') ? token : null;
}

export function sessionCookie(token, secure) {
  return cookieName + '=' + (token ?? '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age='
    + (token ? sessionSeconds : 0) + (secure ? '; Secure' : '');
}
