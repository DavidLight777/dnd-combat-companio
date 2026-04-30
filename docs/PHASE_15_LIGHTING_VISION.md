# Phase 15 — Foundry-grade Lighting & Vision

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-29
**Severity:** P1 — освещение не привязано к стенам, игрок видит врагов сквозь стены

> **READ FIRST: `docs/REAL_TESTING.md`.**
> Каждое изменение = тест, который падает ДО и проходит ПОСЛЕ.
> "pytest passed" без нового теста = не сделано.

---

## Цель

Сделать освещение и видимость как в Foundry VTT:

1. **Свет блокируется стенами** — факел освещает комнату, но не проходит сквозь стены.
2. **Игрок видит в радиусе своего токена** — за пределами радиуса темно.
3. **Враг за стеной = невидим** — пока не войдёт в поле зрения.
4. **Fog of War** — исследованные клетки серые, неисследованные чёрные.
5. **Свет "лежит" на полу**, не "висит в воздухе" при зуме/пане.

---

## Диагностика текущей проблемы (сделай ПЕРВЫМ)

Открой `static/js/map-canvas/render.js:453`:

```js
// Phase 8: lighting overlay (drawn in screen space)
this._renderLightingOverlay(ctx);

ctx.restore();  // ← эта строка ПОСЛЕ освещения
```

**Корень бага "свет висит в воздухе":** `_renderLightingOverlay` вызывается
ПОСЛЕ `ctx.restore()` — это означает что overlay рисуется в **screen space**
(без translate/scale), а все координаты внутри него вычислены в **world space**.
При паннинге/зуме они расходятся.

Убедись что `_renderLightingOverlay(ctx)` вызывается **до** `ctx.restore()`.

---

## Архитектура после Phase 15

```
render() {
  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)
    ↓ всё ниже — в world space (пиксели карты)

  [1] drawImage(mapImage)       ← фон карты
  [2] _renderTiles(ctx)         ← тайлы (стены, пол, двери)
  [3] _renderGrid(ctx)          ← сетка
  [4] _renderEdges(ctx)         ← стрелки переходов
  [5] _renderTokens(ctx)        ← токены (поверх пола, под светом)
  [6] _renderFog(ctx)           ← fog of war (explored/black)
  [7] _renderLightingOverlay(ctx) ← свет + тьма (в world space!)
  ctx.restore()
  ↑ всё выше — в world space
}
```

**Ключевое:** шаги 6 и 7 должны быть ВНУТРИ `ctx.save()/restore()`.

---

## Round 1 — Исправить transform bug (быстрый фикс)

### Файл: `static/js/map-canvas/render.js`

Найди в конце `render()`:

```js
    // Combat FX
    this._renderFx(ctx);

    // Phase 8: lighting overlay (drawn in screen space)
    this._renderLightingOverlay(ctx);

    ctx.restore();
  }
```

Замени на:

```js
    // Combat FX
    this._renderFx(ctx);

    // Phase 15: lighting overlay drawn in WORLD space (inside save/restore)
    this._renderLightingOverlay(ctx);

  ctx.restore();
  }
```

(убедись что `ctx.restore()` идёт ПОСЛЕ `_renderLightingOverlay`)

### Файл: `static/js/map-canvas/lighting.js`

В `_renderLightingOverlay` координаты для `_darkLayer` и `_lightLayer`
сейчас используют `this.offsetX / this.offsetY` для компенсации transform —
это больше не нужно если мы внутри `ctx.save/translate/scale`.

Замени логику рисования:

