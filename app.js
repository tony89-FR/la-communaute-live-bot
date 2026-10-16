const express = require("express");
const cors = require("cors");
const { PermissionFlagsBits } = require("discord.js");

const {
    GUILD_ID,
    STAFF_ROLES,
    ANNOUNCEMENTS_CHANNEL_ID,
    RULES_CHANNEL_ID
} = require("./config/config");

const PERMISSIONS = require("./config/permissions");
const { getMemberPermissions } = require("./middleware/permissions");
const { requireDiscordMember } = require("./middleware/discordAuth");
const { updateStaff } = require("./config/staff");
const { updateEvents } = require("./services/events");
const { updateStats } = require("./services/stats");
const { updateAnnouncements } = require("./services/annonces");
const { updateRules } = require("./services/regles");
const { createSiteDataService } = require("./services/siteData.service");
const { createMembersService } = require("./services/members.service");
const { createModerationService } = require("./services/moderation.service");
const { createSanctionsService } = require("./services/sanctions.service");
const { createDiscordUtils } = require("./utils/discord");
const { createToken, verifyToken, createOAuthState } = require("./utils/session");
const { isSnowflake, safeReason, handleRouteError } = require("./utils/errors");
const client = require("./discord/client");

const registerAuthRoutes = require("./routes/auth.routes");
const registerMembersRoutes = require("./routes/members.routes");
const registerModerationRoutes = require("./routes/moderation.routes");
const registerSanctionsRoutes = require("./routes/sanctions.routes");
const registerChatRoutes = require("./routes/chat.routes");
const registerPublicRoutes = require("./routes/public.routes");
const registerCreationRoutes = require("./routes/creation.routes");
const registerReadyHandler = require("./discord/handlers/ready");
const registerGuildMemberEvents = require("./discord/handlers/guildMembers");
const registerVoiceStateUpdate = require("./discord/handlers/voiceStateUpdate");
const registerChannelCreate = require("./discord/handlers/channelCreate");
const { createCreationService } = require("./services/creation.service");

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = "https://tony89-fr.github.io";

function createRequireSitePermission() {
    return permission => (req, res, next) => {
        if (!req.discordMember) {
            return res.status(401).json({ error: "Utilisateur Discord non authentifié." });
        }
        const permissions = getMemberPermissions(req.discordMember);
        if (!permissions.includes(permission)) {
            return res.status(403).json({ error: "Tu n'as pas la permission nécessaire." });
        }
        return next();
    };
}

async function start() {
    const app = express();
    app.use(cors({
        origin: FRONTEND_URL,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
    }));
    app.use(express.json({ limit: "25kb" }));

    const siteData = createSiteDataService();
    const discordUtils = createDiscordUtils(client, GUILD_ID);
    const creationService = createCreationService({
        client,
        GUILD_ID,
        ANNOUNCEMENTS_CHANNEL_ID,
        PermissionFlagsBits,
        getGuild: discordUtils.getGuild,
        getBotMember: discordUtils.getBotMember,
        updateEvents,
        updateAnnouncements,
        siteData
    });
    const membersService = createMembersService(discordUtils.getGuild);
    const moderationService = createModerationService({ isSnowflake });
    const sanctions = createSanctionsService({
        client,
        GUILD_ID,
        PermissionFlagsBits,
        getMemberPermissions,
        getGuild: discordUtils.getGuild,
        getBotMember: discordUtils.getBotMember,
        invalidateMembersCache: membersService.invalidateCache
    });
    const discordAuth = requireDiscordMember(client, GUILD_ID, verifyToken);

    const context = {
        client,
        app,
        GUILD_ID,
        STAFF_ROLES,
        ANNOUNCEMENTS_CHANNEL_ID,
        RULES_CHANNEL_ID,
        FRONTEND_URL,
        PERMISSIONS,
        PermissionFlagsBits,
        discordAuth,
        getMemberPermissions,
        requireSitePermission: createRequireSitePermission(),
        createOAuthState,
        createToken,
        verifyToken,
        isSnowflake,
        safeReason,
        handleRouteError,
        ...discordUtils,
        ...moderationService,
        invalidateMembersCache: membersService.invalidateCache,
        membersService,
        sanctions,
        siteData,
        creationService
    };

    registerAuthRoutes(app, context);
    registerMembersRoutes(app, context);
    registerModerationRoutes(app, context);
    registerSanctionsRoutes(app, context);
    registerChatRoutes(app, context);
    registerPublicRoutes(app, context);
    registerCreationRoutes(app, context);

    const handlersContext = {
        GUILD_ID,
        STAFF_ROLES,
        ANNOUNCEMENTS_CHANNEL_ID,
        RULES_CHANNEL_ID,
        updateStaff,
        updateEvents,
        updateStats,
        updateAnnouncements,
        updateRules,
        siteData,
        sanctions
    };

    registerReadyHandler(client, handlersContext);
    registerGuildMemberEvents(client, handlersContext);
    registerVoiceStateUpdate(client, sanctions);
    registerChannelCreate(client, sanctions);

    const server = app.listen(PORT, () => {
        console.log(`🌍 Serveur lancé sur le port ${PORT}`);
    });

    client.login(process.env.DISCORD_TOKEN).catch(error => {
        console.error("Erreur de connexion du bot Discord :", error);
    });

    return { app, client, server };
}

module.exports = { start };
