import { createGameUi, rewardImage } from './game.js';
import { createTimer, today } from './pomodoro.js';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const account = document.querySelector('#account');
const categories = {
  tasks: { onboarding: 'Адаптация', team: 'Команда', learning: 'Обучение' },
};
const statuses = { pending: 'На проверке', approved: 'Принято', rejected: 'На доработку' };
const sortOptions = { new: 'Сначала новые', 'points-desc': 'Больше баллов', 'points-asc': 'Меньше баллов' };
const date = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString('ru-RU');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const button = (label, href, style = '') =>
  `<a class="button ${style}" href="${href}">${escape(label)}</a>`;
const pill = (label, style = '') => `<span class="pill ${style}">${escape(label)}</span>`;
const option = (key, label, current) => `<option value="${key}" ${key === current ? 'selected' : ''}>${escape(label)}</option>`;
const title = (heading, lead = '') => `<h1>${escape(heading)}</h1>${lead ? `<p class="lead">${escape(lead)}</p>` : ''}`;
const formMessage = '<p class="form-message" role="status" aria-live="polite"></p>';
const notice = text => `<p class="status" role="status">${escape(text)}</p>`;
const empty = text => `<p class="surface">${escape(text)}</p>`;
const isReward = table => table === 'rewards';
const noun = table => isReward(table) ? 'Награды' : 'Задания';
let user = null;
let renderVersion = 0;
let site = { name: 'Командный ход', admin_theme: 'warm' };

async function api(url, { method = 'GET', body } = {}) {
  const response = await fetch('/api' + url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return result(response);
}

async function result(response) {
  if (response.status === 204) return;
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error.message);
    error.status = response.status;
    error.fields = payload.error.fields;
    throw error;
  }
  return payload;
}

async function catalogLabels(table, management = false) {
  if (table === 'tasks') return categories.tasks;
  const { items } = await api(management ? '/admin/reward-categories' : '/reward-categories');
  return Object.fromEntries(items.map(row => [row.code, row.label + (row.active ? '' : ' · архив')]));
}

function applySiteSettings(data, refreshLogo = false) {
  site = data;
  for (const el of document.querySelectorAll('[data-site-name]')) el.textContent = data.name;
  document.querySelector('meta[name="description"]').content = data.description;
  const contacts = document.querySelector('#site-contacts');
  contacts.replaceChildren();
  for (const [url,label] of [['mailto:' + data.contact,data.contact],[data.social_url,'Социальная сеть']]) {
    if (!label || !url) continue;
    const link = document.createElement('a');
    link.href = url;
    link.textContent = label;
    link.rel = 'noreferrer';
    contacts.append(link);
  }
  if (refreshLogo) {
    const url = '/site-logo?v=' + Date.now();
    document.querySelector('.brand img').src = url;
    document.querySelector('link[rel="icon"]').href = url;
  }
}

async function uploadLogo(file) {
  return result(await fetch('/api/admin/settings/logo', { method:'PUT', headers:{'Content-Type':'image/png'},body:file }));
}

const timer = createTimer({ api, title, formMessage });
const game = createGameUi({ api, escape, title, button, pill, notice, empty, formMessage, nextLogin, go, render,
  renderTimer: timer.renderTimer, today, applySiteSettings, uploadLogo });

