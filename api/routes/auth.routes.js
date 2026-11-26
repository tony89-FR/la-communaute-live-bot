module.exports = function registerAuthRoutes(app, context) {
    const {
        client,
        GUILD_ID,
        FRONTEND_URL,
        createOAuthState,
        createToken,
        verifyToken,
        discordAuth,
        getMemberPermissions
    } = context;

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
};
