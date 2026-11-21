const tools = [
  ['onboarding', 'Квест адаптации', 'Пройдите первые шаги в компании.', '↗'],
  ['challenges', 'Челленджи', 'Выполняйте задания сами или вместе с отделом.', '⚑'],
  ['employees', 'Сотрудники', 'Найдите коллег и посмотрите их достижения.', '◎'],
  ['wheel', 'Колесо фортуны', 'Одна попытка в неделю за внутренние баллы.', '◈'],
  ['pomodoro', 'Таймер Pomodoro', 'Чередуйте работу и перерывы.', '◷'],
  ['polls', 'Опросы и квизы', 'Оставляйте отзывы и отвечайте на вопросы.', '☷'],
  ['auctions', 'Аукционы', 'Ставьте баллы на лоты компании.', '◇'],
  ['cashback', 'Кэшбек', 'Выполняйте задания после покупки и возвращайте часть баллов.', '↺'],
];
const employeePaths = new Set(['cart','orders','onboarding','challenges','wheel','pomodoro','polls','auctions','cashback']);
const statusLabels = { available: 'Можно начать', pending: 'На проверке', approved: 'Готово', rejected: 'На доработку', locked: 'Недоступно' };
const challengeStates = { open: 'Идёт', upcoming: 'Скоро', ended: 'Завершён' };
const adminTools = [
  ['orders','Заказы'], ['challenges','Челленджи'], ['polls','Опросы и квизы'], ['auctions','Аукционы'],
  ['cashback','Кэшбек'], ['employees','Профили сотрудников'], ['reward-categories','Категории наград'], ['settings','Настройки сайта'],
];
const assets = { coffee: '/team-move-rewards.webp', book: '/team-reward-book.webp', notebook: '/team-reward-notebook.webp' };

export function rewardImage(row, lazy = true) {
  const src = assets[row.image];
  return src ? `<img class="product-image" src="${src}" alt="" ${lazy ? 'loading="lazy"' : ''}>`
    : '<span class="product-image product-placeholder" aria-hidden="true">◇</span>';
}

