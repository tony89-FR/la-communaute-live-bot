require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const {
    Client,
    GatewayIntentBits,
    Events
} = require("discord.js");

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


// ======================================================
// CONFIGURATION
// ======================================================

const FRONTEND_URL =
    "https://tony89-fr.github.io";

const {
    GUILD_ID,
    STAFF_ROLES,
    ANNOUNCEMENTS_CHANNEL_ID,
    RULES_CHANNEL_ID
} = require("./config/config");


// ======================================================
// SERVICES
// ======================================================

const { updateStaff } =
    require("./config/staff");

const { updateEvents } =
    require("./services/events");

const { updateStats } =
    require("./services/stats");

const { updateAnnouncements } =
    require("./services/annonces");

const { updateRules } =
    require("./services/regles");


// ======================================================
// PERMISSIONS
// ======================================================

const {
    getMemberPermissions
} = require("./middleware/permissions");

const {
    requireDiscordMember
} = require("./middleware/discordAuth");


// ======================================================
// CORS
// ======================================================

app.use(cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    allowedHeaders: [
        "Content-Type",
        "Authorization"
    ]
}));


// ======================================================
// CACHE
// ======================================================

let eventsCache = [];

let staffCache = [];

let statsCache = {};

let announcementsCache = [];

let rulesCache = {
    content: ""
};


// ======================================================
// OUTILS AUTHENTIFICATION
// ======================================================

function base64urlEncode(value) {

    return Buffer
        .from(value)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

}


function base64urlDecode(value) {

    value = value
        .replace(/-/g, "+")
        .replace(/_/g, "/");


    while (value.length % 4) {

        value += "=";

    }


    return Buffer
        .from(value, "base64")
        .toString("utf8");

}


function createSignature(data) {

    return crypto
        .createHmac(
            "sha256",
            process.env.SESSION_SECRET
        )
        .update(data)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

}


function createToken(payload) {

    const encodedPayload =
        base64urlEncode(
            JSON.stringify(payload)
        );


    const signature =
        createSignature(
            encodedPayload
        );


    return `${encodedPayload}.${signature}`;

}


function verifyToken(token) {

    if (
        !token ||
        !process.env.SESSION_SECRET
    ) {

        return null;

    }


    const parts =
        token.split(".");


    if (parts.length !== 2) {

        return null;

    }


    const [
        encodedPayload,
        signature
    ] = parts;


    const expectedSignature =
        createSignature(
            encodedPayload
        );


    try {

        const signaturesMatch =
            crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            );


        if (!signaturesMatch) {

            return null;

        }

    }

    catch (error) {

        return null;

    }


    try {

        const payload =
            JSON.parse(
                base64urlDecode(
                    encodedPayload
                )
            );


        if (
            !payload.exp ||
            Date.now() > payload.exp
        ) {

            return null;

        }


        return payload;

    }

    catch (error) {

        return null;

    }

}


// ======================================================
// AUTHENTIFICATION DISCORD
// ======================================================

const discordAuth =
    requireDiscordMember(
        client,
        GUILD_ID,
        verifyToken
    );


// ======================================================
// ÉTAT OAUTH2
// ======================================================

function createOAuthState() {

    return createToken({

        nonce:
            crypto
                .randomBytes(32)
                .toString("hex"),

        exp:
            Date.now() +
            (10 * 60 * 1000)

    });

}


// ======================================================
// DISCORD OAUTH2
// ======================================================

// Début de la connexion Discord

app.get(
    "/auth/discord",
    (req, res) => {

        const state =
            createOAuthState();


        const params =
            new URLSearchParams({

                client_id:
                    process.env.DISCORD_CLIENT_ID,

                response_type:
                    "code",

                redirect_uri:
                    process.env.DISCORD_REDIRECT_URI,

                scope:
                    "identify",

                state:
                    state

            });


        const discordURL =
            `https://discord.com/oauth2/authorize?${params.toString()}`;


        res.redirect(
            discordURL
        );

    }
);


// ======================================================
// RETOUR DISCORD
// ======================================================

