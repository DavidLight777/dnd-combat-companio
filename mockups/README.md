# Claude Design mockups

Self-contained single-file HTML snapshots of the app's GM and Player
interfaces, ready to upload to [claude.ai/design](https://claude.ai/design)
as a starting point for UI redesign.

## Files

- `make_mockups.py` — regenerates the two HTML files from the real
  `static/gm.html` and `static/player.html` + their CSS. Rerun any time
  the real UI changes so the mockups stay in sync.
- `mockup-gm.html` — GM interface with inlined CSS and mock data.
- `mockup-player.html` — Player interface with inlined CSS and mock data.

## Regenerate

```powershell
python mockups\make_mockups.py
```

The script:

1. Inlines every `<link rel="stylesheet">` into a `<style>` block.
2. Strips real `<script src="/static/js/...">` tags (websocket client,
   gm-app, player-app, map-canvas, character-sheet-core).
3. Injects a tiny stub that fakes `fetch`, `WebSocket`, and a handful of
   globals (`SESSION_CODE`, `CHAR_ID`) plus populates the first few
   placeholders (char name, session name, status dots) and paints a demo
   map with 5 tokens and a few wall tiles onto the first canvas it finds.

The result is a single HTML file that opens standalone in any browser.

## How to use with Claude Design

1. Open [claude.ai/design](https://claude.ai/design).
2. Attach `mockup-gm.html` or `mockup-player.html` (drag it into the
   prompt, or use the paperclip icon).
3. Ask Claude something like:
   > "Redesign this interface with a cleaner layout. Keep the same
   > tabs / panels / data but improve visual hierarchy and spacing."

   Claude will render the mockup as an artifact and iterate on it in
   place.

## Notes

- The mockup shows a **static snapshot** — no interactions, no real
  data, no canvas rendering beyond the demo paint. That's fine for
  visual redesign.
- The `MOCK` banner at the top of each file is intentional — remove it
  from the final design when you port changes back to the real app.
- If you want a different mock character / tokens / inventory, edit the
  `MOCK` object inside `MOCK_SCRIPT` in `make_mockups.py` and regenerate.
