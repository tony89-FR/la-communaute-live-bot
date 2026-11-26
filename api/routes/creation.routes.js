module.exports = function registerCreationRoutes(app, context) {
    const {
        discordAuth,
        requireSitePermission,
        creationService,
        getGuild,
        handleRouteError
    } = context;

    // La création d'événements Discord reste disponible depuis le site.
    // Aucun endpoint d'envoi de message ou d'annonce n'est exposé ici.
    app.post(
        "/creation/event",
        discordAuth,
        requireSitePermission("create_event"),
        async (req, res) => {
            try {
                const guild = await getGuild();
                const actor = await guild.members.fetch(req.discordMember.id);
                const result = await creationService.createEvent({
                    title: req.body?.title,
                    description: req.body?.description,
                    location: req.body?.location,
                    startAt: req.body?.startAt,
                    endAt: req.body?.endAt,
                    actorName: actor.displayName || actor.user.username
                });
                return res.json(result);
            } catch (error) {
                return handleRouteError(res, error, "Impossible de créer l'événement Discord.");
            }
        }
    );
};
