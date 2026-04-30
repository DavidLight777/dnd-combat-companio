# 📊 ПОЛНАЯ КАРТА ПРОЕКТА DnD Combat Companion

> **Дата генерации:** 2026-04-29
> **Версия модели:** kimi-k2.6
> **Назначение:** Исчерпывающая справочная карта всего проекта для AI-разработчика

---

## 1. ОБЩАЯ АРХИТЕКТУРА

**Стек:** Python 3.11, FastAPI, SQLAlchemy 2.0 (async), SQLite (aiosqlite), Alembic, Vanilla JS, Canvas2D, WebSocket

**Точки входа:**
- `/` → `static/lobby.html` — создание сессии / присоединение
- `/gm` → `static/gm.html` — дашборд GM (1046 строк)
- `/player` → `static/player.html` — дашборд игрока (535 строк)
- `/settings` → `static/settings.html` — настройки сервера

---

## 2. BACKEND — БАЗА ДАННЫХ (`app/models.py`, 1595 строк, 55+ таблиц)

### Ядро сессии и персонажей
| Таблица | Назначение |
|---------|-----------|
| `sessions` | Сессия: код, имя, статус, ход, таймер, настройки XP, блокировка карты |
| `characters` | Персонаж: HP, мана, статы, позиция, инвентарь, уровень/ранг, расса |
| `character_wizard_state` | Состояние пошагового визарда создания персонажа |

### Эффекты и модификаторы
| Таблица | Назначение |
|---------|-----------|
| `character_effects` | Активные эффекты (процент/плоское снижение урона) |
| `stat_modifiers` | Модификаторы статов (с истечением срока) |
| `attack_modifiers` | Модификаторы атаки |
| `damage_modifiers` | Модификаторы урона |
| `turn_timers` | Таймеры ходов |

### Боевая система
| Таблица | Назначение |
|---------|-----------|
| `initiative_order` | Порядок инициативы |
| `combat_log` | Лог боевых событий |
| `combat_events` | Боевые события (статус, раунд) |
| `combat_participants` | Участники боя |
| `combat_actions` | Действия в бою (атака, защита) |

### Карта (legacy)
| Таблица | Назначение |
|---------|-----------|
| `map_data` | Основные данные карты (изображение, сетка, туман) |
| `map_markers` | Маркеры (pin, danger, secret) |
| `map_drawings` | Рисунки (freehand, rectangle, circle) |
| `map_objects` | Объекты (wall, water, difficult, zone) |

### Архитектура карт (шаблоны)
| Таблица | Назначение |
|---------|-----------|
| `map_templates` | Шаблоны карт |
| `map_floors` | Этажи (сетка, размер, тип) |
| `map_library` | Библиотека сохранённых карт |
| `map_traps` | Ловушки на карте |
| `map_chests` | Сундуки на карте |
| `map_portals` | Порталы на карте |

### Предметы и инвентарь
| Таблица | Назначение |
|---------|-----------|
| `item_categories` | Категории предметов |
| `items` | Шаблоны предметов |
| `item_bonuses` | Бонусы предметов |
| `item_weapon_stats` | Оружейные характеристики |
| `inventory_items` | Предметы в инвентаре персонажа |
| `shop_items` | Предметы в магазине сессии |

### Экономика
| Таблица | Назначение |
|---------|-----------|
| `currency_transactions` | История транзакций |
| `npc_reputation` | Репутация у NPC |
| `npc_shop_inventory` | Инвентарь магазина NPC |
| `trade_sessions` | Торговые сессии |

### Статус-эффекты
| Таблица | Назначение |
|---------|-----------|
| `status_effect_templates` | Шаблоны статус-эффектов |
| `character_status_effects` | Активные эффекты на персонаже |
| `equipment_templates` | Шаблоны экипировки |

### Расы, классы, профессии
| Таблица | Назначение |
|---------|-----------|
| `races` | Расы с HP die |
| `race_rank_configs` | Конфиги рангов рас (HP/мана за уровень) |
| `classes` | Классы/профессии |
| `character_professions` | M:N связь персонаж-класс |

### NPC библиотека
| Таблица | Назначение |
|---------|-----------|
| `npc_folders` | Папки NPC (иерархические) |
| `npc_templates` | Шаблоны NPC |
| `event_templates` | Шаблоны событий |

