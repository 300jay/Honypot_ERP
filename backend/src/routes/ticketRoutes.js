const express = require("express");
const router = express.Router();

const {
    createTicket,
    getMyTickets,
    getTicketById,
    replyTicket,
    assignTicket
} = require("../controllers/ticketController");

const authMiddleware = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const ticketAccess = require("../middleware/ticketAccessMiddleware");

// Create ticket
router.post(
    "/create",
    authMiddleware,
    requireRole(["student", "teacher"]),
    createTicket
);

// My tickets
router.get(
    "/my",
    authMiddleware,
    requireRole(["student", "teacher"]),
    getMyTickets
);

// View ticket
router.get(
    "/:id",
    authMiddleware,
    ticketAccess,
    getTicketById
);

// Reply
router.post(
    "/:id/reply",
    authMiddleware,
    ticketAccess,
    replyTicket
);

// Assign (admin)
router.patch(
    "/:id/assign",
    authMiddleware,
    ticketAccess,
    assignTicket
);

module.exports = router;