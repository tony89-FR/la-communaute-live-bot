async function updateStaff(client, GUILD_ID, STAFF_ROLES) {

    try {

        const guild = client.guilds.cache.get(GUILD_ID);

        if (!guild) return [];

        await guild.members.fetch();

        const staff = [];

        for (const roleInfo of STAFF_ROLES) {

            const role = guild.roles.cache.get(roleInfo.id);

            if (!role) continue;

            const members = role.members.map(member => ({

                id: member.id,
                username: member.user.username,
                displayName: member.displayName,

                avatar: member.user.displayAvatarURL({
                    extension: "png",
                    size: 512
                }),

                profile: `https://discord.com/users/${member.id}`

            }));

            staff.push({

                role: roleInfo.name,
                color: role.hexColor,
                members

            });

        }

        console.log(`👥 Staff synchronisé (${staff.length} rôle(s))`);

        return staff;

    } catch (err) {

        console.error("Erreur updateStaff :", err);

        return [];

    }

}

module.exports = {
    updateStaff
};
