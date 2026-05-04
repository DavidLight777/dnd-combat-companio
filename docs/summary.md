# Сводка изменений — BV2 Entity System + E2E Testing

**Дата:** 2026-05-01
**Ветка/работа:** Redesign BV2 entity forms, canvas rendering, player interactions, E2E verification

---

## 1. База данных (Alembic миграции)

Добавлены новые поля в таблицы Builder v2:

- `bv2_traps.size_cells` — размер зоны триггера (клетки)
- `bv2_traps.dot_template_id` — ссылка на DOT шаблон
- `bv2_traps.damage_dice_count` — количество кубиков урона
- `bv2_traps.damage_dice_type` — тип кубика (4/6/8/10/12/20)
- `bv2_portals.size_cells` — размер зоны портала
- `bv2_npc_spawns.trigger_zone_size` — размер триггерной зоны

Миграция: `4ba69fbd39d9_add_trap_damage_dice_count_and_type.py`

---

## 2. Backend API

### 2.1. Trap API (`app/routers/builder_v2/traps.py`)
- **Зона триггера**: ловушка активирует квадрат `size_cells × size_cells` (не только одна клетка)
- **Парсинг урона**: поддержка `damage_dice` (строка "2d6") + новые поля `damage_dice_count` / `damage_dice_type`
- **Dodge endpoint**: `POST /traps/{id}/dodge` — персонаж пытается уклониться
- **Disarm endpoint**: `POST /traps/{id}/disarm` — обезвреживание
- **DOT шаблоны**: поддержка `dot_template_id` для эффектов по тикам
- **Bug fix**: `charges=null` от frontend теперь корректно обрабатывается (default 1, -1 = infinite)
- **Bug fix**: `check_trap_trigger` добавлен `await db.refresh(character)` (character был expired после commit в вызывающем коде)

### 2.2. Chest API (`app/routers/builder_v2/chests.py`)
- **Lockpick endpoint**: `POST /chests/{id}/lockpick`
- **Items в create/update**: формы теперь сохраняют `body["items"]` в `BV2ChestItem`
- **Take endpoint**: `POST /chests/{id}/take` — перенос предметов из сундука в инвентарь персонажа
- **Player endpoint fix**: player теперь загружает сундук через `/api/builder-v2/chests/{id}` (вместо legacy `/api/map-builder/chests/{id}/items`)

### 2.3. Portal / NPC Spawn API
- **Portal**: поддержка `size_cells` в create/update
- **NPC Spawn**: поддержка `trigger_zone_size` в create/update

### 2.4. Locations API (`app/routers/builder_v2/locations.py`)
- **Edges payload**: `target_location_name` добавлен в ответ
- **Enriched entities**: сундуки возвращают `items[]`, ловушки — `size_cells` и т.д.

### 2.5. Map Files API (`app/routers/map/files.py`)
- **Bug fix**: добавлен импорт `BV2Portal` (был `NameError`, карта падала с 500 при наличии порталов)

---

## 3. Frontend (GM Builder v2)

### 3.1. Trap Form (`static/js/builder_v2/50-entities.js`)
- Полностью переделан интерфейс:
  - **Damage section**: count (input) + dice type (dropdown: d4/d6/d8/d10/d12/d20)
  - **Size (cells)**: размер зоны
  - **Undodgeable toggle**
  - **Interaction DCs**: disarm / save
- Убраны toggles Armed/Disarmed/Reset (создание = всегда armed)

### 3.2. Chest Form
- Упрощённый вид: Name, Icon, Description, Hidden toggle
- **Items Inside**: выпадающий список предметов + quantity
- **Currency**: Gold + валюта

### 3.3. Portal / NPC Spawn Forms
- Добавлены поля `size_cells` (portal) и `trigger_zone_size` (npc spawn)

### 3.4. Canvas Rendering (`static/js/builder_v2/20-mapview.js`)
- **Entity zones**: отрисовка квадратных зон для trap/portal/npc_spawn
- **Light icons**: иконка 💡 для GM (цвет по `source_kind`)
- **Drag-to-resize**: Shift+drag на entity меняет `size_cells`
- **Edge tool**: клик по границе карты создаёт переход