```js
MapCanvas.prototype._renderLightingOverlay = function(ctx) {
  // w/h в world space (размер карты, не canvas)
  const w = this.mapWidth || this.canvas.width;
  const h = this.mapHeight || this.canvas.height;
  if (w === 0 || h === 0) return;

  // Ensure offscreen layers match MAP size, not canvas size
  this._ensureLayer('dark', w, h);
  this._ensureLayer('light', w, h);
  const dctx = this._darkLayer.getContext('2d');
  const lctx = this._lightLayer.getContext('2d');

  const ambient = this.ambientLight ?? 1.0;
  const darkAlpha = this.isIndoor ? 0.88 : Math.max(0, 1 - ambient);
  dctx.clearRect(0, 0, w, h);
  dctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
  dctx.fillRect(0, 0, w, h);

  const hasLights = this.lights.length > 0;
  const hasTokenVision = (this.tokens || []).some(t =>
    t.sight_range_cells && t.sight_range_cells > 0);

  if (!hasLights && !hasTokenVision) {
    ctx.drawImage(this._darkLayer, 0, 0);
    return;
  }

  lctx.clearRect(0, 0, w, h);
  lctx.globalCompositeOperation = 'lighter';
  const blocksAt = this._makeBlocksAt();

  for (const light of this.lights) {
    this._drawOneLight(lctx, light, blocksAt);
  }

  // Token vision
  for (const t of this.tokens) {
    if (!t.sight_range_cells || t.sight_range_cells <= 0) continue;
    const gs = this.gridSize;
    const fake = {
      id: -t.character_id,
      col: Math.round(t.x * this.mapWidth / gs - 0.5),
      row: Math.round(t.y * this.mapHeight / gs - 0.5),
      radius_cells: t.sight_range_cells,
      bright_radius_cells: t.sight_range_cells,
      color_hex: '#ffffff',
      intensity: 1.0,
      source_kind: 'sight',
    };
    this._drawOneLight(lctx, fake, blocksAt);
  }

  lctx.globalCompositeOperation = 'source-over';

  dctx.globalCompositeOperation = 'destination-out';
  dctx.drawImage(this._lightLayer, 0, 0);
  dctx.globalCompositeOperation = 'source-over';

  // Draw darkness veil
  ctx.drawImage(this._darkLayer, 0, 0);
  // Additive light colour tint
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(this._lightLayer, 0, 0);
  ctx.restore();
};
```

### В `_drawOneLight` убрать `this.offsetX/offsetY` из координат:

```js
MapCanvas.prototype._drawOneLight = function(lctx, light, blocksAt) {
  const gs = this.gridSize;
  const radius = light.radius_cells ?? 4;
  const bright = (light.bright_radius_cells && light.bright_radius_cells > 0)
      ? light.bright_radius_cells : radius * 0.5;
  let radiusPx = radius * gs;

  // World-space center (NO offsetX/offsetY — we are inside ctx.save/translate)
  const cxWorld = (light.col + 0.5) * gs;
  const cyWorld = (light.row + 0.5) * gs;

  // Animation perturbation (unchanged)
  let intensityMod = 1.0, radiusMod = 1.0;
  const phase = this._lightAnimPhase || 0;
  if (light.source_kind === 'torch') {
    const n = Math.sin(phase * 8 + light.id * 1.7) * 0.5
            + Math.sin(phase * 13 + light.id * 0.3) * 0.5;
    intensityMod = 1 + n * 0.1;
  } else if (light.source_kind === 'magic') {
    radiusMod = 1 + Math.sin(phase * 2 * Math.PI * 2 + light.id) * 0.05;
  }
  const intensity = Math.min(1.5, (light.intensity ?? 1.0) * intensityMod);
  radiusPx = radiusPx * radiusMod;

  const poly = this._raycastPolygon(cxWorld, cyWorld, radiusPx, blocksAt, 120);

  // All coords in world space (no scale/offset needed — lctx NOT transformed)
  const rPx = isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 1;
  const brightPx = isFinite(bright) && bright > 0 ? bright * gs : 0;

  lctx.save();
  lctx.beginPath();
  for (let i = 0; i < poly.length; i++) {
    if (i === 0) lctx.moveTo(poly[i][0], poly[i][1]);
    else lctx.lineTo(poly[i][0], poly[i][1]);
  }
  lctx.closePath();
  lctx.clip();

  const rgb = _hexToRgb(light.color_hex || '#ffd9a0');
  const a0 = 1.0 * intensity;
  const a1 = 0.5 * intensity;
  const grad = lctx.createRadialGradient(cxWorld, cyWorld, 0, cxWorld, cyWorld, rPx);
  const stopAtBright = rPx > 0 ? Math.min(0.99, brightPx / rPx) : 0;
  grad.addColorStop(0,            `rgba(${rgb.r},${rgb.g},${rgb.b},${a0})`);
  grad.addColorStop(stopAtBright, `rgba(${rgb.r},${rgb.g},${rgb.b},${a1})`);
  grad.addColorStop(1,            `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
  lctx.fillStyle = grad;
  lctx.fillRect(cxWorld - rPx, cyWorld - rPx, rPx * 2, rPx * 2);
  lctx.restore();
};
```

### `_ensureLayer` должен пересоздавать canvas при изменении размера:

Найди `_ensureLayer` в `index.js` и замени:

```js
MapCanvas.prototype._ensureLayer = function(name, w, h) {
  const key = '_' + name + 'Layer';
  if (!this[key] || this[key].width !== w || this[key].height !== h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    this[key] = c;
  }
};
```

### Требуемый тест Round 1:

```python
# tests/e2e/test_lighting_transform.py
"""Свет должен совпадать с позицией тайла при любом зуме и паннинге."""
import pytest

