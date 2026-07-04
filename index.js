require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
    Client,
    GatewayIntentBits,
    Events
} = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const app = express();

app.use(cors());

const PORT = process.env.PORT || 3000;

const {
    GUILD_ID,
    STAFF_ROLES,
    ANNOUNCEMENTS_CHANNEL_ID
} = require("./config/config");

const { updateStaff } = require("./config/staff");
const { updateEvents } = require("./services/events");
const { updateStats } = require("./services/stats");
const { updateAnnouncements } = require("./services/annonces");

// Cache
let eventsCache = [];
let staffCache = [];
let statsCache = {};
let announcementsCache = [];

client.once(Events.ClientReady, async () => {

    console.log(`✅ Connecté : ${client.user.tag}`);

    // Chargement initial
    eventsCache = await updateEvents(client, GUILD_ID);
    staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
    statsCache = await updateStats(client, GUILD_ID);

    announcementsCache = await updateAnnouncements(
        client,
        ANNOUNCEMENTS_CHANNEL_ID
    );

    console.log("✅ Toutes les données sont chargées.");

    // Événements
    setInterval(async () => {
        eventsCache = await updateEvents(client, GUILD_ID);
    }, 5 * 60 * 1000);

    // Statistiques
    setInterval(async () => {
        statsCache = await updateStats(client, GUILD_ID);
    }, 5 * 60 * 1000);

    // Staff
    setInterval(async () => {
        staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
    }, 30 * 60 * 1000);

    // Annonces
    setInterval(async () => {

        announcementsCache = await updateAnnouncements(
            client,
            ANNOUNCEMENTS_CHANNEL_ID
        );

    }, 60 * 1000);

});

// Mise à jour automatique du staff
client.on(Events.GuildMemberUpdate, async () => {

    staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);

});

client.on(Events.GuildMemberAdd, async () => {

    staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
    statsCache = await updateStats(client, GUILD_ID);

});

client.on(Events.GuildMemberRemove, async () => {

    staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
    statsCache = await updateStats(client, GUILD_ID);

});

// Routes API

app.get("/", (req, res) => {

    res.send("API La communauté live opérationnelle 🚀");

});

app.get("/stats", (req, res) => {

    res.json(statsCache);

});

app.get("/events", (req, res) => {

    res.json(eventsCache);

});

app.get("/staff", (req, res) => {

    res.json(staffCache);

});

app.get("/annonces", (req, res) => {

    res.json(announcementsCache);

});

app.listen(PORT, () => {

    console.log(`🌍 Serveur lancé sur le port ${PORT}`);

});

client.login(process.env.DISCORD_TOKEN);
