async function updateStats(client, GUILD_ID) {

    try {

        const guild = client.guilds.cache.get(GUILD_ID);

        if (!guild) return {};

        const events = await guild.scheduledEvents.fetch();

        return {

            members: guild.memberCount,
            roles: guild.roles.cache.size,
            channels: guild.channels.cache.size,
            events: events.size

        };

    } catch (err) {

        console.error("Erreur updateStats :", err);

        return {};

    }

}

module.exports = {
    updateStats
};
