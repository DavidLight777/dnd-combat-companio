"""Rewrite ?v=... query strings on <script src> and <link href> to
match the current file's hash. Run before committing or as a
pre-commit hook.

Walks static/gm.html, static/player.html and static/lobby.html, finds every
src="/static/.../file.js?v=..." or href="/static/.../file.css?v=..."
and replaces the version with a short hash of the referenced
file's contents.
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
HTML_FILES = [STATIC / "gm.html", STATIC / "player.html", STATIC / "lobby.html"]

PATTERN = re.compile(
    r'(src|href)="(/static/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"'
)


def file_hash(rel_path: str) -> str:
    p = ROOT / rel_path.lstrip("/")
    if not p.exists():
        return "missing"
    return hashlib.sha1(p.read_bytes()).hexdigest()[:8]


def rewrite(html_path: Path) -> int:
    if not html_path.exists():
        return 0
    text = html_path.read_text(encoding="utf-8")
    changed = 0

    def repl(m):
        nonlocal changed
        attr, src = m.group(1), m.group(2)
        h = file_hash(src)
        new = f'{attr}="{src}?v={h}"'
        if new != m.group(0):
            changed += 1
        return new

    new_text = PATTERN.sub(repl, text)
    if changed:
        html_path.write_text(new_text, encoding="utf-8")
    return changed


def main():
    total = 0
    for f in HTML_FILES:
        n = rewrite(f)
        print(f"{f.name}: {n} tags updated")
        total += n
    print(f"Total: {total}")


if __name__ == "__main__":
    main()
