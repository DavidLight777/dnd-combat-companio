# DND Companion — Rework Plan (Fix and updates)

Статус: **в работе**. Источник требований — `Fix and updates/update and fix.md`, `Update1.png`, `fix1.png`. Подход — **чистая БД**, без миграции legacy-данных; мультикласс профессий активен одновременно; GM вручную контролирует повышение уровня. Все игровые механики должны быть доступны и на стороне Игрока, и на стороне ГМ, синхронизация через WS.

---

## Глоссарий

- **Profession** (было Class) — профессия, освоенная персонажем. У одного персонажа может быть несколько, все активны одновременно, каждая имеет свой уровень 1..5.
- **Rank** — цепочка Common → Uncommon → Rare → Epic → Legendary → Mythic → Divine.
- **Bag / Equipped** — две независимые вкладки инвентаря. Только equipped дают бонусы и не занимают slot-капасити bag.
- **DoT** — Damage over Time. Поддерживается как часть StatusEffect.
- **Weapon poison** — расходуемый заряд яда на оружии; даёт DoT цели при успешном попадании.

---

## Фаза 1. Модели данных + миграция

**Backend:**

- `Character`:
  - `level` default = 0 (ранее 1).
  - Добавить `rank: str` (default `"common"`).
  - Оставить `class_id` (deprecated) для обратной совместимости (но на чистой БД — null). Основная логика — через `character_professions`.
- Новая таблица `character_professions`:
  - `character_id FK`, `class_id FK` (reuse `classes`), `level` int 1..5 default 1, `is_active` bool default true.
  - Unique(character_id, class_id).
- `Item`/`ItemWeaponStats`:
  - Добавить `hit_stat: str` (str/dex/con/int/wis/cha) — какая характеристика даёт бонус к попаданию.
  - Добавить `damage_stat: str | null` — какая добавляет к урону (null → нет).
- Новая `PoisonTemplate`:
  - `id`, `session_id`, `name`, `icon`, `damage_dice_count`, `damage_dice_type`, `damage_type` (poison/fire/bleed/acid/...), `default_charges`, `default_turns`, `description`.
- Новая `InventoryItemPoison`:
  - FK на `inventory_items.id`, FK `poison_template_id`, `charges_remaining`, `turns_per_hit`, `applied_at`.
  - Таймер заморожен пока `inventory_item.is_equipped = false`.
- Расширить `StatusEffect.effects` JSON schema, чтобы поддерживать `{type:"dot", dice_count, dice_type, damage_type}` (без новых таблиц).
- Убрать устаревшие поля если таковые есть (по ходу).

**Alembic:** одна миграция-ребилд (drop-create для новых таблиц, add columns для существующих). База пустая → риск нулевой.

**Acceptance:**

- `alembic upgrade head` применяется к пустой БД без ошибок.
- `GET /characters/{id}` возвращает `professions: [...]`, `rank`.

---

## Фаза 2. Игровая математика и двухэтапный бросок

**Файл:** `app/game_mechanics.py`, `app/routers/combat_events.py`.

- Бонус от характеристики = **сама характеристика** (strength=2 → +2). Убрать D&D-формулу `(stat-10)//2` везде.
- `compute_attack_bonus(character, weapon)`:
  - base = char[weapon.hit_stat]
  - + sum(ItemBonus.attack_bonus от equipped)
  - + sum(AttackModifier active)
  - + sum(расовые/классовые хит-модификаторы, `source in race/class`)
  - + sum(status DoT-независимых attack_bonus)
- `compute_damage_bonus(character, weapon)`:
  - base = char[weapon.damage_stat] если damage_stat не null
  - + sum(ItemBonus.damage_bonus от equipped)
  - + sum(DamageModifier active)
- `/combat-events/hit-roll` и `/damage-roll` уже существуют после прошлой сессии — **пересобрать** под новую логику и вернуть полный breakdown ("stat +2, weapon +1, race +1…").
- Для абилок в `/abilities/{id}/use` передавать `dice_count`, `dice_type`, `advantage` override.

**Acceptance:**

- Hit roll с advantage/disadvantage/normal возвращает детализацию всех бонусов, совпадает с Active Bonuses панелью.
- Игрок и GM (NPC) видят одинаковый результат.

---

## Фаза 3. Инвентарь: bag / equipped

**Backend** (`app/routers/inventory.py`):

- `GET /characters/{id}/inventory` поддерживает `?tab=bag|equipped` (default=all).
- `is_equipped=true` не учитывается в `slots_used`.
- Бонусы (`GET /characters/{id}/bonuses`) только от `is_equipped=true` и status effects. В панели игрока — только equipped.
- Equip/unequip — те же эндпоинты, но сохранить существующие слоты (main_hand, off_hand, armor, head, ring_1/2, amulet, boots, gloves, belt).

