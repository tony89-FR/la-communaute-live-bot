// ======================================================
// RÔLES DISCORD → PERMISSIONS DU SITE
// La communauté live
// ======================================================

const PERMISSIONS = require("./permissions");


// ======================================================
// RÔLES
// ======================================================

const ROLES = {

    // ==================================================
    // FONDATEUR
    // ==================================================

    FONDATEUR: {

        id: "1447263311375761460",

        name: "👑 Fondateur",

        permissions: Object.values(PERMISSIONS)

    },


    // ==================================================
    // CO-FONDATEUR
    // ==================================================

    CO_FONDATEUR: {

        id: "1485266632270942288",

        name: "🛡 Co-Fondateur",

        permissions: Object.values(PERMISSIONS)

    },


    // ==================================================
    // CRÉATEUR
    // ==================================================

    CREATEUR: {

        id: "1447264238279196724",

        name: "✨ Créateur",

        permissions: [

            PERMISSIONS.DASHBOARD,
            PERMISSIONS.LEVEL_MONEY,
            PERMISSIONS.MEMBER_LIST,

            PERMISSIONS.TEMP_BAN,
            PERMISSIONS.PERM_BAN,
            PERMISSIONS.MANAGE_ROLES,

            PERMISSIONS.SANCTIONS_TOTAL,
            PERMISSIONS.VIEW_OWN_SANCTIONS,

            PERMISSIONS.OWN_CARD,

            PERMISSIONS.DISCORD_MOBILE,
            PERMISSIONS.DISCORD_PC,

            PERMISSIONS.SERVER_LOGS,
            PERMISSIONS.CREATE_EVENT,
            PERMISSIONS.CREATE_ANNOUNCEMENT

        ]

    },


    // ==================================================
    // BRAS DROIT
    // ==================================================

    BRAS_DROIT: {

        id: "1448333177947947109",

        name: "💪 Bras droit",

        permissions: [

            PERMISSIONS.DASHBOARD,
            PERMISSIONS.LEVEL_MONEY,
            PERMISSIONS.MEMBER_LIST,

            PERMISSIONS.TEMP_BAN,
            PERMISSIONS.PERM_BAN,
            PERMISSIONS.MANAGE_ROLES,

            PERMISSIONS.SANCTIONS_TOTAL,
            PERMISSIONS.VIEW_OWN_SANCTIONS,

            PERMISSIONS.OWN_CARD,

            PERMISSIONS.DISCORD_MOBILE,
            PERMISSIONS.DISCORD_PC,

            PERMISSIONS.SERVER_LOGS,
            PERMISSIONS.CREATE_EVENT

        ]

    },


    // ==================================================
    // CHEF MODÉRATEUR
    // ==================================================

    CHEF_MODERATEUR: {

        id: "1448333720946737368",

        name: "🟨 Chef Modérateur",

        permissions: [

            PERMISSIONS.DASHBOARD,
            PERMISSIONS.LEVEL_MONEY,
            PERMISSIONS.MEMBER_LIST,

            PERMISSIONS.TEMP_BAN,

            PERMISSIONS.SANCTIONS_TOTAL,
            PERMISSIONS.VIEW_OWN_SANCTIONS,

            PERMISSIONS.OWN_CARD,

            PERMISSIONS.DISCORD_MOBILE,
            PERMISSIONS.DISCORD_PC

        ]

    },


    // ==================================================
    // MODÉRATEUR
    // ==================================================

    MODERATEUR: {

        id: "1448334482867355832",

        name: "🟧 Modérateur",

        permissions: [

            PERMISSIONS.DASHBOARD,
            PERMISSIONS.LEVEL_MONEY,
            PERMISSIONS.MEMBER_LIST,

            PERMISSIONS.TEMP_BAN,

            PERMISSIONS.SANCTIONS_TOTAL,
            PERMISSIONS.VIEW_OWN_SANCTIONS,

            PERMISSIONS.OWN_CARD,

            PERMISSIONS.DISCORD_MOBILE,
            PERMISSIONS.DISCORD_PC

        ]

    },


    // ==================================================
    // MODÉRATEUR TEST
    // ==================================================

    MODERATEUR_TEST: {

        id: "1478757828637360251",

        name: "🟪 Modérateur test",

        permissions: [

            PERMISSIONS.DASHBOARD,
            PERMISSIONS.LEVEL_MONEY,
            PERMISSIONS.MEMBER_LIST,

            PERMISSIONS.TEMP_BAN,

            PERMISSIONS.SANCTIONS_TOTAL,
            PERMISSIONS.VIEW_OWN_SANCTIONS,

            PERMISSIONS.OWN_CARD,

            PERMISSIONS.DISCORD_MOBILE,
            PERMISSIONS.DISCORD_PC

        ]

    },


    // ==================================================
    // EVERYONE
    // ==================================================

    EVERYONE: {

        id: null,

        name: "@everyone",

        permissions: [

            PERMISSIONS.DASHBOARD,
            PERMISSIONS.LEVEL_MONEY,

            PERMISSIONS.VIEW_OWN_SANCTIONS,

            PERMISSIONS.OWN_CARD,

            PERMISSIONS.DISCORD_MOBILE,
            PERMISSIONS.DISCORD_PC

        ]

    }

};


// ======================================================
// EXPORT
// ======================================================

module.exports = ROLES;
