import re
import tempfile
from pathlib import Path


def test_rewrite_inserts_hash():
    import scripts.cache_bust as cb
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        js = tmp_path / "static" / "js" / "foo.js"
        js.parent.mkdir(parents=True)
        js.write_text("console.log('hi')")
        html = tmp_path / "page.html"
        html.write_text('<script src="/static/js/foo.js?v=old"></script>')
        cb.ROOT = tmp_path
        n = cb.rewrite(html)
        assert n == 1
        text = html.read_text()
        assert "?v=" in text
        assert "?v=old" not in text


def test_rewrite_idempotent():
    import scripts.cache_bust as cb
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        js = tmp_path / "static" / "js" / "foo.js"
        js.parent.mkdir(parents=True)
        js.write_text("console.log('hi')")
        html = tmp_path / "page.html"
        html.write_text('<script src="/static/js/foo.js?v=old"></script>')
        cb.ROOT = tmp_path
        cb.rewrite(html)
        n = cb.rewrite(html)
        assert n == 0


def test_rewrite_missing_file():
    import scripts.cache_bust as cb
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        html = tmp_path / "page.html"
        html.write_text('<script src="/static/js/missing.js?v=old"></script>')
        cb.ROOT = tmp_path
        n = cb.rewrite(html)
        assert n == 1
        text = html.read_text()
        assert '?v=missing"' in text
