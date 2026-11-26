const crypto = require("crypto");

function base64urlEncode(value) {
    return Buffer.from(value)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64urlDecode(value) {
    value = value.replace(/-/g, "+").replace(/_/g, "/");

    while (value.length % 4) {
        value += "=";
    }

    return Buffer.from(value, "base64").toString("utf8");
}

function createSignature(data) {
    if (!process.env.SESSION_SECRET) {
        throw new Error("SESSION_SECRET n'est pas configurée.");
    }

    return crypto
        .createHmac("sha256", process.env.SESSION_SECRET)
        .update(data)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function createToken(payload) {
    const encodedPayload = base64urlEncode(
        JSON.stringify(payload)
    );

    return `${encodedPayload}.${createSignature(encodedPayload)}`;
}

function verifyToken(token) {
    if (
        !token ||
        !process.env.SESSION_SECRET ||
        typeof token !== "string"
    ) {
        return null;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
        return null;
    }

    const [encodedPayload, signature] = parts;

    let expectedSignature;

    try {
        expectedSignature = createSignature(encodedPayload);
    } catch {
        return null;
    }

    const received = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);

    if (received.length !== expected.length) {
        return null;
    }

    if (!crypto.timingSafeEqual(received, expected)) {
        return null;
    }

    try {
        const payload = JSON.parse(
            base64urlDecode(encodedPayload)
        );

        if (!payload.exp || Date.now() > payload.exp) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

function createOAuthState() {
    return createToken({
        nonce: crypto.randomBytes(32).toString("hex"),
        exp: Date.now() + 10 * 60 * 1000
    });
}

module.exports = {
    base64urlEncode,
    base64urlDecode,
    createSignature,
    createToken,
    verifyToken,
    createOAuthState
};
