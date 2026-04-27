import os

from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character,
    Session,
)
from app.routers.map.common import TOKEN_MAX_DIMENSION, TOKENS_DIR, router
from app.websocket_manager import manager


@router.get("/token-image/{filename}")
async def get_token_image(filename: str):
    """Serve a saved portrait file. No auth — the filename contains the
    character id, which isn't sensitive, and the token image is already
    visible on every player screen."""
    # Block any attempt at path traversal.
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    path = os.path.join(TOKENS_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "Token image not found")
    return FileResponse(path)


@router.post("/token-image/{character_id}")
async def upload_token_image(
    character_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
):
    """Upload a portrait for this character. The player_token header
    would be ideal, but we keep the trust model simple for now — the GM
    is expected to police this. We downscale to `TOKEN_MAX_DIMENSION`
    and re-encode as PNG so the stored file is predictable + small.
    Broadcasts `map.updated` so every connected client refreshes the
    map (which re-fetches the token row with its new image)."""
    c = await db.get(Character, character_id)
    if not c:
        raise HTTPException(404, "Character not found")
    # Read the upload into memory; PIL handles format sniffing.
    try:
        img = Image.open(file.file)
        img.load()
    except Exception:
        raise HTTPException(400, "Not a valid image")
    img = img.convert("RGBA")
    img.thumbnail((TOKEN_MAX_DIMENSION, TOKEN_MAX_DIMENSION))
    filename = f"token_{character_id}.png"
    path = os.path.join(TOKENS_DIR, filename)
    img.save(path, format="PNG")
    c.token_image_url = f"/api/map/token-image/{filename}"
    await db.commit()
    # Notify everybody so the new image shows up without a hard reload.
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await manager.broadcast_to_session(sess.code, "map.updated", {"reason": "token_image"})
    except Exception:
        pass
    return {"ok": True, "token_image_url": c.token_image_url}


@router.delete("/token-image/{character_id}")
async def delete_token_image(character_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, character_id)
    if not c:
        raise HTTPException(404, "Character not found")
    # Delete the file if it still matches the recorded URL.
    try:
        if c.token_image_url:
            # Extract filename tail and only allow files inside TOKENS_DIR.
            tail = c.token_image_url.rsplit("/", 1)[-1]
            path = os.path.join(TOKENS_DIR, tail)
            if os.path.isfile(path) and path.startswith(TOKENS_DIR):
                os.remove(path)
    except Exception:
        pass
    c.token_image_url = None
    await db.commit()
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await manager.broadcast_to_session(sess.code, "map.updated", {"reason": "token_image_cleared"})
    except Exception:
        pass
    return {"ok": True}