### Квесты
| Таблица | Назначение |
|---------|-----------|
| `quest_templates` | Шаблоны квестов |
| `character_quests` | Квесты персонажа |

### Способности (Level/Rank Config)
| Таблица | Назначение |
|---------|-----------|
| `abilities` | Базовые способности |
| `ability_level_configs` | Конфиги по уровням (nullable → наследование) |
| `ability_rank_configs` | Конфиги по рангам (nullable → наследование) |
| `character_abilities` | Способности на персонаже |

### Прочее
| Таблица | Назначение |
|---------|-----------|
| `character_memory` | Журнал/воспоминания |
| `poison_templates` | Шаблоны ядов |
| `inventory_item_poisons` | Яды на оружии |
| `card_library` | Библиотека карт |
| `chests` / `chest_items` | Legacy сундуки |

### Map Builder v2 (BV2)
| Таблица | Назначение |
|---------|-----------|
| `bv2_maps` | Карты v2 |
| `bv2_locations` | Локации (сетка, ambient_light, indoor) |
| `bv2_tiles` | Плитки (col, row, tile_type, blocks_*) |
| `bv2_entities` | Сущности (chest, trap, portal, npc_spawn, cover_zone, light_marker) |
| `bv2_lights` | Источники света |
| `bv2_edges` | Переходы между локациями |
| `bv2_visit_state` | Fog of War per character per location |
| `bv2_library` | Снапшоты карт |
| `bv2_chests` / `bv2_chest_items` | Сундуки v2 |
| `bv2_traps` | Ловушки v2 (undodgeable, attack_bonus, dot_effect_json, charges, is_armed) |
| `bv2_portals` | Порталы v2 |
| `bv2_npc_spawns` | Спавны NPC |
| `bv2_cover_zones` / `bv2_cover_cells` | Зоны укрытия |
| `bv2_interior_zones` / `bv2_interior_cells` | Внутренние зоны |

---

## 3. BACKEND — РОУТЕРЫ (24 router-а)

| Роутер | Префикс | Ключевые эндпоинты |
|--------|---------|-------------------|
| `sessions` | `/api/sessions` | create, join, characters, settings, full-rest, export |
| `characters` | `/api` | GET/PUT/PATCH, HP, mana, level-up, rank-up, XP, атрибуты, NPC create/delete |
| `combat` | `/api/calc` | damage-intake, attack-roll, damage-roll, hp-recovery, enemy-damage |
| `combat_events` | `/api/combat` | CRUD combat, flow, initiative, attack, defense, rolls |
| `initiative` | `/api/initiative` | roll-all, order, start-combat, next-turn, end-combat |
| `map` | `/api/map` | files, tokens, fog, markers, drawings, objects, overlays |
| `inventory` | `/api` | items CRUD, character inv, equip/unequip, shop |
| `abilities` | `/api` | templates, configs, character abilities, use, passive, resolve |
| `builder_v2` | `/api/builder-v2` | maps, locations, tiles, entities, lights, edges, interiors, traps, chests, portals, spawns, cover_zones, library, FOV |
| `ai` | `/api/ai` | chat, history, generate-npc |
| `economy` | `/api` | currency, shop, trading, reputation, buyback |
| `status_effects` | `/api` | templates, character effects, advantage, equipment |
| `races_classes` | `/api/races-classes` | races, classes, rank-configs, seed |
| `npc_library` | `/api/npc-library` | folders, templates, events, spawn, encounter-difficulty |
| `quests` | `/api` | templates, assign, complete, fail |
| `websocket` | `/ws/{code}` | WebSocket соединение |
| `announcements` | `/api/announcements` | CRUD + pin |
| `notes` | `/api/notes` | character notes |
| `session_timer` | `/api/sessions` | timer start/pause |
| `combat_actions` | `/api/combat` | attack, defend |
| `memory` | `/api` | character memory |
| `professions` | `/api` | character professions |
| `poisons` | `/api` | poison templates, apply/remove |
| `cards` | `/api` | card library |
| `chests` | `/api` | legacy chests |
| `wizard` | `/api/wizard` | wizard state, features, items, finalize, GM oversight |

---

## 4. BACKEND — SACRED ФОРМУЛЫ (`app/game_mechanics.py`)