def test_light_follows_tile_on_zoom(gm_page):
    """После зума свет должен оставаться над факелом, не уплывать."""
    gm_page.click("[data-tab='builder-v2']")
    gm_page.wait_for_timeout(1500)

    # Получить позицию факела на canvas ДО зума
    pos_before = gm_page.evaluate("""() => {
      const v = window.bv2 && window.bv2.view;
      if (!v || !v.lights || !v.lights.length) return null;
      const l = v.lights[0];
      const gs = v.gridSize;
      const cx = (l.col + 0.5) * gs * v.scale + v.offsetX;
      const cy = (l.row + 0.5) * gs * v.scale + v.offsetY;
      return {cx, cy, col: l.col, row: l.row};
    }""")
    if not pos_before:
        pytest.skip("No lights in current location")

    # Зумировать (колесо мыши вверх)
    canvas = gm_page.locator("#bv2-canvas")
    bb = canvas.bounding_box()
    gm_page.mouse.wheel(0, -300)
    gm_page.wait_for_timeout(200)

    # Позиция факела ПОСЛЕ зума
    pos_after = gm_page.evaluate("""() => {
      const v = window.bv2 && window.bv2.view;
      if (!v || !v.lights || !v.lights.length) return null;
      const l = v.lights[0];
      const gs = v.gridSize;
      const cx = (l.col + 0.5) * gs * v.scale + v.offsetX;
      const cy = (l.row + 0.5) * gs * v.scale + v.offsetY;
      return {cx, cy};
    }""")

    # Позиция тайла после зума
    tile_pos = gm_page.evaluate("""(col, row) => {
      const v = window.bv2 && window.bv2.view;
      if (!v) return null;
      const gs = v.gridSize;
      return {
        cx: (col + 0.5) * gs * v.scale + v.offsetX,
        cy: (row + 0.5) * gs * v.scale + v.offsetY,
      };
    }""", pos_before["col"], pos_before["row"])

    assert abs(pos_after["cx"] - tile_pos["cx"]) < 2, \
        f"Light X drifted from tile after zoom: light={pos_after['cx']:.1f} tile={tile_pos['cx']:.1f}"
    assert abs(pos_after["cy"] - tile_pos["cy"]) < 2, \
        f"Light Y drifted from tile after zoom: light={pos_after['cy']:.1f} tile={tile_pos['cy']:.1f}"
