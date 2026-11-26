const MEMBERS_CACHE_TTL = 60 * 1000;

function createMembersService(getGuild) {
    let membersListCache = null;
    let membersListCacheAt = 0;
    let membersListPromise = null;

    function invalidateCache() {
        membersListCache = null;
        membersListCacheAt = 0;
    }

    async function readGuildMembers(guild, GUILD_ID) {
        const allMembers = new Map();
        let after;

        while (true) {
            const options = { limit: 1000 };
            if (after) options.after = after;

            const batch = await guild.members.list(options);
            if (batch.size === 0) break;

            for (const member of batch.values()) {
                allMembers.set(member.id, member);
            }

            const lastMember = batch.last();
            if (!lastMember || batch.size < 1000) break;
            after = lastMember.id;
        }

        return [...allMembers.values()]
            .map(member => ({
                id: member.user.id,
                username: member.user.username,
                globalName: member.user.globalName || member.user.username,
                displayName: member.displayName,
                nickname: member.nickname || "",
                status: guild.presences.cache.get(member.id)?.status || "unknown",
                avatar: member.user.displayAvatarURL({ extension: "png", size: 128 }),
                bot: member.user.bot,
                roles: member.roles.cache
                    .filter(role => role.id !== GUILD_ID)
                    .sort((a, b) => b.position - a.position)
                    .map(role => ({ id: role.id, name: role.name, color: role.hexColor }))
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" }));
    }

    async function getMembers(GUILD_ID) {
        if (membersListCache && Date.now() - membersListCacheAt < MEMBERS_CACHE_TTL) {
            return membersListCache;
        }

        if (!membersListPromise) {
            membersListPromise = (async () => {
                const guild = await getGuild();
                return readGuildMembers(guild, GUILD_ID);
            })()
                .then(members => {
                    membersListCache = members;
                    membersListCacheAt = Date.now();
                    return members;
                })
                .finally(() => { membersListPromise = null; });
        }

        return membersListPromise;
    }

    return { getMembers, invalidateCache };
}

module.exports = { createMembersService };
