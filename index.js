require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
    Client,
    GatewayIntentBits,
    Events,
    PermissionFlagsBits
} = require("discord.js");

const {
    GUILD_ID,
    STAFF_ROLES,
    ANNOUNCEMENTS_CHANNEL_ID,
    RULES_CHANNEL_ID
} = require("./config/config");

const { updateStaff } = require("./config/staff");
const { updateEvents } = require("./services/events");
const { updateStats } = require("./services/stats");
const { updateAnnouncements } = require("./services/annonces");
const { updateRules } = require("./services/regles");

const PERMISSIONS = require("./config/permissions");
const { getMemberPermissions } = require("./middleware/permissions");
const { requireDiscordMember } = require("./middleware/discordAuth");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = "https://tony89-fr.github.io";

app.use(cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "25kb" }));

// ======================================================
// CACHES
// ======================================================

let eventsCache = [];
let staffCache = [];
let statsCache = {};
let announcementsCache = [];
let rulesCache = { content: "" };

let membersListCache = null;
let membersListCacheAt = 0;
let membersListPromise = null;

const MEMBERS_CACHE_TTL = 60 * 1000;

const temporaryBanTimers = new Map();
const MAX_TEMP_BAN_MINUTES = 7 * 24 * 60;

// ======================================================
// SESSIONS DISCORD
// ======================================================

