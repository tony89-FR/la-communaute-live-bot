const { Events } = require("discord.js");
const { announceLevelUps } = require("./xpAnnouncements");

module.exports = function registerXpMessageCreate(client, context) {
    const { GUILD_ID, xpService, LEVEL_UP_CHANNEL_ID } = context;

    client.on(Events.MessageCreate, async message => {
        if (!message.guild || message.guild.id !== GUILD_ID) return;

        try {
            const result = xpService.awardMessage(message);
            if (result && result.levelsGained.length > 0) {
                await announceLevelUps(
                    client,
                    GUILD_ID,
                    message.author.id,
                    result.levelsGained,
                    LEVEL_UP_CHANNEL_ID
                );
            }
        } catch (error) {
            console.error("Erreur attribution XP message :", error);
        }
    });
};
