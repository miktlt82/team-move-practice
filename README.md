# Командный ход

Учебный веб-проект для корпоративной геймификации. Сотрудники проходят квест адаптации, выполняют челленджи, участвуют в опросах и тратят заработанные баллы в магазине и на аукционах. Администратор управляет каталогами и активностями, проверяет отчёты и выдаёт заказы.

| Материал | Ссылка |
| --- | --- |
| Локальный демо-стенд | [Открыть приложение](http://127.0.0.1:8097/) |
| Исходный код | [Репозиторий GitHub](https://github.com/miktlt82/team-move-practice) |
| Макеты | [Figma Design · Активности и другие новые экраны](https://www.figma.com/design/heJgk2RPrcrbCd9xvOfR2s?node-id=20-4499) |
| Интерактивный прототип | [Активности, магазин и управление](https://www.figma.com/proto/heJgk2RPrcrbCd9xvOfR2s?node-id=20-4499&starting-point-node-id=20%3A4499&page-id=0%3A1) · [От задания к баллам](https://www.figma.com/proto/heJgk2RPrcrbCd9xvOfR2s?node-id=1-654&starting-point-node-id=1%3A654) |
| API | [Веб-документация](http://127.0.0.1:8097/docs) · [OpenAPI 3.1](openapi.json) |
| Проектирование и отчёт | [Архитектура и ER-диаграммы](docs/architecture.md) · [Отчёт PDF](docs/report.pdf) · [Примеры ответов новых модулей](docs/expanded-api-run.json) |
| Графика | [Знак, иллюстрации и промпты GPT Image](docs/design-assets.md) · [Лицензия Golos Text](public/fonts/OFL.txt) |

Демо-адрес доступен на компьютере, где запущено приложение. GitHub-репозиторий приватный.

## Запуск

### Docker Compose

```bash
docker compose -p team-move-practice up --build -d --wait
docker compose -p team-move-practice ps
```

Откройте [http://127.0.0.1:8097/](http://127.0.0.1:8097/). Compose публикует порт только на loopback-интерфейсе. Переменная `DEMO_PORT` меняет внешний порт, например `DEMO_PORT=8098 docker compose -p team-move-practice up -d` в Bash. SQLite хранится в именованном томе. `docker compose -p team-move-practice down` останавливает стенд и сохраняет том.

### Node.js

Требуется Node.js 22.13 или новее. Приложение использует только встроенные модули Node.js.

```powershell
$env:PORT = '8097'
npm.cmd run demo
```

Для Bash эквивалентная команда — `PORT=8097 npm run demo`. Файл демо-данных создаётся в `data/demo.sqlite`. Если Docker уже занял 8097, используйте другой порт.

Доступные настройки обычного режима: `HOST`, `PORT`, `DB_PATH`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_ORIGIN` и `SECURE_COOKIE`. Чтобы создать первого администратора, задайте обе переменные `ADMIN_*` перед первым запуском `npm start`. Минимальная длина его пароля — 12 символов. За HTTPS-прокси укажите точный внешний origin в `PUBLIC_ORIGIN` и включите `SECURE_COOKIE=1`.

## Демо-сценарий

| Роль | Email | Пароль |
| --- | --- | --- |
| Сотрудник | `employee@example.test` | `EmployeeDemo!2026` |
| Администратор | `admin@example.test` | `AdminDemo!2026` |

1. Войдите сотрудником и откройте «Активности». Для покупок, колеса и ставок демонстрационному сотруднику начисляется 350 стартовых баллов один раз.
2. Вступите в индивидуальный челлендж «Первый командный ход». В квесте адаптации отправьте отчёт по первому шагу. Войдите администратором в отдельном профиле браузера и примите отчёт в «Управлении». Сотруднику откроется следующий шаг, а в челлендже станет доступна награда. Значок появится в профиле сотрудника в справочнике.
3. В каталоге откройте «Кофе с коллегой» и добавьте товар в корзину. Установите количество и оформите заказ. Администратор может отметить выдачу в «Управление → Заказы». В «Кэшбек» сдайте отдельный отчёт по покупке, примите его в «Управление → Кэшбек» и заберите баллы.
4. Из «Активностей» запустите колесо, ответьте на квиз, сделайте ставку на лот и запустите Pomodoro. В кабинете отражаются операции с балансом, в Pomodoro — завершённые интервалы за день.
5. В «Управлении» проверьте создание категории наград, редактирование профилей и настройки сайта. Для настройки логотипа принимается PNG до 256 КиБ и 2048 × 2048 пикселей.

Демонстрационные аккаунты создаются только в режиме `--demo`. Второй сотрудник отдела «Разработка» для командных проверок — `ira@example.test` с паролем `EmployeeDemo!2026`. Повторный запуск сохраняет баллы, отчёты и остальные данные.

## Telegram

Для подключения бота задайте `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` без `@` и `TELEGRAM_WEBHOOK_SECRET`. На развернутом HTTPS-адресе зарегистрируйте `/api/telegram/webhook` методом `setWebhook` и передайте тот же секрет в `secret_token`. Сотрудник получает ссылку с одноразовым кодом в разделе «Кэшбек» и открывает бота. Сервер доставляет уведомления о начислении кэшбека через очередь. Локальный демостенд показывает состояние «бот не настроен». [Регистрация webhook](https://core.telegram.org/bots/api#setwebhook) · [Параметры ссылки на бота](https://core.telegram.org/bots/features#deep-linking)

## Примеры API

Примеры для PowerShell. Первые две команды запускаются в Bash с `curl` вместо `curl.exe`.

```powershell
curl.exe -sS http://127.0.0.1:8097/api/health
curl.exe -sS "http://127.0.0.1:8097/api/tasks?category=onboarding&sort=points-desc"

$body = @{email='employee@example.test'; password='EmployeeDemo!2026'} | ConvertTo-Json -Compress
Invoke-RestMethod 'http://127.0.0.1:8097/api/auth/login' -Method Post -ContentType 'application/json' -Body $body -SessionVariable teamMoveSession
Invoke-RestMethod 'http://127.0.0.1:8097/api/me/dashboard' -WebSession $teamMoveSession
Invoke-RestMethod 'http://127.0.0.1:8097/api/challenges' -WebSession $teamMoveSession
Invoke-RestMethod 'http://127.0.0.1:8097/api/cart' -WebSession $teamMoveSession
```

Успешный `GET /api/health` возвращает `200 {"status":"ok"}`. Ошибки возвращаются как `{"error":{"code":"…","message":"…","fields":{…}}}`. Поле `fields` присутствует при ошибках валидации. Сервер выставляет cookie сессии при входе и регистрации.

## Проверки и структура

```bash
npm test
```

- `server/` — HTTP-сервер, маршруты API, сессии, операции с баллами и SQL-схема.
- `public/` — адаптивный клиент и локальный просмотрщик OpenAPI.
- `test/` — интеграционные тесты с отдельными БД и тестовым транспортом Telegram.
- `docs/` — схемы, снимки экранов, отчёт и результаты запросов.
