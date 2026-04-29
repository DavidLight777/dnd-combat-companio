import os
import subprocess
import sys
import time

import pytest
import requests
from playwright.sync_api import Page

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))
from app.database import init_db


@pytest.fixture(scope="session")
def live_server():
    """Spin up the real uvicorn app on a random port for E2E tests."""
    # Ensure DB is initialised in a fresh subprocess (avoid asyncio loop clash)
    subprocess.run([sys.executable, "-c", "import asyncio; from app.database import init_db; asyncio.run(init_db())"], check=False)
    port = 18765
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--port", str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=os.path.join(os.path.dirname(__file__), "../.."),
    )
    # Wait for server to come up
    for _ in range(30):
        time.sleep(0.5)
        try:
            r = requests.get(f"http://127.0.0.1:{port}/api/server-info", timeout=2)
            if r.status_code == 200:
                break
        except Exception:
            pass
    else:
        proc.terminate()
        raise RuntimeError("Server failed to start")
    url = f"http://127.0.0.1:{port}"
    yield url
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


@pytest.fixture
def seeded_session(live_server):
    """Create a session via API and return {url, session_code, gm_url, player_url}."""
    r = requests.post(f"{live_server}/api/sessions/create", json={"gm_name": "E2E", "name": "Test"})
    r.raise_for_status()
    data = r.json()
    code = data["session_code"]
    gm_token = data.get("gm_token", "")
    return {
        "url": live_server,
        "session_code": code,
        "gm_token": gm_token,
        "gm_url": f"{live_server}/gm?code={code}",
        "player_url": f"{live_server}/player",
    }


@pytest.fixture
def gm_page(page, seeded_session):
    """Open GM page with auth token pre-seeded in sessionStorage."""
    page.goto(seeded_session["url"] + "/")
    page.evaluate("""
        (data) => {
            sessionStorage.setItem('session_code', data.code);
            sessionStorage.setItem('gm_token', data.token);
            sessionStorage.setItem('session_id', data.id);
        }
    """, {"code": seeded_session["session_code"], "token": seeded_session["gm_token"], "id": "1"})
    page.goto(seeded_session["gm_url"])
    yield page


@pytest.fixture
def player_page(page, seeded_session):
    """Create a player character via API and open the player dashboard."""
    # Join via API to skip the wizard
    r = requests.post(f"{seeded_session['url']}/api/sessions/join", json={
        "session_code": seeded_session["session_code"],
        "player_name": "E2EHero",
    })
    r.raise_for_status()
    data = r.json()
    char_id = data["character_id"]
    player_token = data.get("player_token", "")
    # Open a new page so we don't clobber gm_page
    p = page.context.new_page()
    p.goto(seeded_session["url"] + "/")
    p.evaluate("""
        (data) => {
            sessionStorage.setItem('session_code', data.code);
            sessionStorage.setItem('player_token', data.token);
            sessionStorage.setItem('character_id', data.char_id);
        }
    """, {"code": seeded_session["session_code"], "token": player_token, "char_id": str(char_id)})
    p.goto(f"{seeded_session['url']}/player")
    yield p
    p.close()


@pytest.fixture(autouse=True)
def _no_console_errors(page):
    """Fail any test that logs JS errors or uncaught exceptions."""
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    yield
    assert not errors, "page logged errors:\n" + "\n".join(errors)
