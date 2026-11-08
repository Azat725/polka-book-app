# GitHub Pages + VPS без купленного домена

Интерфейс публикуется по адресу `https://azat725.github.io/polka-book-app/`.
GitHub Pages обслуживает только статические файлы. Django, PostgreSQL, Redis,
обработка и приватные PDF остаются на VPS. API получает HTTPS-адрес
`https://82.22.6.140.sslip.io` через бесплатную DNS-службу sslip.io.
Эта служба — внешняя зависимость; при её недоступности нужен свой домен.

## VPS

На Ubuntu 24.04+ установите Docker Engine и Compose по официальной инструкции,
скопируйте проект в `/srv/polka`, откройте порты 80/443. Публичный SSH-ключ проекта
должен быть установлен отдельно от ключей других проектов.

В каталоге `/srv/polka` выполните `python3 scripts/configure.py` и укажите:

```text
Domain: 82.22.6.140.sslip.io
Bot username: <имя бота без @>
ACME email: <ваша почта>
Bot token: <ввод скрыт>
```

Добавьте в `.env` две строки (без пробелов):

```text
PAGES_ORIGIN=https://azat725.github.io
COMPOSE_FILE=compose.yaml:infra/compose.apparmor.yaml
```

Для Ubuntu загрузите политику `sudo apparmor_parser -r infra/security/polka-pdf.apparmor`.
Проверьте `docker compose config --quiet` и соберите `docker compose build`.
Начальный Nginx поднимается командой
`docker compose -f compose.yaml -f infra/compose.bootstrap.yaml up -d --no-deps web`.

Получите сертификат:

```bash
docker compose --profile tools run --rm certbot certonly --webroot -w /var/www/certbot --email ВАША_ПОЧТА --agree-tos --no-eff-email -d 82.22.6.140.sslip.io
```

Затем `docker compose up -d --build` и `docker compose ps`. Проверьте
`https://82.22.6.140.sslip.io/health`. Сертификат продлевайте через
`docker compose --profile tools run --rm certbot renew --webroot -w /var/www/certbot`
с последующим `docker compose exec web nginx -s reload`; настройте ежедневный timer.
Подробности эксплуатации и резервного копирования — в RUNBOOK.md.

## GitHub и BotFather

Workflow `pages.yml` собирает статический интерфейс и публикует его на Pages.
В настройках репозитория установите переменную Actions `TELEGRAM_BOT_USERNAME`.
Она содержит только публичное имя бота без `@`, не токен. После публикации
укажите в BotFather Main Mini App URL
`https://azat725.github.io/polka-book-app/`.

Проверьте вход именно через Telegram, загрузку и открытие PDF, частичный ответ
`206`, обложку, заметку и повторный вход на телефоне. Если API недоступен,
GitHub Pages покажет оболочку, но личная библиотека работать не будет.
