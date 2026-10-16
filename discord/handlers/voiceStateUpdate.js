const { Events } = require("discord.js");

module.exports = function registerVoiceStateUpdate(client, sanctions) {
    client.on(Events.VoiceStateUpdate, sanctions.handleVoiceStateUpdate);
};
