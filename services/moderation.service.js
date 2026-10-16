function createModerationService({ isSnowflake }) {
    async function fetchTarget(guild, memberId) {
        if (!isSnowflake(memberId)) {
            const error = new Error("Identifiant du membre invalide.");
            error.status = 400;
            throw error;
        }

        try {
            return await guild.members.fetch(memberId);
        } catch {
            const error = new Error("Ce membre n'est pas présent sur le serveur Discord.");
            error.status = 404;
            throw error;
        }
    }

    function ensureActorCanManageTarget(actor, target, guild) {
        if (actor.id === target.id) {
            const error = new Error("Tu ne peux pas effectuer cette action sur ton propre compte.");
            error.status = 400;
            throw error;
        }

        if (target.id === guild.ownerId) {
            const error = new Error("Le propriétaire du serveur ne peut pas être modéré par cette action.");
            error.status = 403;
            throw error;
        }

        const isOwner = actor.id === guild.ownerId;
        const hasHierarchy = actor.roles.highest.comparePositionTo(target.roles.highest) > 0;
        if (!isOwner && !hasHierarchy) {
            const error = new Error("La hiérarchie des rôles Discord ne permet pas cette action.");
            error.status = 403;
            throw error;
        }
    }

    function ensureBotCanManageTarget(botMember, target, requiredPermission) {
        if (!botMember.permissions.has(requiredPermission)) {
            const error = new Error("Le bot n'a pas la permission Discord nécessaire.");
            error.status = 500;
            throw error;
        }

        if (
            botMember.id === target.id ||
            botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0
        ) {
            const error = new Error("Le rôle le plus élevé du bot doit être placé au-dessus de celui du membre.");
            error.status = 403;
            throw error;
        }
    }

    return { fetchTarget, ensureActorCanManageTarget, ensureBotCanManageTarget };
}

module.exports = { createModerationService };
