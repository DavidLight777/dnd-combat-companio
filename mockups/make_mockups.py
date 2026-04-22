"""
Generate self-contained HTML mockups of the GM and Player interfaces for
uploading to Claude.ai/design as a single-file artifact.

What it does:
  1. Reads ../static/gm.html and ../static/player.html.
  2. Inlines every referenced stylesheet (base.css, gm.css, player.css)
     directly into a <style> block so the file works offline.
  3. Strips real <script src="..."> tags (websocket-client.js, gm-app.js,
     player-app.js, map-canvas.js, character-sheet-core.js) and replaces
     them with a self-contained stub script that:
       * fakes fetch / WebSocket / api.* with mock responses
       * pre-populates dropdowns / lists / the map canvas with static
         data so Claude Design sees a "fully-used" UI instead of an
         empty shell.
  4. Writes mockup-gm.html and mockup-player.html next to this script.

Usage:
    python mockups/make_mockups.py
"""
import re
import pathlib
import sys

HERE    = pathlib.Path(__file__).parent.resolve()
ROOT    = HERE.parent
STATIC  = ROOT / "static"

# ---- File helpers --------------------------------------------------------
def read_text(path: pathlib.Path) -> str:
    """Read text trying a few encodings (the repo has a mix of utf-8 and
    utf-8-sig / cp1251 / cp1252 depending on the editor used)."""
    for enc in ("utf-8", "utf-8-sig", "cp1251", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    return path.read_bytes().decode("utf-8", errors="replace")


def write_text(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


# ---- Inline stylesheets / strip scripts ----------------------------------
LINK_RE   = re.compile(
    r'<link[^>]+rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)["\'][^>]*>',
    re.I,
)
SCRIPT_RE = re.compile(
    r'<script\s+src=["\']([^"\']+)["\'][^>]*>\s*</script>',
    re.I,
)


def resolve_static(href: str):
    href = href.split("?")[0]
    if href.startswith("/static/"):
        return STATIC / href[len("/static/"):]
    if href.startswith("static/"):
        return STATIC / href[len("static/"):]
    return None


def inline_css(html: str) -> str:
    def repl(m: re.Match) -> str:
        p = resolve_static(m.group(1))
        if p and p.exists():
            css = read_text(p)
            return f"<style>\n/* inlined from {p.name} */\n{css}\n</style>"
        return m.group(0)
    return LINK_RE.sub(repl, html)


def strip_real_scripts(html: str) -> str:
    def repl(m: re.Match) -> str:
        src = m.group(1).split("?")[0]
        if "/static/js/" in src or src.startswith("static/js/"):
            return f"<!-- stripped real script: {src} -->"
        return m.group(0)
    return SCRIPT_RE.sub(repl, html)


# ---- Mock runtime stub ---------------------------------------------------
MOCK_SCRIPT = r"""
<script>
/* =======================================================================
 * Claude-Design mockup runtime - no network, all data is hard-coded.
 * The real app reads dozens of endpoints; we stub the most common ones
 * and populate DOM sections that the real JS would fill via fetches.
 * ======================================================================= */
(() => {
  const MOCK = {
    character: {
      id: 1, name: 'Nimus', race: 'Human', class: 'Rogue', level: 3,
      current_hp: 18, max_hp: 24, current_mana: 4, max_mana: 10,
      ac: 15, speed: 30,
      stats: { str: 10, dex: 16, con: 12, int: 13, wis: 10, cha: 14 },
      gold: 42, silver: 17, copper: 5,
    },
    tokens: [
      { character_id: 1, name: 'Nimus',  x: 0.30, y: 0.40, color: '#c08a2a', is_npc: false, is_alive: true },
      { character_id: 2, name: 'Kael',   x: 0.35, y: 0.42, color: '#4a7fc0', is_npc: false, is_alive: true },
      { character_id: 3, name: 'Goblin', x: 0.55, y: 0.50, color: '#b84040', is_npc: true,  is_alive: true },
      { character_id: 4, name: 'Goblin', x: 0.60, y: 0.47, color: '#b84040', is_npc: true,  is_alive: true },
      { character_id: 5, name: 'Shaman', x: 0.70, y: 0.52, color: '#8a4abf', is_npc: true,  is_alive: true },
    ],
    inventory: [
      { id: 1, name: 'Shortsword',    rarity: 'uncommon',  icon: '\ud83d\udde1', quantity: 1, equipped: true  },
      { id: 2, name: 'Leather Armor', rarity: 'common',    icon: '\ud83d\udee1', quantity: 1, equipped: true  },
      { id: 3, name: 'Health Potion', rarity: 'common',    icon: '\ud83e\uddea', quantity: 3, equipped: false },
      { id: 4, name: 'Rope (50ft)',   rarity: 'common',    icon: '\ud83e\ude22', quantity: 1, equipped: false },
      { id: 5, name: 'Mystic Amulet', rarity: 'rare',      icon: '\ud83d\udcff', quantity: 1, equipped: false },
    ],
    abilities: [
      { id: 1, name: 'Sneak Attack', school: 'martial',   cost: 0, description: '+1d6 flanking' },
      { id: 2, name: 'Dash',         school: 'movement',  cost: 1, description: 'Double move this turn' },
      { id: 3, name: 'Fireball',     school: 'evocation', cost: 4, description: '8d6 fire 20ft radius' },
    ],
    combat: {
      active: true, round: 3,
      order: [
        { character_id: 1, name: 'Nimus',  init: 18, current: true  },
        { character_id: 3, name: 'Goblin', init: 14, current: false },
        { character_id: 2, name: 'Kael',   init: 12, current: false },
        { character_id: 5, name: 'Shaman', init: 10, current: false },
      ],
    },
  };

  /* Fake fetch ---------------------------------------------------- */
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  window.fetch = async (url) => {
    url = String(url);
    if (url.includes('/api/map/') && url.endsWith('/overlays'))
      return json({ drawings: [], markers: [], objects: [], traps: [] });
    if (url.includes('/api/map/'))
      return json({
        has_map: false, image_url: null, grid_size: 50, grid_enabled: true,
        grid_type: 'square', fog_enabled: false, revealed_cells: [],
        tokens: MOCK.tokens,
        active_floor_tiles: {},
        active_floor_tile_size: 50, active_floor_cols: 20, active_floor_rows: 15,
        active_floor_grid_type: 'square',
      });
    if (url.includes('/characters/') && url.endsWith('/inventory')) return json(MOCK.inventory);
    if (url.includes('/characters/') && url.endsWith('/abilities')) return json(MOCK.abilities);
    if (url.includes('/characters/'))                                return json(MOCK.character);
    if (url.includes('/combat/') && url.includes('active'))          return json(MOCK.combat);
    if (url.includes('/sessions/') && url.endsWith('/characters'))
      return json([
        MOCK.character,
        { id: 2, name: 'Kael', race: 'Elf', class: 'Mage', current_hp: 12, max_hp: 16 },
      ]);
    return json({});
  };

  /* Fake WebSocket ------------------------------------------------ */
  class MockWS {
    constructor() { setTimeout(() => this.onopen && this.onopen(), 10); }
    send() {} close() {}
  }
  window.WebSocket = MockWS;

  /* Globals the real app reads ----------------------------------- */
  window.SESSION_CODE = 'DEMO-0000';
  window.CHAR_ID      = 1;
  window.PLAYER_TOKEN = 'demo-token';

  /* Fill known placeholder nodes + draw a demo map --------------- */
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.status-dot').forEach(d => d.classList.add('connected'));
    document.querySelectorAll('[id$="ws-label"]').forEach(el => el.textContent = 'connected (mock)');

    const fill = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text; };
    fill('#char-name',       MOCK.character.name);
    fill('#session-name',    'Demo Session');
    fill('#session-status',  'active');
    fill('#session-turn',    '3');
    fill('#connected-count', '2');

    const paintDemo = (c) => {
      if (!c || c.tagName !== 'CANVAS') return;
      const parent = c.parentElement;
      if (parent) { c.width = parent.clientWidth || 600; c.height = parent.clientHeight || 400; }
      const ctx = c.getContext('2d');
      const gs = 40, cols = Math.floor(c.width / gs), rows = Math.floor(c.height / gs);
      ctx.fillStyle = '#131110'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = 'rgba(192,138,42,0.15)'; ctx.lineWidth = 1;
      for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x*gs, 0); ctx.lineTo(x*gs, rows*gs); ctx.stroke(); }
      for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y*gs); ctx.lineTo(cols*gs, y*gs); ctx.stroke(); }
      ctx.fillStyle = '#666';
      [[5,3],[6,3],[7,3],[7,4],[7,5]].forEach(([cx,ry]) => { ctx.fillRect(cx*gs+1, ry*gs+1, gs-2, gs-2); });
      MOCK.tokens.forEach(t => {
        const tx = t.x * c.width, ty = t.y * c.height;
        ctx.fillStyle = t.color;
        ctx.beginPath(); ctx.arc(tx, ty, gs*0.35, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#0a0908'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#e2d5c0'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(t.name, tx, ty - gs*0.5);
      });
    };
    ['player-grid-canvas','player-map-canvas','map-canvas','gm-map-canvas','builder-canvas']
      .forEach(id => {
        const c = document.getElementById(id);
        if (c) requestAnimationFrame(() => paintDemo(c));
      });

    /* Drop a placeholder card into obviously-empty list containers */
    const placeholder = (label) => {
      const div = document.createElement('div');
      div.style.cssText = 'margin:6px 0;padding:10px;font-size:0.8rem;color:var(--text-muted);text-align:center;border:1px dashed rgba(220,180,100,0.15);border-radius:6px';
      div.textContent = `(${label} - mock placeholder)`;
      return div;
    };
    document.querySelectorAll('[id$="-list"], [id$="-grid"], [id$="-body"]').forEach(el => {
      if (el.children.length === 0 && !el.textContent.trim()) {
        el.appendChild(placeholder(el.id));
      }
    });
  });

  /* Silence noise from any code we couldn't fully stub ----------- */
  window.addEventListener('error',            e => e.preventDefault());
  window.addEventListener('unhandledrejection', e => e.preventDefault());
})();
</script>
"""


# ---- Builder -------------------------------------------------------------
def build_mockup(src_html: pathlib.Path, out: pathlib.Path, label: str) -> None:
    html = read_text(src_html)
    html = inline_css(html)
    html = strip_real_scripts(html)
    banner = (
        f'<!-- MOCKUP for Claude.ai/design - generated from {src_html.name} -->'
        f'<div style="position:fixed;top:8px;left:50%;transform:translateX(-50%);'
        'z-index:99999;background:#c08a2a;color:#0a0908;padding:4px 12px;'
        'border-radius:4px;font:600 0.75rem Inter,sans-serif;pointer-events:none;">'
        f'MOCK &mdash; {label}</div>'
    )
    if "</body>" in html:
        html = html.replace("</body>", banner + MOCK_SCRIPT + "\n</body>", 1)
    else:
        html += banner + MOCK_SCRIPT
    write_text(out, html)
    print(f"  wrote {out.relative_to(ROOT)}  ({len(html):,} chars)")


def main() -> None:
    if not STATIC.is_dir():
        print(f"ERROR: {STATIC} not found", file=sys.stderr)
        sys.exit(1)
    print("Generating self-contained mockups...")
    build_mockup(STATIC / "gm.html",     HERE / "mockup-gm.html",     "GM interface")
    build_mockup(STATIC / "player.html", HERE / "mockup-player.html", "Player interface")
    print()
    print("Done. Upload mockups/mockup-gm.html or mockups/mockup-player.html to")
    print("Claude.ai/design as an attachment, or double-click the files to preview")
    print("them in your browser first.")


if __name__ == "__main__":
    main()
