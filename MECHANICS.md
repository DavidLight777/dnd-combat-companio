# Combat Companion — Механики и логика

> Читабельный обзор всего, что реализовано.
> Версия: Phase 7 + Rework v3 + Realtime sync (apr 2026).
> Для файловой/архитектурной справки см. `CODE_GUIDE.md`.

---

## Содержание

1. [Обзор](#1-обзор)
2. [Сессии и подключение](#2-сессии-и-подключение)
3. [Создание персонажа (визард на 6 шагов)](#3-создание-персонажа)
4. [Статы, HP, Mana, KD, скорость](#4-статы-hp-mana-kd-скорость)
5. [Уровни, опыт, ранги](#5-уровни-опыт-ранги)
6. [Расы и профессии](#6-расы-и-профессии)
7. [Инвентарь и экипировка](#7-инвентарь-и-экипировка)
8. [Яды и DoT](#8-яды-и-dot)
9. [Бонусы и штрафы (агрегация)](#9-бонусы-и-штрафы)
10. [Способности (Abilities)](#10-способности-abilities)
11. [Статус-эффекты](#11-статус-эффекты)
12. [Бой — цикл](#12-бой--цикл)
13. [Формула урона (SACRED)](#13-формула-урона-sacred)
14. [Advantage / Disadvantage](#14-advantage--disadvantage)
15. [Движение на карте и дистанция](#15-движение-на-карте-и-дистанция)
16. [Карта, токены, маркеры, туман](#16-карта-токены-маркеры-туман)
17. [Экономика — валюта и торговля](#17-экономика--валюта-и-торговля)
18. [Квесты](#18-квесты)
19. [Библиотека NPC и события](#19-библиотека-npc-и-события)
20. [Журнал, заметки, объявления, таймер](#20-журнал-заметки-объявления-таймер)
21. [AI-ассистент](#21-ai-ассистент)
22. [Realtime-синхронизация](#22-realtime-синхронизация)
23. [Роли и права](#23-роли-и-права)
24. [Полная таблица редкостей](#24-полная-таблица-редкостей)

---

## 1. Обзор

**Combat Companion** — веб-приложение для ведения настолок со следующими свойствами:

- Один **Game Master (GM)** и несколько **игроков** в одной **сессии**.
- Все данные хранятся на сервере (SQLite + FastAPI), игроки подключаются по коду сессии через браузер.
- Любое действие (атака, экипировка, получение квеста, бросок) **мгновенно** отражается у всех участников по WebSocket без ручного обновления страницы.
- Поддерживается **custom damage tier formula** (не D&D 5e), браски d20, инвентарь с экипировкой по слотам, статус-эффекты, способности (активные / пассивные / реакции), боевые события с инициативой, карта с туманом войны, экономика с 4-уровневой валютой, квесты с наградами, журнал памяти персонажа и AI-ассистент для GM.

**Стек:** FastAPI + SQLAlchemy (async) + SQLite + vanilla JS + Canvas 2D.

---

## 2. Сессии и подключение

### Создание сессии
- GM жмёт «Создать» в лобби → сервер генерирует код (например `IRON-3631`) + `gm_token`.
- Токен сохраняется в `sessionStorage` браузера. GM возвращается в сессию автоматически, пока токен не стёрт.

### Вход игрока
1. Игрок вводит код сессии.
2. Сервер создаёт черновой `Character` со стат-базой 1/1/1/1/1/1 и запускает **Character Wizard**.
3. После завершения визарда игрок получает `player_token` и панель `/player?code=XXX`.

### Статусы сессии
- `waiting` — создана, ещё никто не играет.
- `active` — активная игра.
- `paused` — пауза (таймер сессии приостановлен).
- `ended` — завершена (GM нажал End).

### Аутентификация
- Все API-запросы привязаны к `gm_token` / `player_token` в cookies/sessionStorage.
- WebSocket: `/ws/{session_code}?token={token}` — сервер автоматически определяет роль (GM / Player).

---

## 3. Создание персонажа

6-шаговый визард в лобби. Прогресс хранится в `CharacterWizardState`.

| # | Шаг | Что делает игрок | Эффект в БД |
|---|-----|------------------|-------------|
| 1 | **Identity** | Имя, возраст (необяз.), пол (свободный текст, необяз.) | Данные в `wizard.data` |
| 2 | **Race** | Выбирает расу (GM заранее заполнил список) — у каждой расы свой HP-die, бонусы, спец-способности | `race_id` привязывается |
| 3 | **Starting Item** | Бросает d20 → редкость фиксирована таблицей ниже. Игрок заполняет форму предмета (оружие или расходник) и отправляет на **одобрение GM** | `wizard.data.starting_item_proposal` |
| 4 | **Stat Choice** | **Accept** (все статы = 1) или **Decline** (все статы = 0, но Step 5 бросок — с advantage) | `declined_stats = true/false`, статы записаны |
| 5 | **Feature Roll** | d20 (2d20-max если decline) → редкость → d4 в пуле стартовых фич этой редкости | `CharacterAbility` выдаётся автоматически |
| 6 | **Finalize** | Бросает HP-die расы → `max_hp = hp_dice_count × d(hp_die)`. `mana_max = 10`, `AC = 0`, `inventory_slots = 10 + 2 × CON` | `wizard.is_completed = true`, переход на `/player` |

### d20 → редкость (Step 3 и 5)

| d20 | Редкость |
|-----|----------|
| 1 | Common (флаг *broken*) |
| 2–9 | Common |
| 10–14 | Uncommon |
| 15–18 | Rare |
| 19–20 | Epic |

> Больше Epic не выпадает — legendary / mythic / divine даёт только GM вручную или level-up с выбором «upgrade feature».

### Одобрение GM
- Предложение предмета висит в очереди у GM. Он может **одобрить** (предмет создаётся в каталоге сессии и в инвентаре игрока) или **отклонить** с заметкой (игрок перезаполняет форму).

---

## 4. Статы, HP, Mana, KD, скорость

### Характеристики
6 статов: **strength, dexterity, constitution, intelligence, wisdom, charisma**.

**Значение стата ЕСТЬ его модификатор.** STR 4 → +4 ко всем броскам и урону на силу. Никакого `(stat-10)/2`. Диапазон в игре обычно 0–10.

### HP
- Стартует с 0; Step 6 визарда бросает HP-die расы → `max_hp`.
- Level-up добавляет ещё один бросок того же die.
- `current_hp ≤ 0` → `is_alive = false` (downed).
- Full Rest (GM-кнопка) восстанавливает HP + mana до максимума, сбрасывает cooldown’ы и `current_uses` способностей.

### Mana
- Стартует с 10 / 10.
- Регенерация в бою: `mana_regen_per_turn` (по умолчанию 0, расовые / способностные бонусы могут поднять).
- Способности и активные предметы могут стоить ману (`mana_cost`) или HP (`hp_cost`).

### KD (Armor Class)
- Стартовое значение 0. Повышается экипировкой (`armor_class` предмета) и расовыми / пассивными бонусами.
- В бою: `character_KD` — это порог в формуле урона (см. §13).

### Скорость и инициатива
- `base_speed_cells = 6` (по умолчанию). Каждый игрок тратит `movement_used_this_turn` за ход.
- `initiative_bonus` — флет-бонус к d20 инициативы.

### Инвентарь-слоты
- `max_inventory_slots = 10 + 2 × CON` (CON 0 → 10, CON 3 → 16).
- 0 = безлимит (для NPC).
- Сервер **enforced** — 400 ошибка при попытке добавить предмет сверх лимита.

---

## 5. Уровни, опыт, ранги

### XP-таблица

Нужно XP до следующего уровня:

| Уровень | XP требуется |
|---------|-------------:|
| 0 → 1 | 100 |
| 1 → 2 | 200 |
| 2 → 3 | 300 |
| 3 → 4 | 400 |
| … | +100 за уровень |

### Level-up
При апе игрок выбирает **ровно одно**:

1. **+1 к двум разным статам.**
2. **Улучшить одну существующую фичу** на следующую редкость — автоматический d4 в пулл фич этой редкости, старая заменяется.

Плюс **всегда**: бросок race HP-die → прибавляется к `max_hp` и `current_hp`.

### Ранги
Игровой ранг персонажа идёт по цепочке:
`common → uncommon → rare → epic → legendary → mythic → divine`.

По умолчанию ранги повышает GM вручную (или по дизайнерскому правилу level > 15 → смена ранга).

---

## 6. Расы и профессии

### Расы (`Race`)
- Хранятся в таблице `races` (глобальные + per-session). Каждая раса:
  - `hp_die` + `hp_dice_count` — используется визардом и level-up.
  - `bonuses` (JSON) — массив объектов `{type: "stat|attack|damage", stat?, value}`. При назначении создаются `StatModifier/AttackModifier/DamageModifier` с `source="race"`.
  - `special_abilities` (JSON) — список спец-абилок, которые можно выдать параллельно.
- Игрок выбирает расу на Step 2 визарда.

### Профессии (`CharacterClass` + `CharacterProfession`)
- Называются «Professions» в UI (термин «class» уехал из лобби).
- Игрок **не выбирает** профессию при создании. GM назначает постфактум через M:N-таблицу `CharacterProfession`.
- Каждая профессия может иметь уровень 1..5 (per character).
- Бонусы профессии применяются так же, как расовые, с `source="class"`.

---

## 7. Инвентарь и экипировка

### Каталог предметов (`Item`)
- Имя, описание, редкость, базовая цена в бронзе, `equippable`, `consumable`, `is_potion`, `potion_icon`.
- `category` — категория (weapon / armor / potion / tool / misc / …).
- `bonuses` (связь на `ItemBonus`).
- `weapon_stats` (связь на `ItemWeaponStats`) — опционально.

### Инвентарь (`InventoryItem`)
- Привязка `character_id × item_id`.
- `quantity` (стаки), `is_equipped`, `equipped_slot`.
- При смене владельца (transfer) предмет **автоматически снимается**.
- При `quantity ≤ 0` запись удаляется.

### Слоты экипировки

```
main_hand, off_hand, armor, head, ring_1, ring_2,
amulet, boots, gloves, belt
```

Potions и консьюмэблы **не экипируются** (сервер возвращает 400).

### Endpoint-ы ключевые
- `PATCH /api/inventory/{id}/equip` — body `{equip: bool, slot?}`.
- `PATCH /api/inventory/{id}/quantity` — body `{quantity | delta}`. При 0 запись удаляется.
- `POST /api/inventory/{id}/transfer` — body `{target_character_id, quantity}`.
- `POST /api/inventory/{id}/use` — для консьюмэблов. Применяет `use_effect` (см. ниже).

### Use-effect (для потенциалов / расходников)

JSON в `Item.use_effect`:

```json
{
  "effects": [
    {"type": "heal",          "value": 20},
    {"type": "damage",        "value": 10},
    {"type": "stat_boost",    "stat": "strength", "value": 3, "duration_turns": 5},
    {"type": "mana_restore",  "value": 15},
    {"type": "apply_status",  "template_id": 5}
  ]
}
```

### Типы бонусов (`ItemBonus`)

| `bonus_type` | Что делает |
|--------------|-----------|
| `stat_bonus` | +N к конкретному стату (нужен `stat_name`) |
| `attack_bonus` | +N к d20 атаки |
| `damage_bonus` | +N к урону |
| `percent_damage_reduction` | % снижения |
| `flat_damage_reduction` | Вычет после % |
| `hp_bonus` / `mana_bonus` | +N к максимумам |
| `initiative_bonus` / `speed_bonus` | В бою / на карте |
| `damage_dice_count` / `damage_dice_type` | Лишние кости урона |

Есть `is_conditional: true` — бонус применяется только вручную GM-ом (сюжетный).

### Оружие (`ItemWeaponStats`)
- `dice_count × dice_type` (напр. `2d6`).
- `damage_type` (physical / fire / ice / bleed / poison / acid / …).
- `weapon_range` — melee / ranged.
- `weapon_properties` (JSON): `["finesse","two-handed","light","heavy","thrown"]`.

---

## 8. Яды и DoT

### Шаблоны ядов (`PoisonTemplate`)
- Глобальные или per-session.
- Задают: `damage_dice_count × damage_dice_type`, `damage_type`, `default_charges`, `default_turns_per_hit`.

### Нанесение яда (`InventoryItemPoison`)
- Игрок жмёт **💧 Poison** на оружии → открывается модал выбора шаблона + зарядов.
- `charges_remaining` уменьшается при каждом **успешном** попадании этим оружием (пока оно экипировано).
- При ударе накладывается статус-эффект DoT с `turns_per_hit` кол-вом ходов.
- Для стрел `turns_per_hit = 1` (одиночный тик), для лезвий — обычно 3.

---

## 9. Бонусы и штрафы

### Агрегация бонусов экипировки (`get_all_active_bonuses`)
Пробегает все `is_equipped=true` предметы, суммирует все `ItemBonus`:

```python
{
  "percent_damage_reduction": 0,
  "flat_damage_reduction": 0,
  "attack_bonus": 0,
  "damage_bonus": 0,
  "damage_dice_count": 0,
  "damage_dice_type": 0,
  "hp_bonus": 0,
  "mana_bonus": 0,
  "initiative_bonus": 0,
  "speed_bonus": 0,
  "breakdown": [
    {"source": "Aegis of the Immortal",
     "bonus_type": "percent_damage_reduction",
     "stat_name": null, "value": 30},
    ...
  ],
  "stat_bonus_strength": 0, "stat_bonus_dexterity": 0, ...
}
```

Плюс к этому фронт добавляет:
- Бонусы от **passive abilities** (из `Ability.passive_effect.bonuses`).
- Позитивные эффекты из `CharacterStatusEffect.effects` (stat boosts).

Отображается в панели **Active Bonuses & Penalties** у игрока, в карточке у GM.

### Штрафы статус-эффектов
Каждый `CharacterStatusEffect.effects` — JSON-массив. Примеры:

```json
[
  {"type": "stat_penalty",             "stat": "strength", "value": -2},
  {"type": "attack_penalty",           "value": 2},
  {"type": "damage_penalty",           "value": 1},
  {"type": "damage_reduction_penalty", "value": -5},
  {"type": "forced_advantage",         "value": true},
  {"type": "forced_disadvantage",      "value": true},
  {"type": "skip_turn",                "value": true},
  {"type": "hp_change_per_turn",       "value": -3},
  {"type": "mana_change_per_turn",     "value": -2}
]
```

Агрегируются в словарь `penalties` → подаются в формулу атаки / урона / advantage-резолвинг.

---

## 10. Способности (Abilities)

### Типы
- **Active** — стоит ману / HP, используется из меню Actions, может иметь cooldown.
- **Passive** — при выдаче автоматически создаются `StatModifier/Attack/Damage` с `source="ability"`. При снятии — автоматически удаляются.
- **Reaction** — как active, но отображается в панели Reactions (для «off-turn» использования).

### Поля (`Ability`)
- Identity: `name, description, icon, color, flavor_text, tags, notes (GM-only)`.
- Type: `ability_type` (active / passive / reaction), `target_type` (self / single / aoe / none), `aoe_radius`.
- Damage: `damage_type`, `custom_damage_type`, `damage_dice_count × damage_dice_type`, `hit_stat`, `damage_stat`.
- Costs: `mana_cost`, `hp_cost`, `cooldown_turns`.
- Hit roll: `requires_hit_roll` (иначе автопопадание).
- **Rework v2 pool fields:**
  - `rarity` — common / uncommon / rare / epic / legendary / mythic / divine.
  - `is_in_starting_pool` — попадает ли в Step 5 визарда.
  - `max_uses` — null = бесконечно, N = общий счёт на всю игру.
  - `is_conditional` + `conditional_text` — флейворный пункт, механиков нет.
- Range: `range_cells` — дальность в клетках карты (Chebyshev-метрика). `None` или `0` = безлимит (ритуал), `1` = melee/touch.

### `CharacterAbility`
- Привязка `character_id × ability_id`.
- `is_unlocked` — можно ли использовать.
- `cooldown_remaining` — уменьшается на 1 в конце хода персонажа.
- `current_uses` — зеркало `max_uses` на момент выдачи; уменьшается с каждым использованием, ноль блокирует.
- `granted_from` — `gm / wizard / level_up`.

### Поток использования
1. Проверка: `is_alive`, `is_unlocked`, `cooldown_remaining == 0`, `current_uses != 0`.
2. Проверка маны (`mana_current ≥ mana_cost`) и HP (`current_hp > hp_cost`).
3. Списание маны + HP.
4. Если `requires_hit_roll` и есть target — d20 + hit-stat против target KD → формула урона.
5. Иначе просто применяется `effect` — тот же JSON-формат, что и `use_effect` предметов.
6. Ставится `cooldown_remaining = cooldown_turns`, декремент `current_uses`.

### Passive bonuses
`Ability.passive_effect` (JSON):
```json
{"bonuses": [
  {"bonus_type": "attack_bonus", "value": 1},
  {"bonus_type": "stat_bonus", "stat_name": "wisdom", "value": 2}
]}
```
При выдаче эти записи создают `AttackModifier/StatModifier` с `source="ability"` и `name = ability.name`.

---

## 11. Статус-эффекты

### Шаблоны (`StatusEffectTemplate`)
- Глобальные или per-session.
- Имя, иконка, цвет, `effects` (JSON), `default_duration` (null = перманент).

### Активные эффекты (`CharacterStatusEffect`)
- Привязка `character_id × template_id`.
- `remaining_turns` — null = перманент, 0 = истёк (удаляется).
- `applied_at`, `applied_by_id` — аудит.
- Снимаются автоматически после Full Rest или истечения срока.

### Тикание
Каждый ход в боевом событии:
- Все эффекты с `remaining_turns != null`: `remaining_turns -= 1`.
- Эффекты с `hp_change_per_turn` / `mana_change_per_turn` применяются сразу.
- При `remaining_turns ≤ 0` → удалить эффект.

### Встроенные типы эффектов
`stat_penalty, stat_boost, attack_penalty, attack_boost, damage_penalty, damage_boost, damage_reduction_penalty, forced_advantage, forced_disadvantage, skip_turn, hp_change_per_turn, mana_change_per_turn`.

---

## 12. Бой — цикл

### Модели
- `CombatEvent` — одно сражение (preparing → active → ended).
- `CombatParticipant` — участники + инициатива + `show_hp_to_players` / `show_ac_to_players`.
- `CombatAction` — лог каждого удара (attack_roll, damage_roll, result).

### Создание боя (GM)
1. GM жмёт **New Combat** → `POST /api/combat/create`.
2. Добавляет участников (PC или NPC) по одному или группой.
3. Бросает инициативу NPC: `POST /api/combat/{id}/roll-npc-initiative` (d20 + initiative_bonus).
4. Запрашивает у игроков: `POST /api/combat/{id}/request-player-initiative` → WS `combat.roll_initiative_request`.
5. Игроки жмут кнопку → `POST /api/combat/{id}/set-player-initiative`.
6. GM жмёт **Start** → сортировка по `final_initiative` desc.

### Ходы
- `current_participant_id` указывает чей сейчас ход.
- `POST /api/combat/{id}/next-turn`:
  - Уменьшает cooldown’ы активных способностей у следующего участника.
  - Тикает `remaining_turns` у всех статус-эффектов.
  - Применяет `hp_change_per_turn` / `mana_change_per_turn`.
  - Сбрасывает `movement_used_this_turn = 0` у следующего.
  - Если у следующего `skip_turn` эффект → авто-пропуск хода.
- `POST /api/combat/{id}/end` — завершает бой, статус `ended`.

### Атака
- **В активном бою:** `POST /api/combat/{id}/attack` — пишет `CombatAction`.
- **Из NPC-панели (вне боя):** `POST /api/combat/execute-attack` — не пишет action, просто крутит цикл.

Полный цикл `execute-attack`:

```
1. Загрузить attacker + target
2. Собрать бонусы экипировки обоих
3. Собрать penalties статус-эффектов обоих
4. Определить оружие (main_hand / unarmed)
5. Resolve advantage (player_choice vs forced)
6. HIT ROLL: d20 + hit_stat + weapon.attack_bonus + item_attack_bonus - status.attack_penalty
   • Nat 1 → FUMBLE (автопромах)
   • Nat 20 → CRITICAL (автопопадание, ×2 кости урона)
   • Иначе: total ≥ target_KD → попадание (для D&D-совместимости) ИЛИ применить формулу урона
7. DAMAGE ROLL: weapon_dice + damage_stat + item_damage_bonus - status.damage_penalty
8. INTAKE: apply formula tiers + effect reductions (см. §13)
9. HP target -= final_damage
10. Если HP ≤ 0 → is_alive = false, WS combat.character_downed
```

Нанесение/получение урона лог в Roll Log всех участников через WS.

---

## 13. Формула урона (SACRED)

> Не классическая D&D 5e, а свой кастом.
> Не трогать без GM-одобрения.

### Tier-таблица по `hit_diff`

```
hit_diff = attacker_total_roll − target_KD

hit_diff ≤ 0     → MISS (0% урона)
hit_diff 1–2     → 50%
hit_diff 3–4     → 60%
hit_diff 5–6     → 70%
hit_diff 7–8     → 80%
hit_diff 9–10    → 90%
hit_diff 11+     → 100%
```

### Агрегация редукций
Процентные редукции **складываются** с tier-редукцией (не умножаются):

```
tier_reduction_pct  = 100% − tier_multiplier_pct
total_percent_red   = tier_reduction_pct + Σ(item.percent_damage_reduction + effect.percent_reduction)
combined_multiplier = 1 − total_percent_red / 100
after_percent       = base_damage × combined_multiplier
flat_sum            = Σ(item.flat_damage_reduction + effect.flat_reduction) − Σ(status.damage_reduction_penalty)
final_damage        = max(0, round(after_percent − flat_sum))
```

Пример:
- Базовый удар: 20.
- Tier 70% (30% редукции).
- Предмет на игроке: +10% процентной редукции.
- Броня: −3 flat.
- Итог: `20 × (1 − 0.40) − 3 = 20 × 0.6 − 3 = 9`.

### Критические и фамблы
- **Nat 20** → автопопадание + кости урона удваиваются (`dice_count × 2`).
- **Nat 1** → автопромах, урона 0, ничто не применяется.

---

## 14. Advantage / Disadvantage

- **Normal** — 1d20.
- **Advantage** — 2d20, берётся **максимум**.
- **Disadvantage** — 2d20, берётся **минимум**.

### Игрок может крутить больше чем 2 кубика
`ADV_DICE_CAP = 5`. Если игрок кидает 5d20 на advantage, берётся самый высокий из пяти.

### Forced модификаторы (от статус-эффектов)
- `forced_advantage` + `forced_disadvantage` вместе → **отменяют** друг друга (normal).
- Forced **переопределяет** выбор игрока. Игрок не может отменить `forced_disadvantage` от яда.

### `resolve_advantage_mode`
```
input: player_choice, penalties
if forced_adv and forced_disadv: return "normal"
if forced_adv:                   return "advantage"
if forced_disadv:                return "disadvantage"
return player_choice
```

---

## 15. Движение на карте и дистанция

Тип сетки (`MapData.grid_type`) может быть в двух режимах — GM переключает кнопкой **Style: ▢ Square / ⬡ Hex** в панели карты.

| Режим | Геометрия | Метрика дистанции |
|-------|-----------|-------------------|
| `square` (по умолчанию) | Квадратные клетки, side = `grid_size` | Chebyshev (king-move): `max(|dx|, |dy|)` |
| `hex` | Pointy-top гексагоны, hex_width = `grid_size` | Аксиальная hex-дистанция: `(|dq| + |dr| + |dq+dr|) / 2` |

Всё остальное ведёт себя одинаково:
- `base_speed_cells` = бюджет движения на ход.
- `movement_used_this_turn` растёт с каждым PATCH `/api/map/token/{id}` — сервер использует метрику из `grid_type` для подсчёта.
- На начале нового хода в бою → сбрасывается в 0.
- Вне боя — движение бесплатное (бюджет не проверяется).
- Snap-to-cell: токен прижимается к центру квадрата или гексагона по текущему режиму.
- Reachable-overlay (подсветка доступных клеток на ход игрока): рисуется квадратами или гексами по режиму.
- Measure-tool (линейка): подписывает расстояние в тех же единицах.
- Туман войны **всегда** на квадратной сетке — это просто bitmap-маска, не «игровая поверхность», переиндексирование существующих сохранённых клеток было бы разрушительным.

### Дальность способности / оружия
- `Ability.range_cells` — проверяется сервером (`app/combat_range.py → grid_cells`), когда у обоих участников есть `map_x/y`. Метрика подтягивается из `MapData.grid_type`.
- `None` / `0` = безлимит (ритуал), `1` = melee/touch.
- `ItemWeaponStats.weapon_range`: `melee` / `ranged` (без цифры — на усмотрение GM).

---

## 16. Карта, токены, маркеры, туман

### MapData
- Фон-изображение (загружается в `/data/maps/`).
- Grid (клетки): размер, смещение, видимость.
- Fog of war (JSON bitmap).

### Токены персонажей
- Круглый токен цвета `token_color` с инициалом имени ИЛИ `token_image_url` (портрет).
- Перетаскивается мышью (GM и игроки).
- `is_visible_on_map` — скрывает токен от игроков (но GM видит).
- `vision_radius` — радиус видимости сквозь туман.

### Маркеры (`MapMarker`)
- Pin, danger, secret, location — у каждого свой цвет/иконка.
- Добавляет GM.

### Рисунки (`MapDrawing`)
- Freehand, rectangle, circle, triangle, line, arrow.
- Цвет, толщина линии.

### Объекты карты (`MapObject`)
- Стены (walls) блокируют визуальный line-of-sight для fog-reveal алгоритма.

### Туман войны
- Bitmap по клеткам. GM рисует кисточкой.
- Клетки, попавшие в `vision_radius` любого PC, автоматически показываются.
- Overlay’ы (walls + fog) присылаются отдельным endpoint `/api/map/{code}/overlays`.

---

## 17. Экономика — валюта и торговля

### Курс валют
Всё хранится в `Character.wealth_bronze` (единое число). Конвертация на лету:

| 1 Platinum | = 1000 bronze |
| 1 Gold | = 100 bronze |
| 1 Silver | = 10 bronze |
| 1 Bronze | = 1 bronze |

Frontend показывает разбивку `bronze_to_display(bronze)`.

### Транзакции (`CurrencyTransaction`)
- `from_character_id` null = GM grant.
- Append-only аудит. В UI не выводится живьём, считываем агрегат.

### Торговля P2P
- `POST /api/economy/transfer` → двусторонний перевод валюты.
- `POST /api/inventory/{id}/transfer` → передача стака предметов.
- Уважает слот-кап получателя. Экипировка снимается автоматически.

### Магазины NPC (`NpcShopInventory` + `TradeSession`)
- NPC-мерчант держит `NpcShopInventory` (stock, цена-override).
- GM инициирует торговлю: `POST /api/trade/initiate {player_id, npc_id}` → создаётся `TradeSession`, у игрока открывается модал.
- Игрок покупает: `POST /api/trade/{id}/buy {shop_item_id, quantity}` → списывается валюта, добавляется предмет.
- Игрок продаёт: `POST /api/trade/{id}/sell` → обратное. Сервер использует множитель цены (обычно 0.5).
- После закрытия (`POST /api/trade/{id}/close`) → `status = closed`.

### Репутация (`NpcReputation`)
- Диапазон -100..+100.
- Влияет на цены магазина (опционально).

### Buyback
- Когда игрок продал NPC предмет, GM может выкупить обратно по той же цене.

---

## 18. Квесты

### Шаблоны (`QuestTemplate`)
- `title, description, source_npc_id, stages` (JSON массив этапов `{order, title, description}`).
- `reward_gold_bronze`, `reward_item_ids` (JSON), `reward_description`, `reward_is_hidden`.
- `is_multi_stage` — можно одним этапом.

### Назначенные (`CharacterQuest`)
- При назначении — копируется снапшот (title / description / rewards) в персонажный квест.
- `status`: active / completed / failed.
- `current_stage`, `stages_completed` (JSON список индексов).
- `reward_revealed` — открылась ли награда игроку (если `reward_is_hidden=true`).

### Поток
1. GM создаёт шаблон через Quest Builder.
2. GM назначает квест: `POST /api/quests/assign {template_id, character_id}`.
3. Игрок видит карточку в панели Main (статус active).
4. Игрок / GM завершает этап: `POST /api/quests/{id}/complete-stage`.
5. При завершении последнего этапа: `POST /api/quests/{id}/complete` → **автоматическая** выдача валюты + предметов (с уважением слот-капа), `reward_revealed = true`, WS `quest.completed`.

---

## 19. Библиотека NPC и события

### Папки (`NpcFolder`)
- Иерархические (parent / children).
- Цвет для визуального группирования в дереве.

### Шаблоны NPC (`NpcTemplate`)
- Все статы (STR..CHA, HP, AC, инициатива, цвет токена).
- `default_equipment` — JSON массив item IDs, которые спавнятся вместе с NPC.
- `shop_items` — JSON `[{item_id, stock, price_override}]` для NPC-мерчантов.
- `is_merchant` — флаг.

### Спавн NPC
`POST /api/npc-library/templates/{id}/spawn` → создаётся `Character(is_npc=true)`, клонируется экипировка, если мерчант — заполняется `NpcShopInventory`.

### События (`EventTemplate`)
Группа NPC для быстрого спавна (например «encounter: bandit squad»):
```json
{"npc_template_ids": "[{\"template_id\": 12, \"count\": 3}, {\"template_id\": 7, \"count\": 1}]"}
```
`POST /api/npc-library/event-templates/{id}/execute` → спавнит всех разом.

---

## 20. Журнал, заметки, объявления, таймер

### Character Memory
- Записи в журнале персонажа: `npc_encounter`, `event`, `note`.
- `related_npc_id` — опциональная ссылка на NPC.
- Игрок пишет сам, GM может подправить.
- Поиск по контенту.

### Notes (`CharacterNote`)
- У каждого персонажа свои.
- `is_gm_note = true` — видна только GM (скрытые заметки о персонаже).
- У игрока есть своя панель Notes.

### Session Announcements
- GM пишет объявления, которые появляются у всех игроков.
- `is_pinned` — закрепляется сверху.

### Session Timer
- `play_timer_started_at` + `total_play_seconds` — счётчик реального времени игры.
- GM кнопками Play / Pause / Reset управляет. Пауза не стопит сессию — только таймер.

---

## 21. AI-ассистент

- Провайдер: **OpenRouter API** (ключ в `config.json`).
- Модель настраивается на `/settings` — любая из OpenRouter каталога.
- Контекст подаётся из `ai_system_prompt.txt` + снапшот сессии (персонажи, активные квесты, последние действия).
- GM пишет вопросы во вкладке AI Chat → ответы стримятся.
- История хранится в `AIConversation` — не теряется между сессиями браузера.

---

## 22. Realtime-синхронизация

### Архитектура
- **`app/realtime.py`** подписан на SQLAlchemy события `after_flush` / `after_commit` / `after_rollback`.
- После **каждого** коммита собирает изменённые строки, классифицирует по FK (`session_id`, `character_id`, `combat_event_id`, `inventory_item_id`), резолвит `session_code` и рассылает WS-событие `entity.invalidated` во все релевантные сессии.
- **Автодетекция**: при первом флаше обходит `Base.registry.mappers` и строит карту маршрутизации сам. Любая новая модель с этими FK-колонками автоматически попадает в рассылку.

### Payload
```json
{"changes": [
  {"entity": "InventoryItem",
   "character_id": 75,
   "combat_event_id": null,
   "inventory_item_id": null,
   "action": "updated"}
]}
```

### Клиентская сторона
- `player-app.js` и `gm-app.js` держат карту `{entity_name: refresher_function}`.
- Все события за 200 мс **дебаунсятся** → один refresh за пачку.
- Игрок игнорирует character-scoped события чужих персонажей; session-scoped (`CombatEvent`, `SessionAnnouncement`, `MapData` и т.п.) — принимает всегда.

### Blacklist
Не ретранслируем: `ai_conversations`, `combat_log`, `currency_transactions`, `character_wizard_state` — либо шумно, либо имеют свои специализированные события.

### Глобальные темплейты
Если `session_id` в записи = `NULL` (builtin Race / CharacterClass / Ability / PoisonTemplate) → рассылка во **все** активные сессии.

### Специализированные события (остались как раньше)
Параллельно работают точечные WS-события: `combat.started/ended/turn_changed`, `combat.roll_initiative_request`, `quest.assigned/completed`, `announcement.new`, `map.updated`, `map.marker_*`, `trade.initiated/closed`, `currency.updated`, `mana.updated`, `session.full_rest`. Они переживают автоматизацию и полезны, когда нужны **дополнительные данные** в payload (имя бросившего, результат броска и т.п.).

---

## 23. Роли и права

| Роль | Доступ |
|------|--------|
| **GM** | Создаёт / удаляет всё. Одобряет item-proposals визарда. Видит GM-only заметки. Управляет боем, картой, экономикой. |
| **Player** | Редактирует своего персонажа (hp/mana/статы — зависит от `can_edit_own_items`). Использует способности и предметы. Видит публичные статус-эффекты других игроков. |
| **NPC (GM-controlled)** | Не логинится. GM управляет через NPC Detail Panel. |

### `show_hp_to_players` / `show_ac_to_players`
- На уровне `CombatParticipant`. GM может скрыть HP / AC конкретных NPC от игроков в UI боя.

### `is_gm_controlled`
- Персонаж, которого GM ведёт, даже если он PC. Например партия-компаньон.

---

## 24. Полная таблица редкостей

Единая цепочка, используется для персонажей (ранг), предметов, способностей:

```
common → uncommon → rare → epic → legendary → mythic → divine
```

CSS-цвета: `.rarity-common` (серый), `.rarity-uncommon` (зелёный), `.rarity-rare` (синий), `.rarity-epic` (фиолет), `.rarity-legendary` (оранжевый), `.rarity-mythic` (красный), `.rarity-divine` (белый с glow).

Visard Step 3/5 генерируют до `epic` включительно. GM вручную даёт выше.

---

*Если что-то не описано или расходится с поведением — значит либо функция изменилась, либо не вошла в документ. Смотри `CODE_GUIDE.md` для архитектуры и `REWORK_PLAN.md` для истории изменений.*