### Урон (НЕ ТРОГАТЬ)
```
hit_diff = enemy_roll - character_kd
hit_diff <= 0  → 0% (miss)
hit_diff 1-2   → 50%
hit_diff 3-4   → 60%
hit_diff 5-6   → 70%
hit_diff 7-8   → 80%
hit_diff 9-10  → 90%
hit_diff 11+   → 100%
```
Процентные снижения СКЛАДЫВАЮТСЯ с тировым. Плоские вычитаются после процентов.

### XP и ранги
- `xp_needed_for_level(L) = 100 + 100 * max(0, L)` (L0→1 = 100, L1→2 = 200...)
- Ранги: common → uncommon → rare → epic → legendary → mythic → divine
- Макс уровень = 10, потом авто-rank-up

### Слоты инвентаря
- `slots = 10 + 2 * constitution`

### Мана
- База = 10, реген = 0

---

## 5. WEBSOCKET СИСТЕМА

### `app/websocket_manager.py`
- `ConnectionManager` — singleton `manager`
- `connect/disconnect/broadcast_to_session/send_to_token/send_to_gm`
- Legacy shim `broadcast(session_id, msg)` для старых роутеров

### `app/realtime.py`
- SQLAlchemy event hooks: `after_flush` → `after_commit` → async broadcast
- Авто-маршрутизация по FK: `session_id` / `character_id` / `combat_event_id` / `inventory_item_id`
- Blacklist: `ai_conversations`, `combat_log`, `currency_transactions`, `character_wizard_state`
- Deduplication по `(label, character_id, combat_event_id)`
- Глобальные шаблоны (session_id=NULL) → broadcast во все сессии

### События GM (`static/js/gm/08-websocket.js`)
- `entity.invalidated` → debounced refresh по типу сущности
- `bv2.*` (30+ событий) → coalesced map refresh (200ms)
- `trap.triggered` → лог
- `wizard.update/completed` → pending approvals

### События Player (`static/js/player/13-websocket.js`)
- `entity.invalidated` → character-scoped refresh (только свой char_id)
- `bv2.*` → coalesced map refresh
- `map.lock_changed` → toggle CSS class
- `trap.triggered` → toast + loadChar()

---

## 6. FRONTEND — GM (`static/js/gm/`, 20 файлов)

| Файл | Размер | Назначение |
|------|--------|-----------|
| `01-core.js` | 21KB | Утилиты, табы, список party/NPC, refreshChars |
| `02-characters.js` | 96KB | Детальная панель персонажа, инвентарь, профессии, левел-ап |
| `03-level-up.js` | 24KB | Модал левел-апа, мерчанты, торговля |
| `04-status-effects.js` | 16KB | Статус-эффекты, библиотека шаблонов |
| `05-npc-sidebar.js` | 3KB | Спавн NPC, AOE урон |
| `06-map-main.js` | 31KB | MapCanvas init, загрузка состояния, маркеры, туман |
| `07-session-ops.js` | 6KB | Инициатива, combat, full rest, end session |
| `08-websocket.js` | 19KB | WS диспатчер, entity invalidation, wizard approvals |
| `09-items.js` | 37KB | База предметов, карты, категории |
| `10-ai-chat.js` | 6KB | AI чат GM |
| `11-combat.js` | 53KB | Полная боевая система GM, таймеры, лог бросков |
| `12-races-classes.js` | 24KB | Расы, классы, rank configs |
| `13-quests.js` | 29KB | Квесты, шаблоны, назначение |
| `14-npc-library.js` | 23KB | Библиотека NPC, папки, события |
| `15-meta-stage10.js` | 20KB | Анонсы, заметки, таймер сессии, AI NPC |
| `16-abilities.js` | 42KB | Редактор способностей (7 секций) |
| `17-npc-panels.js` | 34KB | Плавающие панели управления NPC |
| `19-chests.js` | 31KB | Сундуки, порталы, builder wiring |
| `20-init.js` | 1KB | Инициализация всех модулей |

---

## 7. FRONTEND — PLAYER (`static/js/player/`, 31 файл)

