# Combat Companion — Полный путеводитель по коду

> **Версия:** Phase 7 complete  
> **Стек:** FastAPI + SQLAlchemy (async) + SQLite + vanilla JS  
> **Запуск:** `python main.py` → открывает `http://localhost:8000`

---

## 1. Архитектура проекта

```
dnd-companion/
├── main.py                         # Точка входа, FastAPI app, все роутеры
├── config.json                     # Настройки сервера, AI ключ, валюта
├── requirements.txt                # Python зависимости
├── ai_system_prompt.txt            # Системный промпт для AI ассистента
│
├── app/                            # Серверная логика
│   ├── database.py                 # init_db(), get_session(), SQLite aiosqlite
│   ├── models.py                   # Все ORM модели (770 строк, 30+ таблиц)
│   ├── schemas.py                  # Pydantic схемы валидации
│   ├── game_mechanics.py           # Чистые функции расчётов (без БД)
│   ├── websocket_manager.py        # ConnectionManager — WS по session_code
│   ├── ai_agent.py                 # OpenRouter AI интеграция
│   └── routers/                    # 21 API роутер
│       ├── sessions.py             # Создание/join сессий
│       ├── characters.py           # CRUD персонажей + статы
│       ├── inventory.py            # Предметы, экипировка, магазин
│       ├── economy.py              # Валюта, транзакции, торговля
│       ├── combat.py               # Броски атаки/урона/лечения (legacy)
│       ├── combat_events.py        # Боевые события, инициатива, execute-attack
│       ├── combat_actions.py       # Боевые действия в активном бою
│       ├── initiative.py           # Система инициативы
│       ├── status_effects.py       # Статус-эффекты (яды, бафы, дебафы)
│       ├── abilities.py            # Способности: CRUD, assign, use, passive
│       ├── races_classes.py        # Расы и классы с бонусами
│       ├── npc_library.py          # Библиотека NPC шаблонов + папки
│       ├── quests.py               # Квесты: шаблоны, назначение, этапы
│       ├── map.py                  # Карта: загрузка, маркеры, рисунки, туман
│       ├── notes.py                # Заметки персонажей
│       ├── announcements.py        # Объявления сессии
│       ├── session_timer.py        # Таймер игрового времени
│       ├── memory.py               # Журнал памяти персонажа
│       ├── ai.py                   # AI чат эндпоинты
│       └── websocket.py            # WS хэндлер + роутинг событий
│
├── alembic/                        # Миграции БД
│   └── versions/                   # 18 миграций (initial → phase7)
│
├── static/                         # Фронтенд
│   ├── lobby.html                  # Главная: создать/войти в сессию
│   ├── gm.html                     # GM панель (27KB HTML)
│   ├── player.html                 # Игрок панель (17KB HTML)
│   ├── settings.html               # Настройки сервера
│   ├── index.html                  # Legacy lobby
│   ├── style.css                   # Legacy стили
│   ├── app.js                      # Legacy JS (74KB, не используется активно)
│   ├── css/
│   │   ├── base.css                # Общие стили, CSS переменные, тёмная тема
│   │   ├── gm.css                  # Стили GM панели
│   │   └── player.css              # Стили игрока
│   └── js/
│       ├── gm-app.js               # GM логика (287KB, основной файл)
│       ├── player-app.js           # Игрок логика (117KB)
│       ├── character-sheet-core.js  # Общие функции рендера (Phase 7)
│       ├── map-canvas.js           # Canvas карта с токенами
│       └── websocket-client.js     # WS клиент обёртка
│
├── data/
│   ├── combat_companion.db         # Основная SQLite БД
│   └── maps/                       # Загруженные карты
│
└── test_stage*.py                  # Тесты по стадиям (3-11)
```

---

## 2. Как работает приложение

### Поток данных

```
Браузер (GM/Player)  ←→  WebSocket  ←→  FastAPI Server  ←→  SQLite DB
       ↕                                      ↕
   REST API (fetch)              game_mechanics.py (расчёты)
```

### Сессии и аутентификация

- **GM создаёт сессию** → получает `gm_token` + `session_code` (напр. `IRON-3631`)
- **Игроки присоединяются** по `session_code` → выбирают персонажа → получают `player_token`
- Токены хранятся в `sessionStorage` браузера
- WS подключение: `/ws/{session_code}?token={token}` — роль определяется автоматически

