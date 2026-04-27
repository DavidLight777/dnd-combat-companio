# Лог запросов и изменений — Map Builder v2

> **Дата:** 2026-04-26
> **Контекст:** После завершения основной работы по Map Builder v2 (thin MapData, library save/load, traps, portals) пользователь протестировал UI и выявил ряд проблем с удобством использования.

---

## Запрос 1: «их настройки выглядят по разному»

### Проблема
Пользователь показал скриншоты двух разных модальных окон для работы с сундуками:

1. **Builder-окно** (`openBuilderChestModal`) — простое, без полей Icon/Description, добавление предметов через сырые `<select>` + `<input>` в одну строку
2. **Map (Legacy)-окно** (`#chest-modal`) — красивое: Name + Icon, Description textarea, "Items Inside" секция, кнопки Reveal/Hide/Give to Player

Пользователь сказал: *"мне больше нравится как он выглядит тут [Image 3] но проблема что туда не добавляются предметы, и нельзя положить валюту"*.

**Корень проблемы:**
- Legacy-модалка (`#chest-modal`) имела кнопку **"+ Add Item"** (`#btn-chest-add-item`), но на неё **не был повешен обработчик событий** — кнопка просто не работала
- Legacy-модалка вообще не поддерживала валюту (gold/silver/bronze) — эта функция была только в Builder
- Builder-модалка не имела полей Icon и Description, хотя backend их поддерживал

### Решение
Создана **единая универсальная модалка** `openUnifiedChestModal(chest, options)`:

- Параметр `type: 'legacy' | 'builder'` определяет режим работы
- **Всегда показывает:** Name + Icon (две колонки), Description textarea, Items Inside
- **Для Builder:** дополнительно показывает Hidden/Locked чекбоксы и Lock DC
- **Для Legacy (Edit):** дополнительно показывает Reveal/Hide/Give to Player кнопки
- **Добавление предметов:** `<select>` с загруженными из `/api/items` + количество + кнопка "+"
- **Добавление валюты:** `<select>` (Gold/Silver/Bronze) + количество + кнопка "+ Currency"
- **Удаление предметов:** кнопка 🗑 рядом с каждым предметом в списке

### Файлы
- `static/js/gm-app.js` — добавлена `openUnifiedChestModal`, `openBuilderChestModal` стал обёрткой, `openChestModal` (legacy) тоже обёртка
- `static/gm.html` — удалён статичный HTML `#chest-modal` (больше не нужен, т.к. модалка генерируется динамически)

---

## Запрос 2: «когда я нажимаю +new map в floors у меня сразу происходит это [Image 4]»

### Проблема
При нажатии кнопки **"+ New Map"** в селекте этажей появлялись дубли:
```
Floor 1
Floor 1
Floor 3
Floor 3
```

**Корень проблемы:**
В `createBuilderMap()`:
```javascript
async function createBuilderMap() {
    const m = await api.post(`/api/map-builder/${SESSION_CODE}/maps`, { name });
    builderMaps.push(m); currentMapId = m.id;
    renderBuilderMapSelect();
    await createBuilderFloor(false); // создаёт этаж
}
```

Но `createBuilderFloor` использовал **глобальный массив `builderFloors`**, который **не очищался** при смене карты. Старые этажи предыдущей карты оставались в массиве + добавлялся новый этаж.

### Решение
В `createBuilderMap()` добавлена очистка состояния:
```javascript
async function createBuilderMap() {
    // ... создаём карту ...
    builderFloors = [];        // ← очистить старые этажи
    currentFloorId = null;     // ← сбросить текущий этаж
    await createBuilderFloor(false);  // теперь создаст Floor 1
}
```

Теперь при создании новой карты:
- Список этажей очищается
- Создаётся только **один** этаж: `Floor 1`

---

## Запрос 3: «обновляй тесты чтобы тестировать все то что ты делаешь»

### Проблема
Тесты `test_map_builder_v2.py` покрывали только новую Builder-систему (MapChest, MapPortal, MapTrap). Но не проверяли:
- Legacy-систему сундуков (`/api/chests/...`)
- Создание новой карты без дублирования этажей

### Решение
Добавлены две новые группы тестов:

#### A. Legacy chest system
- Создание legacy chest через `/api/map/{code}/chests`
- Добавление предмета через `/api/chests/{id}/items`
- Получение списка предметов
- Обновление имени через PUT
- Reveal / Hide через PATCH

