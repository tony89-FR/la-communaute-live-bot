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
        GatewayIntentBits.GuildMembers
    ]
});

const app = express();

app.use(cors());

const PORT = process.env.PORT || 3000;

const { GUILD_ID, STAFF_ROLES } = require("./config/config");
const { updateStaff } = require("./config/staff");
const { updateEvents } = require("./services/events");

let eventsCache = [];
let staffCache = [];

client.once(Events.ClientReady, async () => {

    console.log(`✅ Connecté : ${client.user.tag}`);
    
    eventsCache = await updateEvents(client, GUILD_ID);
    staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);

    setInterval(async () => {
    eventsCache = await updateEvents(client, GUILD_ID);
}, 5 * 60 * 1000);
    
    setInterval(async () => {
        staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
    }, 30 * 60 * 1000);

});

client.on(Events.GuildMemberUpdate, async () => {

    console.log("🔄 Un membre a été mis à jour");

    staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);

});

client.on(Events.GuildMemberAdd, async () => {

    console.log("➕ Nouveau membre");

    staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);

});

client.on(Events.GuildMemberRemove, async () => {

    console.log("➖ Membre parti");

    staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);

});

app.get("/", (req, res) => {

    res.send("API La communauté live opérationnelle");

});

app.get("/events", (req, res) => {

    res.json(eventsCache);

});

app.get("/staff", (req, res) => {

    res.json(staffCache);

});

app.listen(PORT, () => {

    console.log(`🌍 Serveur web lancé sur le port ${PORT}`);

});

client.login(process.env.DISCORD_TOKEN);
