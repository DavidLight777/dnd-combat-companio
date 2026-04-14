# WebSocket Event Protocol

All messages are JSON:
```json
{
  "event": "event_name",
  "data": { ... },
  "sender_token": "token_string",
  "timestamp": "ISO8601"
}
```

## Events — Stage 1

| Event | Direction | Description |
|---|---|---|
| `session.state` | Server→Client | Full session state sent on connect |
| `session.player_joined` | Server→All | A new player joined the session |
| `session.player_disconnected` | Server→All | A player disconnected |
| `session.status_change` | Server→All | Session status changed |

## Events — Stage 2 (Inventory System)

| Event | Direction | Description | Payload |
|---|---|---|---|
| `inventory.item_added` | Server→All | Item added to character inventory | `{character_id, item_name}` |
| `inventory.item_equipped` | Server→All | Item equipped/unequipped | `{character_id, item_name, slot, equipped}` |
| `inventory.item_removed` | Server→All | Item removed from inventory | `{character_id, item_name}` |
| `combat.bonuses_updated` | Server→All | Equipped bonuses changed (auto after equip/unequip) | `{character_id}` |

## Events — Stage 3 (Economy & Trading)

| Event | Direction | Description | Payload |
|---|---|---|---|
| `trade.initiated` | GM→Player | GM initiates trade, opens trade modal on player side | `{trade_id, npc_id, npc_name, player_id}` |
| `trade.closed` | Server→All | Trade session closed | `{trade_id}` |
| `currency.updated` | Server→All | Character currency changed (give/transfer/buy) | `{character_id}` |

## Events — Stage 4 (Status Effects)

| Event | Direction | Description | Payload |
|---|---|---|---|
| `status_effect.applied` | Server→All | Status effect applied to character | `{character_id, effect_name}` |
| `status_effect.removed` | Server→All | Status effect removed from character | `{character_id, effect_name}` |
| `status_effect.expired` | Server→All | Status effect expired (duration ended) | `{character_id, effect_name}` |

## Events — Stage 5 (Combat & Initiative)

| Event | Direction | Description | Payload |
|---|---|---|---|
| `combat.created` | Server→All | New combat event created | `{combat_id, name}` |
| `combat.roll_initiative_request` | GM→Players | GM requests initiative rolls from players | `{combat_id, character_id, initiative_bonus}` |
| `combat.initiative_submitted` | Player→GM | Player submitted initiative roll | `{combat_id, character_id, roll, final}` |
| `combat.started` | Server→All | Combat started, initiative locked | `{combat_id}` |
| `combat.turn_changed` | Server→All | Turn advanced to next participant | `{combat_id, current_character_id, current_character_name, round_number}` |
| `combat.timer_started` | GM→Player | Turn timer started for player | `{duration_seconds, combat_id}` |
| `combat.ended` | Server→All | Combat ended | `{combat_id}` |

## Events — Future (planned)

| Event | Direction | Description |
|---|---|---|
| `character.hp_update` | Server→All | HP changed for character |
| `character.stats_update` | Server→All | Stats changed |
| `combat.damage_result` | Server→All | Damage calculation result |
| `map.token_move` | Server→All | Token moved |
| `map.fog_update` | Server→All | Fog of war updated |
| `map.image_loaded` | Server→All | New map uploaded |