### Страницы

| URL | Файл | Назначение |
|-----|-------|-----------|
| `/` | `lobby.html` | Создание/вход в сессию |
| `/gm?code=XXX` | `gm.html` + `gm-app.js` | Панель GM |
| `/player?code=XXX` | `player.html` + `player-app.js` | Панель игрока |
| `/settings` | `settings.html` | Настройки сервера и AI |

---

## 3. Модели данных (app/models.py)

### Основные сущности

| Модель | Таблица | Описание |
|--------|---------|----------|
| `Session` | `sessions` | Игровая сессия (code, gm_token, status, timer) |
| `Character` | `characters` | Персонаж (PC или NPC). 6 статов, HP, мана, KD, токен |
| `CharacterEffect` | `character_effects` | Эффекты на персонаже (percent_reduction, flat_reduction) |
| `StatModifier` | `stat_modifiers` | Модификаторы статов (race/class/potion/manual/ability) |
| `AttackModifier` | `attack_modifiers` | Бонус к атаке |
| `DamageModifier` | `damage_modifiers` | Бонус к урону |
| `TurnTimer` | `turn_timers` | Таймеры с обратным отсчётом |

### Предметы и инвентарь

| Модель | Описание |
|--------|----------|
| `Item` | Предмет в глобальной базе (имя, редкость, цена, бонусы, оружие) |
| `ItemBonus` | Бонус предмета (stat_bonus, attack_bonus, damage_reduction, и т.д.) |
| `ItemWeaponStats` | Статы оружия (dice, damage_type, range, properties) |
| `ItemCategory` | Категория предметов (оружие, броня, зелье...) |
| `InventoryItem` | Предмет в инвентаре персонажа (quantity, equipped, slot) |
| `ShopItem` | Предмет в магазине сессии |

### Экономика и торговля

| Модель | Описание |
|--------|----------|
| `CurrencyTransaction` | Транзакция валюты (от кого → кому, сумма) |
| `NpcReputation` | Репутация NPC↔Player (-100..100) |
| `NpcShopInventory` | Инвентарь магазина NPC (stock, price_override) |
| `TradeSession` | Торговая сессия между NPC и игроком |

### Статус-эффекты

| Модель | Описание |
|--------|----------|
| `StatusEffectTemplate` | Шаблон эффекта (Poisoned, Blessed, Stunned...) |
| `CharacterStatusEffect` | Активный эффект на персонаже (remaining_turns, effects JSON) |
| `EquipmentTemplate` | Шаблон набора экипировки |

### Боевая система

| Модель | Описание |
|--------|----------|
| `CombatEvent` | Боевое событие (preparing→active→ended, round_number) |
| `CombatParticipant` | Участник боя (initiative, turn_order) |
| `CombatAction` | Действие в бою (attack_roll, damage_roll JSON) |
| `CombatLog` | Лог боевых событий |
| `InitiativeOrder` | Порядок инициативы (legacy) |

### Расы, классы, NPC

| Модель | Описание |
|--------|----------|
| `Race` | Раса (bonuses JSON, special_abilities) |
| `CharacterClass` | Профессия (bonuses, special_abilities) |
| `NpcFolder` | Папка в библиотеке NPC (вложенные) |
| `NpcTemplate` | Шаблон NPC (все статы, default_equipment, shop_items) |
| `EventTemplate` | Шаблон события (группа NPC для спавна) |

### Квесты

| Модель | Описание |
|--------|----------|
| `QuestTemplate` | Шаблон квеста (stages, rewards) |
| `CharacterQuest` | Квест назначенный персонажу (active/completed/failed) |

### Способности (Phase 6)

| Модель | Описание |
|--------|----------|
| `Ability` | Способность (active/passive/reaction, costs, targeting, damage, effects) |
| `CharacterAbility` | Назначенная способность (cooldown_remaining) |

### Прочее

| Модель | Описание |
|--------|----------|
| `MapData` | Данные карты (image, grid, fog) |
| `MapMarker` | Маркер на карте |
| `MapDrawing` | Рисунок на карте (freehand, shapes) |
| `AIConversation` | История AI чата |
| `SessionAnnouncement` | Объявления сессии |
| `CharacterNote` | Заметки персонажа |
| `CharacterMemory` | Журнал памяти персонажа |

