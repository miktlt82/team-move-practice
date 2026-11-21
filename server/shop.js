import { transaction } from './db.js';
import { balanceOf, recordPoints } from './wallet.js';
import { conflict, invalid, missing, textValue } from './http.js';

export function cart(db, userId) {
  const items = db.prepare(`SELECT r.id,r.title,r.points,r.active,c.quantity,m.image
    FROM cart_items c JOIN rewards r ON r.id=c.reward_id LEFT JOIN reward_media m ON m.reward_id=r.id
    WHERE c.user_id=? ORDER BY c.reward_id`).all(userId);
  return { items, total: items.reduce((sum, row) => sum + row.points * row.quantity, 0), balance: balanceOf(db, userId) };
}

export function updateCart(db, userId, id, body) {
  return transaction(db, () => {
    if (body.add !== undefined && body.add !== true) throw invalid({ add: 'Выберите действие с корзиной.' });
    const current = db.prepare('SELECT quantity FROM cart_items WHERE user_id=? AND reward_id=?').get(userId, id);
    const quantity = body.add ? (current?.quantity ?? 0) + 1 : body.quantity;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20) throw invalid({ quantity: 'От 0 до 20 единиц товара.' });
    if (quantity === 0) db.prepare('DELETE FROM cart_items WHERE user_id=? AND reward_id=?').run(userId, id);
    else {
      if (!db.prepare('SELECT 1 FROM rewards WHERE id=? AND active=1').get(id)) throw missing();
      db.prepare(`INSERT INTO cart_items VALUES(?,?,?) ON CONFLICT(user_id,reward_id)
        DO UPDATE SET quantity=excluded.quantity`).run(userId, id, quantity);
    }
    return cart(db, userId);
  });
}

export function checkout(db, userId, body) {
  const comment = textValue({ comment: body.comment ?? '' }, 'comment', 0, 400, { label: 'Комментарий' });
  return transaction(db, () => {
    const { items, total, balance } = cart(db, userId);
    if (!items.length) throw conflict('EMPTY_CART', 'Корзина пуста.');
    if (items.some(row => !row.active)) throw conflict('REWARD_UNAVAILABLE', 'Удалите из корзины товары, снятые с продажи.');
    if (total > balance) throw conflict('INSUFFICIENT_POINTS', 'На балансе недостаточно баллов.');
    const order = db.prepare('INSERT INTO orders(user_id,total,comment) VALUES(?,?,?) RETURNING *').get(userId, total, comment);
    const insert = db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)');
    for (const row of items) insert.run(order.id, row.id, row.title, row.points, row.quantity);
    db.prepare(`INSERT INTO cashback_offers(order_id,campaign_id)
      SELECT i.order_id,c.id FROM order_items i JOIN cashback_campaigns c ON c.reward_id=i.reward_id
      JOIN tasks t ON t.id=c.task_id WHERE i.order_id=? AND c.active=1 AND t.active=1
      AND (i.quantity*i.unit_points*c.percent)/100>0`).run(order.id);
    recordPoints(db, userId, -total, 'order', 'order:' + order.id, 'Заказ №' + order.id);
    db.prepare('DELETE FROM cart_items WHERE user_id=?').run(userId);
    return { ...order, balance: balance - total };
  });
}

export function orders(db, userId = null) {
  const rows = db.prepare(`SELECT o.*,u.name FROM orders o JOIN users u ON u.id=o.user_id
    WHERE (? IS NULL OR o.user_id=?) ORDER BY o.id DESC`).all(userId, userId);
  const items = db.prepare('SELECT reward_id,title,unit_points,quantity FROM order_items WHERE order_id=? ORDER BY reward_id');
  return { items: rows.map(row => ({ ...row, items: items.all(row.id) })) };
}

export function fulfill(db, id) {
  const row = db.prepare("UPDATE orders SET status='fulfilled' WHERE id=? RETURNING *").get(id);
  if (!row) throw missing();
  return row;
}

