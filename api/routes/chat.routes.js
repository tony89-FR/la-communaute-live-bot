module.exports = function registerChatRoutes(app, context) {
    const {
        discordAuth,
        requireSitePermission,
        getGuild,
        getBotMember,
        handleRouteError,
        isSnowflake,
        PermissionFlagsBits
    } = context;

app.get(
    "/chat/channels",
    discordAuth,
    requireSitePermission("discord_mobile"),
    async (req, res) => {
        try {
            const guild = await getGuild();
            const member = await guild.members.fetch(req.discordMember.id);
            const botMember = await getBotMember(guild);
            const fetchedChannels = await guild.channels.fetch();

            const channels = [...fetchedChannels.values()]
                .filter(channel => {
                    if (
                        !channel ||
                        channel.guildId !== guild.id ||
                        ![0, 2, 5, 13].includes(channel.type)
                    ) {
                        return false;
                    }

                    const userPermissions = channel.permissionsFor(member);
                    const botPermissions = channel.permissionsFor(botMember);

                    if (!userPermissions || !botPermissions) {
                        return false;
                    }

                    if ([2, 13].includes(channel.type)) {
                        // Salon vocal ou salon de conférence (Stage).
                        return (
                            userPermissions.has(PermissionFlagsBits.ViewChannel) &&
                            userPermissions.has(PermissionFlagsBits.Connect) &&
                            botPermissions.has(PermissionFlagsBits.ViewChannel)
                        );
                    }

                    // Salon texte ou annonces.
                    return (
                        userPermissions.has(PermissionFlagsBits.ViewChannel) &&
                        userPermissions.has(PermissionFlagsBits.ReadMessageHistory) &&
                        botPermissions.has(PermissionFlagsBits.ViewChannel) &&
                        botPermissions.has(PermissionFlagsBits.ReadMessageHistory)
                    );
                })
                .sort((a, b) =>
                    (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1) ||
                    a.rawPosition - b.rawPosition
                )
                .map(channel => {
                    const isVoice = [2, 13].includes(channel.type);

                    const base = {
                        id: channel.id,
                        name: channel.name,
                        type: channel.type,
                        kind: isVoice ? "voice" : "text",
                        categoryId: channel.parentId,
                        categoryName: channel.parent?.name || "Salons sans catégorie",
                        categoryPosition: channel.parent?.rawPosition ?? -1,
                        position: channel.rawPosition
                    };

                    if (!isVoice) {
                        return base;
                    }

                    const voiceUsers = [...channel.members.values()].map(voiceMember => {
                        const voiceState = guild.voiceStates.cache.get(voiceMember.id);

                        return {
                            id: voiceMember.id,
                            username: voiceMember.user.username,
                            displayName: voiceMember.displayName || voiceMember.user.globalName || voiceMember.user.username,
                            avatar: voiceMember.user.displayAvatarURL({
                                extension: "png",
                                size: 64
                            }),
                            selfMute: Boolean(voiceState?.selfMute),
                            selfDeaf: Boolean(voiceState?.selfDeaf),
                            serverMute: Boolean(voiceState?.serverMute),
                            serverDeaf: Boolean(voiceState?.serverDeaf),
                            streaming: Boolean(voiceState?.streaming),
                            video: Boolean(voiceState?.selfVideo)
                        };
                    }).sort((a, b) => a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" }));

                    return {
                        ...base,
                        voiceUsers,
                        userCount: voiceUsers.length,
                        userLimit: channel.userLimit || 0,
                        bitrate: channel.bitrate || 0
                    };
                });

            return res.json({ channels });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Impossible de récupérer les salons Discord."
            );
        }
    }
);

// Recherche de membres pour les suggestions quand on tape @pseudo.
app.get(
    "/chat/members",
    discordAuth,
    requireSitePermission("discord_mobile"),
    async (req, res) => {
        try {
            const query = String(req.query.q || "").trim().slice(0, 32);

            if (!query) {
                return res.json({ members: [] });
            }

            const guild = await getGuild();
            const results = await guild.members.search({
                query,
                limit: 10
            });

            const members = [...results.values()].map(member => ({
                id: member.id,
                username: member.user.username,
                displayName: member.displayName,
                avatar: member.user.displayAvatarURL({
                    extension: "png",
                    size: 64
                })
            }));

            return res.json({ members });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Impossible de rechercher les membres Discord."
            );
        }
    }
);

