# Развёртывание на VPS

Конфигурация предназначена для Linux, Docker Engine и Compose v2. Для первоначальных
50 пользователей разумная отправная точка — 4 vCPU/8 ГБ RAM и SSD от 100 ГБ.
Это инженерная рекомендация, не измеренный предел нагрузки. Ёмкость диска выбирайте
под реальные PDF и отдельный запас. Сервер и домен заранее не предполагаются.

## 1. Подготовьте сервер

Создайте отдельного пользователя с SSH-ключом, обновите Linux, включите firewall:
публичны только SSH, 80 и 443. PostgreSQL/Redis из Compose наружу не публикуются.
Установите Docker Engine и Compose по инструкции для своего дистрибутива:
https://docs.docker.com/engine/install/ . Не используйте production `runserver`.

Sandbox требует unprivileged user namespaces, seccomp и совместимой LSM-политики.
Если провайдер запрещает эти возможности, используйте подходящий VPS: приложение
не должно переключаться на небезопасный parser ради запуска. Проверка Docker
в Windows не заменяет эту проверку Linux-хоста.

Для Ubuntu с AppArmor загрузите узкую политику только PDF-контейнера и включите
override согласно `infra/security/README.md`. В комплекте есть отдельный seccomp
allowlist для bubblewrap; остальные контейнеры сохраняют стандартный профиль.

## 2. DNS и исходники

Направьте A-запись своего поддомена на VPS. AAAA добавляйте только при работающем
IPv6. Скопируйте проект на сервер без `.env`, `.venv`, node_modules, тестовых БД
и каталога artifacts. Не помещайте пользовательские PDF в корень web-сервера.

## 3. Telegram-бот

Создайте бота через @BotFather (`/newbot`). Сохраните токен в менеджере секретов.
Через `/mybots` выберите бота → Bot Settings → Configure Mini App и укажите
HTTPS-адрес `https://ВАШ_ДОМЕН`. Настройте Main Mini App и Menu Button по желанию.
Запускать отдельный polling-бот для работы библиотеки не требуется.

## 4. Окружение

Из корня проекта:

```bash
python3 scripts/configure.py
```

Введите домен, username бота, email для сертификата и токен скрытым вводом.
Скрипт создаст `.env` с уникальными Django/PostgreSQL/Redis/backup-секретами.
Он не выводит их и не перезаписывает существующий файл. Сделайте защищённую копию
секретов отдельно от VPS. При смене username пересоберите frontend.

## 5. Проверка и сборка

```bash
docker compose config --quiet
docker compose build
```

Не публикуйте результат `docker compose config` без `--quiet`: он содержит
подставленные значения окружения. Для диагностики достаточно списка сервисов.

## 6. Получите HTTPS-сертификат

Начальная HTTP-конфигурация обслуживает только ACME challenge:

```bash
docker compose -f compose.yaml -f infra/compose.bootstrap.yaml up -d --no-deps web
```

Получите сертификат, заменив домен/email своими значениями:

```bash
docker compose --profile tools run --rm certbot certonly --webroot -w /var/www/certbot --email owner@example.com --agree-tos --no-eff-email -d books.example.com
```

Затем:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 setup api worker pdf-sandbox
```

Сервис init создаёт права volumes, setup выполняет миграции и collectstatic.
API запускается после успешной подготовки БД. Worker и scheduler отдельны.

## 7. Создайте администратора

```bash
docker compose exec api python manage.py createsuperuser
docker compose exec api python manage.py bootstrap_admin_roles
```

Пароль вводится интерактивно. Откройте `https://ВАШ_ДОМЕН/admin/`. Выдавайте
сотрудникам только нужные model permissions; не используйте superuser для поддержки.
Admin показывает метаданные, а исходные storage keys и ссылки на PDF не отображаются.

## 8. Приёмка production

Проверьте `/health`, вход через настоящего Telegram-бота, загрузку собственного PDF,
создание обложки, открытие и поиск, выделение и заметку, повторный вход, второй
Telegram-клиент, восстановление из корзины и экспорт. Убедитесь, что прямой
`/_private/...` недоступен, а PDF выдаётся только владельцу с `206` для Range.

Проверьте паспортную загрузку до 100 МБ, обрыв сети, ошибочный PDF, файл с паролем,
длинную книгу и несколько параллельных загрузок. На телефонах отдельно проверьте
safe areas, экранную клавиатуру, сворачивание, pinch, выделение и WebGL.

## 9. Продление TLS

Периодически выполняйте:

```bash
docker compose --profile tools run --rm certbot renew --webroot -w /var/www/certbot
docker compose exec web nginx -s reload
```

Для расписания используйте системный timer/cron и контролируйте код завершения.
Первую проверку проведите с `certbot renew --dry-run`.

## 10. Резервирование и обновление

До открытия доступа настройте внешние зашифрованные резервные копии и выполните
пробное восстановление. Процедуры находятся в RUNBOOK.md. Не выполняйте
`docker compose down -v` на пользовательской системе: это удаляет volumes.
