const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function createSanctionsService({
    client,
    GUILD_ID,
    PermissionFlagsBits,
    getMemberPermissions,
    getGuild,
    getBotMember,
    invalidateMembersCache
}) {
    const temporaryBanTimers = new Map();
    const MAX_TEMP_BAN_MINUTES = 7 * 24 * 60;
    const SANCTIONS_FILE = path.join(__dirname, "..", "sanctions.json");
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

async function handleVoiceStateUpdate(_oldState, newState) {
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
}

async function handleChannelCreate(channel) {
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
}

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

    return {
        getHistory: () => sanctionsHistory,
        addSanctionHistory,
        updateSanctionRecord,
        hasSanctionActionPermission,
        requireSanctionActionPermission,
        requireSanctionHistoryPermission,
        scheduleTemporaryUnban,
        temporaryBanTimers,
        MAX_TEMP_BAN_MINUTES,
        restoreMuteSanction,
        expireDueSanctions,
        resumeActiveSanctions,
        handleVoiceStateUpdate,
        handleChannelCreate
    };
}

module.exports = { createSanctionsService };
