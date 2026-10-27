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

По каждому узлу — свойства, которые сразу ложатся в CSS:

- **блок и заливка** — `x, y, w, h, rotation`, `fills` (hex, градиенты с `angle`/точками,
  картинки с hash), `strokes` (`strokeWeight`, `strokeAlign`, `dash`, толщины по сторонам
  `borderWeights`), `cornerRadius` (число или `[tl, tr, br, bl]`), `effects` (тени/блюр),
  `opacity`, `blendMode`, `clipsContent`;
- **текст** — `text`, `fontFamily`, `fontWeight`, `italic`, `fontSize`, `lineHeight`,
  `letterSpacing`, `textAlign`, `textResize` (hug / fixed-width / fixed),
  `textDecoration`, `textCase` и `runs` для разных стилей внутри одного текста;
- **лейаут** — `autoLayout {mode, gap, padding, justify, align, wrap, width/height:
  hug|fixed}` у контейнеров и `layoutGrow` / `alignSelf` / `position` у детей
  (в терминах flexbox), `constraints`;
- **векторы и иконки** — у каждого вектора есть `svg`: точный контур из геометрии
  документа, можно вставлять как есть. Мелкие группы/инстансы только из векторов
  (иконки) сворачиваются в один `svg`;
- **компоненты** — инстансы разворачиваются из мастера (оверрайды, свойства
  текст/видимость/своп, размеры конкретного инстанса), у каждого есть `component`;
- **дизайн-система** — именованные стили (`fillStyle`, `textStyle`, `strokeStyle`, `effectStyle`)
  и переменные (`fills[].var`, `vars: {gap: "space/12"}`) со значениями по режимам;
- **прототип** — `interactions` (click/hover → переход/оверлей/назад/ссылка…), `scroll`.

