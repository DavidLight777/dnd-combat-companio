"""Stage 8 — Quest System: Templates, Assignment, Completion."""
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Character, CharacterQuest, InventoryItem, QuestTemplate, Session

router = APIRouter(prefix="/api", tags=["quests"])


# ── Pydantic schemas ─────────────────────────────────────────
class QuestTemplateBody(BaseModel):
    session_id: int
    title: str
    description: str = ""
    source_npc_id: int | None = None
    reward_gold_bronze: int = 0
    reward_item_ids: list = []
    reward_description: str = ""
    reward_is_hidden: bool = False
    structured_rewards: dict | None = None  # {"xp": 500, "currency": {...}, "items": [...]}
    stages: list = []  # [{order, title, description}]
    is_multi_stage: bool = True


class AssignBody(BaseModel):
    template_id: int | None = None
    character_ids: list[int] = []
    # For custom (one-off) quest:
    title: str | None = None
    description: str | None = None
    source_npc_name: str | None = None
    reward_gold_bronze: int = 0
    reward_item_ids: list = []
    reward_description: str = ""
    reward_is_hidden: bool = False
    structured_rewards: dict | None = None
    stages: list = []
    is_multi_stage: bool = True


class StageCompleteBody(BaseModel):
    stage_index: int


# ── Serializers ──────────────────────────────────────────────
def _ser_template(t: QuestTemplate) -> dict:
    return {
        "id": t.id,
        "session_id": t.session_id,
        "title": t.title,
        "description": t.description,
        "source_npc_id": t.source_npc_id,
        "reward_gold_bronze": t.reward_gold_bronze,
        "reward_item_ids": json.loads(t.reward_item_ids) if t.reward_item_ids else [],
        "reward_description": t.reward_description,
        "reward_is_hidden": t.reward_is_hidden,
        "structured_rewards": json.loads(t.structured_rewards) if t.structured_rewards else None,
        "stages": json.loads(t.stages) if t.stages else [],
        "is_multi_stage": t.is_multi_stage,
    }


def _ser_quest(q: CharacterQuest) -> dict:
    return {
        "id": q.id,
        "character_id": q.character_id,
        "quest_template_id": q.quest_template_id,
        "title": q.title,
        "description": q.description,
        "source_npc_name": q.source_npc_name,
        "status": q.status,
        "current_stage": q.current_stage,
        "stages_completed": json.loads(q.stages_completed) if q.stages_completed else [],
        "reward_gold_bronze": q.reward_gold_bronze,
        "reward_item_ids": json.loads(q.reward_item_ids) if q.reward_item_ids else [],
        "reward_description": q.reward_description,
        "reward_is_hidden": q.reward_is_hidden,
        "reward_revealed": q.reward_revealed,
        "structured_rewards": json.loads(q.structured_rewards) if q.structured_rewards else None,
        "assigned_at": q.assigned_at.isoformat() if q.assigned_at else None,
        "completed_at": q.completed_at.isoformat() if q.completed_at else None,
    }


# ══════════════════════════════════════════════════════════════
# QUEST TEMPLATES CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/quest-templates")
async def list_templates(session_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(QuestTemplate).where(QuestTemplate.session_id == session_id).order_by(QuestTemplate.title)
    )
    return [_ser_template(t) for t in result.scalars().all()]


