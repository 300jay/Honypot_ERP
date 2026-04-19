const express = require("express");
const router = express.Router();
const{createTicket, getMyTickets, getTicketById, replyTicket} = require("../controllers/ticketController");
const authMiddleware = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const ticketAccess = require("../middleware/ticketAccessMiddleware");

router.post("/create", authMiddleware,requireRole(["student", "teacher"]),createTicket);
router.get("/my", authMiddleware,requireRole(["student", "teacher"]), getMyTickets);
router.get("/:id", authMiddleware,ticketAccess, getTicketById);
router.post("/:id/reply", authMiddleware,ticketAccess, replyTicket);

module.exports = router;
