async function announceLevelUps(client, guildId, userId, levelsGained, channelId) {
    if (!channelId || !Array.isArray(levelsGained) || levelsGained.length === 0) return;

    try {
        const channel = client.channels.cache.get(channelId)
            || await client.channels.fetch(channelId);

        if (!channel || !channel.isTextBased() || typeof channel.send !== "function") {
            console.error("Le salon d'annonce des niveaux est introuvable ou n'accepte pas les messages.");
            return;
        }

        for (const level of levelsGained) {
            await channel.send({
                content: `🎉 <@${userId}> vient d'atteindre le niveau **${level}** !`,
                allowedMentions: { users: [userId] }
            });
        }
    } catch (error) {
        console.error(`Impossible d'annoncer le niveau de ${userId} :`, error);
    }
}

module.exports = { announceLevelUps };
