function isSnowflake(value) {
    return (
        typeof value === "string" &&
        /^\d{17,20}$/.test(value)
    );
}

function safeReason(value, fallback) {
    const reason = typeof value === "string" ? value.trim() : "";
    return (reason || fallback).slice(0, 450);
}

function handleRouteError(res, error, genericMessage) {
    console.error(genericMessage, error);
    return res.status(error.status || 500).json({
        error: error.status ? error.message : genericMessage
    });
}

module.exports = { isSnowflake, safeReason, handleRouteError };
