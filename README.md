# Распределение нагрузки — версия для GitHub → Render

Это отдельная копия приложения для размещения на Render. Вариант работает только с удалённым хранилищем MTS Tabs через API.

## Главное

- Excel-файл на Render не используется как хранилище.
- Excel-файл справочника регионов тоже не используется.
- Persistent Disk на Render не нужен.
- Все рабочие данные хранятся в MTS Tabs: дела, сотрудники, очереди, состояние, отпуска, журнал, настройки и справочник регионов.
- API-токен хранится только в переменных окружения Render.

## Как развернуть

1. Создайте новый репозиторий GitHub.
2. Загрузите в него содержимое этой папки `render-mvp-raspredelenie`.
3. В Render выберите `New` → `Blueprint`.
4. Подключите GitHub-репозиторий.
5. Render прочитает `render.yaml` и создаст web service.
6. В настройках сервиса Render укажите переменную окружения:
   - `TABS_API_TOKEN` — токен MTS Tabs без слова `Bearer`.
   - `TABS_DIRECTORIES_DATASHEET_ID=dstUTQd5tp5sCU7mLv`
   - `TABS_DIRECTORIES_VIEW_ID=viwV8x7vx4jzL`
7. Запустите Deploy.

## Если создавать Web Service вручную

Можно не использовать Blueprint. Тогда укажите:

- Runtime: `Node`
- Root Directory: `app`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variable:
  - `HOST=0.0.0.0`
  - `TABS_API_TOKEN=...`
  - `TABS_DIRECTORIES_DATASHEET_ID=dstUTQd5tp5sCU7mLv`
  - `TABS_DIRECTORIES_VIEW_ID=viwV8x7vx4jzL`

Постоянный диск `/data` не добавляйте.

## Проверка после деплоя

Откройте:

- `/` — главная страница приложения;
- `/api/storage-status` — должно быть видно `mode: "tabs"` и `tokenConfigured: true`;
- `/api/directories` — должен вернуться справочник ЮЦ/регионов из MTS Tabs;
- `/api/data` — должен вернуться JSON с данными и справочником из MTS Tabs.

## Очереди для всех ЮЦ

Если в таблице `Сотрудники` появились новые ЮЦ или сотрудники, можно создать недостающие очереди:

```bash
npm run tabs:ensure-queues
```

Команда без `--write` только показывает, что будет создано.

Для записи:

```bash
npm run tabs:ensure-queues -- --write
```

На Render такие команды можно запускать через Shell, если тариф и интерфейс Render это позволяют. Локально их можно запускать из папки репозитория при наличии `TABS_API_TOKEN`.

## Безопасность

В приложении пока нет собственной авторизации. Если ссылка Render будет доступна из интернета, рабочий доступ лучше закрыть внешним способом: корпоративный VPN, restricted access, reverse proxy с авторизацией или встроенная авторизация в следующей версии.