| Файл | Размер | Назначение |
|------|--------|-----------|
| `01-core.js` | 11KB | Утилиты, loadChar, advantage toggle |
| `02-starting-wizard.js` | 14KB | Визард создания, sidebar |
| `03-hp-stats.js` | 7KB | HP/MP бары, сетка статов |
| `04-attack.js` | 12KB | Атака, урон, dice groups |
| `05-damage-recovery.js` | 6KB | Входящий урон, ручное HP |
| `06-turn-effects.js` | 7KB | Таймеры, эффекты |
| `07-enemy-calc.js` | 4KB | Калькулятор урона по врагу |
| `08-log-inventory.js` | 15KB | Инвентарь, экипировка, слоты |
| `09-target-picker.js` | 12KB | Выбор цели, яды, слоты, магазин |
| `10-map.js` | 17KB | Карта, движение токена, FOV |
| `11-status-currency.js` | 8KB | Статус-эффекты, валюта, переводы |
| `12-modals-trade.js` | 8KB | Торговля с NPC |
| `13-websocket.js` | 11KB | WS, entity invalidation |
| `14-combat-banner.js` | 16KB | Боевой баннер, инициатива, таймер |
| `15-combat-fx.js` | 4KB | Анимации боевых эффектов |
| `16-defense.js` | 10KB | Система защиты (dodge/brace) |
| `17-char-roll.js` | 2KB | Броски характеристик |
| `18-quests.js` | 10KB | Квесты игрока |
| `19-chest-portal.js` | 6KB | Взаимодействие с сундуками/порталами |
| `19-traps.js` | 0.5KB | Уведомления о ловушках |
| `20-stage10.js` | 9KB | Анонсы, заметки, таймер |
| `21-tabs.js` | 2KB | Переключение табов |
| `22-table-view.js` | 8KB | Карточки за столом |
| `23-action-menu.js` | 48KB | **Главное меню действий** (атака, способности, предметы) |
| `24-reactions.js` | 5KB | Реакции в бою |
| `25-bonuses.js` | 4KB | Активные бонусы/штрафы |
| `26-abilities.js` | 6KB | Вкладка способностей |
| `27-memory.js` | 6KB | Журнал |
| `28-free-roll.js` | 4KB | Свободные броски кубиков |
| `29-level-up.js` | 9KB | Модал левел-апа |
| `30-init.js` | 2KB | Инициализация |

---

## 8. FRONTEND — MAP CANVAS (`static/js/map-canvas/`, 8 файлов)

| Файл | Назначение |
|------|-----------|
| `index.js` | Конструктор MapCanvas, FX engine, raycast, lifecycle |
| `render.js` | **Главный рендер** (1005 строк): плитки, сетка, токены, свет, туман, интерьеры |
| `events.js` | Ввод: pan, zoom, drag, рисование, measure, токены |
| `state.js` | Сеттеры состояния (setTokens, setLights, setTiles...) |
| `lighting.js` | Динамический свет: flicker, pulse, additive blending, vision |
| `fog.js` | Shadowcasting FOV |
| `hex-math.js` | Геометрия hex-сетки |
| `token-anim.js` | Интерполяция токенов, screen shake |

### MapCanvas — ключевые возможности
- 3 режима: `edit`, `gm-runtime`, `player`
- Сетка: square (Chebyshev) или hex (axial)
- Токены: портреты, HP ring, анимация 200ms easeOutCubic
- Свет: ray-cast polygon, bright/dim radius, torch flicker (~8Hz), magic pulse (~2Hz)
- Туман: explored cells persist, unexplored = black
- Интерьеры: roof hide on enter, door-peek BFS
- Бюджет движения: ghost preview, snap-back если превышен

---

## 9. FRONTEND — BUILDER V2 (`static/js/builder_v2/`, 12 файлов)

| Файл | Назначение |
|------|-----------|
| `00-state.js` | Общее состояние `window.bv2` |
| `10-api.js` | REST wrapper `/api/builder-v2` |
| `20-mapview.js` | Класс MapView (рендер плиток, сущностей, FOV) |
| `30-editor.js` | Контроллер редактора, auto-save tiles |
| `40-websocket.js` | Live-sync между GM |
| `50-entities.js` | CRUD сущностей (chest, trap, portal, npc_spawn, cover_zone) |
| `60-fov.js` | FOVCalculator (recursive shadowcasting) |
| `70-lights.js` | Редактор света, floating draggable panel |
| `80-edges.js` | Переходы между локациями |
| `90-library.js` | Снапшоты карт |
| `95-interiors.js` | Внутренние зоны |
| `96-building.js` | Макрос: стена+пол+дверь+зона одним drag |

---

## 10. ТЕСТЫ

