# Chezz API

Chezz uses the shared platform routes for login, lobby, matchmaking, chat, replay, surrender, draw, and rematch.

Use this header when starting Chezz flows without a `game_id`:

```http
X-MM-Game: chezz
```

## `GET /api/state?game_id=...`

Returns the current Chezz state for the client.

Common fields:

- `game_id`
- `mode`
- `status`
- `players`
- `board`
- `current_turn`
- `you_color`
- `move_history`
- `captures`
- `clocks`
- `legal`

The frontend uses `legal.actions` to know which moves are allowed.

## `POST /api/move`

Submits a player move.

```json
{
  "game_id": "game-id",
  "action_key": "move:e2>e4",
  "expected_seq": 3,
  "client_move_id": "client-move-001"
}
```

`expected_seq` helps reject stale moves. `client_move_id` makes retries safer.

## `POST /api/move` for the engine

Used when the PvE engine needs to take its turn.

```json
{
  "game_id": "game-id",
  "actor": "engine"
}
```

The server only accepts this for the correct PvE turn.

## `GET /api/replay?game_id=...`

Returns replay entries for the game.

## `GET /api/realtime/stream?game_id=...`

Server-sent events for moves, game status, clocks, and chat.

## Notes

- The server checks that the caller belongs to the game.
- The server validates moves instead of trusting the UI.
- Action keys come from the latest `legal.actions` list.
