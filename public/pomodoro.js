const defaults = { focus: 25, short: 5, long: 15, interval: 4 };
const labels = { focus: 'Рабочий отрезок', short: 'Короткий перерыв', long: 'Длинный перерыв' };
const nextKind = state => state.kind === 'focus'
  ? (state.focusCount > 0 && state.focusCount % state.settings.interval === 0 ? 'long' : 'short') : 'focus';
const seconds = value => Math.max(0, Math.ceil(value / 1000));

function localDay(d) {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(value => String(value).padStart(2, '0')).join('-');
}
export const today = () => localDay(new Date());

function load(id) {
  try {
    const data = JSON.parse(localStorage.getItem('team-move-timer-' + id));
    if (data?.settings && Object.hasOwn(labels, data.kind)) return data;
  } catch { /* Use defaults if storage is unavailable. */ }
  return { settings: { ...defaults }, kind: 'focus', focusCount: 0, duration: defaults.focus, remaining: defaults.focus * 60000, until: null, pending: [] };
}

function save(id, state) {
  try {
    localStorage.setItem('team-move-timer-' + id, JSON.stringify(state));
  } catch { /* The timer can continue without persistent storage. */ }
}

function statsText(data) {
  const focus = data.items.find(row => row.kind === 'focus');
  const breaks = data.items.filter(row => row.kind !== 'focus').reduce((sum, row) => sum + row.runs, 0);
  return `<li class="row-line"><span>Рабочие отрезки</span><strong>${focus?.runs ?? 0}</strong></li>
    <li class="row-line"><span>Минут в фокусе</span><strong>${focus?.minutes ?? 0}</strong></li>
    <li class="row-line"><span>Перерывы</span><strong>${breaks}</strong></li>`;
}

export function createTimer({ api, title, formMessage }) {
  let state;
  let activeId;
  let lastStats;
  let flushing = false;

  function loadUser(id) {
    if (id !== activeId) {
      activeId = id;
      state = load(id);
    }
  }

  function renderTimer(id, data) {
    loadUser(id);
    lastStats = data;
    return `<a class="back" href="#/play">← Активности</a>${title('Таймер Pomodoro', 'Настройте длительность работы и перерывов. Таймер продолжает отсчёт при переходе между разделами.')}
      <div class="detail"><section class="surface timer-panel" data-timer>
        <p data-timer-kind>${labels[state.kind]}</p>
        <div class="timer-display" role="timer" aria-live="off" data-countdown></div>
        <div class="actions"><button class="button primary" type="button" data-timer-action="start">Старт</button>
          <button class="button" type="button" data-timer-action="pause">Пауза</button>
          <button class="button" type="button" data-timer-action="reset">Сброс</button>
          <button class="button" type="button" data-timer-action="next">Пропустить</button></div>
        <p class="form-note" role="status" data-timer-message></p>
      </section><section class="surface"><h2>Сегодня</h2><ul class="rows" data-timer-stats>${statsText(data)}</ul></section></div>
      <section class="surface section"><h2>Настройки таймера</h2>
        <form class="form" data-form="timer-settings"><div class="timer-settings">${[
          ['focus','Минут работы',120], ['short','Минут короткого перерыва',60],
          ['long','Минут длинного перерыва',120], ['interval','Рабочих отрезков до длинного перерыва',12],
        ].map(([key,label,max]) => `<label>${label}<input type="number" name="${key}" value="${state.settings[key]}" min="1" max="${max}" required></label>`).join('')}</div>
        <button class="button">Сохранить настройки</button>${formMessage}</form></section>`;
  }

  function show() {
    const panel = document.querySelector('[data-timer]');
    if (!state || !panel) return;
    const time = seconds(state.until ? state.until - Date.now() : state.remaining);
    panel.querySelector('[data-countdown]').textContent = [Math.floor(time / 60), time % 60].map(n => String(n).padStart(2,'0')).join(':');
    panel.querySelector('[data-timer-kind]').textContent = labels[state.kind];
    panel.querySelector('[data-timer-action="start"]').disabled = Boolean(state.until);
    panel.querySelector('[data-timer-action="pause"]').disabled = !state.until;
  }

  function reset(kind = state.kind) {
    state.kind = kind;
    state.duration = state.settings[kind];
    state.remaining = state.duration * 60000;
    state.until = null;
    state.run_id = null;
  }

  function tick(user) {
    if (user?.role !== 'employee') return;
    loadUser(user.id);
    if (state.until && state.until <= Date.now()) {
      state.pending.push({ run_id: state.run_id, kind: state.kind, minutes: state.duration, day: localDay(new Date(state.until)) });
      if (state.kind === 'focus') state.focusCount += 1;
      reset(nextKind(state));
      save(activeId, state);
      const message = document.querySelector('[data-timer-message]');
      if (message) message.textContent = 'Отрезок завершён. Нажмите «Старт», когда будете готовы к следующему.';
    }
    show();
    if (state.pending.length) void flush(user.id, state);
  }

  async function flush(id, pendingState) {
    if (flushing || (pendingState.retryAt ?? 0) > Date.now()) return;
    flushing = true;
    try {
      while (pendingState.pending.length && activeId === id) {
        const body = pendingState.pending[0];
        const data = await api('/pomodoro', { method: 'POST', body });
        pendingState.pending.shift();
        save(id, pendingState);
        const list = document.querySelector('[data-timer-stats]');
        if (list && activeId === id && data.day === lastStats?.day) list.innerHTML = statsText(data);
      }
    } catch {
      pendingState.retryAt = Date.now() + 15000;
    } finally {
      flushing = false;
    }
  }

  function click(action, user) {
    if (user?.role !== 'employee') return;
    tick(user);
    if (action === 'start' && !state.until) {
      state.run_id ??= crypto.randomUUID();
      state.until = Date.now() + state.remaining;
    }
    if (action === 'pause' && state.until) {
      state.remaining = Math.max(0, state.until - Date.now());
      state.until = null;
    }
    if (action === 'reset') reset();
    if (action === 'next') reset(nextKind(state));
    save(user.id, state);
    show();
  }

  function settings(data, user) {
    loadUser(user.id);
    state.settings = Object.fromEntries(Object.keys(defaults).map(key => [key, Number(data[key])]));
    if (!state.run_id) reset();
    save(user.id, state);
    show();
  }

  return { renderTimer, show, tick, click, settings };
}
