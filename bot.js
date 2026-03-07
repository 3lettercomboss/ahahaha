// ============================================================
//  Discord → Roblox Global Announcement Bot
//  
//  /announce  →  opens a modal  →  stores the message
//  Roblox servers poll GET /announcements to pick up new ones
// ============================================================

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
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
const GUILD_ID        = process.env.GUILD_ID;        // optional – remove for global
const API_PORT        = process.env.API_PORT || 3000;
const API_SECRET      = process.env.API_SECRET || ""; // shared secret with Roblox
const ANNOUNCE_ROLE   = process.env.ANNOUNCE_ROLE_ID; // optional role restriction

// ── In-memory announcement queue ─────────────────────────────
// Roblox servers poll this; once fetched the announcement is
// kept for EXPIRY_MS so late-joining servers still see it.
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

let announcements = [];
// Each entry: { id, message, author, timestamp }

function pruneOld() {
  const cutoff = Date.now() - EXPIRY_MS;
  announcements = announcements.filter((a) => a.timestamp > cutoff);
}

// ── Discord client ───────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Register the slash command on startup
client.once("ready", async () => {
  console.log(`✅  Logged in as ${client.user.tag}`);

  const command = new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a global announcement to all Roblox servers")
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
  // ---- Slash command → show modal ----
  if (interaction.isChatInputCommand() && interaction.commandName === "announce") {
    // Optional: restrict to a specific role
    if (ANNOUNCE_ROLE && !interaction.member.roles.cache.has(ANNOUNCE_ROLE)) {
      return interaction.reply({
        content: "❌ You don't have the required role to send announcements.",
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("announce_modal")
      .setTitle("📢 Global Announcement");

    const titleInput = new TextInputBuilder()
      .setCustomId("announce_title")
      .setLabel("Title (optional)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Server Update")
      .setRequired(false)
      .setMaxLength(100);

    const messageInput = new TextInputBuilder()
      .setCustomId("announce_message")
      .setLabel("Message")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Type your announcement here…")
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(messageInput)
    );

    return interaction.showModal(modal);
  }

  // ---- Modal submit ----
  if (interaction.isModalSubmit() && interaction.customId === "announce_modal") {
    const title   = interaction.fields.getTextInputValue("announce_title") || "";
    const message = interaction.fields.getTextInputValue("announce_message");

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      message,
      author: interaction.user.tag,
      timestamp: Date.now(),
    };

    announcements.push(entry);
    console.log(`📢  New announcement from ${entry.author}: ${message.slice(0, 60)}…`);

    // Confirmation embed in Discord
    const embed = new EmbedBuilder()
      .setTitle("✅ Announcement Queued")
      .setColor(0x00b0f4)
      .addFields(
        { name: "Title",   value: title || "(none)", inline: true },
        { name: "Author",  value: entry.author,      inline: true },
        { name: "Message", value: message.slice(0, 1024) }
      )
      .setFooter({ text: `ID: ${entry.id} • Expires in 5 min` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
});

// ── HTTP API for Roblox servers ──────────────────────────────
//
//  GET  /announcements?secret=YOUR_SECRET&after=TIMESTAMP
//       → returns announcements newer than `after` (default 0)
//
//  The Roblox script polls this every few seconds.
// ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${API_PORT}`);

  // ---- Health check ----
  if (url.pathname === "/" || url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", queued: announcements.length }));
  }

  // ---- Announcements endpoint ----
  if (url.pathname === "/announcements" && req.method === "GET") {
    // Validate shared secret
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

// ── Start ────────────────────────────────────────────────────
client.login(DISCORD_TOKEN);
