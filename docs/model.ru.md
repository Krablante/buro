# Сущности и пресеты

[English](model.md) · [Русский](model.ru.md) · [README](../README.ru.md)

У сущности есть постоянный `id`, понятное человеку `name`, тип `kind` из
пресета и версия записи `updated_at`. Остальные поля разрешены для этого
типа. `buro schema` показывает активный пресет, `buro schema <kind>` — поля
типа и пояснения к ним. `buro list [kind]` помогает найти идентификатор,
`buro <id>` выводит пакет.

Пресет задаёт словарь, порядок полей, пояснения к разделам и связь текущего
контекста (обычно хоста) с его сущностями. В нём находится **структура**, а не
частные записи экземпляра. Встроенный [`starter`](../presets/starter.yaml)
описывает хост, проект, сервис и документ; [`politia`](../presets/politia.yaml)
содержит более крупную рабочую модель. Выбери пресет через `preset` /
`BURO_PRESET` или укажи свой YAML через `schema_path` / `BURO_SCHEMA_PATH`.

## Свой словарь

В примере ниже — рабочие пространства и заметки. Сохрани YAML вне
установленного пакета, укажи его в `schema_path` и выполни `buro init` в
режиме local или central.

```yaml
id: notes
version: 1
default_kind: note

context:
  kind: workspace
  alias_field: aliases
  member_field: workspace
  root_field: root

sections:
  summary:
    guide: A short verified description of the item.
    draft_guide: Describe the item itself, not today's task.
  details:
    guide: Useful details about the item.

kinds:
  note:
    fields: [workspace, summary, tags]
  workspace:
    fields: [aliases, root, summary]

fields:
  workspace:
    type: ref
    target_kind: workspace
    section: location
  aliases:
    type: string-list
    section: identity
  root:
    type: string
    section: location
    required: true
  summary:
    type: text
    section: summary
    required: true
  tags:
    type: string-list
    section: details
```

Движок поддерживает `string`, `text`, `boolean`, `integer`, `number`, `ref`,
`string-list`, `record` и `record-list`. Вложенные записи объявляют свои
конечные наборы полей. Неизвестные поля и неверные значения отклоняются.
Ссылка верхнего уровня с `target_kind` должна указывать на сущность этого
типа. Строковые пути и URL хранятся как факты: BURO не проверяет внешние
объекты.

`sections.<name>.guide` показывается рядом с заполненным разделом в пакетах
и черновиках; `draft_guide` — только в черновиках. Поле `guide` видно в
пакетах, справке, схеме и черновиках. `packet: false` скрывает поле из
пакета, сохраняя его в JSON сущности. `draft_optional: false` убирает
отсутствующее необязательное поле из черновика. Пояснения однострочные и не
записываются в данные сущности.

При загрузке пресета проверяются неизвестные параметры, наборы полей,
значения по умолчанию, поля контекста и целевые типы ссылок. Пресет не
исполняет код или SQL. Идентификаторы контекстов и алиасы сравниваются без
учёта регистра; точки и двоеточия сохраняют значение. Неоднозначные имена
контекстов отклоняются.

## Изменение действующей модели

SQLite привязан к id и версии пресета, а также к хешу модели. Текст пояснений
не входит в хеш: его можно поправить, не меняя данные. При изменении
контракта или смысла пресета повысь `version`. `buro init` создаёт резервную
копию, проверяет все записи и принимает совместимую новую версию. Изменение
хеша без повышения версии отклоняется.

Если модель несовместима, [экспортируй весь реестр](interfaces.ru.md) со
старым пресетом, преобразуй манифест вне BURO и импортируй его с новым
пресетом и флагом `--adopt`. Import проверит записи и ссылки до замены базы.