// Charger les 50 derniers messages avec les noms réels des mentions.
app.get(
    "/chat/channels/:channelId/messages",
    discordAuth,
    requireSitePermission("discord_mobile"),
    async (req, res) => {
        try {
            const channelId = String(req.params.channelId || "");

            if (!isSnowflake(channelId)) {
                return res.status(400).json({
                    error: "Identifiant de salon invalide."
                });
            }

            const guild = await getGuild();
            const member = await guild.members.fetch(req.discordMember.id);
            const botMember = await getBotMember(guild);
            const channel = await guild.channels.fetch(channelId);

            if (
                !channel ||
                channel.guildId !== guild.id ||
                ![0, 5].includes(channel.type)
            ) {
                return res.status(404).json({
                    error: "Ce salon texte est introuvable."
                });
            }

            const userPermissions = channel.permissionsFor(member);
            const botPermissions = channel.permissionsFor(botMember);

            if (
                !userPermissions ||
                !userPermissions.has(PermissionFlagsBits.ViewChannel) ||
                !userPermissions.has(PermissionFlagsBits.ReadMessageHistory)
            ) {
                return res.status(403).json({
                    error: "Tu n'as pas accès à ce salon."
                });
            }

            if (
                !botPermissions ||
                !botPermissions.has(PermissionFlagsBits.ViewChannel) ||
                !botPermissions.has(PermissionFlagsBits.ReadMessageHistory)
            ) {
                return res.status(403).json({
                    error: "Le bot ne peut pas lire les messages de ce salon."
                });
            }

            const fetchedMessages = await channel.messages.fetch({ limit: 50 });

            const messages = [...fetchedMessages.values()]
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                .map(message => {
                    const authorMember =
                        message.member ||
                        guild.members.cache.get(message.author.id);

                    return {
                        id: message.id,
                        content: message.content,
                        authorId: message.author.id,
                        authorName:
                            authorMember?.displayName ||
                            message.author.globalName ||
                            message.author.username,
                        authorUsername: message.author.username,
                        authorAvatar: message.author.displayAvatarURL({
                            extension: "png",
                            size: 64
                        }),
                        // Garder aussi l'objet imbriqué pour compatibilité.
                        author: {
                            id: message.author.id,
                            username: message.author.username,
                            displayName:
                                authorMember?.displayName ||
                                message.author.globalName ||
                                message.author.username,
                            avatar: message.author.displayAvatarURL({
                                extension: "png",
                                size: 64
                            }),
                            bot: message.author.bot
                        },
                        timestamp: message.createdAt.toISOString(),
                        attachments: [...message.attachments.values()].map(attachment => ({
                            name: attachment.name || "Fichier joint",
                            url: attachment.url,
                            contentType: attachment.contentType || null,
                            size: attachment.size || null
                        })),
                        // Certaines publications de bots (ex. Instant Gaming) sont
                        // des embeds sans texte dans message.content : transmettre
                        // les champs nécessaires pour que discord.html les affiche.
                        embeds: (message.embeds || []).map(embed => ({
                            title: embed.title || "",
                            description: embed.description || "",
                            url: embed.url || null,
                            color: Number.isInteger(embed.color) ? embed.color : null,
                            provider: embed.provider ? {
                                name: embed.provider.name || ""
                            } : null,
                            author: embed.author ? {
                                name: embed.author.name || "",
                                url: embed.author.url || null,
                                iconURL: embed.author.iconURL || null
                            } : null,
                            thumbnail: embed.thumbnail?.url ? {
                                url: embed.thumbnail.url
                            } : null,
                            image: embed.image?.url ? {
                                url: embed.image.url
                            } : null,
                            footer: embed.footer ? {
                                text: embed.footer.text || "",
                                iconURL: embed.footer.iconURL || null
                            } : null,
                            timestamp: embed.timestamp || null,
                            fields: (embed.fields || []).map(field => ({
                                name: field.name || "",
                                value: field.value || "",
                                inline: Boolean(field.inline)
                            }))
                        })),
                        mentions: {
                            users: [...message.mentions.users.values()].map(user => ({
                                id: user.id,
                                name:
                                    message.mentions.members?.get(user.id)?.displayName ||
                                    user.globalName ||
                                    user.username
                            })),
                            roles: [...message.mentions.roles.values()].map(role => ({
                                id: role.id,
                                name: role.name
                            })),
                            channels: [...message.mentions.channels.values()].map(mentionedChannel => ({
                                id: mentionedChannel.id,
                                name: mentionedChannel.name
                            }))
                        }
                    };
                });

            return res.json({
                channel: { id: channel.id, name: channel.name },
                count: messages.length,
                messages
            });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Impossible de récupérer les messages du salon."
            );
        }
    }
);

