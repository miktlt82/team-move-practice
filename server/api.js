import { digest, newToken, passwordHash, sessionCookie, sessionSeconds, sessionToken, verifyPassword } from './auth.js';
import { rewardCategories, taskCategories } from './catalog.js';
import { transaction } from './db.js';
import { onboarding } from './activity.js';
import { createGameApi } from './game-api.js';
import { balanceOf } from './wallet.js';
import { saveLogo } from './settings.js';
import { HttpError, conflict, emailValue, invalid, json, missing, readJson, readLogo, textValue } from './http.js';

const profileFields = 'u.id, u.email, u.name, u.role';
const rewardCategory = 'COALESCE((SELECT code FROM store_reward_categories WHERE reward_id=rewards.id),category)';
const catalogFields = table => table === 'rewards'
  ? 'id,title,description,' + rewardCategory + ' AS category,points,active,(SELECT image FROM reward_media WHERE reward_id=rewards.id) AS image'
  : 'id,title,description,category,points,active';
const requireAuth = () => new HttpError(401, 'AUTH_REQUIRED', 'Войдите в аккаунт.');
const forbidden = () => new HttpError(403, 'FORBIDDEN', 'Недостаточно прав для этого действия.');
const rejected = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Проверьте email и пароль.');
const fallbackHash = passwordHash(newToken());

function catalogItem(db, table, id, includeInactive = false) {
  const item = db.prepare('SELECT ' + catalogFields(table) + ' FROM ' + table
    + ' WHERE id=? AND (active=1 OR ?=1)').get(id, Number(includeInactive));
  if (!item) throw missing();
  return item;
}

function catalogList(db, table, params, includeInactive) {
  const query = textValue({ q: params.get('q') ?? '' }, 'q', 0, 100, { label: 'Поиск' }).toLowerCase();
  const category = params.get('category');
  const sort = params.get('sort') ?? 'new';
  if (category && !(table === 'tasks' ? taskCategories.includes(category) :
    db.prepare('SELECT 1 FROM store_categories WHERE code=? AND (active=1 OR ?=1)').get(category,Number(includeInactive)))) {
    throw invalid({ category: 'Неизвестная категория.' });
  }
  if (!['new', 'points-asc', 'points-desc'].includes(sort)) throw invalid({ sort: 'Неизвестная сортировка.' });
  const order = { new: 'id DESC', 'points-asc': 'points ASC,id DESC', 'points-desc': 'points DESC,id DESC' }[sort];
  return db.prepare('SELECT ' + catalogFields(table) + ' FROM ' + table
    + ' WHERE (active=1 OR ?=1) AND (? IS NULL OR ' + (table === 'rewards' ? rewardCategory : 'category') + '=?) ORDER BY ' + order)
    .all(Number(includeInactive), category || null, category || null)
    .filter(item => (item.title + ' ' + item.description).toLowerCase().includes(query));
}

function upsertCatalog(db, table, id, body) {
  const title = textValue(body, 'title', 3, 100, { label: 'Название' });
  const description = textValue(body, 'description', 10, 1200, { label: 'Описание' });
  const { category, points, active = true } = body;
  if (!Number.isInteger(points) || points < 1 || points > 10000) throw invalid({ points: 'Введите целое число от 1 до 10000.' });
  if (typeof active !== 'boolean') throw invalid({ active: 'Ожидается true или false.' });
  if (typeof category !== 'string' || !(table === 'tasks' ? taskCategories.includes(category) :
    db.prepare('SELECT 1 FROM store_categories WHERE code=? AND (active=1 OR ?=0)').get(category, Number(active)))) {
    throw invalid({ category: 'Выберите категорию.' });
  }
  const custom = table === 'rewards' && !rewardCategories.includes(category);
  const storedCategory = custom ? rewardCategories[0] : category;
  const media = table === 'rewards' && body.image !== undefined;
  if (media && !['','coffee','book','notebook'].includes(body.image)) throw invalid({ image: 'Выберите изображение из списка.' });
  return transaction(db, () => {
    if (id) {
      catalogItem(db, table, id, true);
      db.prepare('UPDATE ' + table + ' SET title=?,description=?,category=?,points=?,active=? WHERE id=?')
        .run(title, description, storedCategory, points, Number(active), id);
    } else {
      const insert = db.prepare('INSERT INTO ' + table + '(title,description,category,points,active) VALUES(?,?,?,?,?)')
        .run(title, description, storedCategory, points, Number(active));
      id = Number(insert.lastInsertRowid);
    }
    if (media) {
      if (body.image) db.prepare('INSERT INTO reward_media VALUES(?,?) ON CONFLICT(reward_id) DO UPDATE SET image=excluded.image').run(id, body.image);
      else db.prepare('DELETE FROM reward_media WHERE reward_id=?').run(id);
    }
    if (table === 'rewards') {
      if (custom) db.prepare('INSERT INTO store_reward_categories VALUES(?,?) ON CONFLICT(reward_id) DO UPDATE SET code=excluded.code').run(id, category);
      else db.prepare('DELETE FROM store_reward_categories WHERE reward_id=?').run(id);
    }
    return catalogItem(db, table, id, true);
  });
}