export function cashback(db, userId) {
  const items = db.prepare(`SELECT c.id,c.percent,o.id AS order_id,i.title,t.id AS task_id,t.title AS task_title,
    t.description AS task_description,(i.quantity*i.unit_points*c.percent)/100 AS points,cl.points AS claimed_points,
    p.status AS task_status,p.feedback,CASE WHEN p.status='approved' THEN 1 ELSE 0 END AS ready
    FROM cashback_offers f JOIN cashback_campaigns c ON c.id=f.campaign_id
    JOIN order_items i ON i.order_id=f.order_id AND i.reward_id=c.reward_id
    JOIN orders o ON o.id=f.order_id
    JOIN tasks t ON t.id=c.task_id LEFT JOIN cashback_claims cl ON cl.order_id=o.id AND cl.campaign_id=c.id
    LEFT JOIN cashback_reports p ON p.order_id=o.id AND p.campaign_id=c.id
    WHERE o.user_id=?
      AND (i.quantity*i.unit_points*c.percent)/100>0 ORDER BY o.id DESC,c.id`).all(userId);
  const campaigns = db.prepare(`SELECT c.id,c.percent,r.title,t.title AS task_title
    FROM cashback_campaigns c JOIN rewards r ON r.id=c.reward_id JOIN tasks t ON t.id=c.task_id
    WHERE c.active=1 AND r.active=1 AND t.active=1 ORDER BY c.id`).all();
  return { items, campaigns };
}

export function submitCashback(db, userId, campaignId, body) {
  if (!Number.isSafeInteger(body.order_id) || body.order_id < 1) throw invalid({ order_id: 'Укажите номер заказа.' });
  const note = textValue(body, 'note', 10, 1000, { label: 'Отчёт' });
  return transaction(db, () => {
    const row = cashback(db, userId).items.find(item => item.id === campaignId && item.order_id === body.order_id);
    if (!row) throw missing();
    if (row.claimed_points || ['approved','pending'].includes(row.task_status)) {
      throw conflict('ALREADY_SUBMITTED', 'Отчёт по этому заказу уже отправлен.');
    }
    return db.prepare(`INSERT INTO cashback_reports(order_id,campaign_id,note) VALUES(?,?,?)
      ON CONFLICT(order_id,campaign_id) DO UPDATE SET note=excluded.note,status='pending',
      feedback=NULL,submitted_at=CURRENT_TIMESTAMP RETURNING *`).get(row.order_id, campaignId, note);
  });
}

export function cashbackReports(db) {
  return { items: db.prepare(`SELECT p.*,u.name,t.title FROM cashback_reports p
    JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=o.user_id JOIN cashback_campaigns c ON c.id=p.campaign_id
    JOIN tasks t ON t.id=c.task_id ORDER BY p.status<>'pending',p.submitted_at DESC`).all() };
}

export function reviewCashback(db, orderId, body) {
  if (!Number.isSafeInteger(body.campaign_id) || !['approved','rejected'].includes(body.status)) {
    throw invalid({ status: 'Выберите отчёт и решение.' });
  }
  const feedback = textValue({ feedback: body.feedback ?? '' }, 'feedback', body.status === 'rejected' ? 5 : 0, 500,
    { label: 'Комментарий' });
  const report = db.prepare(`UPDATE cashback_reports SET status=?,feedback=? WHERE order_id=? AND campaign_id=?
    AND status='pending' RETURNING *`).get(body.status, feedback || null, orderId, body.campaign_id);
  if (!report) throw conflict('REPORT_NOT_PENDING', 'Отчёт отсутствует или уже проверен.');
  return report;
}

export function claimCashback(db, userId, campaignId, body) {
  if (!Number.isSafeInteger(body.order_id) || body.order_id < 1) throw invalid({ order_id: 'Укажите номер заказа.' });
  return transaction(db, () => {
    const row = cashback(db, userId).items.find(item => item.id === campaignId && item.order_id === body.order_id);
    if (!row) throw missing();
    if (row.claimed_points) throw conflict('ALREADY_CLAIMED', 'Кэшбек по заказу уже начислен.');
    if (!row.ready) throw conflict('TASK_REQUIRED', 'После покупки выполните задание и дождитесь проверки.');
    db.prepare('INSERT INTO cashback_claims(campaign_id,order_id,user_id,points) VALUES(?,?,?,?)')
      .run(campaignId, row.order_id, userId, row.points);
    const title = 'Кэшбек за заказ №' + row.order_id;
    recordPoints(db, userId, row.points, 'cashback', 'cashback:' + row.order_id + ':' + campaignId, title);
    db.prepare('INSERT INTO notification_outbox(user_id,subject) VALUES(?,?)').run(userId, title + ': +' + row.points + ' б.');
    return { points: row.points, balance: balanceOf(db, userId) };
  });
}
