# Phase 16 — Token Smoothness, Builder Preview, Interior Vision

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-29

> **READ FIRST: `docs/REAL_TESTING.md`.**
> Каждое изменение = тест, который падает ДО и проходит ПОСЛЕ.
> "pytest passed" без нового теста = не сделано.

---

## Цель

Три независимые задачи по улучшению карты:

1. **Фризы токенов** — токен зависает на старом месте вместо плавного движения.
2. **Live preview освещения в Builder** — слайдер ambient и параметры фонарей меняют рендер сразу.
3. **Interior zone блокирует видимость** — игрок не должен видеть interior снаружи.

---

## Round 1 — Token Animation Loop (fix фризов)

### Диагноз

`animateTokenTo` (`token-anim.js:2`) записывает анимацию в `_tokenAnims`, но после этого
вызывается единственный `render()` (`player/18-quests.js:179`, `gm/08-websocket.js:49`).
Интерполяция живёт внутри `render()` (`render.js:275-292`) — без rAF-петли токен
рисуется один раз на полпути и застывает до следующего внешнего события.

### Изменения

**`static/js/map-canvas/token-anim.js`** — расширить `animateTokenTo` + добавить loop:

```js
MapCanvas.prototype.animateTokenTo = function(charId, x, y) {
  const t = (this.tokens || []).find(tok => tok.character_id === charId);
  if (!t) return;
  this._tokenAnims.set(charId, {
    prevX: t.x ?? x,
    prevY: t.y ?? y,
    targetX: x,
    targetY: y,
    startTime: performance.now(),
  });
  this._startTokenAnimLoop();
};

MapCanvas.prototype._startTokenAnimLoop = function() {
  if (this._tokenAnimRafId) return;
  const tick = () => {
    this.render();
    if (this._tokenAnims.size > 0) {
      this._tokenAnimRafId = requestAnimationFrame(tick);
    } else {
      this._tokenAnimRafId = null;
    }
  };
  this._tokenAnimRafId = requestAnimationFrame(tick);
};
```

**`static/js/map-canvas/index.js`** — в constructor добавить:
```js
this._tokenAnimRafId = null;
```

### Тест

**`tests/e2e/test_token_animation.py`**:
- Переместить токен через API
- В браузере через `performance.now()` + серию `mc.render()` за 300 мс проверить что
  позиция токена в промежутке `[0, target]` (т.е. интерполируется, а не прыгает)

### Cache-bust

- `static/js/map-canvas/token-anim.js` → новый `?v=`
- `static/js/map-canvas/index.js` → новый `?v=`  
  (оба в `gm.html` и `player.html`)

---

## Round 2 — Builder Live Preview

### Задача

Когда GM меняет ambient light slider или добавляет/редактирует свет в Builder —
canvas обновляется мгновенно без нажатия кнопки.

### Изменения

**`static/js/builder_v2/70-lights.js`**

1. Ambient slider `input` event — добавить `render()`:

```js
// уже есть:
ambientSlider.addEventListener('input', () => {
  if (ambientVal) ambientVal.textContent = parseFloat(ambientSlider.value).toFixed(2);
  // ДОБАВИТЬ:
  if (S.view && S.view.location) {
    S.view.location.ambient_light = parseFloat(ambientSlider.value);
    S.view.render();
  }
});
```

2. После `closeModal()` в `onSaveLight` — вызвать `S.view && S.view.render()` (уже
   происходит через WS reload, но нужен немедленный локальный preview без задержки
   сетевого round-trip — локально обновить `S.view.lights` оптимистично).

**`static/js/builder_v2/20-mapview.js`** — добавить публичный метод:
```js
setAmbient(val) {
  if (this.location) this.location.ambient_light = val;
  this.render();
}
```

### Тест

**`tests/e2e/test_builder_preview.py`**:
- Открыть builder, выбрать локацию
- Установить ambient slider в 0.0 через JS (`ambientSlider.value = '0'; ambientSlider.dispatchEvent(new Event('input'))`)
- Проверить что `S.view.location.ambient_light === 0.0`

### Cache-bust

