import { timingSafeEqual } from 'node:crypto';
import { digest, newToken } from './auth.js';
import { conflict, HttpError } from './http.js';

export function createTelegram(db, { token, username, secret, transport = fetch } = {}) {
  const enabled = Boolean(token && username && secret);
  let stopped = false;
  let flushing = false;
  let timer;
  const status = id => ({ enabled, linked: Boolean(db.prepare('SELECT chat_id FROM telegram_links WHERE user_id=?').get(id)?.chat_id) });

  function link(id) {
    if (!enabled) throw conflict('TELEGRAM_DISABLED', 'Telegram-бот не подключён на этом сервере.');
    const code = newToken();
    db.prepare(`INSERT INTO telegram_links(user_id,code_hash,expires_at) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at`)
      .run(id, digest(code), Date.now() + 15 * 60000);
    return { url: 'https://t.me/' + username + '?start=' + code };
  }

  function webhook(header, body) {
    if (!enabled || typeof header !== 'string'
        || !timingSafeEqual(Buffer.from(digest(header)), Buffer.from(digest(secret)))) {
      throw new HttpError(403, 'FORBIDDEN', 'Не удалось проверить источник уведомления.');
    }
    const message = body.message;
    const chat = message?.chat;
    if (chat?.type !== 'private' || !Number.isSafeInteger(chat.id)) return { ok: true };
    const match = /^\/start ([A-Za-z0-9_-]{43})$/.exec(message.text ?? '');
    if (match) {
      const chatId = String(chat.id);
      const updated = db.prepare(`UPDATE telegram_links SET chat_id=?,code_hash=NULL,expires_at=NULL
        WHERE code_hash=? AND expires_at>? AND NOT EXISTS
        (SELECT 1 FROM telegram_links other WHERE other.chat_id=? AND other.user_id<>telegram_links.user_id)
        RETURNING user_id`).get(chatId, digest(match[1]), Date.now(), chatId);
      if (updated) db.prepare('INSERT INTO notification_outbox(user_id,subject) VALUES(?,?)')
        .run(updated.user_id, 'Уведомления «Командного хода» подключены.');
    }
    return { ok: true };
  }

  async function flush() {
    if (!enabled || stopped || flushing) return;
    flushing = true;
    try {
      const rows = db.prepare(`SELECT o.id,o.subject,o.tries,l.chat_id FROM notification_outbox o
        JOIN telegram_links l ON l.user_id=o.user_id AND l.chat_id IS NOT NULL
        WHERE o.sent_at IS NULL AND o.next_attempt<=? ORDER BY o.id LIMIT 20`).all(Date.now());
      for (const row of rows) {
        if (stopped) break;
        let sent = false;
        try {
          const result = await transport('https://api.telegram.org/bot' + token + '/sendMessage', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: row.chat_id, text: row.subject }), signal: AbortSignal.timeout(5000),
          });
          sent = result.ok && (await result.json()).ok === true;
        } catch {
          // The outbox retries transient delivery failures.
        }
        if (stopped) break;
        if (sent) db.prepare('UPDATE notification_outbox SET sent_at=? WHERE id=?').run(Date.now(), row.id);
        else db.prepare('UPDATE notification_outbox SET tries=tries+1,next_attempt=? WHERE id=?')
          .run(Date.now() + Math.min(3600000, 30000 * 2 ** row.tries), row.id);
      }
    } finally {
      flushing = false;
    }
  }

  if (enabled) {
    timer = setInterval(() => { void flush().catch(() => console.error('Не удалось обработать очередь Telegram.')); }, 5000);
    timer.unref();
  }
  return { status, link, webhook, flush, stop() { stopped = true; clearInterval(timer); } };
}