---

## 4. Frontend (Player View)

### 4.1. Light Icons
- **GM**: видит иконки 💡 + световой эффект
- **Player**: видит ТОЛЬКО световой эффект (иконки скрыты через `if (this.role === 'gm')`)

### 4.2. Chest Interaction (`static/js/player/19-chest-portal.js`)
- Загрузка через `/api/builder-v2/chests/{id}`
- **Take items**: перенос в инвентарь через `POST /take`

### 4.3. Trap Interaction (`static/js/player/19-traps.js`)
- Модал dodge при срабатывании ловушки

### 4.4. Cache Bust
- Обновлены `?v=` хеши в `gm.html` и `player.html`

---

## 5. Тесты

### 5.1. Unit / API Tests (`tests/test_bv2_entities.py`)
5 тестов, все проходят:
1. `test_trap_zone_trigger_size_cells` — проверка зоны 2×2
2. `test_trap_dodge_offer_blocks_retrigger` — dodge не даёт повторно сработать
3. `test_chest_lockpick` — открытие замка
4. `test_portal_size_cells` — размер портала
5. `test_npc_spawn_trigger_zone_size` — зона спавна

### 5.2. E2E Tests (`tests/test_e2e_bv2.py`)
2 теста, все проходят:
1. `test_trap_creation_api_and_zone_render` — создание через API + проверка триггера
2. `test_chest_with_items_api` — создание сундука + take items

### 5.3. Playwright E2E Verification
Проведена ручная верификация через браузер:
- GM dashboard: открывается, персонаж виден в PARTY
- Builder: формы сундука/ловушки отрисовываются корректно
- Map view: локация выбирается, сетка видна
- **Bug found & fixed**: `BV2Portal` не импортирован → 500 при загрузке карты с порталом

---

## 6. Критические баги, найденные и исправленные

| Баг | Причина | Фикс |
|-----|---------|------|
| `charges=null` → 500 | `int(None)` падает | `int(body.get("charges") or 1)` |
| Карта с порталом → 500 | `BV2Portal` не импортирован в `map/files.py` | Добавлен импорт |
| Player не видит items в сундуке | Legacy endpoint мёртв | Переключено на `/api/builder-v2/chests/{id}` |
| Trap trigger не работает | Character expired после commit | `await db.refresh(character)` |

---

## 7. Что осталось непроверенным / TODO

- [ ] **Vision blocking**: проверить, что сундук за стеной не виден игроку (fog-of-war + blocks_vision)
- [ ] **Full trap damage flow**: провести персонажа через ловушку, проверить HP в UI (не только API)
- [ ] **Portal enter**: проверить кнопку "Enter Portal" в player view
- [ ] **Light icons**: скриншот player view — убедиться что 💡 скрыт
- [ ] **NPC spawn trigger**: проверить авто-спавн при входе в зону
- [ ] **Edge transitions**: проверить переход между локациями

---

## 8. Команды для проверки

```bash
# Запуск сервера
python main.py

# API тесты
pytest tests/test_bv2_entities.py -v

# Все тесты (кроме e2e UI)
pytest tests/ --ignore=tests/e2e -q

# E2E API тесты
pytest tests/test_e2e_bv2.py -v
```

---

## 9. Ключевые файлы

- `app/routers/builder_v2/traps.py` — логика ловушек
- `app/routers/builder_v2/chests.py` — сундуки + items
- `app/routers/builder_v2/portals.py` — порталы
- `app/routers/builder_v2/npc_spawns.py` — спавны NPC
- `app/routers/map/files.py` — bridge BV2 → legacy map state
- `static/js/builder_v2/50-entities.js` — формы сущностей
- `static/js/builder_v2/20-mapview.js` — canvas GM
- `static/js/map-canvas/render.js` — canvas Player
- `static/js/map-canvas/lighting.js` — свет + иконки
- `static/js/player/19-chest-portal.js` — player chest
- `tests/test_bv2_entities.py` — API тесты
