import { randomInt } from 'node:crypto';
import { transaction } from './db.js';
import { balanceOf, recordPoints } from './wallet.js';
import { conflict, invalid, missing, textValue } from './http.js';

const stakes = [1, 5, 10, 20, 30];
const outcomes = [[0, 40], [1, 35], [2, 20], [5, 5]];
const cooldown = 7 * 86400000;

export function wheel(db, userId) {
  const items = db.prepare('SELECT id,stake,multiplier,spun_at FROM wheel_spins WHERE user_id=? ORDER BY id DESC LIMIT 30').all(userId);
  return { items, stakes, outcomes, next_at: items.length ? items[0].spun_at + cooldown : null, balance: balanceOf(db, userId) };
}

export function spin(db, userId, stake) {
  if (!stakes.includes(stake)) throw invalid({ stake: 'Выберите одну из пяти ставок.' });
  return transaction(db, () => {
    const now = Date.now();
    const { next_at, balance } = wheel(db, userId);
    if (next_at && next_at > now) throw conflict('WHEEL_COOLDOWN', 'Вращение доступно раз в семь дней.');
    if (balance < stake) throw conflict('INSUFFICIENT_POINTS', 'На балансе недостаточно баллов.');
    let roll = randomInt(100);
    const [multiplier] = outcomes.find(([, weight]) => (roll -= weight) < 0);
    const result = db.prepare('INSERT INTO wheel_spins(user_id,stake,multiplier,spun_at) VALUES(?,?,?,?) RETURNING *')
      .get(userId, stake, multiplier, now);
    const net = stake * (multiplier - 1);
    recordPoints(db, userId, net, 'wheel', 'wheel:' + result.id, 'Колесо фортуны ×' + multiplier);
    return { ...result, net, balance: balance + net, next_at: now + cooldown };
  });
}

export function onboarding(db, userId) {
  const steps = db.prepare(`SELECT t.id,t.title,t.description,t.points,s.points AS report_points,s.status,s.feedback
    FROM tasks t LEFT JOIN submissions s ON s.task_id=t.id AND s.user_id=?
    WHERE t.category='onboarding' AND t.active=1 ORDER BY t.id`).all(userId);
  const current = steps.find(row => row.status !== 'approved')?.id ?? null;
  const completed = steps.filter(row => row.status === 'approved').length;
  const earned = steps.filter(row => row.status === 'approved').reduce((sum, row) => sum + row.report_points, 0);
  return { current, completed, earned, steps: steps.map(row => ({
    ...row, status: row.status === 'approved' || row.id === current ? row.status ?? 'available' : 'locked',
  })) };
}

export const departmentOf = (db, userId) =>
  db.prepare('SELECT department FROM employee_details WHERE user_id=?').get(userId)?.department ?? 'Общая команда';

export function employees(db, userId, url, id, management = false) {
  const q = textValue({ q: url.searchParams.get('q') ?? '' }, 'q', 0, 100, { label: 'Поиск' }).toLowerCase();
  const rows = db.prepare(`SELECT u.id,u.name,COALESCE(d.department,'Общая команда') AS department,
    COALESCE(d.bio,'') AS bio,(SELECT COUNT(*) FROM submissions s WHERE s.user_id=u.id AND s.status='approved') AS completed
    FROM users u LEFT JOIN employee_details d ON d.user_id=u.id
    WHERE u.role='employee' AND (? IS NULL OR u.id=?) ORDER BY u.name,u.id`).all(id ?? null, id ?? null);
  const badges = db.prepare(`SELECT c.badge,c.title FROM challenge_members m JOIN challenges c ON c.id=m.challenge_id
    WHERE m.user_id=? AND m.claimed_at IS NOT NULL ORDER BY m.claimed_at DESC`);
  if (id) {
    const row = rows[0];
    if (!row) throw missing();
    const achievements = db.prepare(`SELECT t.title,s.points,s.reviewed_at FROM submissions s JOIN tasks t ON t.id=s.task_id
      WHERE s.user_id=? AND s.status='approved' ORDER BY s.reviewed_at DESC,s.id DESC`).all(id);
    return { ...row, badges: badges.all(id), achievements, own: id === userId };
  }
  return { items: rows.filter(row => (row.name + ' ' + row.department).toLowerCase().includes(q))
    .map(({ bio, ...row }) => ({ ...row, ...(management ? { bio } : {}), badges: badges.all(row.id) })) };
}

