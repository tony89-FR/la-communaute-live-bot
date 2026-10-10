require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

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

// Les bans temporaires actifs dans ce processus.
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

// Attention : le minuteur est en mémoire.
// Un redémarrage du processus peut interrompre le débannissement
// automatique. Une base de données sera nécessaire pour le rendre durable.

function scheduleTemporaryUnban(guildId, memberId, expiresAt) {
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
        } catch (error) {
            if (error.code !== 10026 && error.code !== 10013) {
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

            scheduleTemporaryUnban(
                guild.id,
                target.id,
                Date.now() + durationMinutes * 60 * 1000
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

    setInterval(async () => {
        try {
            eventsCache = await updateEvents(client, GUILD_ID);
        } catch (error) {
            console.error("Erreur mise à jour événements :", error);
        }
    }, 5 * 60 * 1000);

    setInterval(async () => {
        try {
            statsCache = await updateStats(client, GUILD_ID);
        } catch (error) {
            console.error("Erreur mise à jour statistiques :", error);
        }
    }, 5 * 60 * 1000);

    setInterval(async () => {
        try {
            staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
        } catch (error) {
            console.error("Erreur mise à jour staff :", error);
        }
    }, 30 * 60 * 1000);

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

    setInterval(async () => {
        try {
            rulesCache = await updateRules(client, RULES_CHANNEL_ID);
        } catch (error) {
            console.error("Erreur mise à jour règlement :", error);
        }
    }, 60 * 1000);
});

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