@router.post("/quest-templates")
async def create_template(body: QuestTemplateBody, db: AsyncSession = Depends(get_session)):
    t = QuestTemplate(
        session_id=body.session_id,
        title=body.title,
        description=body.description,
        source_npc_id=body.source_npc_id,
        reward_gold_bronze=body.reward_gold_bronze,
        reward_item_ids=json.dumps(body.reward_item_ids),
        reward_description=body.reward_description,
        reward_is_hidden=body.reward_is_hidden,
        structured_rewards=json.dumps(body.structured_rewards) if body.structured_rewards else None,
        stages=json.dumps(body.stages),
        is_multi_stage=body.is_multi_stage,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _ser_template(t)


@router.put("/quest-templates/{template_id}")
async def update_template(template_id: int, body: QuestTemplateBody, db: AsyncSession = Depends(get_session)):
    t = await db.get(QuestTemplate, template_id)
    if not t:
        raise HTTPException(404, "Quest template not found")
    t.title = body.title
    t.description = body.description
    t.source_npc_id = body.source_npc_id
    t.reward_gold_bronze = body.reward_gold_bronze
    t.reward_item_ids = json.dumps(body.reward_item_ids)
    t.reward_description = body.reward_description
    t.reward_is_hidden = body.reward_is_hidden
    t.structured_rewards = json.dumps(body.structured_rewards) if body.structured_rewards else None
    t.stages = json.dumps(body.stages)
    t.is_multi_stage = body.is_multi_stage
    await db.commit()
    await db.refresh(t)
    return _ser_template(t)


@router.delete("/quest-templates/{template_id}")
async def delete_template(template_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(QuestTemplate, template_id)
    if not t:
        raise HTTPException(404)
    await db.delete(t)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# QUEST ASSIGNMENT
# ══════════════════════════════════════════════════════════════
@router.post("/quests/assign")
async def assign_quest(body: AssignBody, db: AsyncSession = Depends(get_session)):
    if not body.character_ids:
        raise HTTPException(400, "No characters specified")

    # From template or custom
    if body.template_id:
        t = await db.get(QuestTemplate, body.template_id)
        if not t:
            raise HTTPException(404, "Quest template not found")
        title = t.title
        description = t.description
        stages = json.loads(t.stages) if t.stages else []
        reward_gold = t.reward_gold_bronze
        reward_items = t.reward_item_ids
        reward_desc = t.reward_description
        reward_hidden = t.reward_is_hidden
        structured_rewards = t.structured_rewards
        is_multi = t.is_multi_stage
        # Get NPC name
        npc_name = None
        if t.source_npc_id:
            npc = await db.get(Character, t.source_npc_id)
            if npc:
                npc_name = npc.name
    else:
        if not body.title:
            raise HTTPException(400, "Custom quest needs a title")
        title = body.title
        description = body.description or ""
        stages = body.stages
        reward_gold = body.reward_gold_bronze
        reward_items = json.dumps(body.reward_item_ids)
        reward_desc = body.reward_description
        reward_hidden = body.reward_is_hidden
        structured_rewards = json.dumps(body.structured_rewards) if body.structured_rewards else None
        is_multi = body.is_multi_stage
        npc_name = body.source_npc_name

    assigned = []
    for cid in body.character_ids:
        char = await db.get(Character, cid)
        if not char:
            continue
        q = CharacterQuest(
            character_id=cid,
            quest_template_id=body.template_id,
            title=title,
            description=description,
            source_npc_name=npc_name,
            status="active",
            current_stage=0,
            stages_completed="[]",
            reward_gold_bronze=reward_gold,
            reward_item_ids=reward_items if isinstance(reward_items, str) else json.dumps(reward_items),
            reward_description=reward_desc,
            reward_is_hidden=reward_hidden,
            structured_rewards=structured_rewards,
            reward_revealed=False,
        )
        db.add(q)
        await db.flush()
        assigned.append({"quest_id": q.id, "character_id": cid, "character_name": char.name})

    await db.commit()

    # FIX 5: Auto-memory entry per assigned character (best-effort)
    try:
        from app.routers.memory import create_memory_entry
        for a in assigned:
            await create_memory_entry(
                db, a["character_id"], "event",
                f"Quest: {title}",
                description or "A new quest was assigned.",
            )
    except Exception:
        pass

    return {"assigned": assigned, "title": title}


# ══════════════════════════════════════════════════════════════
# CHARACTER QUESTS
# ══════════════════════════════════════════════════════════════
@router.get("/characters/{char_id}/quests")
async def get_character_quests(char_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CharacterQuest).where(CharacterQuest.character_id == char_id).order_by(CharacterQuest.assigned_at.desc())
    )
    quests = result.scalars().all()
    # Enrich with stage data from templates
    enriched = []
    for q in quests:
        data = _ser_quest(q)
        if q.quest_template_id:
            tpl = await db.get(QuestTemplate, q.quest_template_id)
            if tpl:
                data["stages"] = json.loads(tpl.stages) if tpl.stages else []
        if "stages" not in data:
            data["stages"] = []
        enriched.append(data)
    return enriched


@router.patch("/character-quests/{quest_id}/complete-stage")
async def complete_stage(quest_id: int, body: StageCompleteBody, db: AsyncSession = Depends(get_session)):
    q = await db.get(CharacterQuest, quest_id)
    if not q:
        raise HTTPException(404, "Quest not found")
    if q.status != "active":
        raise HTTPException(400, "Quest is not active")

    completed = json.loads(q.stages_completed) if q.stages_completed else []
    if body.stage_index not in completed:
        completed.append(body.stage_index)
    q.stages_completed = json.dumps(completed)
    q.current_stage = body.stage_index + 1
    await db.commit()
    await db.refresh(q)
    return _ser_quest(q)


@router.patch("/character-quests/{quest_id}/complete")
async def complete_quest(quest_id: int, db: AsyncSession = Depends(get_session)):
    from app.game_mechanics import add_item_to_inventory, check_and_trigger_level_up
    from app.websocket_manager import manager as _ws

    q = await db.get(CharacterQuest, quest_id)
    if not q:
        raise HTTPException(404, "Quest not found")
    if q.status != "active":
        raise HTTPException(400, "Quest is not active")

    q.status = "completed"
    q.completed_at = datetime.now(UTC)
    q.reward_revealed = True

    rewards_applied = {"xp": 0, "currency": 0, "items": []}

    # Grant rewards
    char = await db.get(Character, q.character_id)
    if char:
        # Legacy rewards (gold + flat item ids)
        if q.reward_gold_bronze > 0:
            char.wealth_bronze = (char.wealth_bronze or 0) + q.reward_gold_bronze
            rewards_applied["currency"] += q.reward_gold_bronze

        item_ids = json.loads(q.reward_item_ids) if q.reward_item_ids else []
        for item_id in item_ids:
            inv = InventoryItem(
                character_id=char.id,
                item_id=item_id,
                quantity=1,
                is_equipped=False,
            )
            db.add(inv)
            rewards_applied["items"].append({"item_id": item_id, "quantity": 1})

        # Fix 3: structured rewards (XP + currency + items)
        if q.structured_rewards:
            try:
                sr = json.loads(q.structured_rewards)
                if isinstance(sr, dict):
                    # XP
                    if sr.get("xp"):
                        xp_amount = int(sr["xp"])
                        char.experience = (char.experience or 0) + xp_amount
                        rewards_applied["xp"] += xp_amount

                    # Currency
                    if sr.get("currency"):
                        c = sr["currency"]
                        bronze_total = (
                            int(c.get("platinum", 0)) * 1000 +
                            int(c.get("gold", 0)) * 100 +
                            int(c.get("silver", 0)) * 10 +
                            int(c.get("bronze", 0))
                        )
                        if bronze_total > 0:
                            char.wealth_bronze = (char.wealth_bronze or 0) + bronze_total
                            rewards_applied["currency"] += bronze_total

                    # Items with quantities
                    if sr.get("items"):
                        for item_reward in sr["items"]:
                            item_id = int(item_reward["item_id"])
                            qty = int(item_reward.get("quantity", 1))
                            inv = await add_item_to_inventory(db, char.id, item_id, qty)
                            if inv:
                                rewards_applied["items"].append({"item_id": item_id, "quantity": qty})
            except Exception:
                pass

    await db.commit()
    await db.refresh(q)
    await db.refresh(char)

    # Check level-up after XP gain
    if rewards_applied["xp"] > 0:
        try:
            level_up_info = await check_and_trigger_level_up(db, char)
            rewards_applied["level_up_available"] = level_up_info.get("leveled_up", False)
        except Exception:
            pass

    # WS broadcast
    try:
        sess = await db.get(Session, char.session_id)
        if sess:
            await _ws.broadcast_to_session(sess.code, "quest.completed", {
                "quest_id": q.id,
                "character_id": q.character_id,
                "rewards_applied": rewards_applied,
            })
    except Exception:
        pass

    # FIX 5: Append completion note to the existing "Quest: ..." memory entry
    try:
        from app.routers.memory import update_memory_by_title
        reward_txt = q.reward_description or "received"
        await update_memory_by_title(
            db, q.character_id, f"Quest: {q.title}",
            f"\n\n✅ Completed. Reward: {reward_txt}",
        )
    except Exception:
        pass

    return {**_ser_quest(q), "rewards_applied": rewards_applied}


@router.patch("/character-quests/{quest_id}/fail")
async def fail_quest(quest_id: int, db: AsyncSession = Depends(get_session)):
    q = await db.get(CharacterQuest, quest_id)
    if not q:
        raise HTTPException(404, "Quest not found")
    if q.status != "active":
        raise HTTPException(400, "Quest is not active")

    q.status = "failed"
    q.completed_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(q)
    return _ser_quest(q)


# ── Get all active quests for session (GM view) ──────────────
@router.get("/quests/session/{session_code}")
async def get_session_quests(session_code: str, db: AsyncSession = Depends(get_session)):
    from app.models import Session
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    # Get all characters in session
    chars_result = await db.execute(
        select(Character).where(Character.session_id == session.id, Character.is_npc == False)
    )
    chars = chars_result.scalars().all()
    char_map = {c.id: c.name for c in chars}

    # Get all quests for these characters
    if not char_map:
        return []
    quests_result = await db.execute(
        select(CharacterQuest).where(CharacterQuest.character_id.in_(char_map.keys())).order_by(CharacterQuest.assigned_at.desc())
    )
    quests = quests_result.scalars().all()
    return [{**_ser_quest(q), "character_name": char_map.get(q.character_id, "?")} for q in quests]