---

## 4. API Роутеры — полный список эндпоинтов

### sessions.py — `/api/sessions`
- `POST /api/sessions` — создать сессию
- `POST /api/sessions/join` — присоединиться к сессии
- `GET /api/sessions/{code}` — информация о сессии
- `GET /api/sessions/{code}/characters` — все персонажи сессии
- `POST /api/sessions/{code}/npc` — создать NPC в сессии
- `DELETE /api/sessions/{code}` — удалить сессию

### characters.py — `/api/characters`
- `GET /api/characters/{id}` — получить персонажа (полная сериализация)
- `PUT/PATCH /api/characters/{id}` — обновить любые поля
- `DELETE /api/characters/{id}` — удалить
- `PATCH /api/characters/{id}/hp` — изменить HP (delta или set)
- `POST /api/characters/{id}/roll-characteristic` — бросок характеристики (D20 + стат)
- `GET /api/characters/{id}/status-penalties` — штрафы от статус-эффектов
- `POST /api/characters/{id}/set-advantage` — принудительный advantage/disadvantage
- `POST /api/characters/{id}/restore-mana` — восстановить ману

### inventory.py — `/api/inventory`, `/api/items`
- `GET /api/items?session_id=X` — все предметы сессии
- `POST /api/items` — создать предмет
- `PUT /api/items/{id}` — обновить предмет
- `DELETE /api/items/{id}` — удалить
- `POST /api/items/{id}/duplicate` — дублировать
- `GET /api/characters/{id}/inventory` — инвентарь персонажа
- `POST /api/characters/{id}/inventory` — дать предмет
- `DELETE /api/inventory-items/{id}` — убрать предмет
- `POST /api/inventory-items/{id}/equip` — экипировать (в слот)
- `POST /api/inventory-items/{id}/unequip` — снять
- `POST /api/inventory-items/{id}/use` — использовать (зелье и т.д.)
- `GET /api/characters/{id}/equipped-bonuses` — все бонусы от экипировки
- `GET /api/item-categories` — категории предметов
- `POST /api/item-categories` — создать категорию

### economy.py — `/api/characters/{id}/currency`
- `GET /api/characters/{id}/currency` — баланс (platinum/gold/silver/bronze)
- `POST /api/characters/{id}/currency/give` — дать валюту
- `POST /api/characters/{id}/currency/take` — забрать валюту
- `PUT /api/characters/{id}/currency/set` — установить баланс
- `GET /api/characters/{id}/currency/history` — история транзакций
- `POST /api/economy/transfer` — перевод между персонажами
- `GET /api/characters/{id}/merchant/shop` — магазин NPC
- `POST /api/characters/{id}/merchant/shop` — добавить товар
- `POST /api/characters/{id}/merchant/buy` — купить у NPC
- `POST /api/characters/{id}/merchant/sell` — продать NPC
- `POST /api/characters/{id}/merchant/buyback` — выкупить обратно

### combat.py — `/api/combat` (расчёты бросков)
- `POST /api/combat/attack-roll` — бросок атаки (D20 + модификаторы)
- `POST /api/combat/damage-roll` — бросок урона
- `POST /api/combat/damage-intake` — приём урона (формула KD)
- `POST /api/combat/hp-recovery` — лечение (dice + CON mod)

### combat_events.py — `/api/combat` (боевые события)
- `POST /api/combat/create` — создать бой
- `GET /api/combat/{id}/state` — состояние боя
- `GET /api/combat/session/{code}/active` — активный бой сессии
- `POST /api/combat/{id}/add-participant` — добавить участника
- `POST /api/combat/{id}/add-participants` — добавить несколько
- `DELETE /api/combat/{id}/participants/{char_id}` — убрать
- `POST /api/combat/{id}/roll-npc-initiative` — бросить инициативу NPC
- `POST /api/combat/{id}/request-player-initiative` — запросить у игроков
- `POST /api/combat/{id}/set-player-initiative` — игрок отправляет свой бросок
- `POST /api/combat/{id}/set-manual-initiative` — GM устанавливает вручную
- `POST /api/combat/{id}/start` — начать бой (сортировка по инициативе)
- `POST /api/combat/{id}/next-turn` — следующий ход
- `POST /api/combat/{id}/end` — завершить бой
- `POST /api/combat/execute-attack` — полный цикл атаки (hit→damage→apply)

