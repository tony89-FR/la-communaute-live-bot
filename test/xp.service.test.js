const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../database");
const {
    createXpService,
    xpRequiredForLevel,
    getLevelFromXp
} = require("../services/xp.service");

function makeMessage({ guildId = "guild-1", userId = "user-1", content = "bonjour", bot = false } = {}) {
    return {
        guild: { id: guildId },
        author: { id: userId, bot },
        content,
        attachments: new Map(),
        stickers: new Map(),
        embeds: []
    };
}

test("les seuils progressifs correspondent aux seuils validés", () => {
    assert.deepEqual([2, 3, 4, 5, 6, 7].map(xpRequiredForLevel), [100, 250, 450, 700, 1000, 1350]);
    assert.deepEqual([0, 99, 100, 249, 250, 450, 1350].map(getLevelFromXp), [1, 1, 2, 2, 3, 4, 7]);
});

test("les messages suivent le délai de 30 secondes et le redémarrent à chaque message", () => {
    const db = createDatabase(":memory:");
    try {
        const xp = createXpService(db);
        assert.equal(xp.awardMessage(makeMessage(), 1_000).awardedXp, 20);
        assert.equal(xp.awardMessage(makeMessage(), 20_000).awardedXp, 15);
        assert.equal(xp.awardMessage(makeMessage(), 49_999).awardedXp, 15);
        assert.equal(xp.awardMessage(makeMessage(), 80_000).awardedXp, 20);
        assert.equal(xp.getProgress("guild-1", "user-1").xp, 70);
    } finally {
        db.close();
    }
});

test("les messages vides et les bots ne donnent pas d'XP", () => {
    const db = createDatabase(":memory:");
    try {
        const xp = createXpService(db);
        assert.equal(xp.awardMessage(makeMessage({ content: "   " }), 1_000), null);
        assert.equal(xp.awardMessage(makeMessage({ bot: true }), 2_000), null);
        assert.equal(xp.getProgress("guild-1", "user-1").xp, 0);
    } finally {
        db.close();
    }
});

test("un boost actif multiplie l'XP attribuée", () => {
    const db = createDatabase(":memory:");
    try {
        const xp = createXpService(db);
        db.prepare(`INSERT INTO active_xp_boosts (guild_id, user_id, multiplier, starts_at, expires_at)
                    VALUES (?, ?, ?, ?, ?)`).run("guild-1", "user-1", 3, 0, 10_000);
        const result = xp.awardXp("guild-1", "user-1", 10, "voice", 1_000);
        assert.equal(result.multiplier, 3);
        assert.equal(result.awardedXp, 30);
        assert.equal(result.totalXp, 30);
    } finally {
        db.close();
    }
});


test("les XP restent présentes après fermeture et réouverture de SQLite", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xaoris-xp-"));
    const databasePath = path.join(directory, "progress.sqlite");

    try {
        let db = createDatabase(databasePath);
        let xp = createXpService(db);
        xp.awardMessage(makeMessage(), 1_000);
        db.close();

        db = createDatabase(databasePath);
        xp = createXpService(db);
        assert.equal(xp.getProgress("guild-1", "user-1").xp, 20);
        db.close();
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
