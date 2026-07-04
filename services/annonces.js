async function updateAnnouncements(client) {

    const channel = await client.channels.fetch("1447259599811121263");

    if (!channel) return [];

    const messages = await channel.messages.fetch({ limit: 10 });

    return [...messages.values()]
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .map(msg => ({

            id: msg.id,

            author: msg.author.username,

            avatar: msg.author.displayAvatarURL(),

            content: msg.content,

            date: msg.createdAt,

            attachments: msg.attachments.map(att => att.url)

        }));

}

module.exports = {
    updateAnnouncements
};
