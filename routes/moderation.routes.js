module.exports = function registerModerationRoutes(app, context) {
    const {
        discordAuth,
        requireSitePermission,
        PERMISSIONS,
        getGuild,
        getBotMember,
        fetchTarget,
        ensureActorCanManageTarget,
        ensureBotCanManageTarget,
        safeReason,
        handleRouteError,
        invalidateMembersCache,
        PermissionFlagsBits,
        isSnowflake,
        sanctions
    } = context;
    const requireSanctionActionPermission = sanctions.requireSanctionActionPermission;

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
                durationMinutes > sanctions.MAX_TEMP_BAN_MINUTES
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
            const sanctionRecord = sanctions.addSanctionHistory({
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

            sanctions.scheduleTemporaryUnban(
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
                sanctions.temporaryBanTimers.get(target.id);

            if (existingTimer) {
                clearTimeout(existingTimer.timer);
                sanctions.temporaryBanTimers.delete(target.id);
            }

            for (const previousRecord of sanctions.getHistory().filter(item =>
                item.memberId === target.id && item.type === "ban_temp" && item.status === "active"
            )) {
                sanctions.updateSanctionRecord(previousRecord, {
                    status: "superseded",
                    endedAt: new Date().toISOString()
                });
            }

            sanctions.addSanctionHistory({
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
            sanctions.addSanctionHistory({
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

            const alreadyActive = sanctions.getHistory().find(item =>
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
            record = sanctions.addSanctionHistory({
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

                sanctions.updateSanctionRecord(record, { status: "active" });
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
                sanctions.updateSanctionRecord(record, {
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

};