export function createGameUi({ api, escape: e, title, button, pill, notice, empty, formMessage, nextLogin, go, render,
  renderTimer, today, applySiteSettings, uploadLogo }) {
  const when = value => new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(typeof value === 'string' ? value.replace(' ', 'T') + 'Z' : value));
  const money = value => `${value} б.`;
  const signed = value => `${value > 0 ? '+' : ''}${money(value)}`;
  const back = (label, path = 'play') => `<a class="back" href="#/${path}">← ${label}</a>`;
  const control = (label, style = 'primary') => `<button class="button ${style}">${label}</button>`;
  const form = (kind, id, content, extra = '') => `<form class="form" data-form="game-${kind}" data-id="${id ?? ''}" ${extra}>${content}${formMessage}</form>`;
  const hidden = (key, value) => `<input type="hidden" name="${key}" value="${value}">`;
  const number = (key, label, min, max, value) => `<label>${label}<input type="number" name="${key}" min="${min}" max="${max}" value="${value ?? ''}" required></label>`;
  const opt = (value, label) => `<option value="${value}">${e(label)}</option>`;
  const select = (name, label, options, multiple = false) => `<label>${label}<select name="${name}" ${multiple ? 'multiple size="5"' : ''} required>
    ${options.map(([value, text]) => opt(value, text)).join('')}</select></label>`;
  const progress = (current, max) => `<p>Выполнено ${current} из ${max}</p><progress aria-label="Прогресс" class="progress" value="${current}" max="${max || 1}"></progress>`;
  const action = (kind, id, label, fields = '', style) => form(kind, id, fields + control(label, style));
  const initials = name => name.split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase();
  const department = row => pill(row.mode === 'team' ? 'Командный' : 'Индивидуальный');
  const adminLinks = () => `<div class="actions">${adminTools.map(([path,label]) => button(label, '#/admin/' + path)).join('')}</div>`;

  function hub(user) {
    return `${title('Активности', 'Найдите коллег, пройдите квест или выберите командный челлендж.')}
      ${!user ? `<div class="actions">${button('Войти', nextLogin('/play'), 'primary')}</div>` : ''}
      <div class="tile-grid section">${tools.map(([path,name,desc,icon]) => `<a class="activity-tile" href="#/${path}">
        <span class="activity-icon" aria-hidden="true">${icon}</span><h2>${name}</h2><p>${desc}</p>
        <span class="tile-arrow" aria-hidden="true">↗</span></a>`).join('')}</div>`;
  }

  async function cart() {
    const { items,total,balance } = await api('/cart');
    return `${back('Каталог наград','rewards')}${title('Корзина')}
      <div class="detail"><section class="surface"><h2>Товары</h2>${items.length ? `<ul class="rows">${items.map(row => `<li class="cart-line">
        ${rewardImage(row)}<div><a href="#/rewards/${row.id}"><strong>${e(row.title)}</strong></a><p>${money(row.points)} за единицу</p>
        ${row.active ? pill(money(row.quantity * row.points)) : pill('Снято с продажи','rejected')}</div>
        ${form('cart-set', row.id, `${number('quantity', 'Количество', 1, 20, row.quantity)}
          <div class="cart-actions"><button class="button" name="decision" value="save" ${row.active ? '' : 'disabled'}>Обновить</button>
          <button class="button danger" name="decision" value="remove" formnovalidate>Удалить</button></div>`)}</li>`).join('')}</ul>`
        : '<p>Корзина пуста.</p>'}</section>
      <aside class="surface"><h2>Итого ${money(total)}</h2><p>На балансе ${money(balance)}</p>
      ${total > balance ? notice('Не хватает ' + money(total - balance)) : ''}
      ${items.length ? form('checkout', null, `<label>Комментарий<textarea name="comment" maxlength="400"></textarea></label>${control('Оформить заказ')}`) : ''}
      <div class="actions">${button('Мои заказы', '#/orders')}</div></aside></div>`;
  }

  async function orderList(admin = false) {
    const { items } = await api(admin ? '/admin/orders' : '/orders');
    return `${back(admin ? 'Управление' : 'Корзина', admin ? 'admin' : 'cart')}${title(admin ? 'Заказы сотрудников' : 'Мои заказы')}
      ${!admin ? `<div class="actions">${button('Кэшбек по покупкам', '#/cashback')}</div>` : ''}
      <div class="split section">${items.map(row => `<article class="surface"><div class="row-line"><h2>Заказ №${row.id}</h2>
        ${pill(row.status === 'fulfilled' ? 'Выдан' : 'Оформлен', row.status === 'fulfilled' ? 'approved' : '')}</div>
        <p>${admin ? e(row.name) + ' · ' : ''}${when(row.created_at)}</p>
        <ul class="rows">${row.items.map(item => `<li class="row-line"><span>${e(item.title)} × ${item.quantity}</span>
          <strong>${money(item.unit_points * item.quantity)}</strong></li>`).join('')}</ul>
        <p><strong>Итого ${money(row.total)}</strong></p>${row.comment ? `<p>${e(row.comment)}</p>` : ''}
        ${admin && row.status !== 'fulfilled' ? action('fulfill', row.id, 'Отметить выдачу') : ''}</article>`).join('') || empty('Заказов пока нет.')}</div>`;
  }

  async function quest() {
    const { current, completed, earned, steps } = await api('/onboarding');
    const step = steps.find(row => row.id === current);
    return `${back('Активности')}${title(!step && steps.length ? 'Квест пройден' : 'Квест адаптации',
      !step && steps.length ? 'Все шаги приняты. Итоги адаптации сохранены в кабинете.' : 'Следующий шаг открывается после принятия текущего отчёта.')}
      <div class="detail"><section class="surface"><h2>Этапы адаптации</h2>${progress(completed, steps.length)}
        <ol class="quest-list">${steps.map((row,i) => `<li class="${row.status}"><b aria-hidden="true">${row.status === 'approved' ? '✓' : i + 1}</b>
          <div><strong>${e(row.title)}</strong><p>${statusLabels[row.status]} · ${money(row.report_points ?? row.points)}</p></div></li>`).join('')}</ol>
        ${!steps.length ? '<p>Администратор пока не добавил шаги.</p>' : ''}</section>
        <article class="surface"><h2>${step ? e(step.title) : 'Итого за квест'}</h2>
        <p>${step ? e(step.description) : signed(earned)}</p>
        ${step?.feedback ? notice(step.feedback) : ''}${step?.status === 'pending' ? notice('Отчёт отправлен. Дождитесь решения администратора.') : ''}
        ${step && step.status !== 'pending' ? form('quest', step.id, `<label>Отчёт<textarea name="note" minlength="10" maxlength="1000" required></textarea></label>
          ${control('Отправить на проверку')}`) : ''}
        </article></div>`;
  }

  async function wheel() {
    const { balance, next_at, outcomes, stakes, items } = await api('/wheel');
    const recent = items[0];
    const blocked = next_at && next_at > Date.now();
    const win = blocked ? recent.multiplier : null;
    return `${back('Активности')}${title('Колесо фортуны', 'Выберите ставку из внутренних баллов. Вращать колесо можно раз в семь дней.')}
      <div class="detail wheel-layout"><section class="surface wheel-stage">
        <div class="wheel-pointer" aria-hidden="true"></div><div class="wheel-dial ${win === null ? '' : 'wheel-result outcome-' + win}" role="img" aria-label="${win === null ? 'Колесо' : 'Результат ×' + win}">
        <span>×0</span><span>×1</span><span>×2</span><span>×5</span><i></i></div>
        <p>На балансе <strong>${money(balance)}</strong></p>
        ${blocked ? notice('Последний результат ×' + win + ' · ' + signed(recent.stake * (win - 1)) + '. Следующая попытка ' + when(next_at) + '.')
          : form('spin', null, `<fieldset class="stake-options"><legend>Ставка</legend>${stakes.map((stake,i) => `<label><input type="radio" name="stake"
            value="${stake}" ${i === 0 ? 'checked' : ''}><span>${money(stake)}</span></label>`).join('')}</fieldset>${control('Крутить колесо')}`)}</section>
      <section class="surface"><h2>Шансы и история</h2>
        <div class="actions">${outcomes.map(([mult, chance]) => pill('×' + mult + ' · ' + chance + '%')).join('')}</div>
        <ul class="rows">${items.map(row => `<li class="row-line"><span>${when(row.spun_at)}<br><small>Ставка ${money(row.stake)} · ×${row.multiplier}</small></span>
          <strong>${signed(row.stake * (row.multiplier - 1))}</strong></li>`).join('') || '<li>Попыток пока нет.</li>'}</ul></section></div>`;
  }

  async function challenges(id) {
    if (id) {
      const row = await api('/challenges/' + id);
      return `${back('Челленджи','challenges')}${title(row.title, row.description)}
        <div class="detail"><article class="surface"><div class="card-meta">${department(row)}${pill(challengeStates[row.status])}</div>
          <h2 class="compact-actions">Задания для выполнения</h2>
          <p>Принятые отчёты после вступления идут в зачёт. ${row.mode === 'team' ? 'Ваш отдел — ' + e(row.department) + '.' : ''}</p>
          <ul class="rows">${row.tasks.map(task => `<li class="row-line">${task.active ? `<a href="#/tasks/${task.id}">${e(task.title)}</a>` : `<span>${e(task.title)}</span>`}<span>${signed(task.points)}</span></li>`).join('')}</ul>
        </article><aside class="surface"><h2>${row.mode === 'team' ? 'Прогресс отдела' : 'Мой прогресс'}</h2>
        ${progress(row.progress, row.target)}<p>Награда ${money(row.points)} и значок «${e(row.badge)}»</p>
        <p>${when(row.starts_at)} — ${when(row.ends_at)}</p>
        ${row.claimed ? notice('Награда уже получена.') : row.claimable ? action('claim', id, 'Получить награду')
          : !row.joined && row.status === 'open' ? action('join', id, 'Принять участие')
          : row.joined ? notice('Вы участвуете.') : ''}</aside></div>`;
    }
    const { items } = await api('/challenges');
    const section = (name, rows) => `<section class="section"><h2>${name}</h2><div class="tile-grid compact-actions">
      ${rows.map(row => `<article class="card"><div class="card-meta">${department(row)}${pill(challengeStates[row.status])}</div>
        <h3><a href="#/challenges/${row.id}">${e(row.title)}</a></h3><p>${e(row.description)}</p>
        <p>Цель ${row.target} · Награда ${money(row.points)}</p><p>До ${when(row.ends_at)}</p>
        ${row.joined ? progress(row.progress, row.target) : ''}</article>`).join('') || '<p>Пока ничего нет.</p>'}</div></section>`;
    return `${back('Активности')}${title('Челленджи')}${section('Текущие челленджи', items.filter(row => row.status !== 'ended'))}
      ${section('Завершённые челленджи', items.filter(row => row.status === 'ended'))}`;
  }

  async function directory(params, id) {
    if (id) {
      const row = await api('/employees/' + id);
      return `${back('Сотрудники','employees')}${title(row.name, row.department)}
        <div class="detail"><section class="surface"><h2>Достижения</h2>${row.badges.length || row.achievements.length ? `<div class="card-meta compact-actions">
          ${row.badges.map(badge => pill(badge.badge,'approved')).join('')}</div>
          <ul class="rows">${row.achievements.map(item => `<li class="row-line"><span>${e(item.title)}</span><strong>${signed(item.points)}</strong></li>`).join('')}</ul>`
        : '<p>Принятые задания и значки появятся здесь.</p>'}</section><section class="surface"><h2>О сотруднике</h2>
        <p>${e(row.bio || 'Описание пока не добавлено.')}</p>
        ${row.own ? form('bio', id, `<label>О себе<textarea name="bio" maxlength="300">${e(row.bio)}</textarea></label>${control('Сохранить описание')}`) : ''}
        </section></div>`;
    }
    const { items } = await api('/employees?' + params);
    return `${back('Активности')}${title('Сотрудники', 'Ищите по имени или отделу. Профили доступны коллегам с аккаунтом.')}
      <form class="directory-filter" data-form="filters" data-target="/employees"><label>Поиск сотрудников
        <input name="q" type="search" maxlength="100" value="${e(params.get('q'))}"></label>${control('Найти')}</form>
      <div class="stack section">${items.map(row => `<a class="person-row" href="#/employees/${row.id}">
        <span class="person-initials" aria-hidden="true">${e(initials(row.name))}</span>
        <span><strong>${e(row.name)}</strong><small>${e(row.department)}</small></span>
        <span class="card-meta">${row.badges.map(item => pill(item.badge,'approved')).join('')}${pill('Заданий принято: ' + row.completed)}</span>
        <span aria-hidden="true">↗</span></a>`).join('') || empty('Сотрудники не найдены.')}</div>`;
  }

  async function polls() {
    const { items } = await api('/polls');
    return `${back('Активности')}${title('Опросы и квизы', 'За участие в опросе и за правильный ответ в квизе начисляются баллы.')}
      <div class="split section">${items.map(row => `<article class="surface"><div class="card-meta">${pill(row.mode === 'quiz' ? 'Квиз' : 'Опрос')}${pill(signed(row.points))}</div>
        <h2 class="compact-actions">${e(row.title)}</h2><p>${e(row.question)}</p>
        ${row.voted ? `${notice(row.voted.points ? 'Начислено ' + signed(row.voted.points) : 'Ответ сохранён. За него баллы не начислены.')}
        <ul class="rows">${row.options.map(opt => `<li class="row-line"><span>${e(opt.title)} ${opt.correct ? '✓' : ''}</span><strong>${opt.votes}</strong></li>`).join('')}</ul>`
        : form('vote', row.id, `<fieldset class="option-list"><legend>Выберите один ответ</legend>
          ${row.options.map(opt => `<label class="check"><input type="radio" name="option_id" value="${opt.id}" required>${e(opt.title)}</label>`).join('')}</fieldset>
          ${control('Ответить')}`)}</article>`).join('') || empty('Открытых опросов пока нет.')}</div>`;
  }

  async function auctions(id) {
    if (id) {
      const row = await api('/auctions/' + id);
      return `${back('Аукционы','auctions')}${title(row.title, 'Лот · ' + row.reward_title)}
        <div class="detail"><article class="surface"><h2>История ставок</h2>
        <ul class="rows">${row.bids.map(item => `<li class="row-line"><span>${e(item.name)}<br><small>${when(item.created_at)}</small></span>
          <strong>${money(item.amount)}</strong></li>`).join('') || '<li>Ставок пока нет.</li>'}</ul></article>
        <aside class="surface"><h2>${row.open ? 'Сделать ставку' : 'Торги завершены'}</h2><p>Окончание ${when(row.ends_at)}</p>
        ${row.open && row.next_minimum <= 100000 ? form('bid', id, `${number('amount','Ставка в баллах',row.next_minimum,100000,row.next_minimum)}
          <p class="form-note">Баллы резервируются. Если ставку перебьют, они вернутся на баланс.</p>${control('Сделать ставку')}`) : ''}
        ${row.leading ? notice(row.open ? 'Ваша ставка лидирует.' : 'Вы выиграли лот. Обратитесь к администратору за получением.') : ''}
        ${!row.open && row.bids[0] ? `<p>Победитель: ${e(row.bids[0].name)}</p>` : ''}</aside></div>`;
    }
    const { items, balance } = await api('/auctions');
    return `${back('Активности')}${title('Аукционы', 'Лоты компании за внутренние баллы. Ваш баланс — ' + money(balance))}
      <div class="product-grid section">${items.map(row => `<a class="product-card" href="#/auctions/${row.id}">${rewardImage(row)}
        <div class="product-body">${pill(row.open ? 'Открыт' : 'Завершён')}<h2>${e(row.title)}</h2>
        <p>${row.bids[0] ? 'Последняя ставка ' + money(row.bids[0].amount) : 'Стартовая ставка ' + money(row.minimum)}</p>
        <small>До ${when(row.ends_at)}</small></div></a>`).join('') || empty('Лотов пока нет.')}</div>`;
  }

  async function cashback() {
    const [{ items, campaigns }, telegram] = await Promise.all([api('/cashback'),api('/telegram')]);
    return `${back('Активности')}${title('Кэшбек', 'Купите товар по акции, выполните указанное задание и заберите часть стоимости баллами.')}
      <div class="split section"><section class="surface"><h2>Мои покупки по акции</h2><ul class="rows">
        ${items.map(row => `<li><strong>${e(row.title)} · заказ №${row.order_id}</strong><p>Возврат ${row.percent}% · ${money(row.claimed_points ?? row.points)}</p>
          ${row.claimed_points ? pill('Начислено','approved') : row.ready ? action('cashback',row.id,'Получить кэшбек',hidden('order_id',row.order_id))
            : `<p><strong>${e(row.task_title)}</strong></p><p>${e(row.task_description)}</p>
              ${row.feedback ? notice(row.feedback) : ''}
              ${row.task_status === 'pending' ? pill('Отчёт на проверке') : form('cashback-submit',row.id,hidden('order_id',row.order_id) +
                '<label>Отчёт<textarea name="note" minlength="10" maxlength="1000" required></textarea></label>' + control('Отправить отчёт'))}`}</li>`).join('')
          || '<li>Покупок по акциям пока нет.</li>'}</ul></section>
      <section class="surface"><h2>Действующие акции</h2><ul class="rows">
        ${campaigns.map(row => `<li><strong>${e(row.title)} · ${row.percent}%</strong><p>Задание «${e(row.task_title)}»</p></li>`).join('') || '<li>Акций пока нет.</li>'}
        </ul><div class="actions">${button('Открыть каталог','#/rewards')}</div>
        <h3 class="section">Уведомления в Telegram</h3>
        ${telegram.linked ? notice('Telegram подключён.') : telegram.enabled ? action('telegram', null, 'Подключить Telegram')
          : '<p>На этом стенде бот не настроен.</p>'}</section></div>`;
  }

  async function categoryAdmin() {
    const { items } = await api('/admin/reward-categories');
    return `${back('Управление','admin')}${title('Категории наград')}
      <div class="detail"><section class="surface"><h2>Категории каталога</h2><ul class="rows">
        ${items.map(row => `<li>${pill(row.active ? 'Активна' : 'Архив')}
          ${form('category-update', row.code, `<label>Название<input name="label" value="${e(row.label)}" minlength="2" maxlength="60" required></label>
          <div class="actions compact-actions"><button class="button" name="decision" value="${row.active ? 'active' : 'archive'}">Сохранить</button>
          <button class="button" name="decision" value="${row.active ? 'archive' : 'active'}">${row.active ? 'В архив' : 'Восстановить'}</button></div>`)}
          </li>`).join('')}</ul></section>
      <section class="surface"><h2>Новая категория</h2>${form('category-create', null,
        `<label>Название<input name="label" minlength="2" maxlength="60" required></label>
        <label>Код для фильтра<input name="code" pattern="[a-z](?:[a-z0-9]|-){1,39}" placeholder="events" required></label>
        <p class="form-note">От 2 до 40 символов. Начните с латинской буквы, используйте строчные буквы, цифры и дефис.</p>${control('Создать')}`)}</section></div>`;
  }

  async function settingsAdmin() {
    const row = await api('/settings');
    return `${back('Управление','admin')}${title('Настройки сайта')}
      <div class="detail"><section class="surface"><h2>Общие настройки</h2>${form('site-settings', null, `
        <label>Название сайта<input name="name" value="${e(row.name)}" minlength="2" maxlength="55" required></label>
        <label>SEO-описание<textarea name="description" minlength="10" maxlength="160" required>${e(row.description)}</textarea></label>
        <label>Контактный email<input name="contact" type="email" maxlength="120" value="${e(row.contact)}"></label>
        <label>Ссылка на соцсеть<input name="social_url" type="url" maxlength="300" placeholder="https://" value="${e(row.social_url)}"></label>
        <label>Цветовая схема админки<select name="admin_theme"><option value="warm">Тёплая</option>
        <option value="slate" ${row.admin_theme === 'slate' ? 'selected' : ''}>Графитовая</option></select></label>
        ${control('Сохранить настройки')}`)}</section>
      <section class="surface"><h2>Логотип</h2><img class="settings-logo compact-actions" src="${e(document.querySelector('.brand img').getAttribute('src'))}" alt="Текущий логотип">
        ${form('logo', null, `<label>PNG до 256 КиБ<input name="logo" type="file" accept="image/png" required></label>
          ${control('Загрузить логотип')}`)}
        ${row.custom_logo ? action('logo-reset',null,'Вернуть исходный логотип','','') : ''}</section></div>`;
  }

  async function administration(path) {
    if (path === 'orders') return orderList(true);
    if (path === 'reward-categories') return categoryAdmin();
    if (path === 'settings') return settingsAdmin();
    if (path === 'employees') {
      const { items } = await api('/admin/employees');
      return `${back('Управление','admin')}${title('Профили сотрудников')}
        <div class="tile-grid section">${items.map(row => `<article class="card"><h3>${e(row.name)}</h3>
        <a href="#/employees/${row.id}">Открыть публичный профиль</a>
        ${form('department', row.id, `<label>Имя<input name="name" minlength="2" maxlength="80" value="${e(row.name)}" required></label>
          <label>Отдел<input name="department" minlength="2" maxlength="80" value="${e(row.department)}" required></label>
          <label>О себе<textarea name="bio" maxlength="300">${e(row.bio)}</textarea></label>${control('Сохранить профиль')}`)}
        </article>`).join('')}</div>`;
    }
    const name = adminTools.find(([key]) => key === path)[1];
    const [data, tasks, rewards, reports] = await Promise.all([api('/admin/' + path),api('/tasks'),api('/rewards'),
      path === 'cashback' ? api('/admin/cashback/reports') : null]);
    const field = (key,label,extra = '') => `<label>${label}<input name="${key}" required ${extra}></label>`;
    const dates = field('ends_at','Окончание','type="datetime-local"');
    const type = name => select('mode','Тип',name);
    const points = number('points','Награда в баллах',1,10000);
    const list = arr => arr.map(row => [row.id,row.title]);
    const forms = {
      challenges: field('title','Название','minlength="3" maxlength="100"') +
        field('description','Условия','minlength="10" maxlength="1200"') + type([['individual','Индивидуальный'],['team','Командный']]) +
        select('task_ids','Задания (несколько можно выбрать с Ctrl)',list(tasks.items),true) + number('target','Сколько отчётов нужно',1,1000,1) +
        points + field('badge','Название значка','minlength="2" maxlength="80"') + field('starts_at','Начало','type="datetime-local"') + dates,
      polls: field('title','Название','minlength="3" maxlength="100"') + field('question','Вопрос','minlength="5" maxlength="500"') +
        type([['survey','Опрос'],['quiz','Квиз']]) + points + '<label>Варианты (один на строку)<textarea name="options" required></textarea></label>' +
        number('correct','Номер правильного варианта для квиза',1,8,1),
      auctions: field('title','Название лота','minlength="3" maxlength="100"') + select('reward_id','Товар',list(rewards.items)) +
        number('minimum','Стартовая ставка',1,100000,50) + dates,
      cashback: select('reward_id','Товар',list(rewards.items)) + select('task_id','Задание',list(tasks.items)) +
        number('percent','Процент возврата',1,100,25),
    };
    return `${back('Управление','admin')}${title(name)}<div class="detail"><section class="surface"><h2>Опубликованные записи</h2>
      <ul class="rows">${data.items.map(row => `<li><div class="row-line"><strong>${e(row.title)}</strong>
        ${pill(path === 'auctions' ? (row.open ? 'Идёт' : row.closed_at ? 'Подведён итог' : 'Завершён') : row.active ? 'Активно' : 'Архив')}</div>
        ${path === 'polls' ? `<ul class="rows">${row.options.map(opt => `<li>${e(opt.title)} — ${opt.votes}${opt.correct ? ' ✓' : ''}</li>`).join('')}</ul>` : ''}
        ${path === 'cashback' ? `<p>${row.percent}% · ${e(row.task_title)}</p>` : ''}
        ${path === 'auctions' && row.bids.length ? `<p>${e(row.bids[0].name)} · ${money(row.bids[0].amount)}</p>` : ''}
        ${path === 'auctions' && (row.open || row.closed_at) ? '' : action('admin-update',row.id,
          path === 'auctions' ? 'Подтвердить итог' : row.active ? 'В архив' : 'Опубликовать', hidden('active',row.active ? 'false' : 'true') +
          `<input type="hidden" name="resource" value="${path}">`, '')}</li>`).join('') || '<li>Записей пока нет.</li>'}</ul></section>
      <section class="surface"><h2>Создать запись</h2>
        ${form('admin-create', null, `<input type="hidden" name="resource" value="${path}">${forms[path]}${control('Опубликовать')}`)}</section></div>
      ${reports ? `<section class="surface section"><h2>Отчёты по кэшбеку</h2><ul class="rows">
        ${reports.items.map(row => `<li><strong>${e(row.title)} · заказ №${row.order_id}</strong><p>${e(row.name)} · ${statusLabels[row.status]}</p>
          <p>${e(row.note)}</p>${row.feedback ? notice(row.feedback) : ''}
          ${row.status === 'pending' ? form('cashback-review', row.order_id, hidden('campaign_id', row.campaign_id) +
            '<label>Комментарий<textarea name="feedback" maxlength="500"></textarea></label><div class="actions compact-actions">' +
            '<button class="button primary" name="decision" value="approved">Принять</button>' +
            '<button class="button danger" name="decision" value="rejected">Вернуть</button></div>') : ''}</li>`).join('') || '<li>Отчётов пока нет.</li>'}
      </ul></section>` : ''}`;
  }

  async function view(path, params, user) {
    const [, area, key] = path.split('/');
    if (path === '/play') return hub(user);
    if (area === 'admin' && adminTools.some(([section]) => section === key) && path === '/admin/' + key) {
      return user?.role === 'admin' ? administration(key) : title('Доступ для администраторов');
    }
    if (!employeePaths.has(area) && area !== 'employees') return undefined;
    const detailRoutes = ['employees','challenges','auctions'];
    if (path !== '/' + area && (!detailRoutes.includes(area) || !key || !/^[1-9]\d{0,14}$/.test(key) || path !== '/' + area + '/' + key)) return undefined;
    if (!user) return `${title('Требуется вход')}<div class="actions">${button('Войти',nextLogin(path),'primary')}</div>`;
    if (user.role !== 'employee' && area !== 'employees') return `${title('Раздел для сотрудников')}<div class="actions">${button('Управление','#/admin','primary')}</div>`;
    const views = { cart, orders: () => orderList(), onboarding: quest, wheel, challenges: () => challenges(key), employees: () => directory(params,key),
      polls, auctions: () => auctions(key), cashback, pomodoro: async () => renderTimer(user.id, await api('/pomodoro?day=' + today())) };
    return views[area]();
  }

  async function submit(kind, id, data, decision, element) {
    const send = (path, body, method = 'POST') => api(path, { method, body });
    const done = message => render({ focus: true, message });
    if (kind === 'cart-add') {
      await send('/cart/' + id, { add: true }, 'PUT');
      return done('Товар добавлен в корзину.');
    }
    if (kind === 'cart-set') {
      await send('/cart/' + id, { quantity: decision === 'remove' ? 0 : Number(data.quantity) }, 'PUT');
      return done('Корзина обновлена.');
    }
    if (kind === 'checkout') {
      await send('/cart/checkout', { comment: data.comment });
      return go('/orders');
    }
    if (kind === 'quest') {
      await send('/onboarding/' + id + '/submit', { note: data.note });
      return done('Отчёт отправлен на проверку.');
    }
    if (kind === 'spin') {
      const result = await send('/wheel/spin', { stake: Number(data.stake) });
      return done('Результат ×' + result.multiplier + '. Изменение баланса ' + signed(result.net));
    }
    if (kind === 'join' || kind === 'claim') {
      const result = await send('/challenges/' + id + '/' + kind);
      return done(kind === 'join' ? 'Вы участвуете.' : 'Начислено ' + signed(result.points));
    }
    if (kind === 'vote') {
      await send('/polls/' + id + '/vote', { option_id: Number(data.option_id) });
      return done('Ответ сохранён.');
    }
    if (kind === 'bid') {
      await send('/auctions/' + id + '/bid', { amount: Number(data.amount) });
      return done('Ставка принята.');
    }
    if (kind === 'cashback') {
      const result = await send('/cashback/' + id + '/claim', { order_id: Number(data.order_id) });
      return done('Начислено ' + signed(result.points));
    }
    if (kind === 'cashback-submit') {
      await send('/cashback/' + id + '/submit', { order_id: Number(data.order_id), note: data.note });
      return done('Отчёт отправлен на проверку.');
    }
    if (kind === 'cashback-review') {
      await send('/admin/cashback/reports/' + id, { campaign_id: Number(data.campaign_id), status: decision, feedback: data.feedback }, 'PATCH');
      return done('Решение сохранено.');
    }
    if (kind === 'telegram') {
      const result = await send('/telegram/link');
      const message = element.querySelector('.form-message');
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Открыть бота в Telegram';
      message.replaceChildren(link);
      return;
    }
    if (kind === 'bio') {
      await send('/me/employee', { bio: data.bio }, 'PATCH');
      return done('Описание сохранено.');
    }
    if (kind === 'department') {
      await send('/admin/employees/' + id, data, 'PATCH');
      return done('Профиль сохранён.');
    }
    if (kind === 'category-create' || kind === 'category-update') {
      if (kind === 'category-create') await send('/admin/reward-categories', data);
      else await send('/admin/reward-categories/' + id, { label:data.label, active:decision === 'active' }, 'PATCH');
      return done('Категория сохранена.');
    }
    if (kind === 'site-settings') {
      applySiteSettings(await send('/admin/settings', data, 'PUT'));
      return done('Настройки сайта сохранены.');
    }
    if (kind === 'logo' || kind === 'logo-reset') {
      const settings = kind === 'logo' ? await uploadLogo(data.logo) : await send('/admin/settings/logo', undefined, 'DELETE');
      applySiteSettings(settings, true);
      return done('Логотип обновлён.');
    }
    if (kind === 'fulfill') {
      await send('/admin/orders/' + id, undefined, 'PATCH');
      return done('Заказ отмечен как выданный.');
    }
    if (kind === 'admin-create' || kind === 'admin-update') {
      const { resource, ...body } = data;
      if (kind === 'admin-update') {
        await send('/admin/' + resource + '/' + id, { active: body.active === 'true' }, 'PATCH');
      } else {
        for (const key of ['target','points','correct','reward_id','task_id','percent','minimum']) {
          if (body[key] !== undefined) body[key] = Number(body[key]);
        }
        for (const key of ['starts_at','ends_at']) {
          if (body[key] !== undefined) body[key] = new Date(body[key]).getTime();
        }
        if (resource === 'polls') body.options = body.options.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (resource === 'challenges') body.task_ids = new FormData(element).getAll('task_ids').map(Number);
        await send('/admin/' + resource, body);
      }
      return done(kind === 'admin-create' ? 'Запись опубликована.' : 'Запись обновлена.');
    }
  }

  return { view, submit, adminLinks, isPath: path => path === '/play' ||
    /^\/(cart|orders|onboarding|challenges|employees|wheel|pomodoro|polls|auctions|cashback)(\/[1-9]\d*)?$/.test(path) };
}