**Frontend** (`player-app.js`, `gm-app.js`):

- Переделать `renderInventory` — 2 таба: Inventory (bag), Equipped.
- Счётчик слотов (`X / capacity`) считает только bag.
- У equipped — кнопка "Unequip"; у bag — "Equip" + "Use" (если consumable) + "Apply Poison" (если weapon).
- Для GM добавить такие же табы в NPC редакторе.

**Acceptance:**

- Предмет экипирован → исчезает из Bag, появляется в Equipped, бонусы применяются.
- Capacity считает только Bag.
- Бонусы в панели Active Bonuses меняются синхронно через WS.

---

## Фаза 4. Профессии (мультикласс) и панель навыков

**Backend:**

- `POST /characters/{id}/professions {class_id}` — добавить профессию (level=1).
- `DELETE /characters/{id}/professions/{class_id}`.
- `PATCH /characters/{id}/professions/{class_id} {level}` — GM повышает/понижает, 1..5.
- `GET /characters/{id}/professions` — список с расширенной инфой о классе.
- Бонусы от профессий: сумма `CharacterClass.bonuses` (учитывая уровень как множитель, или по ступеням — уточнить в phase-implementation).
- Абилки от профессий: при добавлении профессии с уровнем N автоматически выдаются абилки класса до уровня N включительно (если есть маркировка в `Ability.tags` — "class:Ranger:level:2").
  - На первом этапе просто считаем что все abilities привязанные к классу доступны с level 1.

**Frontend:**

- Игрок:
  - Переименовать везде "Class"→"Profession".
  - Вкладка "Professions" — карточки освоенных профессий с уровнем, описанием, бонусами.
  - Отдельная вкладка "Skills" — две секции Passive / Active:
    - Passive — список с описанием, без кнопки.
    - Active — кнопки "Cast", cooldown, mana cost, hp cost.
- ГМ:
  - В карточке персонажа — добавлять/убирать профессии, менять уровень.
  - Те же вкладки Professions / Skills.

**Acceptance:**

- У персонажа может быть 2+ профессии, Active Bonuses показывает все.
- GM повысил уровень → WS → UI игрока обновился, бонусы пересчитались.

---

## Фаза 5. DoT + ядовитые оружия/стрелы

**Backend:**

- CRUD `/poison-templates` (GM).
- `POST /inventory/{inv_id}/apply-poison {poison_template_id, charges?, turns_per_hit?}`:
  - Если предмет — weapon melee → charges = `charges` или `default_charges`; turns_per_hit = `turns_per_hit` или `default_turns`.
  - Если предмет — arrows (tag "arrow") → turns_per_hit = **1** (жёстко).
  - Таймер зарядов не уменьшается пока не `is_equipped=true` И не использован в hit-roll.
- При успешном попадании (`damage-roll` с `hit=true`):
  - Если у атакера есть `InventoryItemPoison` на equipped weapon → расходуется 1 charge, цели применяется `CharacterStatusEffect` с `effects=[{type:"dot", dice_count, dice_type, damage_type}]`, `remaining_turns = turns_per_hit`.
- Tick DoT: в `combat_events.py` или `status_effects.py` при переходе хода (end of turn) — для каждой активной DoT записи прокидываем урон и применяем его.

**Frontend:**

- В инвентаре bag у weapon — кнопка "💧 Apply poison" → модалка выбора шаблона.
- Отображение charges и "турки на заряд" рядом с именем оружия.
- На цели в combat UI — icon "☠️ DoT X dN (Y ходов)".

**Acceptance:**

- Нанести яд → equip → атаковать → цель получает DoT → через N ходов очищается.
- Пока оружие в bag — charges не тратятся (проверка в логах WS).

---

## Фаза 6. Переработка применения способностей

**Frontend** (`static/js/player-app.js`, `gm-app.js`):

- `openAbilityUse(ability)`:
  1. Если `requires_hit_roll` → шаг 1 — createDiceRollWidget(d20, advantage toggle). Roll hit → показывает результат.
  2. Шаг 2 — создать диапазон бросков урона/эффекта через createDiceRollWidget с `dice_count`, `dice_type` из ability (но допускающий override).
  3. Кнопка Confirm → POST `/abilities/{id}/use` с полным пакетом (hit_result, damage_result, target_id).
- Backend `/abilities/{id}/use` принимает `hit_roll`, `damage_roll` как пред-прокинутые объекты; пересчитывает только бонусы/резисты и применяет эффекты.

**Acceptance:**