function header(path) {
  const links = [['/', 'Главная'], ['/tasks', 'Задания'], ['/rewards', 'Награды'], ['/play', 'Активности'], ['/leaderboard', 'Рейтинг']];
  if (user?.role === 'admin') links.push(['/admin', 'Управление']);
  nav.innerHTML = links.map(([url, label]) => {
    const current = url === '/play' ? game.isPath(path) && !['/cart','/orders'].includes(path)
      : url === '/rewards' && ['/cart','/orders'].includes(path) ? true : url === '/' ? path === url : path.startsWith(url);
    return `<a href="#${url}" ${current ? 'aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  account.innerHTML = user
    ? '<a href="#/profile">Кабинет</a><button type="button" data-action="logout">Выйти</button>'
    : '<a href="#/login">Войти</a>';
}

function catalogList(items, table, featured = false, labels = categories.tasks) {
  if (isReward(table)) return `<div class="product-grid">${items.map(item => `<a class="product-card" href="#/rewards/${item.id}">
    ${rewardImage(item)}<div class="product-body">${pill(labels[item.category])}
    <h2>${escape(item.title)}</h2><p>${escape(item.description)}</p>
    <div class="row-line product-price"><strong>${item.points} б.</strong><span aria-hidden="true">↗</span></div></div></a>`).join('')}</div>`;
  return `<ul class="catalog-list${featured ? ' featured-list' : ''}">${items.map(item => `<li>
    <a class="catalog-entry" href="#/${table}/${item.id}" aria-label="Подробнее: ${escape(item.title)}">
      <span class="catalog-category">${escape(labels[item.category])}</span>
      <span class="catalog-info">
        <strong>${escape(item.title)}</strong>
        <span class="catalog-description">${escape(item.description)}</span>
      </span>
      <span class="catalog-points">+${item.points}<small> б.</small></span>
      <span class="catalog-arrow" aria-hidden="true">↗</span>
    </a>
  </li>`).join('')}</ul>`;
}

async function home() {
  const { items } = await api('/tasks?sort=points-desc');
  return `<section class="hero">
    <div class="hero-intro">
      <h1>Задания<br> для команды</h1>
      <p class="lead">Выполняйте задания, получайте баллы за принятые отчёты и обменивайте их на награды.</p>
      <div class="actions">${button('Смотреть задания', '#/tasks', 'primary')}
        ${button('Все активности', '#/play', 'quiet')}</div>
    </div>
    <img class="hero-photo" src="/team-move-hero.webp" alt="" fetchpriority="high">
  </section>
  <ol class="route-steps" aria-label="Как это работает" role="list">
    <li><span aria-hidden="true">1</span>Выберите задание</li>
    <li><span aria-hidden="true">2</span>Отправьте отчёт на проверку</li>
    <li><span aria-hidden="true">3</span>Обменяйте баллы на награду</li>
  </ol>
  <section class="section home-tasks">
    <div class="section-title"><h2>Открытые задания</h2><a href="#/tasks">Все задания</a></div>
    ${items.length ? catalogList(items.slice(0, 3), 'tasks', true) : empty('Открытые задания появятся здесь.')}
  </section>`;
}

async function catalog(table, params) {
  const [{ items }, labels] = await Promise.all([api('/' + table + '?' + params.toString()), catalogLabels(table)]);
  const intro = isReward(table) ? `<header class="reward-intro">
      <div>${title('Каталог наград', 'Выберите, на что потратить заработанные баллы.')}
      <div class="actions">${button('Корзина', '#/cart', 'primary')}${user?.role === 'employee' ? button('Мои заказы', '#/orders') : ''}</div></div>
      <img src="/team-move-rewards.webp" alt="">
    </header>` : title('Задания', 'Выберите задание и отправьте короткий отчёт после выполнения.');
  return `${intro}
    <form class="filters" data-form="filters" data-target="/${table}">
      <label>Поиск<input name="q" maxlength="100" type="search" placeholder="Название или описание" value="${escape(params.get('q'))}"></label>
      <label>Категория<select name="category"><option value="">Все категории</option>
        ${Object.entries(labels).map(([key, label]) => option(key, label, params.get('category'))).join('')}</select></label>
      <label>Сортировка<select name="sort">${Object.entries(sortOptions).map(([key, label]) => option(key, label, params.get('sort') || 'new')).join('')}</select></label>
      <button class="button primary">Найти</button>
    </form><p class="form-note">Найдено: ${items.length}</p>
    <div class="compact-actions">${items.length ? catalogList(items, table, false, labels) : empty('Измените запрос или выберите другую категорию.')}</div>`;
}

function nextLogin(path) {
  return '#/login?' + new URLSearchParams({ next: path });
}

async function detail(table, id) {
  const [item, labels] = await Promise.all([api('/' + table + '/' + id), catalogLabels(table)]);
  const reward = isReward(table);
  const path = '/' + table + '/' + id;
  let operation = button('Войти в аккаунт', nextLogin(path), 'primary');
  let balance = '';
  if (user?.role === 'employee') {
    const data = await api('/me/dashboard');
    balance = reward ? `<p>Ваш баланс: <strong>${data.balance} б.</strong></p>` : '';
    const submission = data.submissions.find(row => row.task_id === id);
    if (reward) {
      operation = `<form class="form" data-form="game-cart-add" data-id="${id}">
        <div class="actions compact-actions"><button class="button primary">В корзину</button>${button('Открыть корзину', '#/cart')}</div>${formMessage}</form>`;
    } else if (item.category === 'onboarding') {
      operation = button('Открыть квест адаптации', '#/onboarding', 'primary');
    } else {
      operation = submission && submission.status !== 'rejected' ? notice(statuses[submission.status])
        : `${submission ? notice('Комментарий: ' + submission.feedback) : ''}
          <form class="form" data-form="submit-task" data-id="${id}">
          <label>Отчёт<textarea required name="note" minlength="10" maxlength="1000" placeholder="Что вы сделали и каким был результат?"></textarea></label>
          <p class="form-note">От 10 до 1 000 символов.</p>
          <button class="button primary">Отправить на проверку</button>${formMessage}</form>`;
    }
  } else if (user) {
    operation = button('Открыть управление', '#/admin/' + table + '/' + id);
  }
  return `<a class="back" href="#/${table}">← ${noun(table)}</a>${title(item.title)}
    <div class="detail"><article class="surface"><div class="card-meta">${pill(labels[item.category])}</div>
    <h2 class="compact-actions">${reward ? 'О награде' : 'Что нужно сделать'}</h2><p>${escape(item.description)}</p>
    ${reward ? `<div class="detail-product compact-actions">${rewardImage(item, false)}</div>` : ''}</article>
    <section class="surface"><h2>${reward ? 'Добавить в заказ' : 'Сдать задание'}</h2>
    <p>${reward ? 'Стоимость' : 'За принятый отчёт'}: <strong>${item.points} б.</strong></p>${balance}
    <div class="compact-actions">${operation}</div></section></div>`;
}

function auth(mode, params) {
  const registering = mode === 'register';
  const next = params.get('next') ?? '';
  const safe = /^\/(tasks|rewards)(?:\/[1-9]\d*)?$/.test(next) || /^\/(profile|leaderboard)$/.test(next) || game.isPath(next) ? next : '/profile';
  const suffix = '?' + new URLSearchParams({ next: safe });
  return `<section class="surface auth-frame">${title(registering ? 'Создать аккаунт' : 'Войти', registering ? 'Зарегистрируйтесь как сотрудник.' : 'Откройте кабинет и продолжите работу с заданиями.')}
    <form class="form" data-form="${mode}" data-next="${safe}">
      ${registering ? '<label>Имя<input name="name" autocomplete="name" minlength="2" maxlength="80" required></label>' : ''}
      <label>Email<input name="email" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com" required></label>
      <label>Пароль<input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}"
        ${registering ? 'minlength="8"' : ''} maxlength="128" required></label>
      ${registering ? '<p class="form-note">От 8 символов.</p>' : ''}
      <button class="button primary">${registering ? 'Зарегистрироваться' : 'Войти'}</button>${formMessage}
    </form><p class="compact-actions"><a href="#/${registering ? 'login' : 'register'}${suffix}">${registering ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт'}</a></p></section>`;
}

async function profile() {
  const data = await api('/me/dashboard');
  const { progress, balance, submissions, ledger, redemptions, orderCount } = data;
  const employee = data.user.role === 'employee';
  return `${title('Личный кабинет', data.user.name + ' · ' + data.user.email)}
    <section class="stats section" aria-label="Сводка">
      <div class="stat">Баланс<strong>${balance} б.</strong></div>
      <div class="stat">Отчёты приняты<strong>${submissions.filter(row => row.status === 'approved').length}</strong></div>
      <div class="stat">Награды получены<strong>${redemptions.length + orderCount}</strong></div></section>
    ${employee ? `<div class="actions">${button('Мои заказы','#/orders')}${button('Публичный профиль','#/employees/' + data.user.id)}
      ${button('Кэшбек','#/cashback')}</div>` : ''}
    <section class="section surface"><div class="section-title"><h2>Адаптация</h2>${employee ? '<a href="#/onboarding">Открыть квест</a>' : ''}</div>
      <p>Выполнено ${progress.completed} из ${progress.total}</p>
      <progress class="progress" aria-label="Прогресс адаптации" value="${progress.completed}" max="${progress.total || 1}"></progress></section>
    <div class="split section"><section class="surface"><h2>Мои отчёты</h2>
      ${submissions.length ? `<ul class="rows">${submissions.map(row => `<li><div class="row-line"><strong>${escape(row.title)}</strong>${pill(statuses[row.status], row.status)}</div>
        ${row.feedback ? `<p>${escape(row.feedback)}</p>` : ''}${row.status === 'rejected' && row.active ? `<a href="#/${row.category === 'onboarding' ? 'onboarding' : 'tasks/' + row.task_id}">Доработать отчёт</a>` : ''}</li>`).join('')}</ul>` : '<p>Отчётов пока нет.</p>'}
    </section><section class="surface"><h2>История баллов</h2>
      ${ledger.length ? `<ul class="rows">${ledger.map(row => `<li class="row-line"><span>${escape(row.title)}<br><small>${date(row.created_at)}</small></span><strong>${row.amount > 0 ? '+' : ''}${row.amount} б.</strong></li>`).join('')}</ul>` : '<p>Операций пока нет.</p>'}
    </section></div>
    <div class="split section"><section class="surface"><h2>Настройки профиля</h2>
      <form class="form" data-form="profile"><label>Имя<input name="name" value="${escape(data.user.name)}" required minlength="2" maxlength="80"></label>
      <button class="button">Сохранить имя</button>${formMessage}</form></section>
    <section class="surface"><h2>Мои награды</h2>
      ${redemptions.length ? `<ul class="rows">${redemptions.map(row => `<li class="row-line"><strong>${escape(row.title)}</strong><span>${row.points} б.</span></li>`).join('')}</ul>` : '<p>Обменов пока нет.</p>'}
    </section></div>`;
}

async function leaderboard(params) {
  const metric = params.get('metric') === 'tasks' ? 'tasks' : 'points';
  const { items } = await api('/leaderboard?metric=' + metric);
  return `${title('Рейтинг команды', 'Показатели обновляются после проверки отчётов.')}
    <div class="actions">${button('По заработанным баллам', '#/leaderboard?metric=points', metric === 'points' ? 'primary' : '')}
    ${button('По выполненным заданиям', '#/leaderboard?metric=tasks', metric === 'tasks' ? 'primary' : '')}</div>
    <section class="surface section">${items.length ? `<ol class="rows">${items.map((item, index) =>
      `<li class="row-line"><span>${index + 1}. ${escape(item.name)}</span><strong>${item.score} ${metric === 'points' ? 'б.' : 'зад.'}</strong></li>`).join('')}</ol>` : '<p>Рейтинг появится после первого принятого отчёта.</p>'}</section>`;
}

async function adminPage(params) {
  const queueStatus = params.get('status') || 'pending';
  const [tasks, rewards, reviews] = await Promise.all([
    api('/admin/tasks'), api('/admin/rewards'), api('/admin/submissions?status=' + encodeURIComponent(queueStatus)),
  ]);
  return `${title('Управление', 'Проверяйте отчёты сотрудников, обновляйте задания и награды.')}
    ${game.adminLinks()}<section class="section"><h2>Отчёты сотрудников</h2>
      <div class="actions">${Object.entries(statuses).map(([key, label]) =>
        button(label, '#/admin?status=' + key, key === queueStatus ? 'primary' : '')).join('')}</div>
      <div class="split compact-actions">${reviews.items.map(row => `<article class="card">
        <h3>${escape(row.title)}</h3><p>${escape(row.name)} · ${row.points} б.</p><p>${escape(row.note)}</p>
        ${row.status === 'pending' ? `<form class="form" data-form="review" data-id="${row.id}">
          <label>Комментарий<textarea name="feedback" maxlength="500" placeholder="Обязателен при возврате"></textarea></label>
          <div class="actions compact-actions"><button class="button primary" name="decision" value="approved">Принять</button>
          <button class="button danger" name="decision" value="rejected">Вернуть</button></div>${formMessage}</form>` : `<p>${escape(row.feedback)}</p>`}
        </article>`).join('') || empty('В этом разделе пока нет отчётов.')}</div></section>
    <div class="split section">${[['tasks', tasks.items], ['rewards', rewards.items]].map(([table, items]) => `<section class="surface">
      <div class="section-title"><h2>${noun(table)}</h2>${button('Добавить', '#/admin/' + table + '/new', 'primary')}</div>
      <ul class="rows">${items.map(item => `<li class="row-line"><span>${escape(item.title)} · ${item.points} б.${item.active ? '' : ' · архив'}</span>
        <a href="#/admin/${table}/${item.id}">Изменить</a></li>`).join('')}</ul></section>`).join('')}</div>`;
}

async function editor(table, id) {
  const [item, labels] = await Promise.all([id === 'new' ? {} : api('/admin/' + table + '/' + id), catalogLabels(table, true)]);
  const label = isReward(table) ? 'награду' : 'задание';
  return `<a class="back" href="#/admin">← Управление</a><section class="surface narrow">${title((item.id ? 'Изменить ' : 'Добавить ') + label)}
    <form class="form" data-form="editor" data-table="${table}" data-id="${item.id ?? ''}">
      <label>Название<input name="title" value="${escape(item.title)}" required minlength="3" maxlength="100"></label>
      <label>Описание<textarea name="description" required minlength="10" maxlength="1200">${escape(item.description)}</textarea></label>
      <label>Категория<select name="category" required><option value="">Выберите категорию</option>
      ${Object.entries(labels).map(([key, text]) => option(key, text, item.category)).join('')}</select></label>
      ${isReward(table) ? `<label>Фото<select name="image">${Object.entries({ '': 'Без фото', coffee: 'Кофе', book: 'Книга', notebook: 'Блокнот' })
        .map(([key,label]) => option(key,label,item.image ?? '')).join('')}</select></label>` : ''}
      <label>${isReward(table) ? 'Стоимость в баллах' : 'Баллы за выполнение'}<input name="points" type="number" required min="1" max="10000" value="${item.points ?? ''}"></label>
      <label class="check"><input type="checkbox" name="active" ${item.active === 0 ? '' : 'checked'}>Видно в каталоге</label>
      <div class="actions compact-actions"><button class="button primary">Сохранить</button>
      ${item.active ? '<button type="submit" formnovalidate class="button danger" name="decision" value="archive">Убрать в архив</button>' : ''}</div>
      ${formMessage}</form></section>`;
}

async function view(path, params) {
  if (path === '/') return home();
  if (path === '/tasks' || path === '/rewards') return catalog(path.slice(1), params);
  const object = /^\/(tasks|rewards)\/([1-9]\d{0,14})$/.exec(path);
  if (object) return detail(object[1], Number(object[2]));
  if (path === '/login' || path === '/register') return auth(path.slice(1), params);
  const activity = await game.view(path, params, user);
  if (activity !== undefined) return activity;
  if (path === '/profile' || path === '/leaderboard') {
    if (!user) return `${title('Требуется вход')}<div class="actions">${button('Войти', nextLogin(path), 'primary')}</div>`;
    return path === '/profile' ? profile() : leaderboard(params);
  }
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (user?.role !== 'admin') return `${title('Доступ для администраторов')}<div class="actions">${button('На главную', '#/')}</div>`;
    if (path === '/admin') return adminPage(params);
    const match = /^\/admin\/(tasks|rewards)\/(new|[1-9]\d{0,14})$/.exec(path);
    if (match) return editor(match[1], match[2]);
  }
  return `${title('Страница не найдена')}<div class="actions">${button('На главную', '#/')}</div>`;
}

async function render({ focus = false, message = '' } = {}) {
  const version = ++renderVersion;
  const [path, search] = (location.hash.slice(1).startsWith('/') ? location.hash.slice(1) : '/').split('?');
  document.body.dataset.adminTheme = path.startsWith('/admin') ? site.admin_theme : 'warm';
  header(path);
  main.setAttribute('aria-busy', 'true');
  main.innerHTML = '<p role="status">Загружаем данные…</p>';
  try {
    const content = await view(path, new URLSearchParams(search));
    if (version !== renderVersion) return;
    main.innerHTML = (message ? notice(message) : '') + content;
    if (path === '/wheel' && message.startsWith('Результат ×')) main.querySelector('.wheel-result')?.classList.add('wheel-animate');
    timer.show();
  } catch (error) {
    if (version !== renderVersion) return;
    if (error.status === 401) {
      user = null;
      header(path);
      main.innerHTML = `${title('Сеанс завершён')}<div class="actions">${button('Войти', nextLogin(path), 'primary')}</div>`;
    } else {
      main.innerHTML = `${title(error.status === 404 ? 'Запись не найдена' : 'Данные недоступны')}
        <p class="status error" role="alert">${escape(error.status ? error.message : 'Проверьте подключение и повторите попытку.')}</p>
        <div class="actions"><button class="button" data-action="retry">Обновить</button>${button('На главную', '#/')}</div>`;
    }
  } finally {
    if (version === renderVersion) {
      main.removeAttribute('aria-busy');
      document.title = (main.querySelector('h1')?.textContent || 'Портал') + ' · ' + site.name;
      if (focus) main.focus();
    }
  }
}

function go(path) {
  if (location.hash === '#' + path) return render({ focus: true });
  location.hash = path;
}

async function submit(form, submitter) {
  const { form: kind, id, next, target, table } = form.dataset;
  const data = Object.fromEntries(new FormData(form));
  const decision = submitter?.value;
  if (kind === 'filters') {
    const params = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => { if (value.trim()) params.set(key, value.trim()); });
    return go(target + '?' + params);
  }
  const message = form.querySelector('.form-message');
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(item => { item.disabled = true; });
  form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
  message.className = 'form-message';
  message.textContent = 'Отправляем…';
  try {
    if (kind.startsWith('game-')) return await game.submit(kind.slice(5), id, data, decision, form);
    if (kind === 'timer-settings') {
      timer.settings(data, user);
      message.textContent = 'Настройки сохранены.';
      return;
    }
    if (kind === 'login' || kind === 'register') {
      user = await api('/auth/' + kind, { method: 'POST', body: data });
      return go(next);
    }
    if (kind === 'profile') {
      user = await api('/me', { method: 'PATCH', body: data });
      return render({ focus: true, message: 'Имя сохранено.' });
    }
    if (kind === 'submit-task') {
      await api('/tasks/' + id + '/submit', { method: 'POST', body: data });
      return render({ focus: true, message: 'Отчёт отправлен на проверку.' });
    }
    if (kind === 'review') {
      await api('/admin/submissions/' + id, { method: 'PATCH', body: { status: decision, feedback: data.feedback } });
      return render({ focus: true, message: decision === 'approved' ? 'Отчёт принят. Баллы начислены.' : 'Отчёт возвращён сотруднику.' });
    }
    if (kind === 'editor') {
      const url = '/admin/' + table + (id ? '/' + id : '');
      if (decision === 'archive') {
        if (!window.confirm('Убрать эту запись из публичного каталога?')) {
          message.textContent = '';
          return;
        }
        await api(url, { method: 'DELETE' });
      } else {
        await api(url, { method: id ? 'PUT' : 'POST', body: { ...data, points: Number(data.points), active: data.active === 'on' } });
      }
      return go('/admin');
    }
  } catch (error) {
    if (error.status === 401 && kind !== 'login' && kind !== 'register') {
      user = null;
      return render({ focus: true, message: 'Сеанс завершён. Войдите снова.' });
    }
    message.className = 'form-message error';
    message.textContent = error.fields ? Object.values(error.fields).join(' ')
      : error.status ? error.message : 'Проверьте подключение и повторите попытку.';
    for (const field of Object.keys(error.fields ?? {})) {
      const input = form.elements.namedItem(field);
      if (input instanceof Element) input.setAttribute('aria-invalid', 'true');
    }
  } finally {
    buttons.forEach(item => { item.disabled = false; });
  }
}

main.addEventListener('submit', event => {
  if (!event.target.dataset.form) return;
  event.preventDefault();
  void submit(event.target, event.submitter);
});
main.addEventListener('click', event => {
  if (event.target.closest('[data-action="retry"]')) void render({ focus: true });
  const timerAction = event.target.closest('[data-timer-action]')?.dataset.timerAction;
  if (timerAction) timer.click(timerAction, user);
});
account.addEventListener('click', async event => {
  const control = event.target.closest('[data-action="logout"]');
  if (!control) return;
  control.disabled = true;
  try {
    await api('/auth/logout', { method: 'POST' });
    user = null;
    go('/');
  } catch {
    await render({ focus: true, message: 'Выход не выполнен. Проверьте подключение и повторите попытку.' });
  } finally {
    control.disabled = false;
  }
});
document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); main.focus(); });
window.addEventListener('hashchange', () => { void render({ focus: true }); });
const [session, settings] = await Promise.allSettled([api('/me'), api('/settings')]);
if (session.status === 'fulfilled') user = session.value;
else if (session.reason.status !== 401) console.warn('Не удалось загрузить сессию.');
if (settings.status === 'fulfilled') applySiteSettings(settings.value);
void render();
setInterval(() => timer.tick(user), 250);