function base64urlEncode(value) {
    return Buffer.from(value)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64urlDecode(value) {
    value = value.replace(/-/g, "+").replace(/_/g, "/");

    while (value.length % 4) {
        value += "=";
    }

    return Buffer.from(value, "base64").toString("utf8");
}

function createSignature(data) {
    if (!process.env.SESSION_SECRET) {
        throw new Error("SESSION_SECRET n'est pas configurée.");
    }

    return crypto
        .createHmac("sha256", process.env.SESSION_SECRET)
        .update(data)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function createToken(payload) {
    const encodedPayload = base64urlEncode(
        JSON.stringify(payload)
    );

    return `${encodedPayload}.${createSignature(encodedPayload)}`;
}

function verifyToken(token) {
    if (
        !token ||
        !process.env.SESSION_SECRET ||
        typeof token !== "string"
    ) {
        return null;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
        return null;
    }

    const [encodedPayload, signature] = parts;

    let expectedSignature;

    try {
        expectedSignature = createSignature(encodedPayload);
    } catch {
        return null;
    }

    const received = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);

    if (received.length !== expected.length) {
        return null;
    }

    if (!crypto.timingSafeEqual(received, expected)) {
        return null;
    }

    try {
        const payload = JSON.parse(
            base64urlDecode(encodedPayload)
        );

        if (!payload.exp || Date.now() > payload.exp) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

const discordAuth = requireDiscordMember(
    client,
    GUILD_ID,
    verifyToken
);

// ======================================================
// VÉRIFICATION DES PERMISSIONS DU SITE
// ======================================================

function requireSitePermission(permission) {
    return (req, res, next) => {
        if (!req.discordMember) {
            return res.status(401).json({
                error: "Utilisateur Discord non authentifié."
            });
        }

        const permissions = getMemberPermissions(
            req.discordMember
        );

        if (!permissions.includes(permission)) {
            return res.status(403).json({
                error: "Tu n'as pas la permission nécessaire."
            });
        }

        next();
    };
}

// ======================================================
// UTILITAIRES DE MODÉRATION
// ======================================================

function isSnowflake(value) {
    return (
        typeof value === "string" &&
        /^\d{17,20}$/.test(value)
    );
}

function safeReason(value, fallback) {
    const reason =
        typeof value === "string" ? value.trim() : "";

    return (reason || fallback).slice(0, 450);
}

async function getGuild() {
    return client.guilds.fetch(GUILD_ID);
}

async function getBotMember(guild) {
    return guild.members.me || guild.members.fetchMe();
}

async function fetchTarget(guild, memberId) {
    if (!isSnowflake(memberId)) {
        const error = new Error(
            "Identifiant du membre invalide."
        );

        error.status = 400;
        throw error;
    }

    try {
        return await guild.members.fetch(memberId);
    } catch {
        const error = new Error(
            "Ce membre n'est pas présent sur le serveur Discord."
        );

        error.status = 404;
        throw error;
    }
}

function ensureActorCanManageTarget(actor, target, guild) {
    if (actor.id === target.id) {
        const error = new Error(
            "Tu ne peux pas effectuer cette action sur ton propre compte."
        );

        error.status = 400;
        throw error;
    }

    if (target.id === guild.ownerId) {
        const error = new Error(
            "Le propriétaire du serveur ne peut pas être modéré par cette action."
        );

        error.status = 403;
        throw error;
    }

    const isOwner = actor.id === guild.ownerId;

    const hasHierarchy = actor.roles.highest.comparePositionTo(
        target.roles.highest
    ) > 0;

    if (!isOwner && !hasHierarchy) {
        const error = new Error(
            "La hiérarchie des rôles Discord ne permet pas cette action."
        );

        error.status = 403;
        throw error;
    }
}

function ensureBotCanManageTarget(
    botMember,
    target,
    requiredPermission
) {
    if (!botMember.permissions.has(requiredPermission)) {
        const error = new Error(
            "Le bot n'a pas la permission Discord nécessaire."
        );

        error.status = 500;
        throw error;
    }

    if (
        botMember.id === target.id ||
        botMember.roles.highest.comparePositionTo(
            target.roles.highest
        ) <= 0
    ) {
        const error = new Error(
            "Le rôle le plus élevé du bot doit être placé au-dessus de celui du membre."
        );

        error.status = 403;
        throw error;
    }
}

function invalidateMembersCache() {
    membersListCache = null;
    membersListCacheAt = 0;
}

function handleRouteError(res, error, genericMessage) {
    console.error(genericMessage, error);

    return res.status(error.status || 500).json({
        error: error.status
            ? error.message
            : genericMessage
    });
}


// ======================================================
// HISTORIQUE DES SANCTIONS (fichier local du bot)
// ======================================================

const SANCTIONS_FILE = path.join(__dirname, "sanctions.json");
const MAX_SANCTION_HISTORY = 1500;
const CHAT_MUTE_PERMISSION_NAMES = [
    "SendMessages",
    "SendMessagesInThreads",
    "CreatePublicThreads",
    "CreatePrivateThreads"
];

function loadSanctionHistory() {
    try {
        if (!fs.existsSync(SANCTIONS_FILE)) return [];
        const parsed = JSON.parse(fs.readFileSync(SANCTIONS_FILE, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error("Impossible de lire sanctions.json :", error);
        return [];
    }
}

let sanctionsHistory = loadSanctionHistory();

function saveSanctionHistory() {
    try {
        fs.writeFileSync(
            SANCTIONS_FILE,
            JSON.stringify(sanctionsHistory.slice(0, MAX_SANCTION_HISTORY), null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("Impossible d'enregistrer sanctions.json :", error);
        throw new Error("Impossible d'enregistrer l'historique des sanctions. Vérifie que le bot peut écrire dans son dossier.");
    }
}

function addSanctionHistory(entry) {
    const record = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: "completed",
        ...entry
    };
    sanctionsHistory.unshift(record);
    sanctionsHistory = sanctionsHistory.slice(0, MAX_SANCTION_HISTORY);
    saveSanctionHistory();
    return record;
}

function updateSanctionRecord(record, changes) {
    Object.assign(record, changes);
    saveSanctionHistory();
    return record;
}

function hasSanctionActionPermission(req) {
    const perms = getMemberPermissions(req.discordMember);
    return perms.includes("temp_ban") || perms.includes("perm_ban");
}

function requireSanctionActionPermission(req, res, next) {
    if (!req.discordMember) {
        return res.status(401).json({ error: "Utilisateur Discord non authentifié." });
    }
    if (!hasSanctionActionPermission(req)) {
        return res.status(403).json({ error: "Tu n'as pas la permission de sanctionner les membres." });
    }
    return next();
}

function requireSanctionHistoryPermission(req, res, next) {
    if (!req.discordMember) {
        return res.status(401).json({ error: "Utilisateur Discord non authentifié." });
    }
    const perms = getMemberPermissions(req.discordMember);
    const allowed = ["sanctions_total", "temp_ban", "perm_ban"].some(p => perms.includes(p));
    if (!allowed) {
        return res.status(403).json({ error: "Tu n'as pas la permission de consulter les sanctions." });
    }
    return next();
}

function getChatTextChannels(guild) {
    return [...guild.channels.cache.values()].filter(channel =>
        channel &&
        channel.guildId === guild.id &&
        [0, 5, 15, 16].includes(channel.type)
    );
}

function getOverwriteFlagState(overwrite, permissionName) {
    const flag = PermissionFlagsBits[permissionName];
    if (!flag) return null;
    if (overwrite?.deny?.has(flag)) return false;
    if (overwrite?.allow?.has(flag)) return true;
    return null;
}

function getChatOverwriteSnapshot(channel, memberId) {
    const overwrite = channel.permissionOverwrites.cache.get(memberId);
    const states = {};
    for (const name of CHAT_MUTE_PERMISSION_NAMES) {
        states[name] = getOverwriteFlagState(overwrite, name);
    }
    return {
        hadOverwrite: Boolean(overwrite),
        permissionsLocked: Boolean(channel.permissionsLocked),
        states
    };
}

async function applyChatMuteToChannel(record, channel, botMember, reason) {
    if (!channel || ![0, 5, 15, 16].includes(channel.type)) return;
    const botPerms = channel.permissionsFor(botMember);
    if (!botPerms || !botPerms.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error(`Le bot doit avoir la permission « Gérer les salons » dans #${channel.name}.`);
    }

    if (!record.chatOverwrites) record.chatOverwrites = {};
    if (!record.chatOverwrites[channel.id]) {
        record.chatOverwrites[channel.id] = getChatOverwriteSnapshot(channel, record.memberId);
        saveSanctionHistory();
    }

    const denyOptions = Object.fromEntries(
        CHAT_MUTE_PERMISSION_NAMES
            .filter(name => Boolean(PermissionFlagsBits[name]))
            .map(name => [name, false])
    );
    await channel.permissionOverwrites.edit(record.memberId, denyOptions, reason);
}

async function applyChatMute(record, guild, botMember, reason) {
    await guild.channels.fetch();
    const channels = getChatTextChannels(guild);
    const inaccessible = channels.filter(channel => {
        const perms = channel.permissionsFor(botMember);
        return !perms || !perms.has(PermissionFlagsBits.ManageChannels);
    });
    if (inaccessible.length) {
        throw new Error(
            `Le bot n'a pas « Gérer les salons » dans : ${inaccessible.slice(0, 4).map(c => `#${c.name}`).join(", ")}${inaccessible.length > 4 ? "…" : ""}.`
        );
    }

    record.chatOverwrites = record.chatOverwrites || {};
    // Enregistrer l'état d'origine avant de modifier les permissions.
    for (const channel of channels) {
        if (!record.chatOverwrites[channel.id]) {
            record.chatOverwrites[channel.id] = getChatOverwriteSnapshot(channel, record.memberId);
        }
    }
    saveSanctionHistory();

    for (const channel of channels) {
        await applyChatMuteToChannel(record, channel, botMember, reason);
    }
}

async function restoreChatMute(record, guild) {
    const entries = Object.entries(record.chatOverwrites || {});
    const errors = [];

    for (const [channelId, snapshot] of entries) {
        try {
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel?.permissionOverwrites) continue;

            // On restaure uniquement les permissions touchées par ce mute.
            const states = snapshot.states || {};
            const restoreOptions = Object.fromEntries(
                CHAT_MUTE_PERMISSION_NAMES
                    .filter(name => Boolean(PermissionFlagsBits[name]))
                    .map(name => [name, Object.prototype.hasOwnProperty.call(states, name) ? states[name] : null])
            );
            await channel.permissionOverwrites.edit(
                record.memberId,
                restoreOptions,
                `Fin du mute chat de ${record.memberName || record.memberId}`
            );

            // Si aucun overwrite n'existait avant et qu'il est maintenant vide,
            // le supprimer sans effacer d'autres permissions éventuellement ajoutées.
            if (snapshot.permissionsLocked && channel.parentId && typeof channel.lockPermissions === "function") {
                // Le salon était synchronisé avec sa catégorie avant le mute :
                // rétablir cette synchronisation après restauration des flags.
                await channel.lockPermissions();
            } else if (!snapshot.hadOverwrite) {
                const current = channel.permissionOverwrites.cache.get(record.memberId);
                if (
                    current &&
                    current.allow.bitfield === 0n &&
                    current.deny.bitfield === 0n
                ) {
                    await current.delete("Nettoyage de l'overwrite temporaire du mute chat");
                }
            }
        } catch (error) {
            errors.push(`${channelId}: ${error.message}`);
        }
    }

    if (errors.length) {
        throw new Error(`Certains salons n'ont pas pu être restaurés : ${errors.slice(0, 3).join("; ")}`);
    }
}

function sanctionModeIncludesVoice(record) {
    return record?.type === "mute" && ["voice", "both"].includes(record.mode);
}

function sanctionModeIncludesChat(record) {
    return record?.type === "mute" && ["chat", "both"].includes(record.mode);
}

async function restoreMuteSanction(record, finalStatus = "expired") {
    // Passer d'abord à "revoking" pour éviter que voiceStateUpdate ne réapplique
    // le mute pendant que Discord traite la demande de dé-mute.
    updateSanctionRecord(record, { status: "revoking" });

    try {
        const guild = await getGuild();

        if (sanctionModeIncludesChat(record)) {
            await restoreChatMute(record, guild);
        }

        if (sanctionModeIncludesVoice(record)) {
            try {
                const member = await guild.members.fetch(record.memberId);
                if (member.voice?.channelId) {
                    await member.voice.setMute(Boolean(record.voiceWasMuted), `Fin du mute vocal: ${record.reason || "sans raison"}`);
                    record.voiceRestorePending = false;
                } else {
                    // Discord ne permet de changer le server-mute que lorsque le membre est en vocal.
                    record.voiceRestorePending = true;
                }
            } catch (error) {
                record.voiceRestorePending = true;
                console.error(`Restauration du mute vocal pour ${record.memberId} différée :`, error.message);
            }
        }

        updateSanctionRecord(record, {
            status: finalStatus,
            endedAt: new Date().toISOString()
        });
    } catch (error) {
        updateSanctionRecord(record, { status: "active" });
        throw error;
    }
}

async function expireDueSanctions() {
    const now = Date.now();
    for (const record of [...sanctionsHistory]) {
        if (record.status !== "active" || !record.expiresAt) continue;
        if (Date.parse(record.expiresAt) > now) continue;

        try {
            if (record.type === "mute") {
                await restoreMuteSanction(record, "expired");
            } else if (record.type === "ban_temp") {
                const guild = await getGuild();
                await guild.members.unban(record.memberId, "Fin du ban temporaire").catch(error => {
                    if (error.code !== 10026 && error.code !== 10013) throw error;
                });
                updateSanctionRecord(record, {
                    status: "expired",
                    endedAt: new Date().toISOString()
                });
                invalidateMembersCache();
            }
        } catch (error) {
            console.error(`Erreur d'expiration de sanction ${record.id}:`, error);
        }
    }
}

// ======================================================
// CONNEXION DISCORD OAuth2
// ======================================================

function createOAuthState() {
    return createToken({
        nonce: crypto.randomBytes(32).toString("hex"),
        exp: Date.now() + 10 * 60 * 1000
    });
}

app.get("/auth/discord", (req, res) => {
    if (
        !process.env.DISCORD_CLIENT_ID ||
        !process.env.DISCORD_REDIRECT_URI ||
        !process.env.SESSION_SECRET
    ) {
        return res.status(500).send(
            "La connexion Discord n'est pas configurée sur le serveur."
        );
    }

    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        response_type: "code",
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        scope: "identify",
        state: createOAuthState()
    });

    res.redirect(
        `https://discord.com/oauth2/authorize?${params.toString()}`
    );
});

app.get("/auth/discord/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            return res.status(400).send(
                "Code ou état OAuth2 manquant."
            );
        }

        const statePayload = verifyToken(state);

        if (!statePayload || !statePayload.nonce) {
            return res.status(400).send(
                "Session OAuth2 invalide ou expirée."
            );
        }

        if (
            !process.env.DISCORD_CLIENT_ID ||
            !process.env.DISCORD_CLIENT_SECRET ||
            !process.env.DISCORD_REDIRECT_URI
        ) {
            return res.status(500).send(
                "La connexion Discord n'est pas configurée sur le serveur."
            );
        }

        const tokenResponse = await fetch(
            "https://discord.com/api/oauth2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    client_id: process.env.DISCORD_CLIENT_ID,
                    client_secret: process.env.DISCORD_CLIENT_SECRET,
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: process.env.DISCORD_REDIRECT_URI
                })
            }
        );

        if (!tokenResponse.ok) {
            console.error(
                "Erreur token Discord :",
                await tokenResponse.text()
            );

            return res.status(500).send(
                "Impossible de se connecter à Discord. Réessaie depuis le site."
            );
        }

        const tokenData = await tokenResponse.json();

        const userResponse = await fetch(
            "https://discord.com/api/users/@me",
            {
                headers: {
                    Authorization:
                        `Bearer ${tokenData.access_token}`
                }
            }
        );

        if (!userResponse.ok) {
            return res.status(500).send(
                "Impossible de récupérer ton profil Discord."
            );
        }

        const user = await userResponse.json();

        console.log(
            `🔐 Connexion Discord : ${user.username} (${user.id})`
        );

        const sessionToken = createToken({
            userId: user.id,
            username: user.username,
            globalName: user.global_name || user.username,
            avatar: user.avatar || null,
            exp: Date.now() + 30 * 24 * 60 * 60 * 1000
        });

        res.redirect(
            `${FRONTEND_URL}/#discord_token=${encodeURIComponent(sessionToken)}`
        );
    } catch (error) {
        console.error("Erreur OAuth2 :", error);

        res.status(500).send(
            "Une erreur est survenue pendant la connexion Discord."
        );
    }
});