```jsonc
// pixso_tree (фрагмент)
{ "type": "FRAME", "name": "card", "w": 360, "h": 120, "fills": ["#ffffff"], "cornerRadius": 12,
  "clipsContent": true,
  "autoLayout": { "mode": "horizontal", "gap": 12, "padding": [16,16,16,16], "align": "center", "width": "fixed", "height": "hug" },
  "children": [
    { "type": "INSTANCE", "name": "Icon 3", "component": "icon/download", "w": 24, "h": 24,
      "iconLayers": 2, "svg": "<svg viewBox=\"0 0 24 24\" …><path d=\"M4 2L20 2L12 16Z\" fill=\"#112233\"/>…</svg>" },
    { "type": "TEXT", "text": "Требуется согласование", "fontFamily": "Inter", "fontWeight": 600,
      "fontSize": 16, "lineHeight": 24, "fills": ["#1d2129"], "layoutGrow": 1 }
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
| `pixso_file_info` | имя, флаги публичности, права (быстро — без скачивания документа) |
| `pixso_pages(limit?)` | оглавление: страницы и их фреймы верхнего уровня `{id, name, w, h, section}` |
| `pixso_find(query, limit?)` | узлы, у которых **имя или текст** содержит `query`: `{id, type, name, text, frame}` |
| `pixso_text(node?)` | весь видимый текст страницы/фрейма в порядке слоёв: `{id, text, path}` — самый дешёвый способ прочитать экран |
| `pixso_tree(node?, depth?, include_hidden?, icons?, repeats?)` | вложенное дерево: инстансы развёрнуты, иконки — `svg`, длинные списки свёрнуты; `depth` ограничивает глубину (глубже → `childCount`) |
| `pixso_html(node?, fonts?, repeats?)` | **HTML + CSS заготовка**: flexbox из auto layout, иначе абсолютное позиционирование, все стили, иконки inline SVG, CSS-переменные для именованных цветов, `data-pixso-id` / `data-component` / `data-action` |
| `pixso_tokens(node?)` | дизайн-токены со счётчиками: цвета (роли, имена стилей/переменных), текстовые стили, шрифты, радиусы, тени, gap'ы, padding'и, градиенты, переменные по режимам |
| `pixso_components(node?)` | используемые компоненты (и вложенные), по наборам: сколько, id инстансов, значения вариантов и свойств; ненайденные мастера |
| `pixso_flows(node?, limit?)` | карта прототипа: `{from, on, action, to, url, transition}` на каждое взаимодействие + стартовые точки |
| `pixso_svg(node?)` | превью-SVG: точные контуры векторов и глифов текста, реконструкция заливок/обводок/теней/обрезки; так же экспортируются иконки. `stats` — что точно, что приблизительно |
| `pixso_list_nodes(type?, offset?, limit?)` | плоский постраничный список «сырых» слоёв (инстансы не развёрнуты) |
| `pixso_raw_model(offset?, length?)` | base64 распакованного документа, кусками |

`node` — это id (из `pixso_find` или параметра `item-id` в URL; дети инстансов вида
`I3119:319053;12:34`) или точное имя слоя. Без `node` ссылка с `?item-id=` (выделенный слой) или
`?page-id=` ограничивает `pixso_tree` / `pixso_text` / `pixso_svg`.

Типичный путь, чтобы сверстать экран: `pixso_pages` → `pixso_find` → `pixso_tokens(node)` (тема) →
`pixso_components(node)` (переиспользовать свой UI-кит) → `pixso_html(node)` / `pixso_tree(node, depth)` →
`pixso_flows` для навигации, `pixso_svg(node)` — посмотреть или выгрузить иконку. Этот порядок сервер
сам сообщает клиенту в MCP `instructions`.

Пять и больше похожих соседей подряд (строки списка/таблицы, карточки) сворачиваются в первые 3 плюс
узел `REPEAT` `{repeated, like, ids, items}` с текстами остальных — таблица на 300 строк стоит 3 строки
и данные.
Скачанный документ кэшируется на 5 минут — следующие вызовы мгновенные.

### Настройки (переменные окружения)

| переменная | по умолчанию | |
|------------|--------------|-|
| `PIXSO_WAIT_MS` | `60000` | сколько ждать документ по вебсокету |
| `PIXSO_CACHE_MS` | `300000` | сколько переиспользовать скачанный файл |
| `PIXSO_MAX_RESPONSE` | `400000` | предел ответа инструмента (символов); больше → ошибка с просьбой сузить `node`/`depth` |
| `PIXSO_MAX_NODES` | `20000` | сколько узлов `pixso_tree` собирает, прежде чем попросить сузить |
| `PIXSO_ICON_MAX` | `96` | до какого размера (px) иконка сворачивается в один `svg` в `pixso_tree` |
| `PIXSO_DEBUG` | — | `1` — лог кадров вебсокета в stderr |
| `PIXSO_API` / `PIXSO_WS` / `PIXSO_SCHEMA_URL` | pixso.net | свой (self-hosted) Pixso |

## Из командной строки

```bash
# вживую (нужен интернет; анонимно)
node pixso-fetch.mjs <file_key|url> doc.bin
node pixso-kiwi.mjs doc.bin tree          # или: flat | find <q> | node <имя|id> | text [node]
                                          #      pages | tokens [node] | components [node] | flows [node]
node pixso-svg.mjs  doc.bin "Checkout" > out.svg
node pixso-html.mjs doc.bin "Checkout" > out.html

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
- Инстанс разворачивается, только если мастер есть в файле (локальные компоненты и
  библиотечные, которые Pixso копирует в файл). Иначе всё равно отдаётся собственный
  текст инстанса (оверрайды, значения свойств), а `stats.missing` / `warning` называют
  ненайденные мастера.
- Картинки: только hash и размер — самих байтов картинок в потоке документа нет,
  поэтому `pixso_svg` рисует серые плашки.
- `rotation` — в градусах CSS вокруг `x, y` узла (его повёрнутого левого верхнего угла).
- Текст, переопределённый в инстансе без сохранённой раскладки глифов, `pixso_svg`
  рисует через `<text>` (без переносов); данные в `pixso_tree` от этого не страдают.
- Маски и операнды булевых операций в `pixso_svg` не компонуются (рисуется итоговый
  контур булевой операции).
- `pixso_html` — заготовка: flexbox повторяет auto layout, а фреймы без auto layout
  позиционируются абсолютно; шрифты подключаются из Google Fonts по имени семейства.
- Стили и переменные из библиотеки резолвятся, только если Pixso скопировал их
  определения в файл.

## Если что-то не так

- **Первый вызов падает по таймауту клиента** — большой файл долго качается; подними
  таймаут MCP в клиенте (OpenCode: `"timeout": 120000`) и/или `PIXSO_WAIT_MS`.
- **OpenCode: после переподключения сервера инструменты пропали** (`Unknown tool`,
  пустой поиск) — у клиента не обновился каталог инструментов; перезапусти сессию OpenCode.

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