### combat_actions.py — `/api/combat`
- `POST /api/combat/{id}/attack` — атака в контексте активного боя
- `GET /api/combat/{id}/actions` — история действий в бою

### status_effects.py — `/api/characters/{id}/status-effects`
- `GET /api/characters/{id}/status-effects` — активные эффекты
- `POST /api/characters/{id}/status-effects` — применить эффект
- `DELETE /api/status-effects/{id}` — убрать эффект
- `GET /api/status-effect-templates` — шаблоны эффектов
- `POST /api/status-effect-templates` — создать шаблон
- `PUT /api/status-effect-templates/{id}` — обновить шаблон

### abilities.py — `/api/abilities`
- `GET /api/abilities?session_id=X` — все способности сессии
- `POST /api/abilities` — создать способность
- `PUT /api/abilities/{id}` — обновить
- `DELETE /api/abilities/{id}` — удалить
- `POST /api/abilities/{id}/duplicate` — дублировать
- `GET /api/characters/{id}/abilities` — способности персонажа
- `POST /api/characters/{id}/abilities` — назначить способность
- `DELETE /api/character-abilities/{id}` — убрать
- `POST /api/character-abilities/{id}/use` — использовать (мана, HP, эффекты, кулдаун)

### races_classes.py — `/api/races-classes`
- `GET /api/races-classes/races?session_id=X` — расы
- `POST /api/races-classes/races` — создать расу
- `PUT /api/races-classes/races/{id}` — обновить
- `DELETE /api/races-classes/races/{id}` — удалить
- То же для `/classes`
- `POST /api/races-classes/assign-race` — назначить расу (применяет бонусы)
- `POST /api/races-classes/assign-class` — назначить класс

### npc_library.py — `/api/npc-library`
- `GET /api/npc-library/folders?session_id=X` — папки + шаблоны
- `POST /api/npc-library/folders` — создать папку
- `POST /api/npc-library/templates` — создать шаблон NPC
- `POST /api/npc-library/templates/{id}/spawn` — спавнить NPC в сессию
- `GET /api/npc-library/event-templates` — шаблоны событий
- `POST /api/npc-library/event-templates` — создать
- `POST /api/npc-library/event-templates/{id}/execute` — запустить событие (спавн группы)

### quests.py — `/api/quests`
- `GET /api/quests/templates?session_id=X` — шаблоны квестов
- `POST /api/quests/templates` — создать шаблон
- `POST /api/quests/assign` — назначить квест персонажу
- `GET /api/characters/{id}/quests` — квесты персонажа
- `PUT /api/quests/{id}` — обновить прогресс
- `POST /api/quests/{id}/complete-stage` — завершить этап
- `POST /api/quests/{id}/complete` — завершить квест (выдать награды)

### map.py — `/api/map`
- `POST /api/map/upload` — загрузить карту
- `GET /api/map/{session_id}` — получить карту
- `PUT /api/map/{session_id}` — настройки карты (grid, fog)
- `POST /api/map/{session_id}/tokens/move` — переместить токен
- `POST /api/map/{session_id}/markers` — добавить маркер
- `GET /api/map/{session_id}/markers` — маркеры
- `POST /api/map/{session_id}/drawings` — добавить рисунок
- `PUT /api/map/{session_id}/fog` — обновить туман войны

### notes.py, announcements.py, session_timer.py, memory.py, ai.py
- Заметки персонажей (CRUD)
- Объявления сессии (CRUD, pin)
- Таймер сессии (start/stop/reset)
- Журнал памяти персонажа (npc_encounter, event, note)
- AI чат (send message, get history, clear)

---

## 5. Механики игры (game_mechanics.py)

### Формула урона (SACRED — не менять!)
```
hit_diff = enemy_roll - character_KD

hit_diff ≤ 0   → MISS  (0%)
hit_diff 1-2   → 50%
hit_diff 3-4   → 60%
hit_diff 5-6   → 70%
hit_diff 7-8   → 80%
hit_diff 9-10  → 90%
hit_diff 11+   → 100%

Эффект-редукции складываются с tier-редукцией (не умножаются).
Пример: tier 70% (30% ред.) + эффект 10% = 40% → 60% урона.
Плоская редукция вычитается после процентной.
```

