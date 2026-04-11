import uvicorn
import webbrowser
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database import init_db
from routers.characters import router as characters_router
from routers.effects import router as effects_router
from routers.modifiers import router as modifiers_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="DnD Combat Companion", lifespan=lifespan)

# Routers
app.include_router(characters_router)
app.include_router(effects_router)
app.include_router(modifiers_router)

# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


def open_browser():
    webbrowser.open("http://localhost:8000")


if __name__ == "__main__":
    threading.Timer(1.0, open_browser).start()
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