app.get(
    "/auth/discord/callback",
    async (req, res) => {

        try {

            const {
                code,
                state
            } = req.query;


            if (!code) {

                return res
                    .status(400)
                    .send(
                        "Code Discord manquant."
                    );

            }


            if (!state) {

                return res
                    .status(400)
                    .send(
                        "État OAuth2 manquant."
                    );

            }


            // ==========================================
            // VÉRIFICATION DU STATE
            // ==========================================

            const statePayload =
                verifyToken(state);


            if (!statePayload) {

                return res
                    .status(400)
                    .send(
                        "Session OAuth2 invalide ou expirée."
                    );

            }


            // ==========================================
            // ÉCHANGE DU CODE
            // ==========================================

            const tokenResponse =
                await fetch(
                    "https://discord.com/api/oauth2/token",
                    {

                        method: "POST",

                        headers: {

                            "Content-Type":
                                "application/x-www-form-urlencoded"

                        },

                        body:
                            new URLSearchParams({

                                client_id:
                                    process.env.DISCORD_CLIENT_ID,

                                client_secret:
                                    process.env.DISCORD_CLIENT_SECRET,

                                grant_type:
                                    "authorization_code",

                                code:
                                    code,

                                redirect_uri:
                                    process.env.DISCORD_REDIRECT_URI

                            })

                    }
                );


            if (!tokenResponse.ok) {

                const errorText =
                    await tokenResponse.text();


                console.error(
                    "❌ Erreur token Discord :",
                    errorText
                );


                return res
                    .status(500)
                    .send(
                        "Impossible de se connecter à Discord."
                    );

            }


            const tokenData =
                await tokenResponse.json();


            // ==========================================
            // PROFIL DISCORD
            // ==========================================

            const userResponse =
                await fetch(
                    "https://discord.com/api/users/@me",
                    {

                        headers: {

                            Authorization:
                                `Bearer ${tokenData.access_token}`

                        }

                    }
                );


            if (!userResponse.ok) {

                console.error(
                    "❌ Impossible de récupérer le profil Discord."
                );


                return res
                    .status(500)
                    .send(
                        "Impossible de récupérer ton profil Discord."
                    );

            }


            const user =
                await userResponse.json();


            console.log(
                `🔐 Connexion Discord : ${user.username} (${user.id})`
            );


            // ==========================================
            // CRÉATION DE NOTRE SESSION
            // ==========================================

            const sessionToken =
                createToken({

                    userId:
                        user.id,

                    username:
                        user.username,

                    globalName:
                        user.global_name ||
                        user.username,

                    avatar:
                        user.avatar ||
                        null,

                    exp:
                        Date.now() +
                        (30 * 24 * 60 * 60 * 1000)

                });


            // ==========================================
            // RETOUR VERS LE SITE
            // ==========================================

            const redirectURL =
                `${FRONTEND_URL}/#discord_token=${encodeURIComponent(sessionToken)}`;


            res.redirect(
                redirectURL
            );

        }

        catch (error) {

            console.error(
                "❌ Erreur OAuth2 :",
                error
            );


            res
                .status(500)
                .send(
                    "Une erreur est survenue pendant la connexion Discord."
                );

        }

    }
);


// ======================================================
// VÉRIFIER LA SESSION CONNECTÉE
// ======================================================

app.get(
    "/auth/me",
    (req, res) => {

        const authorization =
            req.headers.authorization;


        if (!authorization) {

            return res
                .status(401)
                .json({
                    connected: false
                });

        }


        if (
            !authorization.startsWith(
                "Bearer "
            )
        ) {

            return res
                .status(401)
                .json({
                    connected: false
                });

        }


        const token =
            authorization.substring(7);


        const session =
            verifyToken(token);


        if (!session) {

            return res
                .status(401)
                .json({
                    connected: false
                });

        }


        res.json({

            connected: true,

            user: {

                id:
                    session.userId,

                username:
                    session.username,

                globalName:
                    session.globalName,

                avatar:
                    session.avatar

            }

        });

    }
);


// ======================================================
// STATUT AUTHENTIFICATION
// ======================================================

app.get(
    "/auth/status",
    (req, res) => {

        res.json({

            oauth2: true,

            discord: true

        });

    }
);


// ======================================================
// TEST PERMISSIONS
// ======================================================

app.get(
    "/auth/permissions",
    discordAuth,
    (req, res) => {

        try {

            const permissions =
                getMemberPermissions(
                    req.discordMember
                );


            const roles =
                req.discordMember
                    .roles
                    .cache
                    .filter(
                        role =>
                            role.id !== GUILD_ID
                    )
                    .map(
                        role => ({
                            id:
                                role.id,

                            name:
                                role.name
                        })
                    );


            res.json({

                connected: true,

                user: {

                    id:
                        req.discordMember
                            .user
                            .id,

                    username:
                        req.discordMember
                            .user
                            .username

                },

                roles:

                    roles,

                permissions:

                    permissions

            });

        }

        catch (error) {

            console.error(
                "❌ Erreur permissions :",
                error
            );


            res
                .status(500)
                .json({

                    error:
                        "Impossible de récupérer les permissions."

                });

        }

    }
);


// ======================================================
// BOT DISCORD
// ======================================================