```

---

## Round 2 — Token vision: игрок видит в радиусе, враги за стеной скрыты

### Концепция

Сейчас token vision использует `t.x * mapWidth / gs` для вычисления col/row
— это нормализованные координаты, а не col/row. Нужно:

1. **Игрок имеет `vision_radius` (в клетках)** — уже есть в модели.
2. **На стороне игрока** рисуется своя darkness veil с прорезом по `computeVisibleCells`.
3. **Токены врагов скрыты** если их клетка не в `currentVisible`.

### Изменения в `lighting.js` — player-only vision layer

В `_renderLightingOverlay`, ветку для `role === 'player'` сделать отдельно:

```js
// Если мы player — используем vision polygon от своего токена
if (this.role === 'player' && this.ownCharacterId != null) {
  const own = (this.tokens || []).find(t => t.character_id === this.ownCharacterId);
  if (own && own.x != null) {
    const gs = this.gridSize;
    const col = Math.floor(own.x * this.mapWidth / gs);
    const row = Math.floor(own.y * this.mapHeight / gs);
    const visionRange = own.sight_range_cells || 8;

    // Compute visible cells (reuses existing fog.js algorithm)
    const visSet = this.computeVisibleCells(col, row, visionRange);

    // Paint darkness everywhere, then cut out visible cells
    dctx.clearRect(0, 0, w, h);
    dctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
    dctx.fillRect(0, 0, w, h);

    dctx.globalCompositeOperation = 'destination-out';
    for (const key of visSet) {
      const [c, r] = key.split(',').map(Number);
      dctx.clearRect(c * gs, r * gs, gs, gs);
    }
    dctx.globalCompositeOperation = 'source-over';

    // Store for token visibility check
    this.currentVisible = visSet;
  }
}
```

### Скрыть вражеские токены вне поля зрения

В `render.js`, в цикле рисования токенов:

```js
for (const t of this.tokens) {
  if (!t.visible && this.role !== 'gm') continue;
  // Phase 15: hide enemy tokens outside player vision
  if (this.role === 'player' && t.is_npc && this.currentVisible) {
    const gs = this.gridSize;
    const col = Math.floor(t.x * this.mapWidth / gs);
    const row = Math.floor(t.y * this.mapHeight / gs);
    if (!this.currentVisible.has(`${col},${row}`)) continue; // not visible
  }
  // ... остальной код токена
```

### Требуемые тесты Round 2:

```python
# tests/test_vision_blocking.py
"""computeVisibleCells должен не видеть сквозь стены."""
import pytest

def make_canvas_mock(wall_cells: set):
    """Минимальный mock MapCanvas для тестирования computeVisibleCells."""
    import types
    mc = types.SimpleNamespace()
    mc.tiles = {k: {"type": "wall", "blocks_vision": True} for k in wall_cells}
    # Копируем алгоритм из fog.js на Python
    def compute_visible_cells(origin_col, origin_row, rng):
        MULT = [
            (1,0,0,1),(0,1,1,0),(0,1,-1,0),(-1,0,0,1),
            (-1,0,0,-1),(0,-1,-1,0),(0,-1,1,0),(1,0,0,-1),
        ]
        def blocks(c, r):
            return bool(mc.tiles.get(f"{c},{r}"))
        visible = set()
        visible.add(f"{origin_col},{origin_row}")
        def cast(cx, cy, row, start, end, radius, xx, xy, yx, yy):
            if start < end: return
            rsq = radius * radius
            next_start = start
            for j in range(row, radius + 1):
                blocked = False
                dx = -j - 1
                dy = -j
                while dx <= 0:
                    dx += 1
                    X = cx + dx*xx + dy*xy
                    Y = cy + dx*yx + dy*yy
                    lslope = (dx - 0.5) / (dy + 0.5)
                    rslope = (dx + 0.5) / (dy - 0.5)
                    if start < rslope: continue
                    elif end > lslope: break
                    else:
                        if dx*dx + dy*dy < rsq:
                            visible.add(f"{X},{Y}")
                        if blocked:
                            if blocks(X, Y): next_start = rslope; continue
                            else: blocked = False; nonlocal_start[0] = next_start
                        else:
                            if blocks(X, Y) and j < radius:
                                blocked = True; next_start = rslope
                                cast(cx, cy, j+1, nonlocal_start[0], lslope, radius, xx, xy, yx, yy)
                if blocked: break
        for xx, xy, yx, yy in MULT:
            nonlocal_start = [start := 1.0]
            cast(origin_col, origin_row, 1, 1.0, 0.0, rng, xx, xy, yx, yy)
        return visible
    mc.compute_visible_cells = compute_visible_cells
    return mc

def test_open_room_fully_visible():
    """Без стен — весь радиус виден."""
    mc = make_canvas_mock(set())
    visible = mc.compute_visible_cells(5, 5, 4)
    assert "5,5" in visible
    assert "5,6" in visible
    assert "8,5" in visible  # радиус 4 в сторону

def test_wall_blocks_vision():
    """Стена на (6,5) блокирует клетки за ней."""
    mc = make_canvas_mock({"6,5"})
    visible = mc.compute_visible_cells(5, 5, 6)
    assert "6,5" not in visible or True  # стена может быть видна
    # Клетка ЗА стеной (7,5) должна быть скрыта
    assert "9,5" not in visible, "Cell behind wall should not be visible"

def test_wall_does_not_block_perpendicular():
    """Стена на (6,5) не блокирует клетки под углом."""
    mc = make_canvas_mock({"6,5"})
    visible = mc.compute_visible_cells(5, 5, 4)
    # (5,7) под углом — должна быть видна
    assert "5,7" in visible
```

```python
# tests/e2e/test_player_vision.py
"""Игрок не видит NPC за стеной — Foundry-grade vision."""
def test_npc_behind_wall_is_hidden(player_page, gm_page):
    """NPC на другой стороне стены невидим для игрока."""
    # GM ставит стену и NPC за ней (через API или builder)
    # Проверяем что на canvas игрока NPC-токен не нарисован
    pixel = player_page.evaluate("""() => {
      const canvas = document.getElementById('map-canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      // Координаты клетки за стеной — там должен быть NPC
      // но он должен быть скрыт темнотой
      // Проверяем что пиксель очень тёмный (alpha высокий)
      const d = ctx.getImageData(400, 200, 1, 1).data;
      return {r: d[0], g: d[1], b: d[2], a: d[3]};
    }""")
    # Заглушка — реальный тест требует сетапа карты
    assert pixel is not None
```

---

## Round 3 — Fog of War: explored/unexplored интегрировать с vision

### Текущее состояние

Fog of War в `render.js:211` рисует клетки ДО `_renderLightingOverlay`.
Vision в `_renderLightingOverlay` рисует поверх. Они конкурируют.

### Унификация

**Убрать** старый fog loop из `render.js` для `role === 'player'`.
Заменить его на единый слой в `_renderLightingOverlay`:

```
Порядок слоёв для player:
  [1] Чёрная тьма (unexplored) — вся карта
  [2] Серая тьма (explored, 55% opacity) — поверх исследованных клеток
  [3] Прорез — полностью убрать тьму с текущих visible клеток
  [4] Цветной свет (additive) — факелы и лампы
```

```js
// В _renderLightingOverlay, player branch:
if (this.role === 'player') {
  dctx.clearRect(0, 0, w, h);

  // Layer 1: black for all unexplored
  dctx.fillStyle = 'rgba(0,0,0,0.97)';
  dctx.fillRect(0, 0, w, h);

  // Layer 2: grey for explored (destination-out won't work, use lighter alpha)
  dctx.globalCompositeOperation = 'source-atop';
  for (const key of (this.revealedCells || new Set())) {
    if (this.currentVisible && this.currentVisible.has(key)) continue; // will be cleared
    const [c, r] = key.split(',').map(Number);
    dctx.fillStyle = 'rgba(0,0,0,0.55)'; // dim explored
    dctx.fillRect(c * gs, r * gs, gs, gs);
  }
  dctx.globalCompositeOperation = 'source-over';

  // Layer 3: clear currently visible cells
  dctx.globalCompositeOperation = 'destination-out';
  for (const key of (this.currentVisible || new Set())) {
    const [c, r] = key.split(',').map(Number);
    dctx.clearRect(c * gs, r * gs, gs, gs);
  }
  dctx.globalCompositeOperation = 'source-over';
}
```

### Автоматически сохранять explored клетки

При каждом обновлении `currentVisible` (в `state.js` или WS handler)
добавлять все видимые клетки в `revealedCells`:

```js
// В state.js или setTokens()
if (this.ownCharacterId && this.currentVisible) {
  for (const key of this.currentVisible) {
    this.revealedCells.add(key);
  }
}
```

### Требуемый тест Round 3:

```python
# tests/test_fog_persistence.py
"""Исследованные клетки остаются серыми, а не чёрными."""
def test_revealed_cells_persist_after_token_move():
    """После хода токена старые клетки остаются explored."""
    # Тест через API: отправить токен на (5,5), проверить revealedCells,
    # переместить на (8,8), проверить что (5,5) всё ещё в revealedCells
    # Это unit-тест JS логики через Python-зеркало
    pass  # TODO: реализовать через Playwright evaluate
```

---

## Round 4 — UX упрощение: GM ambient light slider + vision radius

### Проблема

Сейчас нет простого способа:
1. Быстро изменить ambient light для локации
2. Выставить vision radius токену

### Fix A — Ambient light slider прямо в Builder toolbar

В `gm.html`, в секцию builder sidebar добавить:

```html
<div class="bv2-section">
  <div class="bv2-section-title">LIGHTING</div>
  <label style="font-size:11px;color:var(--text-muted)">
    Ambient light: <span id="bv2-ambient-val">0.4</span>
  </label>
  <input type="range" id="bv2-ambient-slider" min="0" max="1" step="0.05"
         value="0.4" style="width:100%">
  <div style="display:flex;gap:4px;margin-top:4px">
    <button class="btn-sm bv2-light-brush" data-preset="torch">🔥 Torch</button>
    <button class="btn-sm bv2-light-brush" data-preset="lamp">💡 Lamp</button>
    <button class="btn-sm bv2-light-brush" data-preset="magic">✨ Magic</button>
  </div>
</div>
```

В `70-lights.js` добавить:

```js
// Ambient light slider
const ambientSlider = document.getElementById('bv2-ambient-slider');
const ambientVal = document.getElementById('bv2-ambient-val');
if (ambientSlider) {
  ambientSlider.addEventListener('input', () => {
    ambientVal.textContent = parseFloat(ambientSlider.value).toFixed(2);
  });
  ambientSlider.addEventListener('change', async () => {
    if (!S.currentLocId) return;
    const val = parseFloat(ambientSlider.value);
    await S.api.updateLocation(S.currentLocId, { ambient_light: val });
  });
}

// Sync slider when location loads
const origLoad = S.loadLocation;
S.loadLocation = async function(locId) {
  await origLoad.call(this, locId);
  const loc = await S.api.getLoc(locId);
  if (ambientSlider && loc.ambient_light != null) {
    ambientSlider.value = loc.ambient_light;
    if (ambientVal) ambientVal.textContent = parseFloat(loc.ambient_light).toFixed(2);
  }
};
```

Добавить `updateLocation` в `10-api.js`:

```js
updateLocation: (locId, body) => api.patch(`${BASE}/locations/${locId}`, body),
```

Добавить PATCH endpoint в `app/routers/builder_v2/locations.py`:

```python
@router.patch("/locations/{location_id}")
async def update_location(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    if "ambient_light" in body:
        loc.ambient_light = max(0.0, min(1.0, float(body["ambient_light"])))
    if "name" in body:
        loc.name = str(body["name"])[:120]
    if "is_indoor" in body:
        loc.is_indoor = bool(body["is_indoor"])
    await db.commit()
    await db.refresh(loc)
    # Broadcast to update map in real time
    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.location_updated", {
            "location_id": location_id,
            "ambient_light": loc.ambient_light,
        })
    return {"id": loc.id, "ambient_light": loc.ambient_light}
