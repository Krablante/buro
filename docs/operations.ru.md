# Настройка и эксплуатация

[English](operations.md) · [Русский](operations.ru.md) · [README](../README.ru.md)

В режиме local BURO напрямую открывает SQLite. Central открывает ту же базу
и запускает `buro serve` для клиентов. Client обращается к API и не держит
локальную копию SQLite или пресета. Во всех режимах действует одна модель
сущностей и один проверяемый [путь записи](draft-workflow.ru.md).

По умолчанию изменяемые данные лежат вне репозитория:

```text
~/.config/buro/config.json
~/.local/share/buro/
├── BURO_DRAFT.yaml              # только во время правки
└── state/buro/
    ├── buro.sqlite3
    └── backups/sqlite/
```

Начальные значения: пресет `starter`, режим `local` и короткое системное
имя хоста как текущий контекст. Пример клиентского конфига:

```json
{
  "mode": "client",
  "current_context": "worker-a",
  "central_host": "registry",
  "api_url": "http://registry:8765"
}
```

`BURO_CONFIG` выбирает другой конфигурационный файл. Переменные окружения
имеют приоритет над JSON. Явный путь к схеме имеет приоритет над встроенным
пресетом.

| Ключ JSON | Переменная окружения |
| --- | --- |
| `mode` | `BURO_MODE` |
| `preset` | `BURO_PRESET` |
| `current_context` | `BURO_CURRENT_CONTEXT` |
| `central_host` | `BURO_CENTRAL_HOST` |
| `api_url` | `BURO_API_URL` |
| `instance_root` | `BURO_ROOT` |
| `state_dir` | `BURO_STATE_DIR` |
| `database_path` | `BURO_DATABASE_PATH` |
| `backup_dir` | `BURO_BACKUP_DIR` |
| `backup_retention` | `BURO_BACKUP_RETENTION` |
| `draft_path` | `BURO_DRAFT_PATH` |
| `schema_path` | `BURO_SCHEMA_PATH` |

По умолчанию сохраняются 20 последних копий. `buro backup` использует
механизм online backup SQLite; каждое успешное изменение снимает копию перед
записью под блокировкой SQLite. Частые правки большой базы требуют
заметного дискового I/O и места. Настрой retention под доступный диск и
проверяй восстановление: импортируй [полный экспорт](interfaces.ru.md) либо
восстанови снимок в отдельном экземпляре. `buro init` создаёт базу, а на
существующей — снимает копию, проверяет каждую запись и явно принимает
совместимую новую версию пресета. Обычное чтение отклоняет несовпадающую
привязку.

`buro init`, `buro backup`, `buro export`, `buro import` и `buro serve`
требуют режима local или central. Встроенный HTTP сервер не имеет
аутентификации и TLS. Используй loopback, если доступ не ограничен доверенной
приватной сетью или внешним прокси. Не копируй и не синхронизируй центральный
SQLite-файл на клиентов.

## Развёртывание Politia

`npm run deploy:politia` (псевдоним `deploy:live`) — операторский скрипт
Politia для Linux, а не универсальный установщик. Он один раз пакует
репозиторий, устанавливает пакет на центральном хосте, проверяет и принимает
пресет `politia`, перезапускает `buro-api.service` и устанавливает тот же
пакет на доступных клиентах. Список клиентов берётся из `buro list host`;
`BURO_WORKER_HOSTS` заменяет автообнаружение. Недоступный клиент остаётся без
изменений и попадает в отчёт; ошибка на доступном клиенте прерывает deploy.

```sh
npm run deploy:politia -- --dry-run
npm run deploy:politia
```

Перед упаковкой скрипт проверяет GIF-демонстрации, после установки — CLI и
API. Нужны настроенные права оператора для SSH и sudo. Правка исходников
сама по себе не обновляет работающие CLI, API и удалённые клиенты. Перед
развёртыванием вне Politia изучи `scripts/deploy-live.sh` и настройки
службы.

## GIF-демонстрации README

`npm run demos` пересобирает английский и русский GIF в `assets/` из команд
настоящего CLI во временном экземпляре `starter`. `npm run demos:check`
сравнивает сохранённые артефакты с тем же сценарием; операторский deploy
запускает эту проверку до упаковки. Для рендера нужны `ffmpeg` с фильтрами
`ass`, `palettegen`, `paletteuse`, а также DejaVu Sans и Mono. Иной каталог
шрифтов задаётся через `BURO_DEMO_FONTS_DIR`. Генератор не открывает рабочую
базу или черновик оператора.
