import { transaction } from './db.js';
import { conflict, invalid, missing, textValue } from './http.js';

function integer(body, key, min, max) {
  const value = body[key];
  if (!Number.isSafeInteger(value) || value < min || value > max) throw invalid({ [key]: 'Введите число от ' + min + ' до ' + max + '.' });
  return value;
}
function choice(body, key, options) {
  if (!options.includes(body[key])) throw invalid({ [key]: 'Выберите допустимый вариант.' });
  return body[key];
}
function reference(db, table, id, key) {
  if (!Number.isSafeInteger(id) || !db.prepare('SELECT 1 FROM ' + table + ' WHERE id=? AND active=1').get(id)) {
    throw invalid({ [key]: 'Выберите активную запись из списка.' });
  }
  return id;
}
function flag(db, table, id, active) {
  if (typeof active !== 'boolean') throw invalid({ active: 'Ожидается true или false.' });
  const row = db.prepare('UPDATE ' + table + ' SET active=? WHERE id=? RETURNING *').get(Number(active), id);
  if (!row) throw missing();
  return row;
}

export function saveChallenge(db, body) {
  const title = textValue(body, 'title', 3, 100, { label: 'Название' });
  const description = textValue(body, 'description', 10, 1200, { label: 'Описание' });
  const badge = textValue(body, 'badge', 2, 80, { label: 'Значок' });
  const mode = choice(body, 'mode', ['team','individual']);
  const target = integer(body, 'target', 1, 1000);
  const points = integer(body, 'points', 1, 10000);
  const starts = integer(body, 'starts_at', 1, 4102444800000);
  const ends = integer(body, 'ends_at', starts + 1, 4102444800000);
  if (!Array.isArray(body.task_ids) || !body.task_ids.length || body.task_ids.length > 30) {
    throw invalid({ task_ids: 'Выберите от 1 до 30 заданий.' });
  }
  return transaction(db, () => {
    const ids = [...new Set(body.task_ids)].map(id => reference(db, 'tasks', id, 'task_ids'));
    if (mode === 'individual' && target > ids.length) throw invalid({ target: 'Цель превышает количество выбранных заданий.' });
    const row = db.prepare(`INSERT INTO challenges(title,description,mode,target,points,badge,starts_at,ends_at)
      VALUES(?,?,?,?,?,?,?,?) RETURNING *`).get(title, description, mode, target, points, badge, starts, ends);
    const task = db.prepare('INSERT INTO challenge_tasks VALUES(?,?)');
    for (const id of ids) task.run(row.id, id);
    return row;
  });
}

export function savePoll(db, body) {
  const title = textValue(body, 'title', 3, 100, { label: 'Название' });
  const question = textValue(body, 'question', 5, 500, { label: 'Вопрос' });
  const mode = choice(body, 'mode', ['survey','quiz']);
  const points = integer(body, 'points', 1, 10000);
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 8) {
    throw invalid({ options: 'Добавьте от 2 до 8 вариантов ответа.' });
  }
  const options = body.options.map((option) => textValue({ option }, 'option', 1, 140, { label: 'Вариант ответа' }));
  if (new Set(options).size !== options.length) throw invalid({ options: 'Варианты ответа должны различаться.' });
  const correct = mode === 'quiz' ? integer(body, 'correct', 1, options.length) : 0;
  return transaction(db, () => {
    const row = db.prepare('INSERT INTO polls(title,question,mode,points) VALUES(?,?,?,?) RETURNING *')
      .get(title, question, mode, points);
    const option = db.prepare('INSERT INTO poll_options(poll_id,title,correct) VALUES(?,?,?)');
    options.forEach((label, index) => option.run(row.id, label, Number(index + 1 === correct)));
    return row;
  });
}

export function saveAuction(db, body) {
  const title = textValue(body, 'title', 3, 100, { label: 'Название' });
  const reward = reference(db, 'rewards', body.reward_id, 'reward_id');
  const minimum = integer(body, 'minimum', 1, 100000);
  const ends = integer(body, 'ends_at', Date.now() + 1000, 4102444800000);
  return db.prepare('INSERT INTO auctions(reward_id,title,minimum,ends_at) VALUES(?,?,?,?) RETURNING *')
    .get(reward, title, minimum, ends);
}

export function closeAuction(db, id) {
  const row = db.prepare('SELECT * FROM auctions WHERE id=?').get(id);
  if (!row) throw missing();
  if (row.closed_at) return row;
  if (row.ends_at > Date.now()) throw conflict('AUCTION_OPEN', 'Дождитесь окончания торгов.');
  return db.prepare('UPDATE auctions SET closed_at=? WHERE id=? RETURNING *').get(Date.now(), id);
}

export function campaigns(db) {
  return { items: db.prepare(`SELECT c.*,r.title,t.title AS task_title FROM cashback_campaigns c
    JOIN rewards r ON r.id=c.reward_id JOIN tasks t ON t.id=c.task_id ORDER BY c.id DESC`).all() };
}

export function saveCampaign(db, body) {
  const reward = reference(db, 'rewards', body.reward_id, 'reward_id');
  const task = reference(db, 'tasks', body.task_id, 'task_id');
  const percent = integer(body, 'percent', 1, 100);
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM cashback_campaigns WHERE reward_id=? AND active=1').get(reward)) {
      throw conflict('CAMPAIGN_EXISTS', 'Для товара уже действует акция.');
    }
    return db.prepare('INSERT INTO cashback_campaigns(reward_id,task_id,percent) VALUES(?,?,?) RETURNING *')
      .get(reward, task, percent);
  });
}

export function setCampaignActive(db, id, active) {
  return transaction(db, () => {
    const row = db.prepare('SELECT reward_id FROM cashback_campaigns WHERE id=?').get(id);
    if (!row) throw missing();
    if (active && db.prepare('SELECT 1 FROM cashback_campaigns WHERE reward_id=? AND active=1 AND id<>?').get(row.reward_id, id)) {
      throw conflict('CAMPAIGN_EXISTS', 'Для товара уже действует акция.');
    }
    return flag(db, 'cashback_campaigns', id, active);
  });
}

export const setChallengeActive = (db, id, active) => flag(db, 'challenges', id, active);
export const setPollActive = (db, id, active) => flag(db, 'polls', id, active);