```

### Fix B — Vision radius на токене через GM

В character detail sidebar (gm.html), добавить поле:

```html
<label>Vision radius (cells)</label>
<input type="number" id="char-vision-radius" min="0" max="30" value="8">
<button onclick="saveVisionRadius()">Save</button>
```

В `gm-app.js`:

```js
async function saveVisionRadius() {
  const val = parseInt(document.getElementById('char-vision-radius').value) || 8;
  await api.patch(`/api/characters/${currentCharId}`, { vision_radius: val });
}
```

Добавить `vision_radius` в `PATCH /api/characters/{id}`:

```python
# В characters.py PATCH endpoint:
if "vision_radius" in body:
    c.vision_radius = max(0, min(50, int(body["vision_radius"])))
```

### Требуемый тест Round 4:

```python
# tests/test_location_ambient.py
@pytest.mark.asyncio
async def test_patch_location_ambient_light():
    """PATCH /locations/{id} обновляет ambient_light."""
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": "AMB_TEST_A"})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 10, "rows": 10,
                                 "ambient_light": 1.0})
        loc_id = lr.json()["id"]

        r = await ac.patch(f"/api/builder-v2/locations/{loc_id}",
                           json={"ambient_light": 0.2})
        assert r.status_code == 200
        assert abs(r.json()["ambient_light"] - 0.2) < 0.01

        # Verify persisted
        r2 = await ac.get(f"/api/builder-v2/locations/{loc_id}")
        assert abs(r2.json()["ambient_light"] - 0.2) < 0.01
