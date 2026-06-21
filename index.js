require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
    Client,
    GatewayIntentBits,
    Events
} = require("discord.js");

const app = express();

app.use(cors());

const PORT = process.env.PORT || 3000;

const GUILD_ID = "1447249368783523942";

const STAFF_ROLES = [
    {
        name: "👑 Fondateur",
        id: "1447263311375761460"
    },
    {
        name: "✨ Créateur",
        id: "1447264238279196724"
    },
    {
        name: "🛡 Co-Fondateur",
        id: "1485266632270942288"
    },
    {
        name: "💪 Bras droit",
        id: "1448333177947947109"
    },
    {
        name: "🟨 Chef Modérateur",
        id: "1448333720946737368"
    },
    {
        name: "🟧 Modérateur",
        id: "1448334482867355832"
    }
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

let eventsCache = [];
let staffCache = [];

async function updateEvents() {

    try {

        const guild = client.guilds.cache.get(GUILD_ID);

        if (!guild) return;

        const events = await guild.scheduledEvents.fetch();

        eventsCache = [...events.values()].map(event => ({

            name: event.name,
            description: event.description || "",
            startTime: event.scheduledStartTimestamp

        }));

        console.log(`📅 ${eventsCache.length} événement(s) synchronisé(s)`);

    } catch (err) {

        console.error("Erreur updateEvents :", err);

    }

}

async function updateStaff() {

    try {

        const guild = client.guilds.cache.get(GUILD_ID);

        if (!guild) return;

        await guild.members.fetch();

        const staff = [];

        for (const roleInfo of STAFF_ROLES) {

            const role = guild.roles.cache.get(roleInfo.id);

            if (!role) continue;

            const members = role.members.map(member => ({

                id: member.id,
                username: member.user.username,
                displayName: member.displayName,

                avatar: member.user.displayAvatarURL({
                    extension: "png",
                    size: 512
                }),

                profile: `https://discord.com/users/${member.id}`

            }));

            staff.push({

                role: roleInfo.name,
                color: role.hexColor,
                members

            });

        }

        staffCache = staff;

        console.log(`👥 Staff synchronisé (${staff.length} rôle(s))`);

    } catch (err) {

        console.error("Erreur updateStaff :", err);

    }

}

client.once(Events.ClientReady, async () => {

    console.log(`✅ Connecté : ${client.user.tag}`);

    await updateEvents();
    await updateStaff();

    setInterval(updateEvents, 5 * 60 * 1000);
    setInterval(updateStaff, 30 * 60 * 1000);

});

client.on(Events.GuildMemberUpdate, async () => {

    console.log("🔄 Un membre a été mis à jour");

    await updateStaff();

});

client.on(Events.GuildMemberAdd, async () => {

    console.log("➕ Nouveau membre");

    await updateStaff();

});

client.on(Events.GuildMemberRemove, async () => {

    console.log("➖ Membre parti");

    await updateStaff();

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