### Полный цикл атаки (execute-attack)
```
1. Загрузить атакующего и цель
2. Загрузить бонусы экипировки + штрафы статусов обоих
3. Получить оружие (main_hand или unarmed)
4. Resolve advantage (player choice + forced status)
5. HIT ROLL: D20 + stat_mod + weapon_bonus + item_atk + status_penalty
   - Nat 1 = FUMBLE (всегда промах)
   - Nat 20 = CRITICAL (всегда попадание, ×2 dice)
   - Иначе: total ≥ target_AC → HIT
6. DAMAGE ROLL: weapon_dice + stat_mod + item_dmg + status_penalty
7. INTAKE: raw_damage × (100% - percent_reduction) - flat_reduction
8. Apply к HP цели, если HP ≤ 0 → is_alive = false
```

### Advantage/Disadvantage
- **Advantage:** бросить 2×D20, взять лучший
- **Disadvantage:** бросить 2×D20, взять худший
- Forced advantage/disadvantage от статус-эффектов переопределяет выбор игрока
- Если оба forced — отменяют друг друга → normal

### Модификатор стата
```python
stat_modifier(stat) = (stat - 10) // 2
# 10 → 0, 12 → 1, 14 → 2, 8 → -1, 6 → -2
```

### Бонусы экипировки
Агрегируются из всех `ItemBonus` экипированных предметов:
- `stat_bonus` — к конкретному стату
- `attack_bonus` / `damage_bonus` — к атаке/урону
- `percent_damage_reduction` / `flat_damage_reduction` — защита
- `hp_bonus` / `mana_bonus` / `initiative_bonus` / `speed_bonus`
- `damage_dice_count` / `damage_dice_type` — доп. кости урона

### Штрафы статус-эффектов
Каждый `CharacterStatusEffect` хранит JSON массив эффектов:
```json
[
  {"type": "stat_penalty", "stat": "strength", "value": -2},
  {"type": "attack_penalty", "value": 2},
  {"type": "damage_penalty", "value": 1},
  {"type": "damage_reduction_penalty", "value": -5},
  {"type": "forced_advantage", "value": true},
  {"type": "forced_disadvantage", "value": true},
  {"type": "skip_turn", "value": true},
  {"type": "hp_change_per_turn", "value": -3},
  {"type": "mana_change_per_turn", "value": -2}
]
```

### Система валюты
```
1 Platinum = 1000 Bronze
1 Gold     = 100 Bronze
1 Silver   = 10 Bronze
1 Bronze   = 1 Bronze
```
Всё хранится как `wealth_bronze`. Конвертация на фронте.

### Способности (Abilities)
- **Active:** стоят ману/HP, можно использовать, есть кулдаун
- **Passive:** при назначении автоматически создают `StatModifier`/`AttackModifier`/`DamageModifier`, при снятии — удаляют
- **Reaction:** как active, но отмечены отдельным типом
- При использовании: проверка маны → проверка HP → списание → применение эффектов → запуск кулдауна
- Кулдауны уменьшаются на 1 каждый ход (в combat turn-end)

---

## 6. WebSocket события

### Типы сообщений (от клиента через `ws.send`)
```
table.updated              — обновить table view у всех
combat.character_downed    — персонаж упал в бою
combat.attack_result       — результат атаки NPC
npc.token_color_changed    — цвет токена NPC изменён
roll.characteristic        — бросок характеристики (broadcast)
mana.updated              — мана изменена
combat.roll_initiative_request — GM запрашивает инициативу
```

### Типы сообщений (от сервера через manager)
```
combat.roll_initiative_request  — к игрокам: бросьте инициативу
combat.initiative_submitted     — инициатива игрока получена
combat.started / combat.ended   — начало/конец боя
combat.turn_changed            — смена хода
quest.assigned / quest.updated  — квесты
announcement.new               — новое объявление
```

### ConnectionManager
- Хранит все WS по `session_code`
- `broadcast_to_session(code, event, data)` — всем в сессии
- `send_to_token(code, token, event, data)` — конкретному игроку
- `send_to_gm(code, event, data)` — только GM

---

## 7. Фронтенд — GM панель (gm-app.js)

