module.exports = function registerMembersRoutes(app, context) {
    const { discordAuth, requireSitePermission, PERMISSIONS, membersService, GUILD_ID, handleRouteError } = context;

    app.get(
        "/members",
        discordAuth,
        requireSitePermission(PERMISSIONS.MEMBER_LIST),
        async (req, res) => {
            try {
                const members = await membersService.getMembers(GUILD_ID);
                return res.json({ count: members.length, members });
            } catch (error) {
                return handleRouteError(res, error, "Impossible de récupérer les membres.");
            }
        }
    );
};
