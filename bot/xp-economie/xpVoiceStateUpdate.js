const { Events } = require("discord.js");
const { announceLevelUps } = require("./xpAnnouncements");

const VOICE_XP_PER_MINUTE = 10;
const CHECK_INTERVAL_MS = 5_000;

module.exports = function registerXpVoiceStateUpdate(client, context) {
    const { GUILD_ID, xpService, LEVEL_UP_CHANNEL_ID } = context;
    const sessions = new Map();
    let interval = null;

    function awardCompletedMinutes(userId, session, now = Date.now()) {
        const completedMinutes = Math.floor((now - session.lastAwardAt) / 60_000);
        if (completedMinutes <= 0) return;

        const nextAwardAt = session.lastAwardAt + completedMinutes * 60_000;
        try {
            const result = xpService.awardXp(
                GUILD_ID,
                userId,
                VOICE_XP_PER_MINUTE * completedMinutes,
                "voice",
                now
            );
            session.lastAwardAt = nextAwardAt;

            if (result.levelsGained.length > 0) {
                announceLevelUps(client, GUILD_ID, userId, result.levelsGained, LEVEL_UP_CHANNEL_ID)
                    .catch(error => console.error("Erreur annonce niveau vocal :", error));
            }
        } catch (error) {
            console.error(`Erreur attribution XP vocal à ${userId} :`, error);
        }
    }

    function startSession(userId) {
        sessions.set(userId, { lastAwardAt: Date.now() });
    }

    function finishSession(userId) {
        const session = sessions.get(userId);
        if (!session) return;
        awardCompletedMinutes(userId, session);
        sessions.delete(userId);
    }

    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
        if (newState.guild.id !== GUILD_ID) return;

        const userId = newState.id || oldState.id;
        const member = newState.member || oldState.member;
        if (!userId) return;

        if (member && member.user.bot) {
            sessions.delete(userId);
            return;
        }

        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;
        if (oldChannelId === newChannelId) return; // mute/deafen changes do not interrupt XP time.

        if (oldChannelId) finishSession(userId);
        if (newChannelId) startSession(userId);
    });

    client.once(Events.ClientReady, () => {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) {
            console.error("Impossible d'initialiser le suivi vocal XP : serveur Discord introuvable.");
            return;
        }

        // Members already in voice when the bot starts begin a fresh tracked session.
        for (const voiceState of guild.voiceStates.cache.values()) {
            if (voiceState.channelId && voiceState.member && !voiceState.member.user.bot) {
                startSession(voiceState.id);
            }
        }

        interval = setInterval(() => {
            const now = Date.now();
            for (const [userId, session] of sessions) {
                awardCompletedMinutes(userId, session, now);
            }
        }, CHECK_INTERVAL_MS);
        if (typeof interval.unref === "function") interval.unref();

        console.log(`✅ Suivi XP vocal activé (${VOICE_XP_PER_MINUTE} XP par minute complète).`);
    });

    return {
        stop() {
            if (interval) clearInterval(interval);
            for (const userId of [...sessions.keys()]) finishSession(userId);
        }
    };
};