function submitTask(db, user, taskId, body, quest = false) {
  const note = textValue(body, 'note', 10, 1000, { label: 'Отчёт' });
  return transaction(db, () => {
    const task = catalogItem(db, 'tasks', taskId);
    const existing = db.prepare('SELECT id,status FROM submissions WHERE user_id=? AND task_id=?').get(user.id, task.id);
    if (existing && existing.status !== 'rejected') {
      throw conflict('ALREADY_SUBMITTED', 'Отчёт по этому заданию уже отправлен.');
    }
    if ((quest || task.category === 'onboarding') && onboarding(db, user.id).current !== taskId) {
      throw conflict('STEP_LOCKED', 'Сначала завершите текущий шаг адаптации.');
    }
    if (existing) {
      return db.prepare(`UPDATE submissions SET note=?,status='pending',points=?,feedback=NULL,
        submitted_at=CURRENT_TIMESTAMP,reviewer_id=NULL,reviewed_at=NULL WHERE id=? RETURNING *`)
        .get(note, task.points, existing.id);
    }
    return db.prepare('INSERT INTO submissions(user_id,task_id,note,points) VALUES(?,?,?,?) RETURNING *')
      .get(user.id, task.id, note, task.points);
  });
}

function reviewTask(db, reviewer, id, body) {
  if (!['approved', 'rejected'].includes(body.status)) throw invalid({ status: 'Выберите решение по отчёту.' });
  const feedback = textValue({ feedback: body.feedback ?? '' }, 'feedback', body.status === 'rejected' ? 5 : 0, 500,
    { label: 'Комментарий' });
  return transaction(db, () => {
    const report = db.prepare('SELECT * FROM submissions WHERE id=?').get(id);
    if (!report) throw missing();
    if (report.status !== 'pending') throw conflict('ALREADY_REVIEWED', 'Отчёт уже проверен.');
    if (report.user_id === reviewer.id) throw forbidden();
    const result = db.prepare(`UPDATE submissions SET status=?, feedback=?, reviewer_id=?,
      reviewed_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *`).get(body.status, feedback || null, reviewer.id, id);
    if (body.status === 'approved') {
      db.prepare('INSERT INTO point_entries(user_id,amount,submission_id) VALUES(?,?,?)')
        .run(report.user_id, report.points, id);
    }
    return result;
  });
}

function redeem(db, user, rewardId) {
  return transaction(db, () => {
    const reward = catalogItem(db, 'rewards', rewardId);
    if (db.prepare('SELECT 1 FROM redemptions WHERE user_id=? AND reward_id=?').get(user.id, reward.id)) {
      throw conflict('ALREADY_REDEEMED', 'Вы уже обменяли баллы на эту награду.');
    }
    const balance = balanceOf(db, user.id);
    if (balance < reward.points) throw conflict('INSUFFICIENT_POINTS', 'На балансе недостаточно баллов.');
    const order = db.prepare('INSERT INTO redemptions(user_id,reward_id,points) VALUES(?,?,?) RETURNING *')
      .get(user.id, reward.id, reward.points);
    db.prepare('INSERT INTO point_entries(user_id,amount,redemption_id) VALUES(?,?,?)')
      .run(user.id, -reward.points, order.id);
    return { ...order, balance: balance - reward.points };
  });
}

