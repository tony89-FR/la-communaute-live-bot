require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Client, GatewayIntentBits, Events } = require("discord.js");

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
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

let eventsCache = [];
let staffCache = [];
let statsCache = {};
let announcementsCache = [];
let rulesCache = { content: "" };

// ======================================================
// SIGNATURE ET VÉRIFICATION DES JETONS DE SESSION
// ======================================================

function base64urlEncode(value) {
    return Buffer.from(value).toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64urlDecode(value) {
    value = value.replace(/-/g, "+").replace(/_/g, "/");
    while (value.length % 4) value += "=";
    return Buffer.from(value, "base64").toString("utf8");
}

function createSignature(data) {
    if (!process.env.SESSION_SECRET) {
        throw new Error("La variable SESSION_SECRET n'est pas configurée.");
    }

    return crypto.createHmac("sha256", process.env.SESSION_SECRET)
        .update(data)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function createToken(payload) {
    const encodedPayload = base64urlEncode(JSON.stringify(payload));
    return `${encodedPayload}.${createSignature(encodedPayload)}`;
}

function verifyToken(token) {
    if (!token || !process.env.SESSION_SECRET || typeof token !== "string") {
        return null;
    }

    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [encodedPayload, signature] = parts;

    let expectedSignature;

    try {
        expectedSignature = createSignature(encodedPayload);
    } catch {
        return null;
    }

    const received = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);

    if (received.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(received, expected)) return null;

    try {
        const payload = JSON.parse(base64urlDecode(encodedPayload));

        if (!payload.exp || Date.now() > payload.exp) return null;

        return payload;
    } catch {
        return null;
    }
}

const discordAuth = requireDiscordMember(client, GUILD_ID, verifyToken);

// ======================================================
// CONNEXION DISCORD OAUTH2
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

    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            return res.status(400).send("Code ou état OAuth2 manquant.");
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
                    Authorization: `Bearer ${tokenData.access_token}`
                }
            }
        );

        if (!userResponse.ok) {
            return res.status(500).send(
                "Impossible de récupérer ton profil Discord."
            );
        }

        const user = await userResponse.json();

        console.log(`🔐 Connexion Discord : ${user.username} (${user.id})`);

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

    if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).json({ connected: false });
    }

    const session = verifyToken(authorization.substring(7));

    if (!session) {
        return res.status(401).json({ connected: false });
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
// ======================================================

app.get("/members", discordAuth, async (req, res) => {
    try {
        const permissions = getMemberPermissions(req.discordMember);

        if (!permissions.includes(PERMISSIONS.MEMBER_LIST)) {
            return res.status(403).json({
                error: "Vous n'avez pas la permission nécessaire."
            });
        }

        const guild = await client.guilds.fetch(GUILD_ID);
        await guild.members.fetch();

        const members = [...guild.members.cache.values()]
            .map(member => ({
                id: member.user.id,
                username: member.user.username,
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

        res.json({
            count: members.length,
            members
        });
    } catch (error) {
        console.error("Erreur liste membres :", error);

        res.status(500).json({
            error: "Impossible de récupérer les membres."
        });
    }
});

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
// CHARGEMENT ET ACTUALISATION DES DONNÉES DU BOT
// ======================================================

client.once(Events.ClientReady, async () => {
    console.log(`✅ Connecté : ${client.user.tag}`);

    try {
        eventsCache = await updateEvents(client, GUILD_ID);
        staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
        statsCache = await updateStats(client, GUILD_ID);
        announcementsCache = await updateAnnouncements(
            client,
            ANNOUNCEMENTS_CHANNEL_ID
        );
        rulesCache = await updateRules(client, RULES_CHANNEL_ID);

        console.log("✅ Toutes les données sont chargées.");
    } catch (error) {
        console.error("Erreur de chargement initial :", error);
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
            staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
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
            rulesCache = await updateRules(client, RULES_CHANNEL_ID);
        } catch (error) {
            console.error("Erreur mise à jour règlement :", error);
        }
    }, 60 * 1000);
});

// Actualiser le staff et les statistiques lors des changements de membres.
async function refreshStaffAndStats() {
    try {
        staffCache = await updateStaff(client, GUILD_ID, STAFF_ROLES);
        statsCache = await updateStats(client, GUILD_ID);
    } catch (error) {
        console.error("Erreur actualisation membres/stats :", error);
    }
}

client.on(Events.GuildMemberAdd, refreshStaffAndStats);
client.on(Events.GuildMemberRemove, refreshStaffAndStats);
client.on(Events.GuildMemberUpdate, refreshStaffAndStats);

// ======================================================
// DÉMARRAGE DU SERVEUR WEB ET DU BOT
// ======================================================

app.listen(PORT, () => {
    console.log(`🌍 Serveur lancé sur le port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error("Erreur de connexion du bot Discord :", error);
});
