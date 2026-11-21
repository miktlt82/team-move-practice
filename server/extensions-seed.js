import { passwordHash } from './auth.js';
import { recordPoints } from './wallet.js';

export function seedExtensions(db) {
  if (!db.prepare('INSERT OR IGNORE INTO demo_extensions(id) VALUES(1)').run().changes) return;
  const detail = db.prepare('INSERT OR IGNORE INTO employee_details(user_id,department,bio) VALUES(?,?,?)');
  const demo = db.prepare("SELECT id FROM users WHERE email='employee@example.test'").get();
  if (demo) {
    detail.run(demo.id, 'Разработка', 'Изучаю командные инструменты и собираю идеи для улучшения портала.');
    recordPoints(db, demo.id, 350, 'demo', 'demo:start:' + demo.id, 'Стартовые баллы демостенда');
  }
  const employee = db.prepare('INSERT OR IGNORE INTO users(email,name,password_hash) VALUES(?,?,?) RETURNING id');
  for (const [email, name, department, bio] of [
    ['ira@example.test', 'Ирина Волкова', 'Разработка', 'Помогаю новым коллегам освоиться в команде.'],
    ['pavel@example.test', 'Павел Орлов', 'Поддержка', 'Собираю обратную связь и улучшаю внутренние инструкции.'],
  ]) {
    const row = employee.get(email, name, passwordHash('EmployeeDemo!2026'));
    if (row) detail.run(row.id, department, bio);
  }
  const tasks = db.prepare('SELECT id,category FROM tasks ORDER BY id').all();
  const rewards = db.prepare('SELECT id,category FROM rewards ORDER BY id').all();
  const task = category => tasks.find(row => row.category === category)?.id;
  const reward = category => rewards.find(row => row.category === category)?.id;
  for (const [category, image] of [['perks','coffee'], ['learning','book'], ['merch','notebook']]) {
    if (reward(category)) db.prepare('INSERT OR IGNORE INTO reward_media VALUES(?,?)').run(reward(category), image);
  }
  const now = Date.now();
  const day = 86400000;
  const challenge = db.prepare('INSERT INTO challenges(title,description,mode,target,points,badge,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?) RETURNING id');
  for (const [title, description, mode, target, points, badge, starts, ends, ids] of [
    ['Первый командный ход', 'Вступите в челлендж и сдайте отчёт по одному из заданий адаптации.', 'individual', 1, 70, 'Первый ход', -1, 30, [task('onboarding')]],
    ['Неделя полезных идей', 'Выполняйте задания вместе с коллегами из своего отдела. Зачтутся принятые отчёты участников.', 'team', 2, 100, 'Командный игрок', -1, 30, [task('team'), task('learning')]],
    ['Осенний обмен опытом', 'Архив челленджа по обмену рабочими находками.', 'team', 1, 50, 'Наставник', -14, -7, [task('learning')]],
  ]) {
    if (ids.some(id => !id)) continue;
    const { id } = challenge.get(title, description, mode, target, points, badge, now + starts * day, now + ends * day);
    for (const taskId of ids) db.prepare('INSERT INTO challenge_tasks VALUES(?,?)').run(id, taskId);
  }
  const poll = db.prepare('INSERT INTO polls(title,question,mode,points) VALUES(?,?,?,?) RETURNING id');
  for (const [title, question, mode, points, options] of [
    ['Что добавить в каталог?', 'Какую награду вы выбрали бы в следующем месяце?', 'survey', 15, ['Сертификат в книжный','Билет на выставку','Командный обед']],
    ['Как начисляются баллы?', 'Когда за задание начисляют баллы?', 'quiz', 25, ['Когда администратор принимает отчёт','При открытии задания','Сразу после отправки отчёта']],
  ]) {
    const { id } = poll.get(title, question, mode, points);
    for (const [index, option] of options.entries()) {
      db.prepare('INSERT INTO poll_options(poll_id,title,correct) VALUES(?,?,?)').run(id, option, Number(mode === 'quiz' && index === 0));
    }
  }
  if (reward('merch')) db.prepare('INSERT INTO auctions(reward_id,title,minimum,ends_at) VALUES(?,?,?,?)')
    .run(reward('merch'), 'Блокнот из небольшой серии', 50, now + 30 * day);
  if (reward('perks') && task('learning')) db.prepare('INSERT INTO cashback_campaigns(reward_id,task_id,percent) VALUES(?,?,?)')
    .run(reward('perks'), task('learning'), 25);
}