#### B. New map floor isolation
- Создание второй карты
- Создание этажа на второй карте
- Проверка что вторая карта имеет **ровно 1 этаж** (Floor 1)
- Проверка что первая карта **сохранила свои этажи**
- Cleanup

**Итого:** с 60 тестов → **75 тестов**, все проходят.

---

## Техническая проблема: Python `__pycache__`

На протяжении всей работы пользователь сталкивался с тем, что backend **не видел изменений** после правок. Сервер возвращал старые данные или старые API.

**Корень:** Python кэширует скомпилированный байткод в `app/__pycache__/` и `app/routers/__pycache__/`. После изменения `.py` файлов сервер продолжал использовать старый кэш.

**Решение:**
- Создан файл `stop-server.bat` (kill всех python процессов)
- В `AGENTS.md` добавлено правило: *"Kill python, clear `app/__pycache__` & `app/routers/__pycache__`, restart"*
- Все перезапуски сервера теперь сопровождаются удалением кэша

---

## Итоговый список изменений

### Backend
- `app/routers/chests.py` — без изменений (legacy API работал, просто frontend не использовал его полноценно)
- `app/routers/map_builder.py` — без изменений (MapChest API уже поддерживал items_json с валютой)

### Frontend
- `static/js/gm-app.js`:
  - ✅ `openUnifiedChestModal()` — новая единая модалка (300+ строк)
  - ✅ `openBuilderChestModal()` — теперь обёртка над unified
  - ✅ `openChestModal()` — теперь обёртка над unified
  - ✅ Удалены: `renderChestItemList`, `saveChest`, `deleteChest`, `revealChest`, `hideChest`, `giveChestToPlayer`, `handleMapClickForChest`, `openChestModalList`, `closeChestModal`
  - ✅ Обновлены обработчики кнопок: `btn-place-chest` и `btn-list-chests` теперь вызывают unified модалку
  - ✅ `createBuilderMap()` — очищает `builderFloors = []` и `currentFloorId = null`
- `static/gm.html`:
  - ✅ Удалён статичный HTML блок `#chest-modal` (весь legacy modal)

### Тесты
- `tests/test_map_builder_v2.py`:
  - ✅ +15 новых тестов
  - ✅ Legacy chest CRUD + items + reveal/hide
  - ✅ New map floor isolation (проверка отсутствия дублей)
  - ✅ Итого: 60 → **75 тестов**

### Инфраструктура
- `stop-server.bat` — kill всех python процессов
- `AGENTS.md` — обновлён раздел Debugging

---

## Как пользоваться

### Добавить сундук в Builder
1. Builder tab → выбрать brush `chest` → кликнуть на canvas
2. Откроется модалка «📦 New Chest»
3. Ввести Name, выбрать Icon, написать Description
4. Поставить галочки Hidden / Locked, задать Lock DC
5. Добавить предметы: выбрать из списка + количество → "+"
6. Добавить валюту: выбрать Gold/Silver/Bronze + количество → "+ Currency"
7. Нажать «Create Chest»

### Редактировать сундук в Builder
1. Кликнуть на существующий сундук на canvas
2. Откроется модалка «✏️ Edit Chest»
3. Можно удалить предметы (🗑), добавить новые
4. Нажать «Save» или «Delete»

### Добавить Legacy-сундук в Map
1. Map tab → нажать кнопку **📦 Chest**
2. Откроется та же модалка «📦 New Chest»
3. Заполнить поля (но без Locked/Lock DC — это только для Builder)
4. Нажать «Create Chest»
5. Сундук появится на карте в центре (map_x: 0.5, map_y: 0.5)

### Редактировать Legacy-сундук
1. Нажать кнопку **📦 List**
2. Выбрать сундук из списка (пока открывается первый)
3. Можно добавить/удалить предметы, нажать Reveal/Hide/Give to Player
4. Нажать «Save» или «Delete»

### Создать новую карту
1. Builder tab → "+ New Map"
2. Ввести имя
3. Автоматически создастся **один** этаж "Floor 1" (без дублей!)

---

> **Примечание:** Для применения любых изменений backend:
> 1. Запустить `stop-server.bat` (или убить python вручную)
> 2. Удалить `app/__pycache__` и `app/routers/__pycache__`
> 3. Запустить `python main.py`
> 4. В браузере: **Ctrl+F5** (hard refresh)
