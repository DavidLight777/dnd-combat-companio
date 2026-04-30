# Builder v2 Form Redesign — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans.

**Goal:** Redesign all builder v2 forms (trap, chest, portal, light, npc spawn, cover zone) to match the polished ability-form style with fieldset sections, toggle switches, minimal inline styles, and a floating draggable light panel with preview.

**Architecture:** Reusable JS helpers for form sections (`_section()`, `_field()`, `_toggle()`) shared across entity types. Light panel becomes a draggable floating div (not modal) with a Preview button that renders the light on the builder canvas in player-vision mode.

**Tech Stack:** Vanilla JS, CSS variables, Canvas2D.

---

## Shared Infrastructure

### Task 1: CSS — `.form-section`, `.toggle-switch`, `.slider-group`

**Files:**
- Modify: `static/css/gm.css`
- Modify: `static/css/base.css`

- [ ] **Step 1: Add `.form-section` class**
```css
.form-section {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 12px;
  margin-bottom: 12px;
  background: var(--bg-surface-2);
}
.form-section-title {
  font-size: 0.78rem;
  font-weight: 700;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
}
```

- [ ] **Step 2: Add `.toggle-switch` class (if missing)**
Already exists in gm.css lines 573-578, verify.

- [ ] **Step 3: Add `.slider-group` class**
```css
.slider-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slider-group input[type="range"] {
  flex: 1;
}
.slider-group .slider-value {
  width: 36px;
  text-align: right;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent);
}
```

- [ ] **Step 4: Add `.floating-panel` class**
```css
.floating-panel {
  position: fixed;
  z-index: 9998;
  background: var(--bg-surface);
  border: 1px solid var(--border-active);
  border-radius: var(--r-lg);
  box-shadow: 0 24px 80px rgba(0,0,0,0.6);
  width: 420px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.floating-panel-header {
  padding: 12px 16px;
  background: var(--bg-surface-2);
  border-bottom: 1px solid var(--border);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.floating-panel-header:active { cursor: grabbing; }
.floating-panel-body { padding: 14px; overflow-y: auto; flex: 1; }
.floating-panel-footer { padding: 10px 14px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }
```

---

## Light Floating Panel

### Task 2: Convert light modal to floating draggable panel

**Files:**
- Modify: `static/gm.html` (replace light modal with floating panel skeleton)
- Modify: `static/js/builder_v2/70-lights.js`
- Modify: `static/js/builder_v2/20-mapview.js` (preview support)

- [ ] **Step 5: Replace light modal HTML in gm.html**
Remove `#bv2-light-modal` overlay. Add:
```html
<div id="bv2-light-panel" class="floating-panel hidden" style="top:80px;right:20px">
  <div class="floating-panel-header" id="bv2-light-panel-header">
    <span id="bv2-light-panel-title">New Light</span>
    <button class="btn-icon" id="bv2-light-panel-close">✕</button>
  </div>
  <div class="floating-panel-body" id="bv2-light-panel-body">
    <!-- Sections injected by JS -->
  </div>
  <div class="floating-panel-footer">
    <button class="btn btn-ghost btn-sm" id="bv2-light-preview">👁 Preview</button>
    <button class="btn btn-ghost btn-sm" id="bv2-light-cancel">Cancel</button>
    <button class="btn btn-primary btn-sm" id="bv2-light-save">Save</button>
  </div>
</div>
```

- [ ] **Step 6: Draggable logic in 70-lights.js**
```js
function _makeDraggable(panel, header) {
  let isDragging = false, startX, startY, rect;
  header.addEventListener('mousedown', e => {
    isDragging = true;
    rect = panel.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    header.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - startX) + 'px';
    panel.style.top = (e.clientY - startY) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { isDragging = false; header.style.cursor = 'grab'; });
}
```

