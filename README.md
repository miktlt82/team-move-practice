# Командный ход

Учебный веб-проект для корпоративной геймификации. Сотрудники выполняют задания, отслеживают адаптацию и обменивают заработанные баллы на награды. Администратор управляет каталогами и проверяет отчёты.

| Материал | Ссылка |
| --- | --- |
| Локальный демо-стенд | [Открыть приложение](http://127.0.0.1:8097/) |
| Исходный код | [Репозиторий GitHub](https://github.com/miktlt82/team-move-practice) |
| Макеты | [Figma Design](https://www.figma.com/design/heJgk2RPrcrbCd9xvOfR2s) |
| Интерактивный прототип | [Запустить сценарий в Figma](https://www.figma.com/proto/heJgk2RPrcrbCd9xvOfR2s?node-id=1-654&starting-point-node-id=1%3A654) |
| API | [Веб-документация](http://127.0.0.1:8097/docs) · [OpenAPI 3.1](openapi.json) |
| Проектирование и отчёт | [Архитектура и ER-диаграмма](docs/architecture.md) · [Отчёт PDF](docs/report.pdf) · [Примеры ответов из браузерной проверки](docs/api-run.json) |

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

1. Зарегистрируйте нового сотрудника или войдите в демонстрационный аккаунт. Откройте задание «Знакомство с командой» и отправьте отчёт длиной от 10 символов.
2. Войдите под администратором в другом профиле браузера или приватном окне. В разделе «Управление» примите отчёт или верните его с комментарием.
3. После принятия проверьте баланс 120 баллов в кабинете сотрудника. Откройте «Кофе с коллегой» и подтвердите обмен за 80 баллов. Баланс составит 40 баллов.
4. В кабинете можно проверить историю начислений и списаний. Рейтинг учитывает заработанные баллы до списаний.

Демонстрационные аккаунты создаются только в режиме `--demo`. Повторный запуск сохраняет существующие данные, поэтому для нового прохождения можно зарегистрировать ещё одного сотрудника.

## Примеры API

Примеры для PowerShell. Первые две команды запускаются в Bash с `curl` вместо `curl.exe`.

```powershell
curl.exe -sS http://127.0.0.1:8097/api/health
curl.exe -sS "http://127.0.0.1:8097/api/tasks?category=onboarding&sort=points-desc"

$body = @{email='employee@example.test'; password='EmployeeDemo!2026'} | ConvertTo-Json -Compress
Invoke-RestMethod 'http://127.0.0.1:8097/api/auth/login' -Method Post -ContentType 'application/json' -Body $body -SessionVariable teamMoveSession
Invoke-RestMethod 'http://127.0.0.1:8097/api/me/dashboard' -WebSession $teamMoveSession
```

Успешный `GET /api/health` возвращает `200 {"status":"ok"}`. Ошибки возвращаются как `{"error":{"code":"…","message":"…","fields":{…}}}`. Поле `fields` присутствует при ошибках валидации. Сервер выставляет cookie сессии при входе и регистрации.

## Проверки и структура

```bash
npm test
```

- `server/` — HTTP-сервер, маршруты API, сессии, операции с баллами и SQL-схема.
- `public/` — адаптивный клиент и локальный просмотрщик OpenAPI.
- `test/api.test.js` — интеграционные тесты с отдельной БД.
- `docs/` — схемы, снимки экранов, отчёт и результаты запросов.