function dashboard(db, user) {
  const ledger = db.prepare(`SELECT id,amount,created_at,title FROM wallet_entries
    WHERE user_id=? ORDER BY created_at DESC,(id<0) DESC,abs(id) DESC`).all(user.id);
  const submissions = db.prepare(`SELECT s.*,t.title,t.category,t.active FROM submissions s JOIN tasks t ON t.id=s.task_id
    WHERE s.user_id=? ORDER BY s.submitted_at DESC,s.id DESC`).all(user.id);
  const redemptions = db.prepare(`SELECT d.*,r.title FROM redemptions d JOIN rewards r ON r.id=d.reward_id
    WHERE d.user_id=? ORDER BY d.id DESC`).all(user.id);
  const progress = db.prepare(`SELECT COUNT(*) AS total,COUNT(CASE WHEN s.status='approved' THEN 1 END) AS completed
    FROM tasks t LEFT JOIN submissions s ON t.id=s.task_id AND s.user_id=?
    WHERE t.category='onboarding' AND t.active=1`).get(user.id);
  const orderCount = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE user_id=? AND status='fulfilled'").get(user.id).count;
  return { user, balance: balanceOf(db, user.id), ledger, submissions, redemptions, progress, orderCount };
}

export function createApi(db, { secureCookie = false, allowedOrigin, telegram } = {}) {
  const gameApi = createGameApi(db, telegram, submitTask);
  const authAttempts = new Map();
  function limitAuth(request) {
    const key = request.socket.remoteAddress;
    const now = Date.now();
    for (const [address, entry] of authAttempts) if (entry.expires <= now) authAttempts.delete(address);
    const entry = authAttempts.get(key) ?? { attempts: 0, expires: now + 60000 };
    authAttempts.set(key, entry);
    if (++entry.attempts > 20) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Слишком много попыток. Подождите минуту.');
  }

  return async (request, response, url) => {
    const route = url.pathname;
    const method = request.method;
    const token = sessionToken(request);
    const origin = request.headers.origin;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && origin
        && origin !== (allowedOrigin ?? (secureCookie ? 'https://' : 'http://') + request.headers.host)) {
      throw forbidden();
    }
    const user = token ? db.prepare('SELECT ' + profileFields + ' FROM users u JOIN sessions s ON s.user_id=u.id'
      + ' WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), Date.now()) : null;
    function authenticated() {
      if (!user) throw requireAuth();
      return user;
    }
    function admin() {
      if (authenticated().role !== 'admin') throw forbidden();
      return user;
    }
    function employee() {
      if (authenticated().role !== 'employee') throw forbidden();
      return user;
    }
    function signIn(account, status) {
      const fresh = newToken();
      transaction(db, () => {
        db.prepare('DELETE FROM sessions WHERE expires_at<=? OR token_hash=?').run(Date.now(), token ? digest(token) : '');
        db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
          .run(digest(fresh), account.id, Date.now() + sessionSeconds * 1000);
      });
      response.setHeader('Set-Cookie', sessionCookie(fresh, secureCookie));
      const { id, name, email, role } = account;
      json(response, status, { id, name, email, role });
    }

    if (method === 'GET' && route === '/api/health') {
      db.prepare('SELECT 1').get();
      return json(response, 200, { status: 'ok' });
    }
    if (method === 'POST' && route === '/api/auth/register') {
      limitAuth(request);
      const body = await readJson(request);
      const email = emailValue(body);
      const name = textValue(body, 'name', 2, 80, { label: 'Имя' });
      const password = textValue(body, 'password', 8, 128, { trim: false, label: 'Пароль' });
      const account = db.prepare(`INSERT INTO users(email,name,password_hash) VALUES(?,?,?)
        ON CONFLICT(email) DO NOTHING RETURNING id,email,name,role`).get(email, name, passwordHash(password));
      if (!account) throw conflict('EMAIL_IN_USE', 'Этот email уже зарегистрирован.');
      return signIn(account, 201);
    }
    if (method === 'POST' && route === '/api/auth/login') {
      limitAuth(request);
      const body = await readJson(request);
      const email = emailValue(body);
      const password = textValue(body, 'password', 1, 128, { trim: false, label: 'Пароль' });
      const account = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const valid = verifyPassword(password, account?.password_hash ?? fallbackHash);
      if (!account || !valid) throw rejected();
      return signIn(account, 200);
    }
    if (method === 'POST' && route === '/api/auth/logout') {
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
      response.setHeader('Set-Cookie', sessionCookie(null, secureCookie));
      return json(response, 204);
    }
    if (route === '/api/me' && method === 'GET') return json(response, 200, authenticated());
    if (route === '/api/me' && method === 'PATCH') {
      const account = authenticated();
      const name = textValue(await readJson(request), 'name', 2, 80, { label: 'Имя' });
      db.prepare('UPDATE users SET name=? WHERE id=?').run(name, account.id);
      return json(response, 200, { ...account, name });
    }
    if (route === '/api/me/dashboard' && method === 'GET') return json(response, 200, dashboard(db, authenticated()));
    if (route === '/api/leaderboard' && method === 'GET') {
      authenticated();
      const metric = url.searchParams.get('metric') ?? 'points';
      if (!['points', 'tasks'].includes(metric)) throw invalid({ metric: 'Выберите points или tasks.' });
      const earned = metric === 'points' ? `SELECT user_id,amount FROM point_entries WHERE amount>0
        UNION ALL SELECT user_id,amount FROM extended_points WHERE amount>0 AND kind IN ('challenge','poll','cashback','wheel')`
        : 'SELECT user_id,1 AS amount FROM point_entries WHERE submission_id IS NOT NULL';
      const items = db.prepare(`SELECT u.name,SUM(p.amount) AS score FROM (${earned}) p JOIN users u ON u.id=p.user_id
        WHERE u.role='employee' GROUP BY u.id ORDER BY score DESC,u.id LIMIT 50`).all();
      return json(response, 200, { items });
    }

    const entry = /^(\/api\/)(admin\/)?(tasks|rewards)(?:\/([1-9]\d{0,14}))?(?:\/(submit|redeem))?$/.exec(route);
    if (entry) {
      const [, , management, table, key, action] = entry;
      const id = Number(key);
      if (management) admin();
      if (method === 'GET' && !action) {
        return json(response, 200, id ? catalogItem(db, table, id, Boolean(management))
          : { items: catalogList(db, table, url.searchParams, Boolean(management)) });
      }
      if (method === 'POST' && management && !id && !action) {
        return json(response, 201, upsertCatalog(db, table, id, await readJson(request)));
      }
      if (method === 'PUT' && management && id && !action) {
        return json(response, 200, upsertCatalog(db, table, id, await readJson(request)));
      }
      if (method === 'DELETE' && management && id && !action) {
        catalogItem(db, table, id, true);
        db.prepare('UPDATE ' + table + ' SET active=0 WHERE id=?').run(id);
        return json(response, 204);
      }
      if (method === 'POST' && !management && id && table === 'tasks' && action === 'submit') {
        const account = authenticated();
        if (account.role !== 'employee') throw forbidden();
        return json(response, 201, submitTask(db, account, id, await readJson(request)));
      }
      if (method === 'POST' && !management && id && table === 'rewards' && action === 'redeem') {
        const account = authenticated();
        if (account.role !== 'employee') throw forbidden();
        return json(response, 201, redeem(db, account, id));
      }
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Метод недоступен для этого адреса.');
    }

    if (route === '/api/admin/submissions' && method === 'GET') {
      admin();
      const status = url.searchParams.get('status') ?? 'pending';
      if (!['pending', 'approved', 'rejected'].includes(status)) throw invalid({ status: 'Неизвестный статус.' });
      const items = db.prepare(`SELECT s.*,u.name,t.title FROM submissions s
        JOIN users u ON u.id=s.user_id JOIN tasks t ON t.id=s.task_id
        WHERE s.status=? ORDER BY s.submitted_at,s.id`).all(status);
      return json(response, 200, { items });
    }
    const review = /^\/api\/admin\/submissions\/([1-9]\d{0,14})$/.exec(route);
    if (review && method === 'PATCH') {
      const reviewer = admin();
      return json(response, 200, reviewTask(db, reviewer, Number(review[1]), await readJson(request)));
    }
    if (route === '/api/admin/settings/logo' && ['PUT','DELETE'].includes(method)) {
      admin();
      return json(response, 200, saveLogo(db, method === 'PUT' ? await readLogo(request) : null));
    }
    if (await gameApi(request, response, url, { authenticated, admin, employee })) return;
    throw missing();
  };
}
