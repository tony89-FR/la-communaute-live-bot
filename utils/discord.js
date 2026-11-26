function createDiscordUtils(client, GUILD_ID) {
    async function getGuild() {
        return client.guilds.fetch(GUILD_ID);
    }

    async function getBotMember(guild) {
        return guild.members.me || guild.members.fetchMe();
    }

    return { getGuild, getBotMember };
}

module.exports = { createDiscordUtils };
