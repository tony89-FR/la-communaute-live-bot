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
    async function createAnnouncement({ title, message, url, actorName }) {
        const cleanTitle = cleanText(title);
        const cleanMessage = cleanText(message);
        const cleanUrl = cleanText(url);
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

        const lines = [
            `📢 **${cleanTitle}**`,
            cleanMessage,
            ...(safeUrl ? [`🔗 ${safeUrl}`] : []),
            `— Annonce publiée par ${author}`
        ];
        const content = lines.join("\n\n");
        if (content.length > 2000) {
            throw httpError(400, "Le message final dépasse la limite Discord de 2 000 caractères. Raccourcis le texte ou le lien.");
        }

        const sent = await channel.send({
            content,
            allowedMentions: { parse: [], users: [], roles: [], repliedUser: false }
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