// ======================================================
// VÉRIFIER LA SESSION
// ======================================================

app.get("/auth/me", (req, res) => {
    const authorization = req.headers.authorization;

    if (
        !authorization ||
        !authorization.startsWith("Bearer ")
    ) {
        return res.status(401).json({
            connected: false
        });
    }

    const session = verifyToken(
        authorization.substring(7)
    );

    if (!session) {
        return res.status(401).json({
            connected: false
        });
    }

    res.json({
        connected: true,
        user: {
            id: session.userId,
            username: session.username,
            globalName: session.globalName,
            avatar: session.avatar
        }
    });
});

app.get("/auth/status", (req, res) => {
    res.json({
        oauth2: true,
        discord: true
    });
});

// ======================================================
// PERMISSIONS DISCORD
// ======================================================

app.get("/auth/permissions", discordAuth, (req, res) => {
    try {
        const member = req.discordMember;
        const user = member.user;

        const permissions = getMemberPermissions(member);

        const roles = member.roles.cache
            .filter(role => role.id !== GUILD_ID)
            .sort((a, b) => b.position - a.position)
            .map(role => ({
                id: role.id,
                name: role.name
            }));

        res.json({
            connected: true,
            user: {
                id: user.id,
                username: user.username,
                globalName: user.globalName || user.username,
                avatar: user.displayAvatarURL({
                    extension: "png",
                    size: 256,
                    forceStatic: true
                })
            },
            roles,
            permissions
        });
    } catch (error) {
        console.error("Erreur permissions :", error);

        res.status(500).json({
            error: "Impossible de récupérer les permissions."
        });
    }
});

