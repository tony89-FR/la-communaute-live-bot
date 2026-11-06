module.exports = function registerSanctionsRoutes(app, context) {
    const {
        discordAuth,
        requireSitePermission,
        handleRouteError,
        sanctions,
        getGuild,
        ensureActorCanManageTarget,
        isSnowflake
    } = context;
    const requireSanctionActionPermission = sanctions.requireSanctionActionPermission;
    const requireSanctionHistoryPermission = sanctions.requireSanctionHistoryPermission;

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

            const sanctionsList = sanctions.getHistory()
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

            return res.json({ memberId, sanctions: sanctionsList });
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
            const record = sanctions.getHistory().find(item => item.id === sanctionId);

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

            await sanctions.restoreMuteSanction(record, "revoked");
            return res.json({ ok: true, message: `Sanction levée pour ${record.memberName || record.memberId}.` });
        } catch (error) {
            return handleRouteError(res, error, "Impossible de lever cette sanction.");
        }
    }
);

// Les mutes vocaux continuent à s'appliquer si le membre rejoint un vocal

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
            const sanctionsList = [...sanctions.getHistory()]
                .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
                .map(serializeSanctionRecord);

            return res.json({ sanctions: sanctionsList });
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
            const sanctionsList = sanctions.getHistory()
                .filter(item => item.memberId === memberId)
                .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
                .map(serializeSanctionRecord);

            return res.json({ memberId, sanctions: sanctionsList });
        } catch (error) {
            return handleRouteError(
                res,
                error,
                "Impossible de récupérer tes sanctions."
            );
        }
    }
);
};
