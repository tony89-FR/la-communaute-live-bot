async function updateRules(client, channelId) {

    const channel = await client.channels
        .fetch(channelId)
        .catch(() => null);

    if (!channel) {
        console.error("❌ Salon du règlement introuvable.");
        return {
            content: ""
        };
    }

    const messages = await channel.messages
        .fetch({ limit: 1 })
        .catch(() => null);

    if (!messages || messages.size === 0) {
        console.log("⚠️ Aucun message trouvé dans le salon du règlement.");
        return {
            content: ""
        };
    }

    const message = messages.first();

    return {
        content: message.content || ""
    };
}

module.exports = {
    updateRules
};