// ======================================================
// LISTE DES MEMBRES
// Pagination + cache pour limiter les demandes Discord.
// ======================================================

async function readGuildMembers(guild) {
    const allMembers = new Map();
    let after;

    while (true) {
        const options = { limit: 1000 };

        if (after) {
            options.after = after;
        }

        const batch = await guild.members.list(options);

        if (batch.size === 0) {
            break;
        }

        for (const member of batch.values()) {
            allMembers.set(member.id, member);
        }

        const lastMember = batch.last();

        if (!lastMember || batch.size < 1000) {
            break;
        }

        after = lastMember.id;
    }

    return [...allMembers.values()]
        .map(member => ({
            id: member.user.id,
            username: member.user.username,
            globalName:
                member.user.globalName || member.user.username,
            displayName: member.displayName,
            nickname: member.nickname || "",
            status:
                guild.presences.cache.get(member.id)?.status || "unknown",
            avatar: member.user.displayAvatarURL({
                extension: "png",
                size: 128
            }),
            bot: member.user.bot,
            roles: member.roles.cache
                .filter(role => role.id !== GUILD_ID)
                .sort((a, b) => b.position - a.position)
                .map(role => ({
                    id: role.id,
                    name: role.name,
                    color: role.hexColor
                }))
        }))
        .sort((a, b) =>
            a.displayName.localeCompare(
                b.displayName,
                "fr",
                { sensitivity: "base" }
            )
        );
}

app.get(
    "/members",
    discordAuth,
    requireSitePermission(PERMISSIONS.MEMBER_LIST),
    async (req, res) => {
        try {
            if (
                membersListCache &&
                Date.now() - membersListCacheAt < MEMBERS_CACHE_TTL
            ) {
                return res.json({
                    count: membersListCache.length,
                    members: membersListCache
                });
            }

            if (!membersListPromise) {
                membersListPromise = (async () => {
                    const guild = await getGuild();
                    return readGuildMembers(guild);
                })()
                    .then(members => {
                        membersListCache = members;
                        membersListCacheAt = Date.now();
                        return members;
                    })
                    .finally(() => {
                        membersListPromise = null;
                    });
            }

            const members = await membersListPromise;

            res.json({
                count: members.length,
                members
            });
        } catch (error) {
            handleRouteError(
                res,
                error,
                "Impossible de récupérer les membres."
            );
        }
    }
);

// ======================================================
// BAN TEMPORAIRE
// ======================================================

function scheduleTemporaryUnban(guildId, memberId, expiresAt, sanctionId = null) {
    const previous = temporaryBanTimers.get(memberId);

    if (previous) {
        clearTimeout(previous.timer);
    }

    const delay = Math.max(0, expiresAt - Date.now());

    const timer = setTimeout(async () => {
        try {
            const guild = await client.guilds.fetch(guildId);

            await guild.members.unban(
                memberId,
                "Fin automatique du ban temporaire"
            );

            console.log(
                `✅ Ban temporaire terminé pour ${memberId}`
            );

            invalidateMembersCache();
            if (sanctionId) {
                const record = sanctionsHistory.find(item => item.id === sanctionId);
                if (record) updateSanctionRecord(record, { status: "expired", endedAt: new Date().toISOString() });
            }
        } catch (error) {
            if (error.code === 10026 || error.code === 10013) {
                if (sanctionId) {
                    const record = sanctionsHistory.find(item => item.id === sanctionId);
                    if (record) updateSanctionRecord(record, { status: "expired", endedAt: new Date().toISOString() });
                }
            } else {
                console.error(
                    `Erreur fin ban temporaire (${memberId}) :`,
                    error
                );
            }
        } finally {
            temporaryBanTimers.delete(memberId);
        }
    }, delay);

    timer.unref?.();

    temporaryBanTimers.set(memberId, {
        timer,
        expiresAt,
        guildId
    });
}

app.post(
    "/moderation/temp-ban",
    discordAuth,
    requireSitePermission(PERMISSIONS.TEMP_BAN),
    async (req, res) => {
        try {
            const memberId = String(
                req.body?.memberId || ""
            );

            const durationMinutes = Number(
                req.body?.durationMinutes
            );

            if (
                !Number.isInteger(durationMinutes) ||
                durationMinutes < 1 ||
                durationMinutes > MAX_TEMP_BAN_MINUTES
            ) {
                return res.status(400).json({
                    error: "Choisis une durée entre 1 minute et 7 jours."
                });
            }

            const guild = await getGuild();

            const actor = await guild.members.fetch(
                req.discordMember.id
            );

            const target = await fetchTarget(
                guild,
                memberId
            );

            const botMember = await getBotMember(guild);

            ensureActorCanManageTarget(
                actor,
                target,
                guild
            );

            ensureBotCanManageTarget(
                botMember,
                target,
                PermissionFlagsBits.BanMembers
            );

            const reason = safeReason(
                req.body?.reason,
                `Ban temporaire demandé par ${actor.user.tag}`
            );

            await guild.members.ban(target.id, {
                reason
            });

            const expiresAt = Date.now() + durationMinutes * 60 * 1000;
            const sanctionRecord = addSanctionHistory({
                type: "ban_temp",
                memberId: target.id,
                memberName: target.displayName,
                moderatorId: actor.id,
                moderatorName: actor.displayName || actor.user.username,
                reason,
                status: "active",
                durationMinutes,
                expiresAt: new Date(expiresAt).toISOString()
            });

            scheduleTemporaryUnban(
                guild.id,
                target.id,
                expiresAt,
                sanctionRecord.id
            );

            invalidateMembersCache();

            console.log(
                `⏱️ Ban temporaire : ${target.user.tag}, ${durationMinutes} min, par ${actor.user.tag}`
            );

            res.json({
                ok: true,
                message:
                    `Membre banni temporairement pour ${durationMinutes} minute(s).`
            });
        } catch (error) {
            handleRouteError(
                res,
                error,
                "Erreur pendant le ban temporaire."
            );
        }
    }
);

// ======================================================
// BAN DÉFINITIF
// ======================================================

