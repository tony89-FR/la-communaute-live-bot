const MESSAGE_XP_NORMAL = 20;
const MESSAGE_XP_COOLDOWN = 15;
const MESSAGE_COOLDOWN_MS = 30_000;

function xpRequiredForLevel(level) {
    if (!Number.isInteger(level) || level < 1) {
        throw new TypeError("Le niveau doit être un entier supérieur ou égal à 1.");
    }

    if (level === 1) return 0;
    return 25 * (level - 1) * (level + 2);
}

function getLevelFromXp(totalXp) {
    if (!Number.isSafeInteger(totalXp) || totalXp < 0) {
        throw new TypeError("L'XP total doit être un entier positif sûr.");
    }

    // Inverse of: XP(level) = 25 * (level - 1) * (level + 2).
    let level = Math.max(1, Math.floor((Math.sqrt(9 + (4 * totalXp) / 25) - 1) / 2));

    // Correct possible floating-point rounding at exact thresholds.
    while (xpRequiredForLevel(level + 1) <= totalXp) level += 1;
    while (level > 1 && xpRequiredForLevel(level) > totalXp) level -= 1;
    return level;
}

function createXpService(database) {
    if (!database) throw new TypeError("Une connexion SQLite est obligatoire.");

    const ensureMember = database.prepare(`
        INSERT OR IGNORE INTO member_progress (guild_id, user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    `);
    const getMember = database.prepare(`
        SELECT guild_id, user_id, xp, coins, last_text_message_at
        FROM member_progress WHERE guild_id = ? AND user_id = ?
    `);
    const getActiveBoost = database.prepare(`
        SELECT multiplier FROM active_xp_boosts
        WHERE guild_id = ? AND user_id = ? AND status = 'active'
          AND starts_at <= ? AND expires_at > ?
        ORDER BY multiplier DESC LIMIT 1
    `);
    const updateXp = database.prepare(`
        UPDATE member_progress SET xp = xp + ?, updated_at = ?
        WHERE guild_id = ? AND user_id = ?
    `);
    const insertXpTransaction = database.prepare(`
        INSERT INTO xp_transactions (guild_id, user_id, source, amount, created_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    const updateLastMessage = database.prepare(`
        UPDATE member_progress SET last_text_message_at = ?, updated_at = ?
        WHERE guild_id = ? AND user_id = ?
    `);

    function inTransaction(callback) {
        database.exec("BEGIN IMMEDIATE");
        try {
            const result = callback();
            database.exec("COMMIT");
            return result;
        } catch (error) {
            try { database.exec("ROLLBACK"); } catch (_) { /* Preserve the original error. */ }
            throw error;
        }
    }

    function buildAwardResult(previousXp, newXp, awardedXp, multiplier, source) {
        const previousLevel = getLevelFromXp(previousXp);
        const newLevel = getLevelFromXp(newXp);
        const levelsGained = [];

        for (let level = previousLevel + 1; level <= newLevel; level += 1) {
            levelsGained.push(level);
        }

        return {
            source,
            previousXp,
            totalXp: newXp,
            awardedXp,
            multiplier,
            previousLevel,
            level: newLevel,
            levelsGained,
            xpIntoLevel: newXp - xpRequiredForLevel(newLevel),
            xpForNextLevel: xpRequiredForLevel(newLevel + 1) - xpRequiredForLevel(newLevel)
        };
    }

    function applyXpInsideTransaction(guildId, userId, baseAmount, source, now) {
        ensureMember.run(guildId, userId, now, now);
        const member = getMember.get(guildId, userId);
        const boost = getActiveBoost.get(guildId, userId, now, now);
        const multiplier = boost ? Number(boost.multiplier) : 1;
        const awardedXp = Math.round(baseAmount * multiplier);
        const previousXp = Number(member.xp);

        updateXp.run(awardedXp, now, guildId, userId);
        insertXpTransaction.run(guildId, userId, source, awardedXp, now);

        return buildAwardResult(previousXp, previousXp + awardedXp, awardedXp, multiplier, source);
    }

    function awardXp(guildId, userId, baseAmount, source, now = Date.now()) {
        if (!guildId || !userId) throw new TypeError("Le serveur et le membre sont obligatoires.");
        if (!Number.isSafeInteger(baseAmount) || baseAmount <= 0) {
            throw new TypeError("Le montant d'XP doit être un entier positif.");
        }
        if (!source || typeof source !== "string") throw new TypeError("La source d'XP est obligatoire.");

        return inTransaction(() => applyXpInsideTransaction(guildId, userId, baseAmount, source, now));
    }

    function awardMessage(message, now = Date.now()) {
        if (!message || !message.guild || !message.author || message.author.bot || message.webhookId) return null;
        if (!message.guild.id || !message.author.id) return null;

        const hasText = typeof message.content === "string" && message.content.trim().length > 0;
        const hasAttachment = Boolean(message.attachments && message.attachments.size > 0);
        const hasSticker = Boolean(message.stickers && message.stickers.size > 0);
        const hasEmbed = Array.isArray(message.embeds) && message.embeds.length > 0;
        if (!hasText && !hasAttachment && !hasSticker && !hasEmbed) return null;

        return inTransaction(() => {
            const guildId = message.guild.id;
            const userId = message.author.id;
            ensureMember.run(guildId, userId, now, now);
            const member = getMember.get(guildId, userId);
            const lastMessageAt = member.last_text_message_at;
            const elapsed = lastMessageAt === null ? null : now - Number(lastMessageAt);
            const baseAmount = elapsed === null || elapsed >= MESSAGE_COOLDOWN_MS
                ? MESSAGE_XP_NORMAL
                : MESSAGE_XP_COOLDOWN;

            // The 30-second timer restarts after every valid message, even when it earns 15 XP.
            updateLastMessage.run(now, now, guildId, userId);
            return applyXpInsideTransaction(guildId, userId, baseAmount, "message", now);
        });
    }

    function getProgress(guildId, userId) {
        const member = getMember.get(guildId, userId);
        if (!member) {
            return {
                guildId,
                userId,
                xp: 0,
                coins: 0,
                level: 1,
                xpIntoLevel: 0,
                xpForNextLevel: xpRequiredForLevel(2)
            };
        }

        const xp = Number(member.xp);
        const level = getLevelFromXp(xp);
        return {
            guildId,
            userId,
            xp,
            coins: Number(member.coins),
            level,
            xpIntoLevel: xp - xpRequiredForLevel(level),
            xpForNextLevel: xpRequiredForLevel(level + 1) - xpRequiredForLevel(level)
        };
    }

    return { awardXp, awardMessage, getProgress };
}

module.exports = {
    createXpService,
    xpRequiredForLevel,
    getLevelFromXp,
    MESSAGE_XP_NORMAL,
    MESSAGE_XP_COOLDOWN,
    MESSAGE_COOLDOWN_MS
};
