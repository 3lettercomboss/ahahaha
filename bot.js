// ============================================================
//  Discord → Roblox Global Announcement Bot
//  
//  /announce message:"your text here"  →  queues it
//  Bot looks up the sender's Discord ID in a table to find
//  their Roblox user ID, which is sent in the payload so the
//  game can fetch display name, headshot, and role tags.
//
//  Roblox servers poll GET /announcements to pick up new ones
// ============================================================

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  REST,
  Routes,
} = require("discord.js");

const http = require("http");
require("dotenv").config();

// ── Config ───────────────────────────────────────────────────
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const CLIENT_ID       = process.env.CLIENT_ID;
const GUILD_ID        = process.env.GUILD_ID;
const API_PORT        = process.env.API_PORT || 3000;
const API_SECRET      = process.env.API_SECRET || "";
const ANNOUNCE_ROLE   = process.env.ANNOUNCE_ROLE_ID;

// ══════════════════════════════════════════════════════════════
//  DISCORD → ROBLOX ID LOOKUP TABLE
//
//  Add entries here:  "DISCORD_USER_ID": ROBLOX_USER_ID
//
//  To find a Discord ID:  Enable Developer Mode in Discord
//    Settings → App Settings → Advanced → Developer Mode
//    Then right-click a user → Copy User ID
//
//  To find a Roblox ID:  Go to the player's Roblox profile,
//    the number in the URL is their ID
//    e.g. https://www.roblox.com/users/123456789/profile
// ══════════════════════════════════════════════════════════════
const DISCORD_TO_ROBLOX = {
  "123456789012345678": 123456789,   // Example — replace with real IDs
  "987654321098765432": 987654321,   // Add as many as you need
  // "DISCORD_ID": ROBLOX_ID,
};

// ── In-memory announcement queue ─────────────────────────────
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

let announcements = [];

function pruneOld() {
  const cutoff = Date.now() - EXPIRY_MS;
  announcements = announcements.filter((a) => a.timestamp > cutoff);
}

// ── Discord client ───────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`✅  Logged in as ${client.user.tag}`);

  const command = new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a global announcement to all Roblox servers")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The announcement message to send")
        .setRequired(true)
        .setMaxLength(2000)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

  const rest = new REST().setToken(DISCORD_TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: [command.toJSON()],
      });
      console.log(`📌  Slash command registered for guild ${GUILD_ID}`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: [command.toJSON()],
      });
      console.log("🌍  Slash command registered globally (may take ~1 hr)");
    }
  } catch (err) {
    console.error("Failed to register command:", err);
  }
});

// ── Handle /announce interaction ─────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "announce") return;

  // Optional: restrict to a specific role
  if (ANNOUNCE_ROLE && !interaction.member.roles.cache.has(ANNOUNCE_ROLE)) {
    return interaction.reply({
      content: "❌ You don't have the required role to send announcements.",
      ephemeral: true,
    });
  }

  // Look up the sender's Roblox ID
  const discordId = interaction.user.id;
  const robloxId = DISCORD_TO_ROBLOX[discordId] || null;

  if (!robloxId) {
    return interaction.reply({
      content: "❌ Your Discord account is not linked to a Roblox ID. Ask an admin to add your ID to the bot.",
      ephemeral: true,
    });
  }

  const message = interaction.options.getString("message");

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    discordId,
    discordTag: interaction.user.tag,
    robloxId,
    timestamp: Date.now(),
  };

  announcements.push(entry);
  console.log(`📢  Announcement from ${entry.discordTag} (Roblox ${robloxId}): ${message.slice(0, 60)}…`);

  const embed = new EmbedBuilder()
    .setTitle("📢 Announcement Sent")
    .setColor(0x00b0f4)
    .addFields(
      { name: "Author",    value: entry.discordTag,     inline: true },
      { name: "Roblox ID", value: String(robloxId),     inline: true },
      { name: "Message",   value: message.slice(0, 1024) }
    )
    .setFooter({ text: `ID: ${entry.id} • Expires in 5 min` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
});

// ── HTTP API for Roblox servers ──────────────────────────────
//
//  GET /announcements?secret=XXX&after=TIMESTAMP
//
//  Response:
//  {
//    "announcements": [
//      {
//        "id": "...",
//        "message": "Double XP!",
//        "discordId": "123456789012345678",
//        "discordTag": "Admin#0001",
//        "robloxId": 123456789,        ← use this in-game
//        "timestamp": 1709856000000
//      }
//    ]
//  }
//
//  In your Roblox game, use robloxId to:
//    - Get display name via Players:GetNameFromUserIdAsync(robloxId)
//    - Get headshot via Players:GetUserThumbnailAsync(robloxId, ...)
//    - Check your own role table for [OWNER] tag etc.
// ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${API_PORT}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", queued: announcements.length }));
  }

  if (url.pathname === "/announcements" && req.method === "GET") {
    if (API_SECRET && url.searchParams.get("secret") !== API_SECRET) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid secret" }));
    }

    pruneOld();

    const after = parseInt(url.searchParams.get("after") || "0", 10);
    const fresh = announcements.filter((a) => a.timestamp > after);

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ announcements: fresh }));
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(API_PORT, () => {
  console.log(`🌐  HTTP API listening on port ${API_PORT}`);
});

client.login(DISCORD_TOKEN);