app.post(
    "/moderation/perm-ban",
    discordAuth,
    requireSitePermission(PERMISSIONS.PERM_BAN),
    async (req, res) => {
        try {
            const memberId = String(
                req.body?.memberId || ""
            );

            const guild = await getGuild();

            const actor = await guild.members.fetch(
                req.discordMember.id
            );

            const target = await fetchTarget(
                guild,
                memberId
            );

            const botMember = await getBotMember(guild);

            ensureActorCanManageTarget(
                actor,
                target,
                guild
            );

            ensureBotCanManageTarget(
                botMember,
                target,
                PermissionFlagsBits.BanMembers
            );

            const reason = safeReason(
                req.body?.reason,
                `Ban définitif demandé par ${actor.user.tag}`
            );

            await guild.members.ban(target.id, {
                reason
            });

            const existingTimer =
                temporaryBanTimers.get(target.id);

            if (existingTimer) {
                clearTimeout(existingTimer.timer);
                temporaryBanTimers.delete(target.id);
            }

            for (const previousRecord of sanctionsHistory.filter(item =>
                item.memberId === target.id && item.type === "ban_temp" && item.status === "active"
            )) {
                updateSanctionRecord(previousRecord, {
                    status: "superseded",
                    endedAt: new Date().toISOString()
                });
            }

            addSanctionHistory({
                type: "ban_perm",
                memberId: target.id,
                memberName: target.displayName,
                moderatorId: actor.id,
                moderatorName: actor.displayName || actor.user.username,
                reason,
                status: "active"
            });

            invalidateMembersCache();

            console.log(
                `🔨 Ban définitif : ${target.user.tag}, par ${actor.user.tag}`
            );

            res.json({
                ok: true,
                message: "Le membre a été banni définitivement."
            });
        } catch (error) {
            handleRouteError(
                res,
                error,
                "Erreur pendant le ban définitif."
            );
        }
    }
);

// ======================================================
// RÔLES : LISTE DES RÔLES MODIFIABLES
// ======================================================

app.get(
    "/moderation/roles",
    discordAuth,
    requireSitePermission(PERMISSIONS.MANAGE_ROLES),
    async (req, res) => {
        try {
            const memberId = String(
                req.query.memberId || ""
            );

            const guild = await getGuild();

            const actor = await guild.members.fetch(
                req.discordMember.id
            );

            const target = await fetchTarget(
                guild,
                memberId
            );

            const botMember = await getBotMember(guild);

            if (
                !botMember.permissions.has(
                    PermissionFlagsBits.ManageRoles
                )
            ) {
                return res.status(500).json({
                    error:
                        "Le bot n'a pas la permission Gérer les rôles sur Discord."
                });
            }

            ensureActorCanManageTarget(
                actor,
                target,
                guild
            );

            await guild.roles.fetch();

            const actorIsOwner =
                actor.id === guild.ownerId;

            const availableRoles = guild.roles.cache
                .filter(role =>
                    role.id !== guild.id &&
                    !role.managed &&
                    botMember.roles.highest.comparePositionTo(
                        role
                    ) > 0 &&
                    (
                        actorIsOwner ||
                        actor.roles.highest.comparePositionTo(
                            role
                        ) > 0
                    )
                )
                .sort((a, b) => b.position - a.position)
                .map(role => ({
                    id: role.id,
                    name: role.name,
                    color: role.hexColor,
                    assigned: target.roles.cache.has(role.id)
                }));

            res.json({
                memberId: target.id,
                memberName: target.displayName,
                roles: availableRoles
            });
        } catch (error) {
            handleRouteError(
                res,
                error,
                "Erreur pendant le chargement des rôles."
            );
        }
    }
);

// ======================================================
// RÔLES : AJOUT / RETRAIT
// ======================================================

app.post(
    "/moderation/roles",
    discordAuth,
    requireSitePermission(PERMISSIONS.MANAGE_ROLES),
    async (req, res) => {
        try {
            const memberId = String(
                req.body?.memberId || ""
            );

            const roleId = String(
                req.body?.roleId || ""
            );

            const action = String(
                req.body?.action || ""
            );

            if (!isSnowflake(roleId)) {
                return res.status(400).json({
                    error: "Identifiant de rôle invalide."
                });
            }

            if (action !== "add" && action !== "remove") {
                return res.status(400).json({
                    error: "Action invalide."
                });
            }

            const guild = await getGuild();

            const actor = await guild.members.fetch(
                req.discordMember.id
            );

            const target = await fetchTarget(
                guild,
                memberId
            );

            const botMember = await getBotMember(guild);

            const role = await guild.roles.fetch(roleId);

            if (
                !role ||
                role.id === guild.id ||
                role.managed
            ) {
                return res.status(400).json({
                    error:
                        "Ce rôle ne peut pas être modifié depuis le dashboard."
                });
            }

            if (
                !botMember.permissions.has(
                    PermissionFlagsBits.ManageRoles
                )
            ) {
                return res.status(500).json({
                    error:
                        "Le bot n'a pas la permission Gérer les rôles sur Discord."
                });
            }

            ensureActorCanManageTarget(
                actor,
                target,
                guild
            );

            if (
                botMember.roles.highest.comparePositionTo(
                    role
                ) <= 0
            ) {
                return res.status(403).json({
                    error:
                        "Le rôle du bot doit être placé au-dessus du rôle à modifier."
                });
            }

            if (
                actor.id !== guild.ownerId &&
                actor.roles.highest.comparePositionTo(role) <= 0
            ) {
                return res.status(403).json({
                    error:
                        "Tu ne peux pas modifier un rôle égal ou supérieur à ton rôle le plus élevé."
                });
            }

            const reason =
                `Gestion des rôles depuis le dashboard par ${actor.user.tag} (${actor.id})`;

            if (action === "add") {
                await target.roles.add(role, reason);
            } else {
                await target.roles.remove(role, reason);
            }

            invalidateMembersCache();

            console.log(
                `🛡️ Rôle ${action === "add" ? "ajouté" : "retiré"} : ${role.name} -> ${target.user.tag}, par ${actor.user.tag}`
            );

            res.json({
                ok: true,
                message: action === "add"
                    ? `Rôle « ${role.name} » ajouté.`
                    : `Rôle « ${role.name} » retiré.`
            });
        } catch (error) {
            handleRouteError(
                res,
                error,
                "Erreur pendant la gestion des rôles."
            );
        }
    }
);

// ======================================================
// EXPULSER UN MEMBRE
// ======================================================

