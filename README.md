<h1 align="center">MindMidas Games</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Phylib-334155?style=for-the-badge&labelColor=e5e9ec&color=334155" alt="Phylib">
  <img src="https://img.shields.io/badge/Negamax-334155?style=for-the-badge&labelColor=e5e9ec&color=334155" alt="Negamax">
  <img src="https://img.shields.io/badge/Bitboards-334155?style=for-the-badge&labelColor=e5e9ec&color=334155" alt="Bitboards">
  <img src="https://img.shields.io/badge/Matchmaking-334155?style=for-the-badge&labelColor=e5e9ec&color=334155" alt="Matchmaking">
  <img src="https://img.shields.io/badge/PvP-334155?style=for-the-badge&labelColor=e5e9ec&color=334155" alt="PvP">
</p>

<p align="center">
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python"></a>
  <a href="https://en.cppreference.com/w/c"><img src="https://img.shields.io/badge/C-555555?style=for-the-badge&logo=c&logoColor=white" alt="C"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind-38B2AC?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"></a>
  <a href="https://www.docker.com/"><img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"></a>
  <a href="https://supabase.com/"><img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase"></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/Postgres-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="Postgres"></a>
  <a href="https://caddyserver.com/"><img src="https://img.shields.io/badge/Caddy-1F88C0?style=for-the-badge&logo=caddy&logoColor=white" alt="Caddy"></a>
</p>

| Pool | Chezz |
|---|---|
| [![Pool demo](./src/pool/pool.gif)](./src/pool/) | [![Chezz demo](./src/chezz/chezz.gif)](./src/chezz/) |

---

# **Overview**

MindMidas Games is a shared web app for two games: **Pool** and **Chezz**.

The main idea was to keep the game engines in C, use Python for the backend/runtime layer, and use TypeScript for the browser client. Pool uses a C physics engine. Chezz uses a C bitboard engine with negamax search.

---

# **What Is Included**

- Pool with pass and play, online PvP, shot replay, and a C physics engine.
- Chezz with PvE, online PvP, custom pieces, and C engine search.
- Shared auth, matchmaking, chat, persistence, game sessions, and frontend shell.
- Supabase/Postgres support for production data.
- Docker and Caddy config for deployment.

---

# **Pre-Requisites**

Ensure the following are installed:

- Python 3.10+
- Node.js 20.19+, 22.13+, or 24+
- npm 10+
- C compiler and Make
- SWIG
- Docker and Compose, only needed for production
- Supabase project values for auth and persistence

---

# **Folder Structure**

```text
games/
|-- assets/
|   `-- github-banner.png
|-- deploy/
|-- src/
|   |-- chezz/
|   |-- db/
|   |-- platform/
|   `-- pool/
|-- build
|-- compose.yaml
|-- setup
`-- README.md
```

Important paths:

- `src/pool/` contains the Pool runtime, README, GIF, and C engine.
- `src/chezz/` contains the Chezz runtime, README, GIF, and C engine.
- `src/platform/` contains the shared Python backend and TypeScript frontend shell.
- `src/db/supabase_schema.sql` contains the database schema.
- `assets/github-banner.png` is the GitHub social preview image.

---

# **How to Build & Run**

Create the environment file:

```bash
cp .env.example .env
```

Fill in the required Supabase and auth values in `.env`.

Build the engines and frontend:

```bash
./build build
```

Start the app:

```bash
./build
```

Open:

```text
http://127.0.0.1:8080
```

The home screen lets you pick Pool or Chezz.

To use another port:

```bash
GAMES_PORT=8081 ./build
```

---

# **Common Commands**

```bash
./build build       # build engines and frontend
./build run         # start without rebuilding
./build restart     # rebuild and restart
./build stop        # stop the local server
./build clean       # remove generated output
./build test        # run Python compile checks and frontend tests
./build typecheck   # run TypeScript checks
./build lint        # run ESLint
./build audit       # run the full validation set
```

---

# **Deployment**

Set the production environment values first:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GAMES_AUTH_PEPPER`
- `DOMAIN`
- `GAMES_ENV=production`
- `GAMES_ALLOWED_HOSTS`
- `GAMES_TRUSTED_PROXY_IPS`

Then run:

```bash
docker compose up -d --build
```

Check the containers:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

---

# **API Reference**

- [`src/platform/backend/API.md`](src/platform/backend/API.md)
- [`src/pool/runtime/API.md`](src/pool/runtime/API.md)
- [`src/chezz/runtime/API.md`](src/chezz/runtime/API.md)

---

# **Notes**

- The default local port is `8080`.
- `./setup` is mainly for Ubuntu setup.
- Pool defaults to pass and play mode.
- Chezz defaults to PvE mode.
- Online play needs the Supabase values to be configured.
