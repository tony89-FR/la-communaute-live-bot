async function updateEvents(client, GUILD_ID) {

    try {

        const guild = client.guilds.cache.get(GUILD_ID);

        if (!guild) return [];

        const events = await guild.scheduledEvents.fetch();

        const eventsCache = [...events.values()].map(event => ({

            name: event.name,
            description: event.description || "",
            startTime: event.scheduledStartTimestamp

        }));

        console.log(`📅 ${eventsCache.length} événement(s) synchronisé(s)`);

        return eventsCache;

    } catch (err) {

        console.error("Erreur updateEvents :", err);

        return [];

    }

}

module.exports = {
    updateEvents
};