app.post(
    "/moderation/kick",
    discordAuth,
    requireSitePermission(PERMISSIONS.KICK_MEMBER),
    async (req, res) => {
        try {
            const memberId = String(req.body?.memberId || "");
            const guild = await getGuild();

            const actor = await guild.members.fetch(
                req.discordMember.id
            );

            const target = await fetchTarget(
                guild,
                memberId
            );

            const botMember = await getBotMember(guild);

            ensureActorCanManageTarget(
                actor,
                target,
                guild
            );

            ensureBotCanManageTarget(
                botMember,
                target,
                PermissionFlagsBits.KickMembers
            );

            const reason = safeReason(
                req.body?.reason,
                `Expulsion demandée par ${actor.user.tag}`
            );

            await target.kick(reason);
            addSanctionHistory({
                type: "kick",
                memberId: target.id,
                memberName: target.displayName,
                moderatorId: actor.id,
                moderatorName: actor.displayName || actor.user.username,
                reason,
                status: "completed"
            });
            invalidateMembersCache();

            console.log(
                `👢 Expulsion : ${target.user.tag}, par ${actor.user.tag}`
            );

            return res.json({
                ok: true,
                message: `${target.user.tag} a été expulsé du serveur.`
            });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Erreur pendant l'expulsion du membre."
            );
        }
    }
);

// ======================================================
// MODIFIER LE PSEUDO D'UN MEMBRE SUR LE SERVEUR
// ======================================================

app.post(
    "/moderation/nickname",
    discordAuth,
    requireSitePermission(PERMISSIONS.MANAGE_NICKNAMES),
    async (req, res) => {
        try {
            const memberId = String(req.body?.memberId || "");
            const nickname = req.body?.nickname;

            if (typeof nickname !== "string") {
                return res.status(400).json({
                    error: "Le nouveau pseudo doit être du texte."
                });
            }

            const cleanNickname = nickname.trim();

            if (cleanNickname.length > 32) {
                return res.status(400).json({
                    error:
                        "Le pseudo doit contenir au maximum 32 caractères."
                });
            }

            const guild = await getGuild();

            const actor = await guild.members.fetch(
                req.discordMember.id
            );

            const target = await fetchTarget(
                guild,
                memberId
            );

            const botMember = await getBotMember(guild);

            ensureActorCanManageTarget(
                actor,
                target,
                guild
            );

            ensureBotCanManageTarget(
                botMember,
                target,
                PermissionFlagsBits.ManageNicknames
            );

            const reason = safeReason(
                req.body?.reason,
                `Pseudo modifié par ${actor.user.tag}`
            );

            await target.setNickname(
                cleanNickname || null,
                reason
            );

            invalidateMembersCache();

            console.log(
                `✏️ Pseudo modifié : ${target.user.tag}, nouveau pseudo : ${cleanNickname || "(réinitialisé)"}, par ${actor.user.tag}`
            );

            return res.json({
                ok: true,
                message: cleanNickname
                    ? `Le pseudo a été changé en « ${cleanNickname} ».`
                    : "Le pseudo personnalisé a été réinitialisé."
            });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Erreur pendant la modification du pseudo."
            );
        }
    }
);

// ======================================================
// MUTE VOCAL / MUTE CHAT / MUTE COMBINÉ
// ======================================================

app.post(
    "/moderation/mute",
    discordAuth,
    requireSanctionActionPermission,
    async (req, res) => {
        let record = null;
        try {
            const memberId = String(req.body?.memberId || "");
            const mode = String(req.body?.mode || "");
            const durationMinutes = Number(req.body?.durationMinutes);
            const reason = typeof req.body?.reason === "string"
                ? req.body.reason.trim().slice(0, 450)
                : "";

            if (!isSnowflake(memberId)) {
                return res.status(400).json({ error: "Identifiant du membre invalide." });
            }
            if (!["voice", "chat", "both"].includes(mode)) {
                return res.status(400).json({ error: "Choisis mute vocal, mute chat ou les deux." });
            }
            const allowedDurations = [5, 10, 30, 60, 360, 720, 1440, 4320, 10080];
            if (!allowedDurations.includes(durationMinutes)) {
                return res.status(400).json({ error: "Durée de sanction invalide." });
            }
            if (reason.length < 3) {
                return res.status(400).json({ error: "Indique une raison d'au moins 3 caractères." });
            }

            const guild = await getGuild();
            const actor = await guild.members.fetch(req.discordMember.id);
            const target = await fetchTarget(guild, memberId);
            const botMember = await getBotMember(guild);

            ensureActorCanManageTarget(actor, target, guild);

            if (["voice", "both"].includes(mode)) {
                ensureBotCanManageTarget(botMember, target, PermissionFlagsBits.MuteMembers);
            }

            if (["chat", "both"].includes(mode) && target.permissions.has(PermissionFlagsBits.Administrator)) {
                return res.status(400).json({
                    error: "Le mute chat par permissions de salon ne peut pas bloquer un administrateur Discord."
                });
            }

            const alreadyActive = sanctionsHistory.find(item =>
                item.type === "mute" &&
                item.memberId === target.id &&
                ["active", "pending", "revoking"].includes(item.status) &&
                (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())
            );
            if (alreadyActive) {
                return res.status(409).json({
                    error: "Ce membre a déjà un mute actif. Consulte son historique et lève-le avant d'en créer un autre."
                });
            }

            const expiresAt = Date.now() + durationMinutes * 60 * 1000;
            record = addSanctionHistory({
                type: "mute",
                mode,
                memberId: target.id,
                memberName: target.displayName,
                moderatorId: actor.id,
                moderatorName: actor.displayName || actor.user.username,
                reason,
                status: "pending",
                durationMinutes,
                expiresAt: new Date(expiresAt).toISOString(),
                voiceWasMuted: Boolean(target.voice?.serverMute),
                chatOverwrites: {}
            });

            try {
                if (["voice", "both"].includes(mode) && target.voice?.channelId) {
                    await target.voice.setMute(true, `Mute vocal (${durationMinutes} min): ${reason}`);
                }

                if (["chat", "both"].includes(mode)) {
                    await applyChatMute(record, guild, botMember, `Mute chat (${durationMinutes} min): ${reason}`);
                }

                updateSanctionRecord(record, { status: "active" });
            } catch (error) {
                // Rollback si l'application n'a pas pu se terminer entièrement.
                try {
                    if (["chat", "both"].includes(mode)) {
                        await restoreChatMute(record, guild);
                    }
                    if (["voice", "both"].includes(mode) && target.voice?.channelId) {
                        await target.voice.setMute(Boolean(record.voiceWasMuted), "Annulation du mute incomplet");
                    }
                } catch (rollbackError) {
                    console.error("Échec du rollback de mute :", rollbackError);
                }
                updateSanctionRecord(record, {
                    status: "failed",
                    endedAt: new Date().toISOString(),
                    error: error.message
                });
                throw error;
            }

            return res.json({
                ok: true,
                sanctionId: record.id,
                message: mode === "voice"
                    ? `Mute vocal appliqué pendant ${durationMinutes} minute(s). Le membre peut toujours entendre.`
                    : mode === "chat"
                        ? `Mute chat appliqué pendant ${durationMinutes} minute(s).`
                        : `Mute vocal et chat appliqué pendant ${durationMinutes} minute(s).`
            });
        } catch (error) {
            return handleRouteError(res, error, "Erreur pendant l'application du mute.");
        }
    }
);