- [ ] **Step 7: Render form sections in panel body**
Replace flat `.form-grid` with fieldset-like sections:
```js
const html = `
  <div class="form-section">
    <div class="form-section-title">📍 Position</div>
    <div style="display:flex;gap:8px">
      <div class="form-group" style="flex:1"><label>Col</label><input type="number" id="li-col" min="0"></div>
      <div class="form-group" style="flex:1"><label>Row</label><input type="number" id="li-row" min="0"></div>
    </div>
  </div>
  <div class="form-section">
    <div class="form-section-title">💡 Light Settings</div>
    <div class="form-group"><label>Radius (cells)</label>
      <div class="slider-group">
        <input type="range" id="li-radius" min="0" max="20" step="0.5" value="4"
               oninput="this.nextElementSibling.textContent=this.value">
        <span class="slider-value">4</span>
      </div>
    </div>
    <!-- same for bright_radius, intensity -->
    <div class="form-group"><label>Color</label><input type="color" id="li-color" style="width:100%;height:32px"></div>
    <div class="form-group"><label>Kind</label><input type="text" id="li-kind"></div>
  </div>
`;
```

- [ ] **Step 8: Preview button logic**
On Preview click: temporarily add the light to `S.view.lights` with a negative preview ID, call `S.view.render()`, restore old lights on Cancel/Save.

---

## Entity Forms (Trap, Chest, Portal, NPC Spawn, Cover Zone)

### Task 3: Shared form helpers

**Files:**
- Modify: `static/js/builder_v2/50-entities.js`

- [ ] **Step 9: Replace `_field()`, `_sel()`, `_inp()`, `_chk()` with styled helpers**
```js
function _section(title, html) {
  return `<div class="form-section">
    <div class="form-section-title">${title}</div>
    ${html}
  </div>`;
}
function _field(label, html) {
  return `<div class="form-group"><label>${label}</label>${html}</div>`;
}
function _row(...fields) {
  return `<div style="display:flex;gap:8px">${fields.join('')}</div>`;
}
function _sel(id, opts, val) {
  return `<select id="${id}">${opts.map(o => `<option value="${o.v}" ${o.v == val ? 'selected' : ''}>${o.l}</option>`).join('')}</select>`;
}
function _inp(id, val, type='text') {
  return `<input type="${type}" id="${id}" value="${val !== undefined ? escapeHtml(String(val)) : ''}">`;
}
function _toggle(id, checked, label) {
  return `<label class="toggle-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="toggle-slider"></span> ${label}</label>`;
}
```

### Task 4: Trap form redesign

- [ ] **Step 10: Rewrite `_buildTrapForm()`**
Group into sections: "⚙️ Configuration" (type, trigger mode), "🗡️ Damage" (dice, type, undodgeable, attack bonus), "🔍 Detection" (DC detect, DC disarm), "📦 State" (charges, armed, disarmed), "☠️ DoT Effect" (conditional).
Use toggle switches for booleans.

### Task 5: Chest form redesign

- [ ] **Step 11: Rewrite `_buildChestForm()`**
Sections: "🔒 Lock" (locked toggle, lock DC conditional), "🎨 Appearance" (icon), "📦 Contents" (items list).

### Task 6: Portal form redesign

- [ ] **Step 12: Rewrite `_buildPortalForm()`**
Sections: "🎯 Destination" (target location, col, row), "⚙️ Settings" (one way toggle, label, active toggle).

### Task 7: Entity modal shell

- [ ] **Step 13: Redesign entity modal in gm.html**
Change max-width to 600px, replace `.form-grid` with `.form-section` blocks, ensure typed sections are injected INSIDE the body (not outside grid).

---

## Tests

### Task 8: Verify forms render without errors

- [ ] **Step 14: E2E test — open each entity form**
```python
def test_builder_forms_render(seeded_session, gm_page: Page):
    gm_page.click("[data-tab='builder-v2']")
    # Place tile first so canvas is active
    # Click entity tool, click canvas, verify modal opens
    # Check each entity type
```

- [ ] **Step 15: Run full E2E suite**
Expected: all pass

---

## Manual Verification

- [ ] Light panel is draggable
- [ ] Preview button shows light on canvas
- [ ] All entity forms have sections, toggle switches, no inline style clutter
- [ ] Conditional fields show/hide correctly