client.once(
    Events.ClientReady,
    async () => {

        console.log(
            `✅ Connecté : ${client.user.tag}`
        );


        // ==============================================
        // CHARGEMENT INITIAL
        // ==============================================

        eventsCache =
            await updateEvents(
                client,
                GUILD_ID
            );


        staffCache =
            await updateStaff(
                client,
                GUILD_ID,
                STAFF_ROLES
            );


        statsCache =
            await updateStats(
                client,
                GUILD_ID
            );


        announcementsCache =
            await updateAnnouncements(
                client,
                ANNOUNCEMENTS_CHANNEL_ID
            );


        rulesCache =
            await updateRules(
                client,
                RULES_CHANNEL_ID
            );


        console.log(
            "✅ Toutes les données sont chargées."
        );


        // ==============================================
        // ÉVÉNEMENTS
        // ==============================================

        setInterval(
            async () => {

                try {

                    eventsCache =
                        await updateEvents(
                            client,
                            GUILD_ID
                        );

                }

                catch (error) {

                    console.error(
                        "❌ Erreur mise à jour événements :",
                        error
                    );

                }

            },
            5 * 60 * 1000
        );


        // ==============================================
        // STATISTIQUES
        // ==============================================

        setInterval(
            async () => {

                try {

                    statsCache =
                        await updateStats(
                            client,
                            GUILD_ID
                        );

                }

                catch (error) {

                    console.error(
                        "❌ Erreur mise à jour statistiques :",
                        error
                    );

                }

            },
            5 * 60 * 1000
        );


        // ==============================================
        // STAFF
        // ==============================================

        setInterval(
            async () => {

                try {

                    staffCache =
                        await updateStaff(
                            client,
                            GUILD_ID,
                            STAFF_ROLES
                        );

                }

                catch (error) {

                    console.error(
                        "❌ Erreur mise à jour staff :",
                        error
                    );

                }

            },
            30 * 60 * 1000
        );


        // ==============================================
        // ANNONCES
        // ==============================================

        setInterval(
            async () => {

                try {

                    announcementsCache =
                        await updateAnnouncements(
                            client,
                            ANNOUNCEMENTS_CHANNEL_ID
                        );

                }

                catch (error) {

                    console.error(
                        "❌ Erreur mise à jour annonces :",
                        error
                    );

                }

            },
            60 * 1000
        );


        // ==============================================
        // RÈGLEMENT
        // ==============================================

        setInterval(
            async () => {

                try {

                    rulesCache =
                        await updateRules(
                            client,
                            RULES_CHANNEL_ID
                        );

                }

                catch (error) {

                    console.error(
                        "❌ Erreur mise à jour règlement :",
                        error
                    );

                }

            },
            60 * 1000
        );

    }
);


// ======================================================
// MISE À JOUR AUTOMATIQUE DU STAFF
// ======================================================

client.on(
    Events.GuildMemberUpdate,
    async () => {

        try {

            staffCache =
                await updateStaff(
                    client,
                    GUILD_ID,
                    STAFF_ROLES
                );

        }

        catch (error) {

            console.error(
                "❌ Erreur mise à jour staff :",
                error
            );

        }

    }
);


client.on(
    Events.GuildMemberAdd,
    async () => {

        try {

            staffCache =
                await updateStaff(
                    client,
                    GUILD_ID,
                    STAFF_ROLES
                );


            statsCache =
                await updateStats(
                    client,
                    GUILD_ID
                );

        }

        catch (error) {

            console.error(
                "❌ Erreur arrivée membre :",
                error
            );

        }

    }
);


client.on(
    Events.GuildMemberRemove,
    async () => {

        try {

            staffCache =
                await updateStaff(
                    client,
                    GUILD_ID,
                    STAFF_ROLES
                );


            statsCache =
                await updateStats(
                    client,
                    GUILD_ID
                );

        }

        catch (error) {

            console.error(
                "❌ Erreur départ membre :",
                error
            );

        }

    }
);


// ======================================================
// ROUTES API
// ======================================================

app.get(
    "/",
    (req, res) => {

        res.send(
            "API La communauté live opérationnelle 🚀"
        );

    }
);


app.get(
    "/stats",
    (req, res) => {

        res.json(
            statsCache
        );

    }
);


app.get(
    "/events",
    (req, res) => {

        res.json(
            eventsCache
        );

    }
);


app.get(
    "/staff",
    (req, res) => {

        res.json(
            staffCache
        );

    }
);


app.get(
    "/annonces",
    (req, res) => {

        res.json(
            announcementsCache
        );

    }
);


app.get(
    "/regles",
    (req, res) => {

        res.json(
            rulesCache
        );

    }
);


// ======================================================
// SERVEUR
// ======================================================

app.listen(
    PORT,
    () => {

        console.log(
            `🌍 Serveur lancé sur le port ${PORT}`
        );

    }
);


// ======================================================
// CONNEXION BOT
// ======================================================

client.login(
    process.env.DISCORD_TOKEN
);
