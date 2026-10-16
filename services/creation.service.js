const {
    GuildScheduledEventEntityType,
    GuildScheduledEventPrivacyLevel
} = require("discord.js");

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function parseDate(value, label) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
        throw httpError(400, `La date « ${label} » est invalide.`);
    }
    return date;
}

function createCreationService({
    client,
    GUILD_ID,
    ANNOUNCEMENTS_CHANNEL_ID,
    PermissionFlagsBits,
    getGuild,
    getBotMember,
    updateEvents,
    updateAnnouncements,
    siteData
}) {
    async function createAnnouncement({ title, message, url, color, imageUrl, thumbnailUrl, footerText, actorName, actor, mentions = [] }) {
        const cleanTitle = cleanText(title);
        const cleanMessage = cleanText(message);
        const cleanUrl = cleanText(url);
        const cleanColor = cleanText(color) || "#5865f2";
        const cleanImageUrl = cleanText(imageUrl);
        const cleanThumbnailUrl = cleanText(thumbnailUrl);
        const cleanFooterText = cleanText(footerText);
        const author = cleanText(actorName) || "Équipe de modération";

        if (cleanTitle.length < 3 || cleanTitle.length > 100) {
            throw httpError(400, "Le titre doit contenir entre 3 et 100 caractères.");
        }
        if (cleanMessage.length < 3 || cleanMessage.length > 1600) {
            throw httpError(400, "Le message doit contenir entre 3 et 1 600 caractères.");
        }

        let safeUrl = "";
        if (cleanUrl) {
            try {
                const parsed = new URL(cleanUrl);
                if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
                safeUrl = parsed.href;
            } catch {
                throw httpError(400, "Le lien doit être une URL valide commençant par https:// ou http://.");
            }
            if (safeUrl.length > 300) {
                throw httpError(400, "Le lien ne peut pas dépasser 300 caractères.");
            }
        }

        if (!/^#[0-9a-fA-F]{6}$/.test(cleanColor)) {
            throw httpError(400, "La couleur doit être un code hexadécimal au format #RRGGBB.");
        }

        function validateOptionalImage(value, label) {
            if (!value) return "";
            if (value.length > 500) throw httpError(400, `${label} ne peut pas dépasser 500 caractères.`);
            try {
                const parsed = new URL(value);
                if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
                return parsed.href;
            } catch {
                throw httpError(400, `${label} doit être une URL valide commençant par https:// ou http://.`);
            }
        }
        const safeImageUrl = validateOptionalImage(cleanImageUrl, "L'image");
        const safeThumbnailUrl = validateOptionalImage(cleanThumbnailUrl, "La miniature");
        if (cleanFooterText.length > 1800) {
            throw httpError(400, "Le pied de page ne peut pas dépasser 1 800 caractères.");
        }

        if (!ANNOUNCEMENTS_CHANNEL_ID) {
            throw httpError(500, "Le salon des annonces n'est pas configuré dans config/config.js.");
        }

        const guild = await getGuild();
        const channel = await guild.channels.fetch(ANNOUNCEMENTS_CHANNEL_ID).catch(() => null);
        if (!channel || typeof channel.send !== "function" || channel.guildId !== guild.id) {
            throw httpError(500, "Le salon configuré pour les annonces est introuvable ou n'est pas un salon textuel.");
        }

        const botMember = await getBotMember(guild);
        const channelPermissions = channel.permissionsFor(botMember);
        if (
            !channelPermissions ||
            !channelPermissions.has(PermissionFlagsBits.ViewChannel) ||
            !channelPermissions.has(PermissionFlagsBits.SendMessages)
        ) {
            throw httpError(500, "Le bot doit avoir les permissions Voir le salon et Envoyer des messages dans le salon des annonces.");
        }

        // Seules les mentions explicitement choisies dans le formulaire sont autorisées.
        if (!Array.isArray(mentions) || mentions.length > 30) {
            throw httpError(400, "La liste de mentions est invalide ou trop longue.");
        }
        const allowedUserIds = new Set();
        const allowedRoleIds = new Set();
        const seenRefs = new Set();
        const actorCanMentionRoles = Boolean(
            actor && channel.permissionsFor(actor)?.has(PermissionFlagsBits.MentionEveryone)
        );

        for (const ref of mentions) {
            if (!ref || !["user", "role"].includes(ref.type) || typeof ref.id !== "string" || !/^\d{17,20}$/.test(ref.id)) {
                throw httpError(400, "Une mention sélectionnée est invalide.");
            }
            const key = `${ref.type}:${ref.id}`;
            if (seenRefs.has(key)) continue;
            seenRefs.add(key);

            if (ref.type === "user") {
                // Ne permettre un ping que si le token de cette personne est bien dans le message.
                if (!new RegExp(`<@!?${ref.id}>`).test(cleanMessage)) continue;
                const targetMember = await guild.members.fetch(ref.id).catch(() => null);
                if (!targetMember) throw httpError(400, "Un membre sélectionné pour une mention n'est plus présent sur le serveur.");
                allowedUserIds.add(targetMember.id);
            } else {
                if (!cleanMessage.includes(`<@&${ref.id}>`)) continue;
                const targetRole = await guild.roles.fetch(ref.id).catch(() => null);
                if (!targetRole || targetRole.id === guild.id || targetRole.managed) {
                    throw httpError(400, "Un rôle sélectionné pour une mention est introuvable ou ne peut pas être mentionné.");
                }
                if (!targetRole.mentionable && !actorCanMentionRoles) {
                    throw httpError(403, `Le rôle « ${targetRole.name} » n'est pas mentionnable. Il faut le rendre mentionnable ou disposer de la permission Discord Mentionner @everyone.`);
                }
                allowedRoleIds.add(targetRole.id);
            }
        }

        // Vérifier les mentions de salons insérées avec # : seul un salon textuel de ce serveur est accepté.
        const channelMentionIds = [...cleanMessage.matchAll(/<#(\d{17,20})>/g)].map(match => match[1]);
        for (const channelId of new Set(channelMentionIds)) {
            const mentionedChannel = await guild.channels.fetch(channelId).catch(() => null);
            if (!mentionedChannel || mentionedChannel.guildId !== guild.id || ![0, 5].includes(mentionedChannel.type)) {
                throw httpError(400, "Un salon choisi avec # est invalide ou n'est plus disponible.");
            }
        }

        // Conserver le format de contenu actuel pour ne pas casser l'affichage des annonces
        // sur le site. Les mentions restent dans le contenu et sont contrôlées ci-dessous.
        const attribution = `— Annonce publiée par ${author}`;
        const lines = [
            `📢 **${cleanTitle}**`,
            cleanMessage,
            ...(safeUrl ? [`🔗 ${safeUrl}`] : []),
            attribution
        ];
        const content = lines.join("\n\n");
        if (content.length > 2000) {
            throw httpError(400, "Le message final dépasse la limite Discord de 2 000 caractères. Raccourcis le texte ou le lien.");
        }

        const footerAttribution = `La communauté live • Publié par ${author}`;
        const footer = [cleanFooterText, footerAttribution].filter(Boolean).join(" | ").slice(0, 2048);
        const embed = {
            title: cleanTitle,
            color: Number.parseInt(cleanColor.slice(1), 16),
            ...(safeUrl ? { url: safeUrl } : {}),
            ...(safeImageUrl ? { image: { url: safeImageUrl } } : {}),
            ...(safeThumbnailUrl ? { thumbnail: { url: safeThumbnailUrl } } : {}),
            ...(footer ? { footer: { text: footer } } : {})
        };

        const sent = await channel.send({
            content,
            embeds: [embed],
            allowedMentions: {
                parse: [],
                users: [...allowedUserIds],
                roles: [...allowedRoleIds],
                repliedUser: false
            }
        });

        try {
            if (typeof updateAnnouncements === "function" && siteData) {
                siteData.setAnnouncements(await updateAnnouncements(client, ANNOUNCEMENTS_CHANNEL_ID));
            }
        } catch (error) {
            // L'annonce a bien été envoyée : un échec de rafraîchissement du cache ne doit pas l'annuler.
            console.error("Annonce publiée, mais le cache des annonces n'a pas pu être actualisé :", error);
        }

        return {
            ok: true,
            message: `Annonce publiée dans #${channel.name}.`,
            messageId: sent.id,
            channelId: channel.id,
            channelName: channel.name
        };
    }

    async function createEvent({ title, description, location, startAt, endAt, actorName }) {
        const name = cleanText(title);
        const details = cleanText(description);
        const place = cleanText(location);
        const author = cleanText(actorName) || "Équipe de modération";

        if (name.length < 3 || name.length > 100) {
            throw httpError(400, "Le nom de l'événement doit contenir entre 3 et 100 caractères.");
        }
        if (details.length > 1000) {
            throw httpError(400, "La description ne peut pas dépasser 1 000 caractères.");
        }
        if (place.length < 1 || place.length > 100) {
            throw httpError(400, "Le lieu doit contenir entre 1 et 100 caractères.");
        }

        const starts = parseDate(startAt, "début");
        const ends = parseDate(endAt, "fin");
        const now = Date.now();
        if (starts.getTime() < now + 60_000) {
            throw httpError(400, "Choisis une date de début située au moins une minute dans le futur.");
        }
        if (ends.getTime() <= starts.getTime()) {
            throw httpError(400, "La date de fin doit être postérieure à la date de début.");
        }
        if (starts.getTime() > now + 365 * 24 * 60 * 60 * 1000) {
            throw httpError(400, "La date de début doit être située dans l'année à venir.");
        }

        const guild = await getGuild();
        const botMember = await getBotMember(guild);
        if (!botMember.permissions.has(PermissionFlagsBits.CreateEvents)) {
            throw httpError(500, "Le bot doit avoir la permission Discord Créer des événements.");
        }

        const event = await guild.scheduledEvents.create({
            name,
            ...(details ? { description: details } : {}),
            scheduledStartTime: starts,
            scheduledEndTime: ends,
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityType: GuildScheduledEventEntityType.External,
            entityMetadata: { location: place },
            reason: `Créé depuis le site par ${author}`.slice(0, 500)
        });

        try {
            if (typeof updateEvents === "function" && siteData) {
                siteData.setEvents(await updateEvents(client, GUILD_ID));
            }
        } catch (error) {
            console.error("Événement créé, mais le cache des événements n'a pas pu être actualisé :", error);
        }

        return {
            ok: true,
            message: "Événement Discord créé avec succès.",
            eventId: event.id,
            eventName: event.name,
            eventUrl: `https://discord.com/events/${GUILD_ID}/${event.id}`,
            startAt: event.scheduledStartAt?.toISOString?.() || starts.toISOString(),
            endAt: event.scheduledEndAt?.toISOString?.() || ends.toISOString()
        };
    }

    return { createAnnouncement, createEvent };
}

module.exports = { createCreationService };