// Envoyer un message. L'envoi est effectué par le bot, après vérification
// des permissions du compte connecté et du bot dans le salon sélectionné.
app.post(
    "/chat/channels/:channelId/messages",
    discordAuth,
    requireSitePermission("discord_mobile"),
    async (req, res) => {
        try {
            const channelId = String(req.params.channelId || "");
            let content = typeof req.body?.content === "string"
                ? req.body.content.trim()
                : "";

            if (!isSnowflake(channelId)) {
                return res.status(400).json({
                    error: "Identifiant de salon invalide."
                });
            }

            if (!content) {
                return res.status(400).json({
                    error: "Écris un message avant de l'envoyer."
                });
            }

            if (content.length > 2000) {
                return res.status(400).json({
                    error: "Le message ne peut pas dépasser 2000 caractères."
                });
            }

            const guild = await getGuild();
            const member = await guild.members.fetch(req.discordMember.id);
            const botMember = await getBotMember(guild);
            const channel = await guild.channels.fetch(channelId);

            if (
                !channel ||
                channel.guildId !== guild.id ||
                ![0, 5].includes(channel.type)
            ) {
                return res.status(404).json({
                    error: "Ce salon texte est introuvable."
                });
            }

            const userPermissions = channel.permissionsFor(member);
            const botPermissions = channel.permissionsFor(botMember);

            if (
                !userPermissions ||
                !userPermissions.has(PermissionFlagsBits.ViewChannel) ||
                !userPermissions.has(PermissionFlagsBits.SendMessages)
            ) {
                return res.status(403).json({
                    error: "Tu n'as pas le droit d'écrire dans ce salon."
                });
            }

            if (
                !botPermissions ||
                !botPermissions.has(PermissionFlagsBits.ViewChannel) ||
                !botPermissions.has(PermissionFlagsBits.SendMessages)
            ) {
                return res.status(403).json({
                    error: "Le bot n'a pas le droit d'écrire dans ce salon."
                });
            }

            const requestedIds = Array.isArray(req.body?.mentionUserIds)
                ? [...new Set(req.body.mentionUserIds.map(String))].slice(0, 10)
                : [];

            const allowedUserMentions = [];

            for (const userId of requestedIds) {
                if (!isSnowflake(userId)) continue;

                try {
                    const target = await guild.members.fetch(userId);
                    const visibleMention = `@${target.user.username}`;
                    const escapedMention = visibleMention.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&"
                    );
                    const mentionPattern = new RegExp(
                        `(^|\\s)${escapedMention}(?=\\s|$|[,!.?;:])`,
                        "g"
                    );
                    let replaced = false;

                    content = content.replace(
                        mentionPattern,
                        (match, prefix) => {
                            replaced = true;
                            return `${prefix}<@${target.id}>`;
                        }
                    );

                    if (replaced) {
                        allowedUserMentions.push(target.id);
                    }
                } catch {
                    // Ignore les membres qui ne sont plus présents sur le serveur.
                }
            }

            const sentMessage = await channel.send({
                content,
                allowedMentions: {
                    parse: [],
                    users: allowedUserMentions,
                    roles: [],
                    repliedUser: false
                }
            });

            console.log(
                `💬 Message depuis le site : ${member.user.tag} -> #${channel.name}`
            );

            return res.json({
                ok: true,
                messageId: sentMessage.id,
                message: "Message envoyé par le bot."
            });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Erreur pendant l'envoi du message."
            );
        }
    }
);
};