### Основные секции GM панели

1. **Левый sidebar** — список персонажей (PCs + NPCs), кнопка создания NPC
2. **Центральная панель** — детали выбранного персонажа
3. **Правая панель** — GM Tools
4. **Нижняя панель** — Roll Log (броски от игроков)

### GM Tools (правая панель)
- **Item Editor** — создание/редактирование предметов с бонусами и оружейными статами
- **Ability Builder** — создание способностей (6 секций: Identity, Type, Costs, Damage, Effects, Passive)
- **Status Effect Templates** — создание шаблонов статус-эффектов
- **NPC Library** — папки с шаблонами NPC, событиями
- **Races & Classes** — создание рас/классов с бонусами
- **Quest Builder** — создание квестов с этапами и наградами
- **Combat Manager** — создание боя, добавление участников, инициатива, ходы
- **Economy** — управление валютой, магазины
- **Map** — загрузка карты, маркеры, рисунки, туман войны
- **AI Chat** — AI ассистент через OpenRouter
- **Announcements** — объявления для игроков
- **Session Timer** — таймер игры

### NPC Detail Panel (Phase 7) — 6 вкладок

Когда GM выбирает NPC, открывается **6-табовая панель** (а не одна прокрутка):

**Header Bar (всегда видно):**
- 🎨 Выбор цвета токена
- ✅ "Table" / "HP" тоглы
- 💀 Kill/KO кнопка
- 🗑️ Удалить NPC

**Tab 1 — Stats & Combat:**
- HP бар + быстрые кнопки (+5, -10, Full...)
- Mana бар + кнопки + 🔮 Full
- Permanent Bonuses (раса/класс)
- 6 статов + KD (отображение + редактирование)
- ⚔️ NPC Attack: выбор цели, advantage toggle, Roll Attack (полный цикл execute-attack)
- Apply Damage to NPC (враг бьёт этого NPC)

**Tab 2 — Inventory:**
- Инвентарь, экипировка
- Дать предмет
- 💰 Валюта (P/G/S/B)
- 🏪 Merchant настройки

**Tab 3 — Status Effects:**
- Активные эффекты (toggle on/off)
- Статус-бейджи (добавить/удалить)
- Force Advantage/Disadvantage

**Tab 4 — Abilities:**
- Карточки способностей (icon, color, type badge, cost)
- Use кнопка (мана → кулдаун)
- Assign/Unassign

**Tab 5 — Turn Counter & Notes:**
- 🔄 Turn counter (+1/-1/Reset)
- 📝 GM Notes (textarea + save + preview)
- Character Notes

**Tab 6 — Characteristic Rolls:**
- Stat dropdown + roll type + Roll D20
- ☑️ "Broadcast to players" toggle

### Player Detail Panel
Для игроков — **одна прокручиваемая панель** (без вкладок):
- HP, Mana, Stats, Edit Stats
- Effects, Status, Rolls
- Damage intake
- Currency, Inventory
- Abilities
- XP/Level
- Notes

---

## 8. Фронтенд — Player панель (player-app.js)

### 4 вкладки (bottom tab bar)

**⚔️ Main:**
- HP бар, мана, статы
- Active Bonuses (от экипировки + passive abilities)
- Статус-эффекты (badge)
- Квесты (active/completed)
- Объявления
- Боевой UI (инициатива, атака, урон)

**🎒 Inventory:**
- Экипировка по слотам (main_hand, off_hand, armor, head, ring_1, ring_2, amulet, boots, gloves, belt)
- Инвентарь с equip/unequip/use/drop
- Валюта (Platinum/Gold/Silver/Bronze)
- Магазин (если NPC торговец)

**✨ Abilities:**
- Группировка: Active → Reaction → Passive
- Карточки с icon, color, flavor_text
- Use кнопка (с проверкой маны/HP/кулдауна)
- Passive abilities серые и некликабельные

**📖 Memory:**
- Журнал: NPC encounters, Events, Notes
- Добавление записей игроком
- Поиск

---

## 9. Боевая система подробно

