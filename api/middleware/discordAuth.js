// ======================================================
// AUTHENTIFICATION DISCORD
// La communauté live
// ======================================================

function requireDiscordMember(
    client,
    guildId,
    verifyToken
) {

    return async (req, res, next) => {

        try {

            // ==========================================
            // RÉCUPÉRER LE TOKEN
            // ==========================================

            const authorization =
                req.headers.authorization;


            if (
                !authorization ||
                !authorization.startsWith("Bearer ")
            ) {

                return res.status(401).json({
                    error: "Authentification requise."
                });

            }


            const token =
                authorization.substring(7);


            // ==========================================
            // VÉRIFIER NOTRE SESSION
            // ==========================================

            const session =
                verifyToken(token);


            if (!session) {

                return res.status(401).json({
                    error: "Session invalide ou expirée."
                });

            }


            // ==========================================
            // RÉCUPÉRER LE SERVEUR DISCORD
            // ==========================================

            const guild =
                await client.guilds.fetch(guildId);


            if (!guild) {

                return res.status(500).json({
                    error: "Serveur Discord introuvable."
                });

            }


            // ==========================================
            // RÉCUPÉRER LE MEMBRE
            // ==========================================

            let member;


            try {

                member =
                    await guild.members.fetch(
                        session.userId
                    );

            }

            catch (error) {

                return res.status(403).json({
                    error: "Tu n'es pas membre du serveur Discord."
                });

            }


            // ==========================================
            // STOCKER LES INFORMATIONS
            // ==========================================

            req.discordSession =
                session;


            req.discordMember =
                member;


            // ==========================================
            // CONTINUER
            // ==========================================

            next();

        }

        catch (error) {

            console.error(
                "❌ Erreur authentification Discord :",
                error
            );

            return res.status(500).json({
                error: "Erreur lors de la vérification Discord."
            });

        }

    };

}


module.exports = {
    requireDiscordMember
};
