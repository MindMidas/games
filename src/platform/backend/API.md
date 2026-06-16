# Platform API

These are the shared API routes used by the Games frontend.

| Item | Value |
|---|---|
| Local URL | `http://127.0.0.1:8080` |
| Auth | `games_session` cookie |
| Errors | `{"error": "message"}` |
| Game choice | `X-MM-Game: pool` or `X-MM-Game: chezz` |

If a request has a `game_id`, the server uses the game type saved with that game.

## Health

### `GET /api/health`

Basic server health check.

```json
{ "ok": true }
```

### `GET /api/ready`

Readiness check for the configured backend services.

```json
{ "ok": true }
```

## Auth

### `POST /api/auth/register`

```json
{ "username": "alice", "password": "example-password", "photo_url": null }
```

Creates an account and starts a session.

### `POST /api/auth/login`

```json
{ "username": "alice", "password": "example-password" }
```

Starts a session.

### `POST /api/auth/logout`

Ends the session.

### `GET /api/auth/me`

Returns the logged-in user.

### `GET /api/auth/session`

Lightweight session check for the frontend.

## Profile

### `GET /api/profile/stats`

Returns stats for the selected game.

### `POST /api/profile/update`

```json
{ "username": "alice2", "photo_url": null }
```

Updates the current user profile.

## Lobby

### `GET /api/players/online`

Returns online players for the selected game.

Optional query:

- `touch_presence=0` to read without refreshing your own presence.

### `POST /api/presence/ping`

Updates your lobby presence.

### `GET /api/leaderboard`

Returns leaderboard rows.

### `GET /api/bot/profile`

Returns the Chezz engine profile when Chezz is selected.

## Matchmaking and Invites

### `GET /api/matchmaking/status`

Returns your queue state.

### `POST /api/matchmaking/join`

Joins the random PvP queue.

### `POST /api/matchmaking/cancel`

Leaves the random PvP queue.

### `GET /api/active-pvp-game`

Returns an unfinished PvP game if you have one.

### `GET /api/runtime/metrics`

Returns lightweight runtime counters for the logged-in user.

### `GET /api/invite/status`

Returns your current invite state.

### `POST /api/invite/create`

Creates an invite code.

```json
{ "ok": true, "code": "ABC123" }
```

### `POST /api/invite/join`

```json
{ "code": "ABC123" }
```

Accepts an invite and starts a PvP match.

## Games

### `POST /api/new-game`

Starts or resumes a game.

```http
X-MM-Game: chezz
```

```json
{ "mode": "pve" }
```

Pool modes: `pnp`, `pvp`.
Chezz modes: `pve`, `pvp`.

### `GET /api/state?game_id=...`

Returns the current game state. Pool and Chezz have their own state details.

### `GET /api/replay?game_id=...`

Returns replay entries for one game.

Optional query:

- `include_events=1` to include more replay event detail.

### `GET /api/realtime/stream?game_id=...`

Server-sent events for live updates.

Optional query:

- `since_seq=12` to resume after a known event sequence.

## Chat and Game Actions

### `GET /api/chat?game_id=...`

Returns chat rows.

Optional query:

- `since_id=10` to fetch newer messages only.

### `GET /api/chat/queue?game_id=...`

Returns chat queue state for the game.

### `POST /api/chat`

```json
{ "game_id": "game-id", "message": "gl hf" }
```

### `POST /api/game/surrender`

```json
{ "game_id": "game-id", "cause": "manual" }
```

### `POST /api/game/draw-offer`

```json
{ "game_id": "game-id" }
```

### `POST /api/game/draw-respond`

```json
{ "game_id": "game-id", "offer_id": 1, "accept": true }
```

### `POST /api/game/rematch-offer`

```json
{ "game_id": "game-id" }
```

### `POST /api/game/rematch-respond`

```json
{ "game_id": "game-id", "offer_id": 2, "accept": true }
```

## Notes

- Most routes require login.
- The server checks game membership before game actions.
- Use the game-specific docs for Pool and Chezz move routes.
