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
from app.routers.sessions import router as sessions_router
from app.routers.characters import router as characters_router
from app.routers.combat import router as combat_router
from app.routers.websocket import router as websocket_router
from app.routers.initiative import router as initiative_router
from app.routers.map import router as map_router


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


def open_browser():
    port = config.get("server_port", 8000)
    webbrowser.open(f"http://localhost:{port}")


if __name__ == "__main__":
    host = config.get("server_host", "0.0.0.0")
    port = config.get("server_port", 8000)
    threading.Timer(1.0, open_browser).start()
    uvicorn.run("main:app", host=host, port=port, reload=False)
