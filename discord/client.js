const {
    Client,
    GatewayIntentBits
} = require("discord.js");

// Client Discord centralisé. Les handlers sont enregistrés par app.js.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

module.exports = client;