### Unit tests (`tests/`, 18 файлов, 127 passed / 2 failed)
| Файл | Что тестирует |
|------|---------------|
| `test_smoke.py` | Основной интеграционный набор (80+ тестов) |
| `test_trap_trigger.py` | Триггер ловушек, заряды, уклонение |
| `test_interior_perimeter.py` | Авто-стены вокруг зданий |
| `test_vision_blocking.py` | FOV/shadowcasting |
| `test_location_ambient.py` | Ambient light round-trip |
| `test_edge_transition.py` | Телепортация через edge |
| `test_lighting_bug_b.py` | bright_radius_cells default |
| `test_movement_bug_a.py` | Floor не блокирует, wall блокирует |
| `test_delete_guard.py` | Каскадное удаление BV2 карты |
| `test_viewport_cull.py` | Viewport culling |
| `test_grid_lod.py` | Скрытие сетки при мелких ячейках |
| `test_phase13_lighting_r*.py` | Lighting R1/R2/R3 |
| `test_phase10_demo_seed.py` | Демо-карта |
| `test_cache_bust.py` | Cache bust script |

### E2E tests (`tests/e2e/`, 38 тестов, все проходят)
- Playwright + Chromium против live Uvicorn
- Покрывают: создание сессии, drag токена, combat, builder v2, сундуки, свет, левел-ап, инициатива, AI, туман, lock map, движение токена, ловушки, vision, lighting (R1/R2/R3)

---

## 11. CSS

| Файл | Строки | Назначение |
|------|--------|-----------|
| `static/css/base.css` | 372 | Дизайн-система: переменные, утилиты, модалки, тосты |
| `static/css/gm.css` | 1022 | GM интерфейс: табы, sidebar, combat, builder, токены |
| `static/css/player.css` | 721 | Player: 3-колонки, HP/MP, способности, инвентарь |

---

## 12. КЛЮЧЕВЫЕ ИНТЕГРАЦИОННЫЕ ТОЧКИ

### Async SQLAlchemy (частая причина багов)
- **НЕЛЬЗЯ** обращаться к relationship вне async контекста
- **Правильно:** Batch-загрузка отдельными запросами вместо `selectinload()`

### Rank/Level система способностей
- `_resolve_ability()` нужно вызывать с явной передачей `level_configs` и `rank_configs`
- `null` в конфиге = inherit от предыдущего тира или базы
- При rank-up: удалить старые passive bonuses → resolve с новым рангом → применить новые

### WebSocket события (backend → frontend)
```
character.leveled_up
character.rank_promoted
ability.rank_promoted
quest.completed
trap.triggered
entity.invalidated   # для всех DB mutations
bv2.*                # 30+ событий для builder
map.lock_changed
```

### Последовательность инициализации (GM)
`refreshChars` → `loadInitiativeOrder` → `loadAIHistory` → `loadItems` → `loadCombatPanel` → `loadRacesClasses` → `loadNpcLibrary` → `loadQuests` → `loadAnnouncements` → `loadSessionTimer` → `loadGmAbilities` → `loadWizardPending` → `loadMapState` → `loadCards` → `loadChests` → `ws.connect()`

### Последовательность инициализации (Player)
`loadChar` → `loadInventory` → `loadCurrency` → `loadStatusEffects` → `initPlayerMainGrid` → `loadCombatBanner` → `loadPlayerQuests` → `loadPlayerAnnouncements` → `loadPlayerNotes` → `loadPlayerTimer` → `loadTableView` → `renderBonusesPenalties` → `loadAbilities` → `initFreeRollWidget` → `ws.connect()`

---

## 13. МИГРАЦИИ ALEMBIC (46+ ревизий)

Ключевые этапы:
- `4b807ffb72fe` — **BV2 Map Builder v2** (основные таблицы)
- `d928752f9387` — BV2 entity details (chests, traps, portals, NPC spawns, cover zones)
- `a6197a61b7f3` — BV2 interior zones + cells
- `924b67782e86` — **Phase 17 R5** расширение traps (undodgeable, attack_bonus, dot_effect_json, charges, is_armed)
- `78dfd2bbf75f` — Map lock for players
- `ee1d2737fa51` — Ability level/rank configs
- `r2a0b1c2d3e4` — Rework v2 (age, gender, max_inventory_slots, declined_stats)

---

*Карта сгенерирована AI-ассистентом. При изменении архитектуры обновлять этот файл.*
