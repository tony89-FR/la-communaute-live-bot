module.exports = function registerCreationRoutes(app, context) {
    const {
        discordAuth,
        requireSitePermission,
        creationService,
        getGuild,
        ANNOUNCEMENTS_CHANNEL_ID,
        PermissionFlagsBits,
        handleRouteError
    } = context;

    // Suggestions @membre/@rôle et #salon pour le formulaire d'annonce.
    app.get(
        "/creation/suggestions",
        discordAuth,
        requireSitePermission("create_announcement"),
        async (req, res) => {
            try {
                const type = String(req.query.type || "");
                const query = String(req.query.q || "").trim().slice(0, 64).toLocaleLowerCase("fr");
                if (!["mention", "channel"].includes(type)) {
                    return res.status(400).json({ error: "Type de suggestion invalide." });
                }

                const guild = await getGuild();
                const actor = await guild.members.fetch(req.discordMember.id);
                const items = [];

                if (type === "mention") {
                    // Les membres sont recherchés côté Discord pour tenir compte des noms actuels.
                    if (query.length >= 1) {
                        try {
                            const searched = await guild.members.search({ query, limit: 8 });
                            for (const member of searched.values()) {
                                items.push({
                                    type: "user",
                                    id: member.id,
                                    label: member.displayName || member.user.globalName || member.user.username,
                                    detail: `@${member.user.username} · Membre`
                                });
                            }
                        } catch (error) {
                            console.warn("Recherche de membres pour les mentions indisponible :", error.message);
                            for (const member of guild.members.cache.values()) {
                                const name = member.displayName || member.user.globalName || member.user.username;
                                if (name.toLocaleLowerCase("fr").includes(query) || member.user.username.toLocaleLowerCase("fr").includes(query)) {
                                    items.push({ type: "user", id: member.id, label: name, detail: `@${member.user.username} · Membre` });
                                    if (items.length >= 8) break;
                                }
                            }
                        }
                    }

                    await guild.roles.fetch().catch(() => null);
                    const announcementChannel = ANNOUNCEMENTS_CHANNEL_ID
                        ? await guild.channels.fetch(ANNOUNCEMENTS_CHANNEL_ID).catch(() => null)
                        : null;
                    const actorChannelPermissions = announcementChannel?.permissionsFor(actor);
                    const actorCanMentionRoles = Boolean(
                        actorChannelPermissions?.has(PermissionFlagsBits.MentionEveryone)
                    );
                    const roles = [...guild.roles.cache.values()]
                        .filter(role => role.id !== guild.id && !role.managed && (role.mentionable || actorCanMentionRoles))
                        .filter(role => !query || role.name.toLocaleLowerCase("fr").includes(query))
                        .sort((a, b) => b.position - a.position)
                        .slice(0, query ? 8 : 12);

                    for (const role of roles) {
                        items.push({
                            type: "role",
                            id: role.id,
                            label: role.name,
                            detail: role.mentionable ? "Rôle mentionnable" : "Rôle · permission Mentionner @everyone requise"
                        });
                    }
                } else {
                    const channels = [...guild.channels.cache.values()]
                        .filter(channel => channel && channel.guildId === guild.id && [0, 5].includes(channel.type))
                        .filter(channel => {
                            const perms = channel.permissionsFor(actor);
                            return perms && perms.has(PermissionFlagsBits.ViewChannel);
                        })
                        .filter(channel => !query || channel.name.toLocaleLowerCase("fr").includes(query))
                        .sort((a, b) => a.rawPosition - b.rawPosition)
                        .slice(0, 15);

                    for (const channel of channels) {
                        items.push({ type: "channel", id: channel.id, label: `#${channel.name}`, detail: channel.type === 5 ? "Salon d'annonces" : "Salon textuel" });
                    }
                }

                return res.json({ items: items.slice(0, 18) });
            } catch (error) {
                return handleRouteError(res, error, "Impossible de charger les suggestions Discord.");
            }
        }
    );

    app.post(
        "/creation/announcement",
        discordAuth,
        requireSitePermission("create_announcement"),
        async (req, res) => {
            try {
                const guild = await getGuild();
                const actor = await guild.members.fetch(req.discordMember.id);
                const result = await creationService.createAnnouncement({
                    title: req.body?.title,
                    message: req.body?.message,
                    url: req.body?.url,
                    mentions: req.body?.mentions,
                    actor,
                    actorName: actor.displayName || actor.user.username
                });
                return res.json(result);
            } catch (error) {
                return handleRouteError(res, error, "Impossible de publier l'annonce.");
            }
        }
    );

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