// Consulter l'historique d'un membre.
app.get(
    "/moderation/sanctions",
    discordAuth,
    requireSanctionHistoryPermission,
    async (req, res) => {
        try {
            const memberId = String(req.query.memberId || "");
            if (!isSnowflake(memberId)) {
                return res.status(400).json({ error: "Identifiant du membre invalide." });
            }

            const sanctions = sanctionsHistory
                .filter(item => item.memberId === memberId)
                .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
                .map(item => ({
                    id: item.id,
                    type: item.type,
                    mode: item.mode || null,
                    memberId: item.memberId,
                    memberName: item.memberName || "Membre",
                    moderatorId: item.moderatorId || "",
                    moderatorName: item.moderatorName || "Inconnu",
                    reason: item.reason || "Aucune raison renseignée",
                    status: item.status,
                    durationMinutes: item.durationMinutes ?? null,
                    createdAt: item.createdAt,
                    expiresAt: item.expiresAt || null,
                    endedAt: item.endedAt || null,
                    voiceRestorePending: Boolean(item.voiceRestorePending)
                }));

            return res.json({ memberId, sanctions });
        } catch (error) {
            return handleRouteError(res, error, "Impossible de récupérer l'historique des sanctions.");
        }
    }
);

// Lever un mute actif depuis l'historique.
app.post(
    "/moderation/sanctions/:sanctionId/revoke",
    discordAuth,
    requireSanctionActionPermission,
    async (req, res) => {
        try {
            const sanctionId = String(req.params.sanctionId || "");
            const record = sanctionsHistory.find(item => item.id === sanctionId);

            if (!record || record.type !== "mute" || record.status !== "active") {
                return res.status(404).json({ error: "Aucun mute actif correspondant." });
            }

            const guild = await getGuild();
            const actor = await guild.members.fetch(req.discordMember.id);
            const target = await guild.members.fetch(record.memberId).catch(() => null);

            if (target) {
                ensureActorCanManageTarget(actor, target, guild);
            } else if (["voice", "both"].includes(record.mode)) {
                return res.status(404).json({ error: "Le membre a quitté le serveur; la partie vocale ne peut pas être restaurée maintenant." });
            }

            await restoreMuteSanction(record, "revoked");
            return res.json({ ok: true, message: `Sanction levée pour ${record.memberName || record.memberId}.` });
        } catch (error) {
            return handleRouteError(res, error, "Impossible de lever cette sanction.");
        }
    }
);

// Les mutes vocaux continuent à s'appliquer si le membre rejoint un vocal
// après avoir reçu la sanction.
client.on(Events.VoiceStateUpdate, async (_oldState, newState) => {
    if (!newState.guild || newState.guild.id !== GUILD_ID || !newState.channelId) return;
    const activeVoiceSanction = sanctionsHistory.find(item =>
        item.type === "mute" &&
        item.memberId === newState.id &&
        item.status === "active" &&
        sanctionModeIncludesVoice(item) &&
        Date.parse(item.expiresAt || 0) > Date.now()
    );

    try {
        if (activeVoiceSanction) {
            if (!newState.serverMute) {
                await newState.setMute(true, `Mute vocal actif: ${activeVoiceSanction.reason}`);
            }
            return;
        }

        const pendingRestore = [...sanctionsHistory].reverse().find(item =>
            item.memberId === newState.id &&
            item.type === "mute" &&
            item.voiceRestorePending &&
            ["voice", "both"].includes(item.mode) &&
            item.status !== "active"
        );
        if (pendingRestore) {
            await newState.setMute(Boolean(pendingRestore.voiceWasMuted), "Restauration du statut vocal après expiration d'une sanction");
            updateSanctionRecord(pendingRestore, { voiceRestorePending: false });
        }
    } catch (error) {
        console.error(`Impossible de mettre à jour le mute vocal de ${newState.id}:`, error);
    }
});

// Les nouveaux salons texte créés pendant un mute chat restent mutés.
client.on(Events.ChannelCreate, async channel => {
    if (!channel.guildId || channel.guildId !== GUILD_ID || ![0, 5, 15, 16].includes(channel.type)) return;
    const activeChatMutes = sanctionsHistory.filter(item =>
        item.type === "mute" &&
        item.status === "active" &&
        sanctionModeIncludesChat(item) &&
        Date.parse(item.expiresAt || 0) > Date.now()
    );
    if (!activeChatMutes.length) return;

    try {
        const guild = await getGuild();
        const botMember = await getBotMember(guild);
        for (const record of activeChatMutes) {
            await applyChatMuteToChannel(record, channel, botMember, `Mute chat actif: ${record.reason}`);
        }
    } catch (error) {
        console.error("Impossible d'appliquer un mute chat à un nouveau salon :", error);
    }
});

async function resumeActiveSanctions() {
    try {
        const guild = await getGuild();
        const botMember = await getBotMember(guild);
        await expireDueSanctions();

        // Si le processus a redémarré au milieu de l'application d'un mute,
        // restaurer les permissions d'origine au lieu de laisser une sanction partielle.
        for (const pending of sanctionsHistory.filter(item => item.type === "mute" && item.status === "pending")) {
            try {
                if (sanctionModeIncludesChat(pending)) {
                    await restoreChatMute(pending, guild);
                }
                if (sanctionModeIncludesVoice(pending)) {
                    const member = await guild.members.fetch(pending.memberId).catch(() => null);
                    if (member?.voice?.channelId) {
                        await member.voice.setMute(Boolean(pending.voiceWasMuted), "Annulation d'une sanction interrompue par un redémarrage");
                    }
                }
                updateSanctionRecord(pending, { status: "failed", endedAt: new Date().toISOString(), error: "Le bot a redémarré pendant l'application de la sanction." });
            } catch (error) {
                console.error(`Impossible de restaurer le mute incomplet ${pending.id}:`, error);
            }
        }

        for (const record of sanctionsHistory.filter(item => item.type === "mute" && item.status === "active")) {
            if (Date.parse(record.expiresAt || 0) <= Date.now()) continue;
            try {
                if (sanctionModeIncludesChat(record)) {
                    // Réappliquer les interdictions sur les salons enregistrés.
                    for (const channelId of Object.keys(record.chatOverwrites || {})) {
                        const channel = await guild.channels.fetch(channelId).catch(() => null);
                        if (channel) await applyChatMuteToChannel(record, channel, botMember, `Reprise du mute chat: ${record.reason}`);
                    }
                }
                if (sanctionModeIncludesVoice(record)) {
                    const member = await guild.members.fetch(record.memberId).catch(() => null);
                    if (member?.voice?.channelId && !member.voice.serverMute) {
                        await member.voice.setMute(true, `Reprise du mute vocal: ${record.reason}`);
                    }
                }
            } catch (error) {
                console.error(`Impossible de rétablir la sanction ${record.id} :`, error);
            }
        }
    } catch (error) {
        console.error("Erreur pendant la reprise des sanctions actives :", error);
    }
}