- `static/js/builder_v2/70-lights.js` → новый `?v=`
- `static/js/builder_v2/20-mapview.js` → новый `?v=`

---

## Round 3 — Interior Zone Vision Blocking

### Диагноз

Игрок видит interior снаружи потому что:
1. Interior zone — это только визуальная область + `ambient_light_override`, у неё нет wall tiles на периметре.
2. `computeVisibleCells` (shadowcasting) блокируется только tile_type="wall" (`blocks_vision: true`).
3. Значит если периметр здания не выложен wall-тайлами — shadow-cast проходит насквозь.

### Решение (два шага)

**Шаг A — Backend: при создании interior zone автоматически генерировать wall tiles на периметре**

`app/routers/builder_v2/interiors.py` — в `POST /locations/{loc_id}/interiors`:
после создания zone, если `kind == "building"` — вызвать helper `_stamp_perimeter_walls(db, loc_id, cells)`.

Helper `_stamp_perimeter_walls`:
- Из списка `cells` (переданных при создании) найти периметр (клетки у которых есть сосед не в cells)
- Для каждой периметральной клетки: upsert tile с `tile_type="wall"` (через тот же механизм что `replaceTiles`)
- НЕ перезаписывать уже существующие wall tiles

**Шаг B — Frontend: `MapView._drawLighting` применяет `ambient_light_override` для interior cells**

`static/js/builder_v2/20-mapview.js` — в `_drawLighting`:

```js
// Получить interior cells Map: "col,row" -> ambient_override
const interiorAmbient = new Map();
if (this.location && this.location.interiors) {
  for (const zone of this.location.interiors) {
    const ov = zone.ambient_light_override ?? null;
    if (ov === null) continue;
    for (const cell of (zone.cells || [])) {
      interiorAmbient.set(`${cell.col},${cell.row}`, ov);
    }
  }
}

// В цикле рендера:
for (let r = rect.rMin; r <= rect.rMax; r++) {
  for (let c = rect.cMin; c <= rect.cMax; c++) {
    // Проверить zone override
    const zoneAmb = interiorAmbient.get(`${c},${r}`);
    const effectiveIllum = zoneAmb !== undefined
      ? Math.min(1.0, illum[r][c] + zoneAmb)  // zone ambient добавляется к свету от источников
      : illum[r][c];
    // ... остальная логика с effectiveIllum вместо illum[r][c]
  }
}
```

**Шаг C — `MapView.loadLocation` должен получать `interiors` с cells**

В `30-editor.js:loadLocation` данные приходят через `S.api.getLoc(locId)` — проверить что endpoint возвращает `interiors` с `cells`. Если нет — добавить отдельный `S.api.listInteriors(locId)` в `loadLocation` и сохранять в `view.location.interiors`.

### Тест

**`tests/e2e/test_interior_vision.py`**:
- Создать локацию 10×10
- Создать interior zone с `kind="building"`, cells = (3,3),(4,3),(3,4),(4,4)
- Проверить через API что tile_type="wall" появился на периметре
- В player-view: поставить токен снаружи (0,0), убедиться что `computeVisibleCells` не включает (4,4)

**`tests/test_interior_perimeter.py`** (unit):
- Вызвать `_stamp_perimeter_walls` напрямую, проверить что правильные клетки помечены wall

### Cache-bust

- `static/js/builder_v2/20-mapview.js` → новый `?v=`

---

## Порядок выполнения

```
Round 1 (token freeze)   → Round 2 (preview) → Round 3 (interior)
```

Каждый Round = отдельный отчёт с результатами `pytest`.

---

## Файлы изменений (summary)

| Файл | Round |
|------|-------|
| `static/js/map-canvas/token-anim.js` | 1 |
| `static/js/map-canvas/index.js` | 1 |
| `static/js/builder_v2/70-lights.js` | 2 |
| `static/js/builder_v2/20-mapview.js` | 2 + 3 |
| `app/routers/builder_v2/interiors.py` | 3 |
| `static/gm.html` (cache-busts) | 1 + 2 + 3 |
| `static/player.html` (cache-busts) | 1 |
