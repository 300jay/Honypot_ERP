const db = require("../db");

// Honeypot logger
const logDecoyEvent = async (userId, type, ip) => {
    try {
        await db.execute(
            "INSERT INTO decoy_events (user_id, event_type, source_ip) VALUES (?,?,?)",
            [userId, type, ip]
        );
    } catch (err) {
        console.error("logged error", err);
    }
};

// ======================
// CREATE TICKET
// ======================
exports.createTicket = async (req, res) => {
    try {
        let { subject, description, priority } = req.body;

        subject = subject?.trim();
        description = description?.trim();

        if (!subject || !description) {
            return res.status(400).json({ message: "Invalid Input" });
        }

        // Spam protection
        const [count] = await db.execute(
            "SELECT COUNT(*) as total FROM support_tickets WHERE raised_by = ? AND created_at > NOW() - INTERVAL 1 MINUTE",
            [req.user.id]
        );

        if (count[0].total > 5) {
            await logDecoyEvent(req.user.id, "TICKET_SPAM", req.ip);
            return res.status(429).json({ message: "Too many requests" });
        }

        const allowed = ["low", "medium", "high"];
        if (!allowed.includes(priority)) priority = "low";

        const [result] = await db.execute(
            "INSERT INTO support_tickets (raised_by, subject, description, priority) VALUES (?,?,?,?)",
            [req.user.id, subject, description, priority]
        );

        const ticketId = result.insertId;

        res.json({ message: "Ticket created", ticketId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};

// ======================
// GET MY TICKETS
// ======================
exports.getMyTickets = async (req, res) => {
    try {
        const [tickets] = await db.execute(
            "SELECT * FROM support_tickets WHERE raised_by = ? ORDER BY created_at DESC",
            [req.user.id]
        );

        res.json(tickets);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
};

// ======================
// GET TICKET BY ID
// ======================
exports.getTicketById = async (req, res) => {
    try {
        const ticket = req.ticket;
        const id = req.params.id;

        const [messages] = await db.execute(
            "SELECT message_id, sender_id, message, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC",
            [id]
        );

        res.json({ ticket, messages });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};

// ======================
// REPLY TO TICKET
// ======================
exports.replyTicket = async (req, res) => {
    try {
        const { id } = req.params;
        let { message } = req.body;

        message = message?.trim();

        if (!message) {
            return res.status(400).json({ message: "Invalid message" });
        }

        // Honeypot check
        const patterns = [/or\s+\d+=\d+/i, /<script>/i];
        if (patterns.some(p => p.test(message))) {
            await logDecoyEvent(req.user.id, "INJECTION_ATTEMPT", req.ip);
        }

        await db.execute(
            "INSERT INTO ticket_messages (ticket_id, sender_id, message) VALUES (?,?,?)",
            [id, req.user.id, message]
        );

        res.json({ message: "Reply added" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};

// ======================
// ADMIN ASSIGN TICKET
// ======================
exports.assignTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const ticket = req.ticket;

        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Only admins allowed" });
        }

        if (ticket.assigned_to) {
            return res.status(400).json({ message: "Already assigned" });
        }

        await db.execute(
            "UPDATE support_tickets SET assigned_to = ?, status = 'in_progress' WHERE ticket_id = ?",
            [req.user.id, id]
        );

        res.json({ message: "Assigned successfully" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};