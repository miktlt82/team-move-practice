export function balanceOf(db, userId) {
  return db.prepare('SELECT COALESCE(SUM(amount),0) AS balance FROM wallet_entries WHERE user_id=?').get(userId).balance;
}

export function recordPoints(db, userId, amount, kind, key, title) {
  if (amount === 0) return;
  db.prepare('INSERT INTO extended_points(user_id,amount,kind,source_key,title) VALUES(?,?,?,?,?)')
    .run(userId, amount, kind, key, title);
}
