import { transaction } from './db.js';
import { conflict, invalid, missing, textValue } from './http.js';

export function rewardCategories(db, management = false) {
  return { items: db.prepare('SELECT * FROM store_categories WHERE active=1 OR ?=1 ORDER BY rowid').all(Number(management)) };
}

export function saveCategory(db, code, body) {
  const label = textValue(body, 'label', 2, 60, { label: 'Название категории' });
  if (!code) {
    const key = body.code;
    if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(key)) {
      throw invalid({ code: 'Код категории: 2–40 строчных латинских букв, цифр и дефисов.' });
    }
    const row = db.prepare('INSERT OR IGNORE INTO store_categories(code,label) VALUES(?,?) RETURNING *').get(key, label);
    if (!row) throw conflict('CATEGORY_EXISTS', 'Категория с этим кодом уже существует.');
    return row;
  }
  if (typeof body.active !== 'boolean') throw invalid({ active: 'Ожидается true или false.' });
  return transaction(db, () => {
    if (!body.active && db.prepare(`SELECT 1 FROM rewards r LEFT JOIN store_reward_categories s ON s.reward_id=r.id
      WHERE r.active=1 AND COALESCE(s.code,r.category)=? LIMIT 1`).get(code)) {
      throw conflict('CATEGORY_IN_USE', 'Сначала перенесите активные товары в другую категорию или архивируйте их.');
    }
    const row = db.prepare('UPDATE store_categories SET label=?,active=? WHERE code=? RETURNING *').get(label, Number(body.active), code);
    if (!row) throw missing();
    return row;
  });
}

const defaultSettings = {
  name: 'Командный ход',
  description: 'Корпоративный портал заданий, адаптации и наград.',
  contact: '',
  social_url: '',
  admin_theme: 'warm',
  custom_logo: false,
};

export function siteSettings(db) {
  const row = db.prepare('SELECT name,description,contact,social_url,admin_theme,logo IS NOT NULL AS custom_logo FROM site_settings WHERE id=1').get();
  return row ? { ...row, custom_logo: Boolean(row.custom_logo) } : defaultSettings;
}

export function saveSiteSettings(db, body) {
  const name = textValue(body,'name',2,55,{label:'Название сайта'});
  const description = textValue(body,'description',10,160,{label:'SEO-описание'});
  const contact = textValue(body,'contact',0,120,{label:'Контактный email'});
  const social = textValue(body,'social_url',0,300,{label:'Ссылка на соцсеть'});
  if (contact && !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(contact)) throw invalid({contact:'Введите контактный email.'});
  if (social) {
    let url;
    try { url = new URL(social); } catch { /* Report invalid input below. */ }
    if (url?.protocol !== 'https:' || url.username || url.password) throw invalid({social_url:'Введите ссылку, начинающуюся с https://.'});
  }
  if (!['warm','slate'].includes(body.admin_theme)) throw invalid({admin_theme:'Выберите цветовую схему.'});
  db.prepare(`INSERT INTO site_settings(id,name,description,contact,social_url,admin_theme) VALUES(1,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,contact=excluded.contact,
    social_url=excluded.social_url,admin_theme=excluded.admin_theme`).run(name,description,contact,social,body.admin_theme);
  return siteSettings(db);
}

export function saveLogo(db, logo) {
  const { name,description,contact,social_url,admin_theme } = siteSettings(db);
  db.prepare(`INSERT INTO site_settings(id,name,description,contact,social_url,admin_theme,logo) VALUES(1,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET logo=excluded.logo`).run(name,description,contact,social_url,admin_theme,logo);
  return siteSettings(db);
}
