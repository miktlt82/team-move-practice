import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';
import { openDatabase } from './db.js';
import { HttpError, json } from './http.js';

const assets = {
  '/': ['../public/index.html', 'text/html'],
  '/styles.css': ['../public/styles.css', 'text/css'],
  '/app.js': ['../public/app.js', 'text/javascript'],
  '/docs': ['../public/api-docs.html', 'text/html'],
  '/api-docs.js': ['../public/api-docs.js', 'text/javascript'],
  '/openapi.json': ['../openapi.json', 'application/json'],
  '/team-mark.svg': ['../public/team-mark.svg', 'image/svg+xml'],
};

export function createApp({ filename = ':memory:', demo, allowedOrigin, secureCookie, adminEmail, adminPassword } = {}) {
  const db = openDatabase(filename, { demo, adminEmail, adminPassword });
  const api = createApi(db, { allowedOrigin, secureCookie });
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(request, response, url);
      const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null;
      if (asset && ['GET','HEAD'].includes(request.method)) {
        const [path, type] = asset;
        const body = await readFile(new URL(path, import.meta.url));
        response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' });
        return response.end(request.method === 'HEAD' ? undefined : body);
      }
      return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Страница не найдена.' } });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(response, error.status, { error: { code: error.code, message: error.message, fields: error.fields } });
      }
      if (error.errcode === 5) return json(response, 503, { error: { code: 'BUSY', message: 'Повторите запрос через несколько секунд.' } });
      console.error(error);
      if (!response.headersSent) return json(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Произошла ошибка сервера.' } });
      response.destroy();
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const demo = process.argv.includes('--demo');
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8080);
  const filename = process.env.DB_PATH ?? (demo ? 'data/demo.sqlite' : 'data/team-move.sqlite');
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (Boolean(adminEmail) !== Boolean(adminPassword) || (adminPassword && adminPassword.length < 12)) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD together. Use at least 12 characters.');
  }
  const server = createApp({ filename, demo, adminEmail, adminPassword,
    allowedOrigin: process.env.PUBLIC_ORIGIN, secureCookie: process.env.SECURE_COOKIE === '1' });
  server.listen(port, host, () => console.log('Командный ход: http://' + host + ':' + server.address().port));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
