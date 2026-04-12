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

## Events — Stage 2+ (planned)

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
| `inventory.item_granted` | Server→Target | GM gave item |
| `inventory.item_removed` | Server→Target | Item removed |
| `shop.updated` | Server→All | Shop changed |
| `log.new_entry` | Server→All/GM | New log entry |
| `ai.response` | Server→GM | AI response |
| `gm.force_roll` | Server→Target | GM requests roll |
| `character.status_effect` | Server→All | Status effect changed |