### Создание боя (GM)
1. GM нажимает "New Combat" → `POST /api/combat/create`
2. Добавляет участников → `POST /api/combat/{id}/add-participants`
3. Бросает инициативу NPC → `POST /api/combat/{id}/roll-npc-initiative`
4. Запрашивает инициативу игроков → WS `combat.roll_initiative_request`
5. Игроки бросают D20 → `POST /api/combat/{id}/set-player-initiative`
6. GM нажимает Start → `POST /api/combat/{id}/start` (сортировка по initiative)

### Ход боя
- `current_participant_id` указывает чей ход
- `POST /api/combat/{id}/next-turn` → переход к следующему
- На конце хода: уменьшение `remaining_turns` эффектов, мана regen, кулдаун -1, expired модификаторы
- Пропуск хода если есть `skip_turn` эффект

### Атака
- **В бою:** `POST /api/combat/{id}/attack` → полный цикл + сохранение CombatAction
- **Вне боя (NPC panel):** `POST /api/combat/execute-attack` → полный цикл без CombatAction

---

## 10. Карта (map-canvas.js)

- Canvas рендер карты с grid
- Токены персонажей (перетаскивание)
- Маркеры (pin, danger, secret, location)
- Рисунки (freehand, rectangle, circle, triangle, line, arrow)
- Туман войны (fog of war) — GM показывает/скрывает клетки
- Vision radius для персонажей
- Zoom и pan

---

## 11. Система предметов

### Редкость
`common → uncommon → rare → epic → legendary → mythic → divine`

### Типы бонусов (ItemBonus)
| Тип | Описание |
|-----|----------|
| `stat_bonus` | +N к конкретному стату (strength, dexterity...) |
| `attack_bonus` | +N к броску атаки |
| `damage_bonus` | +N к урону |
| `percent_damage_reduction` | N% снижение урона |
| `flat_damage_reduction` | -N урона после процентного |
| `hp_bonus` | +N к max HP |
| `mana_bonus` | +N к max Mana |
| `initiative_bonus` | +N к инициативе |
| `speed_bonus` | +N к скорости |
| `damage_dice_count` | +N кости урона |
| `damage_dice_type` | Тип кости урона (d6, d8...) |

### Слоты экипировки
`main_hand, off_hand, armor, head, ring_1, ring_2, amulet, boots, gloves, belt`

### Оружие (ItemWeaponStats)
- `dice_count` × `dice_type` (напр. 2d6)
- `damage_type` (physical, fire, ice...)
- `weapon_range` (melee / ranged)
- `weapon_properties` JSON: ["finesse", "two-handed", "light", "heavy", "thrown"]

### Использование предметов (use_effect)
```json
{
  "effects": [
    {"type": "heal", "value": 20},
    {"type": "damage", "value": 10},
    {"type": "stat_boost", "stat": "strength", "value": 3, "duration_turns": 5},
    {"type": "mana_restore", "value": 15},
    {"type": "apply_status", "template_id": 5}
  ]
}
```

---

## 12. Расы и классы

### Бонусы (JSON)
```json
[
  {"type": "stat", "stat": "strength", "value": 2},
  {"type": "stat", "stat": "constitution", "value": 1},
  {"type": "attack", "value": 1},
  {"type": "damage", "value": 1}
]
```

При назначении расы/класса автоматически создаются `StatModifier`/`AttackModifier`/`DamageModifier` с `source="race"` или `source="class"`.

---

## 13. Квесты

- GM создаёт шаблон квеста с этапами
- GM назначает квест персонажу → `CharacterQuest`
- Этапы завершаются по одному
- При завершении квеста → автоматическая выдача наград (валюта + предметы)
- Награда может быть скрыта до завершения

---

## 14. AI интеграция

- Используется **OpenRouter API** (ключ в `config.json`)
- Модель настраивается в Settings (`ai_model`)
- GM отправляет сообщения → AI отвечает с контекстом сессии
- История чата хранится в `AIConversation`
- Системный промпт настраивается в `ai_system_prompt.txt`

---

## 15. Миграции (Alembic)

