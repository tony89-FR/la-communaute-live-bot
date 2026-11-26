const test = require("node:test");
const assert = require("node:assert/strict");
const { isSnowflake, safeReason } = require("../utils/errors");
const { createToken, verifyToken } = require("../utils/session");

test("isSnowflake accepte un identifiant Discord valide", () => {
    assert.equal(isSnowflake("1447249368783523942"), true);
    assert.equal(isSnowflake("abc"), false);
    assert.equal(isSnowflake(12345678901234567), false);
});

test("safeReason applique le motif par défaut et limite la longueur", () => {
    assert.equal(safeReason("  ", "Aucun motif"), "Aucun motif");
    assert.equal(safeReason("  Test  ", "Aucun motif"), "Test");
    assert.equal(safeReason("x".repeat(500), "Aucun motif").length, 450);
});

test("les jetons de session signés sont vérifiés et expirent", () => {
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "test-secret-not-for-production";
    try {
        const token = createToken({ userId: "123", exp: Date.now() + 60_000 });
        assert.equal(verifyToken(token).userId, "123");
        assert.equal(verifyToken(`${token}x`), null);
        const expired = createToken({ userId: "123", exp: Date.now() - 1 });
        assert.equal(verifyToken(expired), null);
    } finally {
        if (previous === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = previous;
    }
});