- Игрок может выбрать количество кубиков и тип во время каста.
- GM видит в логе тот же breakdown.

---

## Фаза 7. Wizard создания персонажа

**Backend:**

- Новая таблица `CharacterWizardState {character_id PK, step int, data JSON}` — ресьюмабельность.
- Endpoints:
  - `POST /wizard/start` → создаёт персонажа с пустыми полями, step=1.
  - `POST /wizard/{char_id}/step` с payload по шагу.
  - `POST /wizard/{char_id}/commit` — валидация, финализация.
- 4 шага:
  1. Stats pool (раскинь по 6 статам из выданного пула).
  2. Race — выбрать расу.
  3. Profession — выбрать стартовую профессию (level=1).
  4. Starting item roll — прокид d20 → таблица рар, игрок описывает предмет, GM аппрувит.

**Frontend:**

- В лобби — кнопка "Start Wizard", открывает страницу шагов.
- Шаг 4 требует GM approve через WS.

**Acceptance:**

- Игрок может выйти, перезайти — продолжить с того же шага.
- GM одобряет предмет → `Item` создаётся и сразу в bag.

---

## Фаза 8. Уровни/Ранги/XP

**Backend:**

- `Character.level` default 0, `rank` default "common".
- `xp_to_next(level) = 100 + 100*level` (lvl0→1 = 100; lvl11→12 = 1200).
- `POST /characters/{id}/grant-xp {amount}` — увеличивает experience, не трогает level (GM повышает вручную).
- `POST /characters/{id}/level-up` — проверяет порог, повышает level, списывает XP.
- `POST /characters/{id}/rank-up`:
  - Если level == 20 → rank = next(rank), level = 1.
  - Если level < 20 → rank = next(rank), level остаётся тот же, но clamp level ≤ 15 если > 15.
  - HP/stats/bonuses сохраняются.

**Frontend:**

- Блок уровня: "Lvl X / Rank" + прогресс-бар до следующего.
- GM-кнопки "+XP", "Level up", "Rank up".

**Acceptance:**

- Персонаж стартует с lvl 0 и 0 XP.
- На 100 XP можно повысить до lvl 1.
- На lvl 20 rank-up переводит на lvl 1 нового ранга.

---

## Sync-матрица Player ↔ GM

| Система | Player видит | GM видит / контролирует | WS события |
|---|---|---|---|
| Stats / bonuses | Active bonuses panel | + редактирование | `character.update`, `bonuses.update` |
| Inventory | bag/equipped вкладки, equip/unequip | + добавить/удалить | `inventory.update` |
| Professions | список своих | + add/remove/set-level | `character.update` |
| Skills | passive/active табы, cast | + редактирование шаблонов | `ability.used`, `ability.updated` |
| Attack 2-step | hit + damage widgets | тот же UI для NPC | `combat.hit_result`, `combat.attack_result` |
| Poison | apply poison, charges, DoT иконки на целях | + PoisonTemplate CRUD | `inventory.update`, `status.update` |
| Wizard | 4 шага своего персонажа | approve stage 4 | `wizard.update`, `wizard.committed` |
| Level/Rank/XP | свой прогресс | + grant XP, level up, rank up | `character.update` |

---

## Порядок выполнения и зависимости

```
1 (models+migration) → 2 (mechanics) → 3 (inventory) → 4 (professions)
                                         ↘ 5 (poison/DoT, нужно inventory split)
                                         ↘ 6 (abilities, нужны mechanics)
                                            ↘ 7 (wizard, нужен весь стек)
                                               ↘ 8 (level/rank, поверх professions)
```

---

## Критерии готовности (DoD) всей переработки

- Чистая БД, `alembic upgrade head` + старт сервера без ошибок.
- GM и Player в двух вкладках браузера видят синхронное состояние по всем экранам.
- Двухэтапный бросок атаки работает для игрока и NPC (GM).
- Все бонусы (stat=bonus, items только equipped, race/class/status) сходятся в Active Bonuses панели и в breakdown бросков.
- Multi-profession: ≥2 профессии дают свои абилки/бонусы одновременно; GM управляет уровнем.
- Poison applied в bag → не тикает; в equipped + attack → тикает и вешает DoT.
- Ability cast — 2 шага с настраиваемым количеством кубиков.
- Character Wizard — резьюмабельный 4-шаговый.
- XP/Level/Rank работают по новой формуле; старт lvl 0.

---

## Открытые вопросы (подтверждены пользователем)

- ✅ Clean DB wipe — подтверждено.
- ✅ Multi-profession все активны одновременно, GM контролирует leveling — подтверждено.
- ✅ Bonus formula: stat value = bonus (strength 2 → +2) — подтверждено (из update and fix.md строка 69).