| # | Revision | Описание |
|---|----------|----------|
| 1 | `4254238cce0d` | Initial schema (sessions, characters, effects) |
| 2 | `b3db128f567e` | Stage 2: Inventory system |
| 3 | `69c627818d70` | Stage 3: Economy & trading |
| 4 | `43fb2bc7cf58` | Stage 4: Status effects, equipment templates |
| 5 | `96e747247da2` | Stage 5: Combat events |
| 6 | `4ef14b36e2f0` | Stage 6: Races, classes, character fields |
| 7 | `378784d0fdd1` | Stage 7: NPC library, event templates |
| 8 | `2c55803c7964` | Stage 8: Quest system |
| 9 | `f1ef6d6d5b1e` | Stage 9: Map markers, drawings, fog |
| 10 | `62bbf1808bed` | Stage 10: Announcements, notes, timer |
| 11 | `eb0ca4abdc8b` | Stage 11: Combat actions, weapon fields |
| 12 | `252d5cf1d886` | Stage 1 (retro): Item database rarity system |
| 13 | `a1b2c3d4e5f6` | Phase 2: Rename copper to bronze |
| 14 | `b2c3d4e5f6a7` | Phase 3: Mana system |
| 15 | `c3d4e5f6a7b8` | Phase 4: Stat modifier expires_at |
| 16 | `d4e5f6a7b8c9` | Phase 6: Abilities, memory |
| 17 | `7758c240dd27` | Phase 6 Addition: Ability builder fields |
| 18 | `0bd0a55496f6` | Phase 7: gm_notes on characters |

Команды:
```bash
python -m alembic upgrade head      # Применить все миграции
python -m alembic revision --autogenerate -m "description"  # Создать миграцию
```

---

## 16. CSS архитектура

### base.css — CSS переменные (тёмная тема)
```css
--bg:         #0f1117        /* Фон */
--bg-surface: #1a1d27        /* Карточки */
--text:       #e4e4e7        /* Текст */
--accent:     #60a5fa        /* Акцент (синий) */
--accent-green/orange/red    /* Цветовые акценты */
--r-sm/md/lg                 /* Border radius */
--t-fast/normal              /* Transitions */
```

### Компоненты
- `.btn` / `.btn-primary` / `.btn-danger` / `.btn-ghost` / `.btn-xs/sm`
- `.cc-badge` / `.badge-npc` / `.badge-dead` / `.badge-player`
- `.stat-inline` / `.stats-inline`
- `.hp-bar-container` / `.hp-bar`
- `.npc-tab` / `.npc-tab.active` — вкладки NPC панели
- `.toggle-switch` — переключатели
- `.adv-badge` / `.advantage` / `.disadvantage`
- `.ability-card` / `.ability-card.passive`
- `.rarity-*` — цвета редкости предметов

---

## 17. Быстрый старт для разработки

### Запуск
```bash
cd dnd-companion
pip install -r requirements.txt
python -m alembic upgrade head
python main.py
```

### Тесты
```bash
pytest test_stage3.py -v    # Экономика
pytest test_stage4.py -v    # Статус-эффекты
# ... и т.д. до test_stage11.py
```

### Добавление нового поля в модель
1. Добавить в `app/models.py`
2. `python -m alembic revision --autogenerate -m "description"` 
3. Добавить `server_default` если NOT NULL
4. `python -m alembic upgrade head`
5. Добавить в `_serialize_char()` или соответствующий сериализатор
6. Добавить в Pydantic схему (`app/schemas.py`) если нужно в PUT/PATCH

### Добавление нового API роутера
1. Создать `app/routers/my_router.py`
2. `router = APIRouter(prefix="/api", tags=["my_tag"])`
3. Импортировать и `app.include_router()` в `main.py`

---

## 18. Ключевые паттерны кода

### Фронтенд: API обёртка
```javascript
const api = {
  get: (url) => fetch(url).then(r => r.json()),
  post: (url, body) => fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}).then(r => r.json()),
  put: (url, body) => ...,
  patch: (url, body) => ...,
  del: (url) => ...,
};
```

### Фронтенд: DOM helpers
```javascript
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
```

### Фронтенд: WS паттерн
```javascript
// Отправка
ws.ws.send(JSON.stringify({ type: 'event_name', ...data }));

// Приём (в websocket-client.js)
ws.on('event_name', (data) => { ... });
```

### Бэкенд: async SQLAlchemy
```python
async def my_endpoint(db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Model).where(...))
    obj = result.scalar_one_or_none()
    # или
    obj = await db.get(Model, id)
    await db.commit()
    await db.refresh(obj)
```

---

*Этот документ полностью описывает текущее состояние проекта Combat Companion на момент завершения Phase 7.*
