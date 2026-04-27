"""Stage 3 — Multi-Currency Economy & Trading System."""

import json
import os

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["economy"])

# ── Load currency rates from config ──────────────────────────
_config_path = os.path.join(os.path.dirname(__file__), "..", "..", "config.json")
_rates = {"platinum": 1000, "gold": 100, "silver": 10, "bronze": 1}
try:
    with open(_config_path) as f:
        _cfg = json.load(f)
        _rates = _cfg.get("currency_rates", _rates)
except Exception:
    pass


# ══════════════════════════════════════════════════════════════
# SCHEMAS
# ══════════════════════════════════════════════════════════════
class GiveGoldBody(BaseModel):
    platinum: int = 0
    gold: int = 0
    silver: int = 0
    bronze: int = 0
    note: str = "GM grant"


class TransferBody(BaseModel):
    from_id: int
    to_id: int
    bronze_amount: int
    note: str = ""


class ReputationSetBody(BaseModel):
    reputation_value: int


class ReputationAdjustBody(BaseModel):
    delta: int


class ShopItemAddBody(BaseModel):
    item_id: int
    stock: int | None = None
    price_override_bronze: int | None = None


class ShopItemPatchBody(BaseModel):
    stock: int | None = None
    price_override_bronze: int | None = None
    is_available: bool | None = None


class TradeInitiateBody(BaseModel):
    npc_id: int
    player_id: int


class TradeBuyBody(BaseModel):
    shop_item_id: int
    quantity: int = 1


# ══════════════════════════════════════════════════════════════
# CURRENCY ENDPOINTS
# ══════════════════════════════════════════════════════════════