// ======================================================
// MINI-DISCORD : SALONS, MEMBRES, MESSAGES ET ENVOI
// ======================================================

// Liste des salons que le membre et le bot peuvent lire.
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

// ======================================================
// ROUTES PUBLIQUES DU SITE
// ======================================================

app.get("/", (req, res) => {
    res.send("API La communauté live opérationnelle 🚀");
});

app.get("/stats", (req, res) => res.json(statsCache));
app.get("/events", (req, res) => res.json(eventsCache));
app.get("/staff", (req, res) => res.json(staffCache));
app.get("/annonces", (req, res) => res.json(announcementsCache));
app.get("/regles", (req, res) => res.json(rulesCache));

// ======================================================
// CHARGEMENT ET ACTUALISATION DES DONNÉES
// ======================================================

client.once(Events.ClientReady, async () => {
    console.log(`✅ Connecté : ${client.user.tag}`);

    await resumeActiveSanctions();
    setInterval(() => {
        expireDueSanctions().catch(error => console.error("Erreur vérification sanctions :", error));
    }, 15 * 1000);

    try {
        eventsCache = await updateEvents(client, GUILD_ID);

        staffCache = await updateStaff(
            client,
            GUILD_ID,
            STAFF_ROLES
        );

        statsCache = await updateStats(
            client,
            GUILD_ID
        );

        announcementsCache = await updateAnnouncements(
            client,
            ANNOUNCEMENTS_CHANNEL_ID
        );

        rulesCache = await updateRules(
            client,
            RULES_CHANNEL_ID
        );

        console.log("✅ Toutes les données sont chargées.");
    } catch (error) {
        console.error(
            "Erreur de chargement initial :",
            error
        );
    }

    // Événements : toutes les 5 minutes
    setInterval(async () => {
        try {
            eventsCache = await updateEvents(client, GUILD_ID);
        } catch (error) {
            console.error("Erreur mise à jour événements :", error);
        }
    }, 5 * 60 * 1000);

    // Statistiques : toutes les 5 minutes
    setInterval(async () => {
        try {
            statsCache = await updateStats(client, GUILD_ID);
        } catch (error) {
            console.error("Erreur mise à jour statistiques :", error);
        }
    }, 5 * 60 * 1000);

    // Staff : toutes les 30 minutes
    setInterval(async () => {
        try {
            staffCache = await updateStaff(
                client,
                GUILD_ID,
                STAFF_ROLES
            );
        } catch (error) {
            console.error("Erreur mise à jour staff :", error);
        }
    }, 30 * 60 * 1000);

    // Annonces : toutes les minutes
    setInterval(async () => {
        try {
            announcementsCache = await updateAnnouncements(
                client,
                ANNOUNCEMENTS_CHANNEL_ID
            );
        } catch (error) {
            console.error("Erreur mise à jour annonces :", error);
        }
    }, 60 * 1000);

    // Règlement : toutes les minutes
    setInterval(async () => {
        try {
            rulesCache = await updateRules(
                client,
                RULES_CHANNEL_ID
            );
        } catch (error) {
            console.error("Erreur mise à jour règlement :", error);
        }
    }, 60 * 1000);
});

// Actualiser le staff et les statistiques lors des changements de membres.
async function refreshStaffAndStats() {
    try {
        staffCache = await updateStaff(
            client,
            GUILD_ID,
            STAFF_ROLES
        );

        statsCache = await updateStats(
            client,
            GUILD_ID
        );
    } catch (error) {
        console.error(
            "Erreur actualisation membres/stats :",
            error
        );
    }
}

client.on(Events.GuildMemberAdd, refreshStaffAndStats);
client.on(Events.GuildMemberRemove, refreshStaffAndStats);
client.on(Events.GuildMemberUpdate, refreshStaffAndStats);
// Résumé d'une sanction renvoyé aux pages du site.
function serializeSanctionRecord(item) {
    return {
        id: item.id,
        type: item.type,
        mode: item.mode || null,
        memberId: item.memberId,
        memberName: item.memberName || "Membre",
        moderatorId: item.moderatorId || "",
        moderatorName: item.moderatorName || "Inconnu",
        reason: item.reason || "Aucune raison renseignée",
        status: item.status || "unknown",
        durationMinutes: item.durationMinutes ?? null,
        createdAt: item.createdAt || null,
        expiresAt: item.expiresAt || null,
        endedAt: item.endedAt || null,
        voiceRestorePending: Boolean(item.voiceRestorePending)
    };
}

// Historique global : uniquement pour les personnes autorisées à modérer/consulter.
app.get(
    "/moderation/sanctions/all",
    discordAuth,
    requireSanctionHistoryPermission,
    async (_req, res) => {
        try {
            const sanctions = [...sanctionsHistory]
                .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
                .map(serializeSanctionRecord);

            return res.json({ sanctions });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Impossible de récupérer toutes les sanctions."
            );
        }
    }
);

// Mes sanctions : le membre cible est toujours l'utilisateur connecté.
// Aucun memberId n'est accepté depuis le navigateur.
app.get(
    "/moderation/sanctions/mine",
    discordAuth,
    requireSitePermission("view_own_sanctions"),
    async (req, res) => {
        try {
            const memberId = req.discordMember.id;
            const sanctions = sanctionsHistory
                .filter(item => item.memberId === memberId)
                .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
                .map(serializeSanctionRecord);

            return res.json({ memberId, sanctions });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Impossible de récupérer tes sanctions."
            );
        }
    }
);

// ======================================================
// DÉMARRAGE
// ======================================================

app.listen(PORT, () => {
    console.log(`🌍 Serveur lancé sur le port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error(
        "Erreur de connexion du bot Discord :",
        error
    );
});
