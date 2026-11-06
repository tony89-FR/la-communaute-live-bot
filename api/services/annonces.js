async function updateAnnouncements(client, channelId) {

    const channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel) return [];

    const messages = await channel.messages.fetch({ limit: 10 });

    return [...messages.values()]
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .map(message => ({
            id: message.id,
            author: message.author.username,
            avatar: message.author.displayAvatarURL({
                extension: "png",
                size: 256
            }),
            content: message.content,
            createdAt: message.createdTimestamp,
            attachments: [...message.attachments.values()].map(file => file.url)
        }));

}

module.exports = {
    updateAnnouncements
};
