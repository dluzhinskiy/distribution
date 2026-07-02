# Распределение нагрузки — версия для GitHub → Render

Это отдельная копия приложения для размещения на Render. Вариант работает только с удалённым хранилищем MTS Tabs через API.

## Главное

- Excel-файл на Render не используется как хранилище.
- Excel-файл справочника регионов тоже не используется.
- Persistent Disk на Render не нужен.
- Все рабочие данные хранятся в MTS Tabs: дела, сотрудники, очереди, состояние, отпуска, журнал, настройки, справочник регионов, настройки ЮЦ, региональные закрепления и региональные замещения.
- API-токен хранится только в переменных окружения Render.
- В эту сборку включена последняя локальная логика региональных очередей, сроков активности/автозавершения, замещений, импорта отпусков из Excel и Apple-like оформления.

## Что умеет эта версия

- Работает по выбранному сверху ЮЦ.
- Создаёт и распределяет новые дела через удалённые таблицы MTS Tabs.
- Поддерживает региональные закрепления: сначала рассматриваются юристы, закреплённые за регионом дела.
- Уходит вне региона только если вся доступная региональная группа перегружена сверх порога, заданного для ЮЦ.
- Если региональный юрист один и не перегружен сверх порога, он может получить второе дело того же типа подряд.
- Поддерживает заместителей: они подключаются, когда все региональные юристы по региону и типу нагрузки недоступны, а настройка ЮЦ разрешает порядок «заместитель затем общая очередь».
- Если для ЮЦ ещё нет строки настроек, региональные очереди по умолчанию считаются выключенными (`Нет`).
- Позволяет редактировать сроки:
  - `Активность, дни` — влияет на вес дела в нагрузке;
  - `Автозавершение, дни` — выводит дело в контроль завершения.
- Долги после отпуска редактируются на вкладке `Сотрудники`; отдельная вкладка `Очереди` не используется.
- Отпуска хранятся периодами: `employee_id`, `ФИО`, `Дата начала`, `Дата окончания`, `Тип`, `Комментарий`, `Изменено`.
- График отпусков можно загрузить из Excel формата `ФИО × даты`, где `1` — отпуск, `0` — рабочий день; перед записью показывается предпросмотр сопоставления сотрудников.

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
   - `TABS_YUC_SETTINGS_DATASHEET_ID=dstGXdrV1Mb3Rkc57E`
   - `TABS_YUC_SETTINGS_VIEW_ID=viwzMFn8hWD2U`
   - `TABS_REGIONAL_ASSIGNMENTS_DATASHEET_ID=dstPFbxwoPH7YfCRAz`
   - `TABS_REGIONAL_ASSIGNMENTS_VIEW_ID=viwrYdxBbj4UD`
   - `TABS_REGIONAL_SUBSTITUTIONS_DATASHEET_ID=dstZng9NVviKd5PhnZ`
   - `TABS_REGIONAL_SUBSTITUTIONS_VIEW_ID=viwMkyAsobxjs`
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
  - `TABS_YUC_SETTINGS_DATASHEET_ID=dstGXdrV1Mb3Rkc57E`
  - `TABS_YUC_SETTINGS_VIEW_ID=viwzMFn8hWD2U`
  - `TABS_REGIONAL_ASSIGNMENTS_DATASHEET_ID=dstPFbxwoPH7YfCRAz`
  - `TABS_REGIONAL_ASSIGNMENTS_VIEW_ID=viwrYdxBbj4UD`
  - `TABS_REGIONAL_SUBSTITUTIONS_DATASHEET_ID=dstZng9NVviKd5PhnZ`
  - `TABS_REGIONAL_SUBSTITUTIONS_VIEW_ID=viwMkyAsobxjs`

Постоянный диск `/data` не добавляйте.

## Проверка после деплоя

Откройте:

- `/` — главная страница приложения;
- `/api/storage-status` — должно быть видно `mode: "tabs"` и `tokenConfigured: true`;
- `/api/directories` — должен вернуться справочник ЮЦ/регионов из MTS Tabs;
- `/api/data` — должен вернуться JSON с данными и справочником из MTS Tabs.

Локальная проверка бизнес-логики без обращения к MTS Tabs:

```bash
npm run test:domain
```

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
