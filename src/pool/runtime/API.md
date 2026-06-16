# Pool API

Pool uses the shared platform routes for login, lobby, matchmaking, chat, replay, surrender, draw, and rematch.

Use this header when starting Pool flows without a `game_id`:

```http
X-MM-Game: pool
```

## `GET /api/state?game_id=...`

Returns the current Pool state for the client.

Common fields:

- `game_id`
- `mode`
- `status`
- `players`
- `table`
- `you_seat`
- `current_player_id`
- `can_place_cue`
- `can_fire_shot`
- `move_history`

Example:

```json
{
  "ok": true,
  "game_id": "game-id",
  "status": "active",
  "you_seat": "player1",
  "can_place_cue": false,
  "can_fire_shot": true,
  "table": {
    "balls": [],
    "game_over": false
  }
}
```

## `POST /api/shot`

Fires the cue ball.

```json
{
  "game_id": "game-id",
  "x_vel": 120.5,
  "y_vel": -80.0,
  "aim": { "power": 0.75 }
}
```

If the player has ball-in-hand, the request can also include `cue_x` and `cue_y`.

## `POST /api/place-cue`

Places the cue ball during ball-in-hand.

```json
{
  "game_id": "game-id",
  "x": 0.25,
  "y": 0.5,
  "validate_only": false
}
```

Use `validate_only: true` to check a spot without committing it.

## `GET /api/replay?game_id=...`

Returns replay entries for the game.

## `GET /api/realtime/stream?game_id=...`

Server-sent events for table updates, game status, clocks, and chat.

## Notes

- The server checks whose turn it is before accepting shots.
- The frontend should use `can_place_cue` and `can_fire_shot` to decide which controls to show.
