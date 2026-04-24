import json
import os
import socket
import uvicorn
import webbrowser
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
# Registers SQLAlchemy after_commit listeners that fan out
# `entity.invalidated` WS events for every DB mutation. Must be imported
# before any router touches the DB so the hooks are active on day one.
from app import realtime  # noqa: F401
from app.routers.sessions import router as sessions_router
from app.routers.characters import router as characters_router
from app.routers.combat import router as combat_router
from app.routers.websocket import router as websocket_router
from app.routers.initiative import router as initiative_router
from app.routers.map import router as map_router
from app.routers.map_builder import router as map_builder_router
from app.routers.inventory import router as inventory_router
from app.routers.ai import router as ai_router
from app.routers.economy import router as economy_router
from app.routers.status_effects import router as status_effects_router
from app.routers.combat_events import router as combat_events_router
from app.routers.races_classes import router as races_classes_router
from app.routers.npc_library import router as npc_library_router
from app.routers.quests import router as quests_router
from app.routers.announcements import router as announcements_router
from app.routers.notes import router as notes_router
from app.routers.session_timer import router as session_timer_router
from app.routers.combat_actions import router as combat_actions_router
from app.routers.abilities import router as abilities_router
from app.routers.memory import router as memory_router
from app.routers.professions import router as professions_router
from app.routers.poisons import router as poisons_router
from app.routers.wizard import router as wizard_router
from app.routers.cards import router as cards_router
from app.routers.chests import router as chests_router


# ── Load config ──────────────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
config = {}
if os.path.exists(CONFIG_PATH):
    with open(CONFIG_PATH, "r") as f:
        config = json.load(f)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Combat Companion", lifespan=lifespan)

# CORS for LAN access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(sessions_router)
app.include_router(characters_router)
app.include_router(combat_router)
app.include_router(websocket_router)
app.include_router(initiative_router)
app.include_router(map_router)
app.include_router(inventory_router)
app.include_router(ai_router)
app.include_router(economy_router)
app.include_router(status_effects_router)
app.include_router(combat_events_router)
app.include_router(races_classes_router)
app.include_router(npc_library_router)
app.include_router(quests_router)
app.include_router(announcements_router)
app.include_router(notes_router)
app.include_router(session_timer_router)
app.include_router(combat_actions_router)
app.include_router(abilities_router)
app.include_router(memory_router)
app.include_router(professions_router)
app.include_router(poisons_router)
app.include_router(wizard_router)
app.include_router(cards_router)
app.include_router(chests_router)
app.include_router(map_builder_router)

# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/lobby.html")


@app.get("/gm")
async def gm_page():
    return FileResponse("static/gm.html")


@app.get("/player")
async def player_page():
    return FileResponse("static/player.html")


@app.get("/settings")
async def settings_page():
    return FileResponse("static/settings.html")


@app.get("/api/server-info")
async def server_info():
    """Return LAN IP for other players to connect."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"
    port = config.get("server_port", 8000)
    return {"local_ip": local_ip, "port": port, "url": f"http://{local_ip}:{port}"}


PROMPT_PATH = os.path.join(os.path.dirname(__file__), "ai_system_prompt.txt")


@app.get("/api/settings")
async def get_settings():
    prompt = ""
    if os.path.exists(PROMPT_PATH):
        with open(PROMPT_PATH) as f:
            prompt = f.read()
    return {
        "openrouter_api_key": config.get("openrouter_api_key", ""),
        "ai_model": config.get("ai_model", "google/gemma-3-27b-it:free"),
        "system_prompt": prompt,
        "max_players": config.get("max_players", 10),
        "default_dice": config.get("default_dice", "d20"),
        "ai_npc_control": config.get("ai_npc_control", False),
    }


@app.put("/api/settings")
async def save_settings(body: dict):
    config["openrouter_api_key"] = body.get("openrouter_api_key", "")
    config["ai_model"] = body.get("ai_model", "google/gemma-3-27b-it:free")
    config["max_players"] = body.get("max_players", 10)
    config["default_dice"] = body.get("default_dice", "d20")
    config["ai_npc_control"] = body.get("ai_npc_control", False)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    # Save system prompt
    prompt = body.get("system_prompt", "")
    with open(PROMPT_PATH, "w") as f:
        f.write(prompt)
    return {"ok": True}


def open_browser():
    port = config.get("server_port", 8000)
    webbrowser.open(f"http://localhost:{port}")


if __name__ == "__main__":
    host = config.get("server_host", "0.0.0.0")
    port = config.get("server_port", 8000)
    threading.Timer(1.0, open_browser).start()
    uvicorn.run("main:app", host=host, port=port, reload=False)
