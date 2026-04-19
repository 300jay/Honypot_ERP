const { logActivity } = require("../logger");
const db =  require("../db");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.JWT_SECRET;

module.exports = async (req, res, next) => {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        logActivity(db, {
            activity: "ACCESS_PROTECTED",
            ip_address: req.ip,
            result: "FAILED",
            source: "AUTH"
        });
        return res.json({ message: "No token provided" });
    }

    const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

    try {
        const decoded = jwt.verify(token, SECRET_KEY);

        const [results] = await db.execute(
            `SELECT * FROM admin.session_tracker 
             WHERE session_id = ? AND logout_time IS NULL`,
            [decoded.session_id]
        );

        if (results.length === 0) {
            logActivity(db, {
                account_id: decoded.id,
                activity: "INVALID_SESSION",
                ip_address: req.ip,
                result: "FAILED",
                source: "AUTH"
            });
            return res.json({ message: "Invalid session" });
        }

        const [roleResults] = await db.execute(
            `SELECT r.role_name 
             FROM og.account_role_map arm 
             JOIN og.access_roles r ON arm.role_id = r.role_id 
             WHERE arm.account_id = ?`,
            [decoded.id]
        );

        if (roleResults.length === 0) {
            logActivity(db, {
                account_id: decoded.id,
                activity: "ROLE_NOT_FOUND",
                ip_address: req.ip,
                result: "FAILED",
                source: "AUTH"
            });
            return res.json({ message: "Role not found" });
        }

        req.user = {
            ...decoded,
            role: roleResults[0].role_name
        };

        next();

    } catch (err) {
        logActivity(db, {
            activity: "INVALID_TOKEN",
            ip_address: req.ip,
            result: "FAILED",
            source: "AUTH"
        });
        return res.json({ message: "Invalid token" });
    }
};