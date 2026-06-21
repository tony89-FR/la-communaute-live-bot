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
    },
    {
        name: "🟧 Modérateur test",
        id: "1478757828637360251"
    },
    ];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.once(Events.ClientReady, () => {
    console.log(`✅ Connecté : ${client.user.tag}`);
});

app.get("/", (req, res) => {
    res.send("API La communauté live opérationnelle");
});

app.get("/events", async (req, res) => {

    try {

        const guild = await client.guilds.fetch(GUILD_ID);

        const events = await guild.scheduledEvents.fetch();

        const result = [...events.values()].map(event => ({

            name: event.name,
            description: event.description || "",
            startTime: event.scheduledStartTimestamp

        }));

        res.json(result);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: "Impossible de récupérer les événements"
        });

    }

});

app.get("/staff", async (req, res) => {

    try {

        const guild = await client.guilds.fetch(GUILD_ID);

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

        res.json(staff);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: "Impossible de récupérer le staff"
        });

    }

});

app.listen(PORT, () => {

    console.log(`🌍 Serveur web lancé sur le port ${PORT}`);

});

client.login(process.env.DISCORD_TOKEN);
