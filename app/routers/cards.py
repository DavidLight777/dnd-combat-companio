"""Fix 2 — Card Library API."""
import json
import os
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import CardLibrary

router = APIRouter(prefix="/api", tags=["cards"])


# ── Schemas ───────────────────────────────────────────────────
class CardBody(BaseModel):
    session_id: int
    name: str
    description: str = ""
    card_type: str = "character"  # character / location / item / custom
    card_data: dict = {}


class CardUpdateBody(BaseModel):
    name: str | None = None
    description: str | None = None
    card_type: str | None = None
    card_data: dict | None = None


# ── Helpers ───────────────────────────────────────────────────
def _ser_card(c: CardLibrary) -> dict:
    return {
        "id": c.id,
        "session_id": c.session_id,
        "name": c.name,
        "description": c.description,
        "image_url": c.image_url,
        "card_type": c.card_type,
        "card_data": json.loads(c.card_data) if c.card_data else {},
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


# ══════════════════════════════════════════════════════════════
# CARD LIBRARY CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/cards")
async def list_cards(session_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CardLibrary).where(CardLibrary.session_id == session_id).order_by(CardLibrary.name)
    )
    return [_ser_card(c) for c in result.scalars().all()]


@router.post("/cards")
async def create_card(
    body: CardBody,
    db: AsyncSession = Depends(get_session),
):
    c = CardLibrary(
        session_id=body.session_id,
        name=body.name,
        description=body.description,
        card_type=body.card_type,
        card_data=json.dumps(body.card_data),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _ser_card(c)


@router.put("/cards/{card_id}")
async def update_card(card_id: int, body: CardUpdateBody, db: AsyncSession = Depends(get_session)):
    c = await db.get(CardLibrary, card_id)
    if not c:
        raise HTTPException(404, "Card not found")
    if body.name is not None:
        c.name = body.name
    if body.description is not None:
        c.description = body.description
    if body.card_type is not None:
        c.card_type = body.card_type
    if body.card_data is not None:
        c.card_data = json.dumps(body.card_data)
    await db.commit()
    await db.refresh(c)
    return _ser_card(c)


@router.delete("/cards/{card_id}")
async def delete_card(card_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(CardLibrary, card_id)
    if not c:
        raise HTTPException(404, "Card not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# IMAGE UPLOAD
# ══════════════════════════════════════════════════════════════
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "static", "uploads", "cards")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/cards/{card_id}/upload-image")
async def upload_card_image(
    card_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
):
    c = await db.get(CardLibrary, card_id)
    if not c:
        raise HTTPException(404, "Card not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        raise HTTPException(400, "Invalid image format")

    filename = f"card_{card_id}_{int(datetime.now(UTC).timestamp())}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(await file.read())

    c.image_url = f"/static/uploads/cards/{filename}"
    await db.commit()
    await db.refresh(c)
    return _ser_card(c)


@router.get("/cards/{card_id}/export")
async def export_card(card_id: int, format: str = "json", db: AsyncSession = Depends(get_session)):
    c = await db.get(CardLibrary, card_id)
    if not c:
        raise HTTPException(404, "Card not found")

    if format == "json":
        return _ser_card(c)
    else:
        raise HTTPException(400, "Format must be 'json' (PNG export requires frontend generation)")
