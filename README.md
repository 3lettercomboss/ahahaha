# Discord → Roblox Global Announcement Bot

A Discord bot with a `/announce` slash command that opens a modal dialog, queues the message, and exposes an HTTP API that your Roblox game servers can poll to display global announcements.

## Architecture

```
Discord (/announce)  →  Bot queues message  →  HTTP API
                                                   ↑
                                          Roblox servers poll
                                          every 5 seconds
```

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it → go to **Bot** tab
3. Click **Reset Token** → copy the token
4. Under **Privileged Gateway Intents**, no special intents needed
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`
6. Copy the generated URL and open it to invite the bot to your server

### 2. Configure the Bot

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Your bot token from step 1 |
| `CLIENT_ID` | Your application ID (found on General Information page) |
| `GUILD_ID` | Your Discord server ID (right-click server → Copy ID) |
| `API_PORT` | Port for the HTTP API (default: 3000) |
| `API_SECRET` | A random string shared between bot and Roblox script |
| `ANNOUNCE_ROLE_ID` | (Optional) Only this role can use /announce |

### 3. Install & Run

```bash
npm install
npm start
```

### 4. Roblox Side (You handle this)

The file `roblox-script.lua` is a reference script. Place it in **ServerScriptService** and update:

- `BOT_URL` → your server's public URL/IP
- `API_SECRET` → same secret as your `.env`
- Enable **HttpService** in Game Settings → Security

## API Reference

### `GET /announcements`

| Param | Description |
|---|---|
| `secret` | Your API_SECRET |
| `after` | Timestamp — only returns announcements newer than this |

**Response:**
```json
{
  "announcements": [
    {
      "id": "1234567890-abc123",
      "title": "Server Update",
      "message": "Double XP weekend starts now!",
      "author": "Admin#0001",
      "timestamp": 1709856000000
    }
  ]
}
```

### `GET /health`

Returns `{ "status": "ok", "queued": 2 }`

## How It Works

1. Admin runs `/announce` in Discord
2. A modal pops up with Title + Message fields
3. On submit, the message is queued in memory (expires after 5 min)
4. Roblox servers poll `GET /announcements?after=<lastTimestamp>` every 5 seconds
5. New announcements are shown as system chat messages to all players

## Notes

- Announcements expire after **5 minutes** (configurable in `bot.js` → `EXPIRY_MS`)
- The queue is in-memory — restarting the bot clears it
- For production, host on a VPS/cloud server with a public IP or domain
- The `/announce` command is restricted to users with **Administrator** permission by default
