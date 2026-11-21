import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../server/index.js';

describe('REST API', () => {
  let server;
  let root;
  let employee;
  let admin;
  let draft;

  async function send(path, { method = 'GET', data, cookie, headers } = {}) {
    const response = await fetch(root + '/api' + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      data: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie'),
    };
  }
  const session = response => response.cookie.split(';')[0];

  before(async () => {
    server = createApp({ demo: true });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    root = 'http://127.0.0.1:' + server.address().port;
  });

  after(async () => {
    server.close();
    await once(server, 'close');
  });

  it('serves health and the OpenAPI contract', async () => {
    assert.deepEqual((await send('/health')).data, { status: 'ok' });
    const spec = await (await fetch(root + '/openapi.json')).json();
    assert.ok(spec.paths['/api/auth/login'].post.responses[200]);
    assert.ok(spec.paths['/api/cart/checkout'].post.responses[201]);
    assert.ok(spec.paths['/api/admin/cashback/reports/{id}'].patch.responses[200]);
  });

  it('registers, signs in, rejects duplicate emails and clears sessions', async () => {
    const data = { email: 'qa@example.test', name: 'Мария Тестова', password: 'TestingPass!123', role: 'admin' };
    const created = await send('/auth/register', { method: 'POST', data });
    assert.equal(created.status, 201);
    assert.equal(created.data.role, 'employee');
    assert.equal(created.data.password_hash, undefined);
    assert.match(created.cookie, /HttpOnly; SameSite=Lax/);
    assert.equal((await send('/auth/register', { method: 'POST', data })).status, 409);
    assert.equal((await send('/auth/login', { method: 'POST', data: { ...data, password: 'wrong' } })).status, 401);
    const signed = await send('/auth/login', { method: 'POST', data, cookie: session(created) });
    assert.equal(signed.status, 200);
    assert.notEqual(session(signed), session(created));
    assert.equal((await send('/me', { cookie: session(created) })).status, 401);
    employee = session(signed);
    const logged = await send('/auth/login', {
      method: 'POST', data: { email: 'admin@example.test', password: 'AdminDemo!2026' },
    });
    assert.equal(logged.data.role, 'admin');
    admin = session(logged);
    const anonymous = await send('/me');
    assert.equal(anonymous.status, 401);
  });

  it('validates data, enforces roles and rejects cross-origin changes', async () => {
    const change = { method: 'PATCH', cookie: employee, data: { name: 'x' } };
    assert.equal((await send('/me', change)).status, 422);
    assert.equal((await send('/admin/tasks', { cookie: employee })).status, 403);
    assert.equal((await send('/me', { ...change, headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await send('/me', { ...change, data: { name: 'Мария Иванова' } })).data.name, 'Мария Иванова');
    const badJson = await fetch(root + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(badJson.status, 400);
    const largeJson = await send('/auth/login', { method: 'POST', data: { password: 'a'.repeat(20000) } });
    assert.equal(largeJson.status, 413);
  });

  it('filters by category, searches Cyrillic case-insensitively and sorts by points', async () => {
    const query = new URLSearchParams({ category: 'onboarding', q: 'КОМАНДОЙ', sort: 'points-desc' });
    const result = await send('/tasks?' + query);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.items.map(item => item.title), ['Знакомство с командой']);
    const sorted = (await send('/tasks?sort=points-asc')).data.items.map(item => item.points);
    assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b));
    assert.equal((await send('/tasks?category=invalid')).status, 422);
  });

  it('creates, reads, updates and archives catalog records for both resources', async () => {
    for (const [table, category] of [['tasks', 'team'], ['rewards', 'perks']]) {
      const data = { title: 'Новое предложение', description: 'Описание для тестовой записи.', category, points: 10 };
      const created = await send('/admin/' + table, { method: 'POST', cookie: admin, data });
      assert.equal(created.status, 201);
      const url = '/' + table + '/' + created.data.id;
      assert.equal((await send(url)).data.points, 10);
      assert.equal((await send('/admin' + url, { method: 'PUT', cookie: admin, data: { ...data, points: 20 } })).data.points, 20);
      assert.equal((await send('/admin' + url, { method: 'DELETE', cookie: admin })).status, 204);
      assert.equal((await send(url)).status, 404);
      assert.equal((await send('/admin' + url, { cookie: admin })).data.active, 0);
    }
  });

  it('returns a report for correction and locks it after resubmission and approval', async () => {
    const payload = { method: 'POST', cookie: employee, data: { note: 'Познакомилась с коллегами из команды поддержки.' } };
    const created = await send('/tasks/1/submit', payload);
    assert.equal(created.status, 201);
    draft = created.data.id;
    assert.equal((await send('/tasks/1/submit', payload)).data.error.code, 'ALREADY_SUBMITTED');
    const endpoint = '/admin/submissions/' + draft;
    const assess = { method: 'PATCH', cookie: admin, data: { status: 'rejected', feedback: 'Укажите, чем занимается отдел.' } };
    assert.equal((await send(endpoint, { ...assess, cookie: employee })).status, 403);
    assert.equal((await send(endpoint, assess)).data.status, 'rejected');
    assert.equal((await send('/tasks/1/submit', payload)).data.id, draft);
    const approval = { ...assess, data: { status: 'approved' } };
    const reviews = await Promise.all([send(endpoint, approval), send(endpoint, approval)]);
    assert.deepEqual(reviews.map(result => result.status).sort(), [200, 409]);
    const dashboard = (await send('/me/dashboard', { cookie: employee })).data;
    assert.equal(dashboard.balance, 120);
    assert.deepEqual(dashboard.progress, { total: 3, completed: 1 });
    assert.equal(dashboard.ledger.length, 1);
  });

  it('exchanges points once, protects against negative balance and preserves ranking', async () => {
    const exchange = { method: 'POST', cookie: employee };
    assert.equal((await send('/rewards/2/redeem', exchange)).data.error.code, 'INSUFFICIENT_POINTS');
    const results = await Promise.all([send('/rewards/1/redeem', exchange), send('/rewards/1/redeem', exchange)]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    assert.equal(results.find(result => result.status === 201).data.balance, 40);
    const dashboard = (await send('/me/dashboard', { cookie: employee })).data;
    assert.deepEqual(dashboard.ledger.map(row => row.amount), [-80, 120]);
    assert.equal(dashboard.redemptions.length, 1);
    assert.equal((await send('/leaderboard?metric=points', { cookie: employee })).data.items[0].score, 120);
    assert.equal((await send('/leaderboard?metric=tasks', { cookie: employee })).data.items[0].score, 1);
    assert.equal((await send('/auth/logout', exchange)).status, 204);
    assert.equal((await send('/me', { cookie: employee })).status, 401);
  });
});
