const db = require("../db");
const crypto = require("crypto");

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

module.exports = async (req, res, next) => {
    try {
        const ip = getClientIP(req);

        const authHeader = req.headers.authorization;
        const token = authHeader ? authHeader.split(" ")[1] : null;
        const tokenHash = token ? hashToken(token) : null;

        // IP BLOCK
        const [ipRows] = await db.execute(
            "SELECT is_active FROM admin.ip_blocklist WHERE ip_address = ?",
            [ip]
        );

        if (ipRows.length && ipRows[0].is_active) {
            return res.status(403).json({ message: "IP BLOCKED" });
        }

        // JWT BLOCK
        if (tokenHash) {
            const [jwtRows] = await db.execute(
                "SELECT id FROM admin.jwt_blacklist WHERE token_hash = ?",
                [tokenHash]
            );

            if (jwtRows.length) {
                return res.status(401).json({ message: "TOKEN REVOKED" });
            }
        }

        // SESSION KILL
        if (tokenHash) {
            const [sessionRows] = await db.execute(
                "SELECT logout_time FROM admin.session_tracker WHERE token_hash = ?",
                [tokenHash]
            );

            if (sessionRows.length && sessionRows[0].logout_time !== null) {
                return res.status(401).json({ message: "SESSION TERMINATED" });
            }
        }

        next();
    } catch (err) {
        console.error("Security middleware error:", err);
        next(); // fail open (important)
    }
};