export function updateEmployee(db, userId, body, admin = false) {
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role='employee'").get(userId)) throw missing();
  const field = admin ? 'department' : 'bio';
  const value = textValue(body, field, admin ? 2 : 0, admin ? 80 : 300, { label: admin ? 'Отдел' : 'О себе' });
  const profile = { [field]: value };
  if (admin && body.name !== undefined) profile.name = textValue(body,'name',2,80,{label:'Имя'});
  if (admin && body.bio !== undefined) profile.bio = textValue(body,'bio',0,300,{label:'О себе'});
  return transaction(db, () => {
    db.prepare(`INSERT INTO employee_details(user_id,${field}) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET ${field}=excluded.${field}`).run(userId, value);
    if (profile.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(profile.name,userId);
    if (admin && profile.bio !== undefined) db.prepare('UPDATE employee_details SET bio=? WHERE user_id=?').run(profile.bio,userId);
    return profile;
  });
}

export function challenge(db, userId, id) {
  const row = db.prepare('SELECT * FROM challenges WHERE id=?').get(id);
  if (!row) throw missing();
  const now = Date.now();
  const member = db.prepare('SELECT * FROM challenge_members WHERE challenge_id=? AND user_id=?').get(id, userId);
  const tasks = db.prepare(`SELECT t.id,t.title,t.points,t.active FROM challenge_tasks ct JOIN tasks t ON t.id=ct.task_id
    WHERE ct.challenge_id=? ORDER BY t.id`).all(id);
  const count = member ? db.prepare(`SELECT COUNT(*) AS progress FROM challenge_members m
    JOIN challenge_tasks ct ON ct.challenge_id=m.challenge_id
    JOIN submissions s ON s.user_id=m.user_id AND s.task_id=ct.task_id
    WHERE m.challenge_id=? AND s.status='approved'
    AND unixepoch(s.submitted_at)>=CAST(m.joined_at / 1000 AS INTEGER)
    AND unixepoch(s.reviewed_at) BETWEEN CAST(? / 1000 AS INTEGER) AND CAST(? / 1000 AS INTEGER)
    AND ((?='individual' AND m.user_id=?) OR (?='team' AND m.department=?))`)
    .get(id, row.starts_at, row.ends_at, row.mode, userId, row.mode, member.department).progress : 0;
  const status = !row.active || now >= row.ends_at ? 'ended' : now < row.starts_at ? 'upcoming' : 'open';
  const claimable = Boolean(member && !member.claimed_at && row.active && count >= row.target);
  return { ...row, tasks, status, joined: Boolean(member), department: member?.department ?? departmentOf(db, userId),
    claimed: Boolean(member?.claimed_at), progress: count, claimable };
}

export function challenges(db, userId) {
  return { items: db.prepare('SELECT id FROM challenges ORDER BY ends_at DESC,id').all().map(({ id }) => challenge(db, userId, id)) };
}

export function joinChallenge(db, userId, id) {
  return transaction(db, () => {
    const data = challenge(db, userId, id);
    if (data.joined) return data;
    if (data.status !== 'open') throw conflict('CHALLENGE_CLOSED', 'Регистрация в челлендже закрыта.');
    db.prepare('INSERT INTO challenge_members(challenge_id,user_id,department,joined_at) VALUES(?,?,?,?)')
      .run(id, userId, data.department, Date.now());
    return challenge(db, userId, id);
  });
}

export function claimChallenge(db, userId, id) {
  return transaction(db, () => {
    const data = challenge(db, userId, id);
    if (!data.claimable) throw conflict('CHALLENGE_NOT_CLAIMABLE', data.claimed ? 'Награда уже получена.' : 'Цель пока не достигнута.');
    db.prepare('UPDATE challenge_members SET claimed_at=? WHERE challenge_id=? AND user_id=?').run(Date.now(), id, userId);
    recordPoints(db, userId, data.points, 'challenge', 'challenge:' + id + ':' + userId, data.title);
    return { points: data.points, balance: balanceOf(db, userId), badge: data.badge };
  });
}

export function polls(db, userId, management = false) {
  const options = db.prepare(`SELECT o.id,o.title,o.correct,
    (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id=o.id) AS votes FROM poll_options o WHERE o.poll_id=? ORDER BY o.id`);
  const vote = db.prepare('SELECT option_id,points FROM poll_votes WHERE poll_id=? AND user_id=?');
  const items = db.prepare('SELECT * FROM polls WHERE active=1 OR ?=1 ORDER BY id').all(Number(management));
  return { items: items.map(row => {
    const voted = vote.get(row.id, userId) ?? null;
    return { ...row, voted, options: options.all(row.id).map(opt =>
      management || voted ? opt : { id: opt.id, title: opt.title }) };
  }) };
}

export function vote(db, userId, id, optionId) {
  if (!Number.isSafeInteger(optionId)) throw invalid({ option_id: 'Выберите вариант ответа.' });
  return transaction(db, () => {
    const poll = db.prepare('SELECT * FROM polls WHERE id=? AND active=1').get(id);
    if (!poll) throw missing();
    const option = db.prepare('SELECT correct FROM poll_options WHERE id=? AND poll_id=?').get(optionId, id);
    if (!option) throw invalid({ option_id: 'Ответ не относится к этому опросу.' });
    if (db.prepare('SELECT 1 FROM poll_votes WHERE poll_id=? AND user_id=?').get(id, userId)) {
      throw conflict('ALREADY_VOTED', 'Ответ уже сохранён.');
    }
    const points = poll.mode === 'survey' || option.correct ? poll.points : 0;
    db.prepare('INSERT INTO poll_votes(poll_id,user_id,option_id,points) VALUES(?,?,?,?)').run(id, userId, optionId, points);
    recordPoints(db, userId, points, 'poll', 'poll:' + id + ':' + userId, poll.title);
    return { points, correct: poll.mode === 'quiz' ? Boolean(option.correct) : null };
  });
}

export function auction(db, userId, id) {
  const lot = db.prepare(`SELECT a.*,r.title AS reward_title,m.image FROM auctions a JOIN rewards r ON r.id=a.reward_id
    LEFT JOIN reward_media m ON m.reward_id=r.id WHERE a.id=?`).get(id);
  if (!lot) throw missing();
  const bids = db.prepare(`SELECT b.id,b.amount,b.created_at,b.user_id,u.name FROM auction_bids b JOIN users u ON u.id=b.user_id
    WHERE b.auction_id=? ORDER BY b.id DESC LIMIT 30`).all(id);
  return { ...lot, open: !lot.closed_at && lot.ends_at > Date.now(), bids,
    leading: bids[0]?.user_id === userId, next_minimum: bids[0] ? bids[0].amount + 1 : lot.minimum };
}

export function auctions(db, userId) {
  return { items: db.prepare('SELECT id FROM auctions ORDER BY ends_at DESC').all().map(({ id }) => auction(db, userId, id)),
    balance: balanceOf(db, userId) };
}

export function bid(db, userId, id, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000) throw invalid({ amount: 'Введите от 1 до 100000 баллов.' });
  return transaction(db, () => {
    const lot = auction(db, userId, id);
    if (!lot.open) throw conflict('AUCTION_CLOSED', 'Торги завершены.');
    if (amount < lot.next_minimum) throw conflict('BID_TOO_LOW', 'Минимальная ставка сейчас: ' + lot.next_minimum + ' б.');
    const previous = lot.bids[0];
    const available = balanceOf(db, userId) + (lot.leading ? previous.amount : 0);
    if (available < amount) throw conflict('INSUFFICIENT_POINTS', 'На балансе недостаточно баллов.');
    const result = db.prepare('INSERT INTO auction_bids(auction_id,user_id,amount) VALUES(?,?,?) RETURNING *').get(id, userId, amount);
    if (previous) recordPoints(db, previous.user_id, previous.amount, 'bid_refund', 'refund:' + previous.id, 'Возврат ставки: ' + lot.title);
    recordPoints(db, userId, -amount, 'bid', 'bid:' + result.id, 'Ставка: ' + lot.title);
    return { ...result, balance: available - amount };
  });
}

function validatedDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw invalid({ day: 'Формат даты: ГГГГ-ММ-ДД.' });
  const parsed = new Date(day);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== day) throw invalid({ day: 'Укажите существующую дату.' });
  return day;
}

export function pomodoro(db, userId, day) {
  const items = db.prepare(`SELECT kind,COUNT(*) AS runs,SUM(minutes) AS minutes FROM pomodoro_sessions
    WHERE user_id=? AND local_day=? GROUP BY kind`).all(userId, validatedDay(day));
  return { day, items };
}

export function recordSession(db, userId, body) {
  const { run_id, kind, minutes, day } = body;
  if (typeof run_id !== 'string' || !/^[0-9a-f-]{36}$/.test(run_id)) throw invalid({ run_id: 'Некорректный идентификатор сессии.' });
  if (!['focus','short','long'].includes(kind)) throw invalid({ kind: 'Некорректный тип сессии.' });
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw invalid({ minutes: 'От 1 до 120 минут.' });
  db.prepare('INSERT OR IGNORE INTO pomodoro_sessions VALUES(?,?,?,?,?)').run(userId, run_id, kind, minutes, validatedDay(day));
  return pomodoro(db, userId, day);
}
