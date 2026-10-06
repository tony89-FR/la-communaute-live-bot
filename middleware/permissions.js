// ======================================================
// MIDDLEWARE DES PERMISSIONS
// La communauté live
// ======================================================

const ROLES = require("../config/roles");


// ======================================================
// RÉCUPÉRER LES PERMISSIONS D'UN MEMBRE
// ======================================================

function getMemberPermissions(member) {

    const permissions = new Set();


    // ----------------------------------------------
    // @everyone
    // ----------------------------------------------

    const everyoneRole = ROLES.EVERYONE;

    if (everyoneRole) {

        everyoneRole.permissions.forEach(
            permission => permissions.add(permission)
        );

    }


    // ----------------------------------------------
    // RÔLES DISCORD DU MEMBRE
    // ----------------------------------------------

    if (!member) {
        return [...permissions];
    }


    const discordRoles =
        member.roles?.cache;


    if (!discordRoles) {
        return [...permissions];
    }


    for (const role of discordRoles.values()) {

        const roleConfig =
            Object.values(ROLES).find(
                config => config.id === role.id
            );


        if (!roleConfig) {
            continue;
        }


        roleConfig.permissions.forEach(
            permission => permissions.add(permission)
        );

    }


    return [...permissions];
}


// ======================================================
// VÉRIFIER UNE PERMISSION
// ======================================================

function hasPermission(member, permission) {

    const permissions =
        getMemberPermissions(member);

    return permissions.includes(permission);
}


// ======================================================
// MIDDLEWARE EXPRESS
// ======================================================

function requirePermission(permission) {

    return (req, res, next) => {

        try {

            if (!req.discordMember) {

                return res.status(401).json({
                    error: "Utilisateur Discord non authentifié."
                });

            }


            if (
                !hasPermission(
                    req.discordMember,
                    permission
                )
            ) {

                return res.status(403).json({
                    error: "Vous n'avez pas la permission nécessaire."
                });

            }


            next();

        }

        catch (error) {

            console.error(
                "❌ Erreur vérification permission :",
                error
            );

            return res.status(500).json({
                error: "Erreur lors de la vérification des permissions."
            });

        }

    };
}


// ======================================================
// EXPORT
// ======================================================

module.exports = {

    getMemberPermissions,

    hasPermission,

    requirePermission

};