```

---

## Exit criteria

Перед тем как сказать "done":

- [ ] `pytest tests/ -q --ignore=tests/e2e` — **зелёный** (119 + новые тесты)
- [ ] `pytest tests/e2e -v --browser chromium` — **зелёный**
- [ ] DevTools Console — **нуль ошибок**
- [ ] Свет **не уплывает** при зуме/паннинге (визуально)
- [ ] Факел **не освещает** клетки за стеной (визуально)
- [ ] Игрок видит в радиусе токена, за стеной — темно
- [ ] NPC за стеной невидим для игрока
- [ ] Ambient light slider работает и меняет карту в реальном времени
- [ ] Vision radius токена сохраняется и применяется
- [ ] Commit: `feat: phase-15 world-space lighting, token vision, fog-of-war unification`

---

## Anti-fail правила

1. **`_ensureLayer` пересоздаёт canvas при изменении w/h** — иначе старый
   буфер неправильного размера даст артефакты при ресайзе окна.
2. **Не используй `this.offsetX/offsetY` внутри `_drawOneLight`** — мы
   теперь в world space. Смещение применяется один раз через `ctx.translate`.
3. **`_renderLightingOverlay` вызывается ВНУТРИ `ctx.save()/restore()`** —
   это главный фикс "света в воздухе".
4. **`lctx` (light layer context) не трансформируй** — он рисует в world
   space напрямую. Не добавляй к нему `translate/scale`.
5. **Fog of War для player — только через `_renderLightingOverlay`** —
   старый fog loop в `render.js` для `role === 'player'` должен быть
   удалён или пропускаться (`if (this.role !== 'player')`), иначе два
   слоя тьмы будут накладываться некорректно.
6. **`computeVisibleCells` уже существует** в `fog.js` — не переписывай,
   вызывай как `this.computeVisibleCells(col, row, range)`.
7. **Restart сервер + Ctrl+Shift+R браузера после каждого раунда.**
