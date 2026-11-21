import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { passwordHash } from './auth.js';
import { starterTasks, starterRewards } from './catalog.js';

export const demoAccounts = [
  ['employee@example.test', 'Алекс Морозов', 'EmployeeDemo!2026', 'employee'],
  ['admin@example.test', 'Анна Соколова', 'AdminDemo!2026', 'admin'],
];

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(filename, { demo = false, adminEmail, adminPassword } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const insertUser = db.prepare(
    'INSERT INTO users(email,name,password_hash,role) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING'
  );
  transaction(db, () => {
    if (adminEmail && adminPassword) {
      const account = db.prepare('SELECT role FROM users WHERE email=?').get(adminEmail);
      if (account && account.role !== 'admin') throw new Error('ADMIN_EMAIL is already used by an employee');
      if (!account) insertUser.run(adminEmail, 'Администратор', passwordHash(adminPassword), 'admin');
    }
    if (demo && !db.prepare('SELECT 1 FROM users WHERE email=?').get(demoAccounts[1][0])) {
      for (const [email, name, password, role] of demoAccounts) {
        insertUser.run(email, name, passwordHash(password), role);
      }
      for (const [table, rows] of [['tasks', starterTasks], ['rewards', starterRewards]]) {
        if (db.prepare('SELECT 1 FROM ' + table + ' LIMIT 1').get()) continue;
        const insert = db.prepare('INSERT INTO ' + table + '(title,description,category,points) VALUES(?,?,?,?)');
        for (const row of rows) insert.run(...row);
      }
    }
  });
  return db;
}
