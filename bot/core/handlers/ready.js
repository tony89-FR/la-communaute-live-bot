const { Events } = require("discord.js");

module.exports = function registerReadyHandler(client, context) {
    const {
        GUILD_ID,
        STAFF_ROLES,
        ANNOUNCEMENTS_CHANNEL_ID,
        RULES_CHANNEL_ID,
        updateStaff,
        updateEvents,
        updateStats,
        updateAnnouncements,
        updateRules,
        siteData,
        sanctions
    } = context;

    client.once(Events.ClientReady, async () => {
        console.log(`✅ Connecté : ${client.user.tag}`);

        await sanctions.resumeActiveSanctions();
        setInterval(() => {
            sanctions.expireDueSanctions().catch(error =>
                console.error("Erreur vérification sanctions :", error)
            );
        }, 15 * 1000);

        try {
            siteData.setEvents(await updateEvents(client, GUILD_ID));
            siteData.setStaff(await updateStaff(client, GUILD_ID, STAFF_ROLES));
            siteData.setStats(await updateStats(client, GUILD_ID));
            siteData.setAnnouncements(await updateAnnouncements(client, ANNOUNCEMENTS_CHANNEL_ID));
            siteData.setRules(await updateRules(client, RULES_CHANNEL_ID));
            console.log("✅ Toutes les données sont chargées.");
        } catch (error) {
            console.error("Erreur de chargement initial :", error);
        }

        // Événements : toutes les 5 minutes
        setInterval(async () => {
            try {
                siteData.setEvents(await updateEvents(client, GUILD_ID));
            } catch (error) {
                console.error("Erreur mise à jour événements :", error);
            }
        }, 5 * 60 * 1000);

        // Statistiques : toutes les 5 minutes
        setInterval(async () => {
            try {
                siteData.setStats(await updateStats(client, GUILD_ID));
            } catch (error) {
                console.error("Erreur mise à jour statistiques :", error);
            }
        }, 5 * 60 * 1000);

        // Staff : toutes les 30 minutes
        setInterval(async () => {
            try {
                siteData.setStaff(await updateStaff(client, GUILD_ID, STAFF_ROLES));
            } catch (error) {
                console.error("Erreur mise à jour staff :", error);
            }
        }, 30 * 60 * 1000);

        // Annonces : toutes les minutes
        setInterval(async () => {
            try {
                siteData.setAnnouncements(await updateAnnouncements(client, ANNOUNCEMENTS_CHANNEL_ID));
            } catch (error) {
                console.error("Erreur mise à jour annonces :", error);
            }
        }, 60 * 1000);

        // Règlement : toutes les minutes
        setInterval(async () => {
            try {
                siteData.setRules(await updateRules(client, RULES_CHANNEL_ID));
            } catch (error) {
                console.error("Erreur mise à jour règlement :", error);
            }
        }, 60 * 1000);
    });
};
