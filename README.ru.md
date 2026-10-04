# pixso-public-mcp

[English](README.md) · **Русский**

Неофициальный read-only [MCP](https://modelcontextprotocol.io)-сервер, который декодирует
**публичные** файлы [Pixso](https://pixso.net) в структурированные данные для
AI-агентов (Claude Code, Cursor, OpenCode и др.) — чтобы агент понял макет и сверстал
его в HTML/React/и т.д.

- **Без логина, без платного места (seat), без стороннего relay** — читает файлы,
  которые владелец открыл публично, через собственный анонимный гостевой доступ Pixso.
- **Ноль зависимостей** — только встроенные средства Node ≥ 22.15 (`fetch`,
  `WebSocket`, `zlib` zstd).
- **Точный декод** — разбирает настоящий формат документа Pixso (kiwi) по его же
  схеме, без эвристик.

> Не аффилировано с Pixso и не одобрено им. «Pixso» — товарный знак правообладателя.
> Работает только с файлами, которые владелец сделал публичными
> (`public_access` / `tourist_access`). См. **[Юридическое](#юридическое)**.

## Что на выходе

По каждому узлу: `type, name, x, y, w, h, fills, strokes, strokeWeight, cornerRadius,
opacity, effects (тени/блюр), background, text, fontSize, fontName, auto-layout`
и вложенное **дерево** «родитель → потомок».

```jsonc
// pixso_tree (фрагмент)
{ "type": "FRAME", "name": "WRAP", "w": 400, "h": 300, "fills": ["#ffffff"],
  "autoLayout": { "mode": "VERTICAL", "gap": 8, "padding": [16,16,16,16] },
  "children": [
    { "type": "RECTANGLE", "name": "BOX", "x": 16, "y": 16, "w": 200, "h": 100,
      "fills": ["#112233"], "strokes": ["#445566"], "strokeWeight": 4, "cornerRadius": 12,
      "effects": [{ "type": "DROP_SHADOW", "color": "#00000040", "x": 4, "y": 4, "blur": 10, "spread": 2 }] }
  ] }
```

## Установка

```bash
git clone <этот-репозиторий> && cd pixso-public-mcp
npm install           # заодно скачает схему Pixso (pixso.binary) через postinstall
# или только схему:  npm run schema
# зависимостей нет — npm нужен лишь чтобы скачать схему; можно вместо этого:
#   node scripts/get-schema.mjs
```

Нужен Node 22.15+ (встроенные zstd и WebSocket).

## Как MCP-сервер

```bash
# Claude Code
claude mcp add pixso node /абс/путь/pixso-mcp.mjs
```

Для OpenCode смотри `opencode.example.jsonc`.

Инструменты (принимают `file_key` **или полную ссылку** на макет
`pixso.net/app/design/<file_key>`):

| инструмент | возвращает |
|------------|------------|
| `pixso_file_info` | имя, флаги публичности, права |
| `pixso_find(query)` | лёгкий список `{id, type, name}` по имени — чтобы найти, что тянуть |
| `pixso_tree(node?)` | вложенное дерево; с `node` (имя или id, любой тип) — только это поддерево |
| `pixso_list_nodes` | плоский список узлов |
| `pixso_svg(node?)` | превью-SVG (реконструкция из данных, не официальный вектор Pixso) |
| `pixso_raw_model` | base64 распакованного документа |

Для больших файлов: `pixso_find` найти узел → `pixso_tree(node)` вытащить только его поддерево.

## Из командной строки

```bash
# вживую (нужен интернет; анонимно)
node pixso-fetch.mjs <file_key|url> doc.bin
node pixso-kiwi.mjs doc.bin tree          # или: flat | find <q> | node <имя|id>
node pixso-svg.mjs  doc.bin "Checkout" > out.svg

# из DevTools .har открытого публичного файла (вообще без работы с токеном)
node pixso-har.mjs capture.har doc.bin
node pixso-kiwi.mjs doc.bin tree
```

## Как это работает

1. `GET api.pixso.net/api/pix/file/<key>/access` → анонимный гостевой токен (только для публичных файлов).
2. `wss://api.pixso.net/ws/coop …` + `FileInit{LoadAll}` → документ приходит потоком.
3. Кадры — `zstd`-сжатый **kiwi** (бинарный формат Figma). Распаковка встроенным `zlib`.
4. Разбор компилированной kiwi-схемы Pixso (`pixso.binary`) и декод документа
   (`PixsoMsg → PixsoNode[]`), затем сборка в дерево по `parentIndex`.

## Корпоративный / self-hosted Pixso

Если у тебя своя инсталляция Pixso (с анонимным доступом к файлам) — укажи домен
через переменные окружения (см. `opencode.example.jsonc`):

```
PIXSO_API=https://pixso-url
PIXSO_WS=wss://pixso-url
PIXSO_SCHEMA_URL=https://pixso-url/app/pixso.binary
```
Схему под этот сервер: `PIXSO_SCHEMA_URL=https://pixso-url/app/pixso.binary npm run schema`.

## Ограничения

- Только публичные файлы. Файлы за логином этим путём недоступны (для них —
  Enterprise Open API с ключами от администратора).
- Привязано к версии схемы `v10.01`. Если Pixso поднимет версию — `npm run schema` заново.
- Пока не разобрано: угол градиента, URL картинок-заливок, констрейнты, пер-символьные
  стили текста.

## Юридическое

Инструмент читает **только** те файлы, которые владелец явно сделал публичными,
через собственный гостевой эндпоинт Pixso — ровно те данные, что получает анонимный
браузер.

- Он **не содержит кода или ассетов Pixso**. `pixso.binary` (схема Pixso) скачивается
  с серверов Pixso при установке и **игнорируется git**, здесь не распространяется.
- Весь код декодирования — оригинальный (независимая реализация открытого формата
  [kiwi](https://github.com/evanw/kiwi)).
- Лицензия MIT (только на код этого проекта).

Использование может подпадать под условия Pixso (например, пункты про автоматический
доступ или реверс-инжиниринг). Ответственность за использование — на тебе.
Предоставляется «как есть», без гарантий. Не используй для доступа к файлам, которые
тебе не разрешено просматривать.
