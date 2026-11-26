const { Events } = require("discord.js");

module.exports = function registerGuildMemberEvents(client, context) {
    const { GUILD_ID, STAFF_ROLES, updateStaff, updateStats, siteData } = context;

    async function refreshStaffAndStats() {
        try {
            siteData.setStaff(await updateStaff(client, GUILD_ID, STAFF_ROLES));
            siteData.setStats(await updateStats(client, GUILD_ID));
        } catch (error) {
            console.error("Erreur actualisation membres/stats :", error);
        }
    }

    client.on(Events.GuildMemberAdd, refreshStaffAndStats);
    client.on(Events.GuildMemberRemove, refreshStaffAndStats);
    client.on(Events.GuildMemberUpdate, refreshStaffAndStats);
};
