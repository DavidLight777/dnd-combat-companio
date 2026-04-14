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

## Events — Stage 5+ (planned)

| Event | Direction | Description |
|---|---|---|
| `character.hp_update` | Server→All | HP changed for character |
| `character.stats_update` | Server→All | Stats changed |
| `combat.damage_result` | Server→All | Damage calculation result |
| `combat.heal_result` | Server→All | Heal result |
| `initiative.order_set` | Server→All | Full initiative order |
| `initiative.turn_advance` | Server→All | Whose turn it is |
| `map.token_move` | Server→All | Token moved |
| `map.fog_update` | Server→All | Fog of war updated |
| `map.image_loaded` | Server→All | New map uploaded |
| `shop.updated` | Server→All | Shop changed |
| `log.new_entry` | Server→All/GM | New log entry |
| `ai.response` | Server→GM | AI response |
| `gm.force_roll` | Server→Target | GM requests roll |
| `character.status_effect` | Server→All | Status effect changed |
