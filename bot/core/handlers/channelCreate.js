const { Events } = require("discord.js");

module.exports = function registerChannelCreate(client, sanctions) {
    client.on(Events.ChannelCreate, sanctions.handleChannelCreate);
};
