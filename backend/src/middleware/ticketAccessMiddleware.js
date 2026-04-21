const db = require("../db");

module.exports = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Fetch ticket
        const [rows] = await db.execute(
            "SELECT * FROM support_tickets WHERE ticket_id = ?",
            [id]
        );

        // If ticket doesn't exist
        if (rows.length === 0) {
            return res.status(404).json({ message: "Ticket not found" });
        }

        const ticket = rows[0];

        //  Ensure type consistency 
        const userId = Number(req.user.id);

        // Access checks
        const isOwner = ticket.raised_by === userId;
        const isAssigned = ticket.assigned_to === userId;
        const isAdmin = req.user.role === "admin";

        // Deny if no permission
        if (!isOwner && !isAssigned && !isAdmin) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        // Attach ticket to request
        req.ticket = ticket;

        next();

    } catch (err) {
        console.error("Ticket access middleware error:", err);
        res.status(500).json({ message: "Server error" });
    }
};