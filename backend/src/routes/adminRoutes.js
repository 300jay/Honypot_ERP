const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const {
    getDashboardStats,
    getAllTickets,
    getTicketById,
    updateTicketStatus,
    assignTicket,
    getAllUsers,
    // updateUserRole,
    // getAlerts,
    // updateAlertStatus
} = require("../controllers/adminController");

//main dashboard route
router.get("/dashboard", authMiddleware, requireRole("admin"), getDashboardStats);



//Tickets
router.get("/tickets",authMiddleware, requireRole("admin"), getAllTickets);
router.get("/tickets/:id", authMiddleware, requireRole("admin"), getTicketById);
router.patch("/tickets/:id/status", authMiddleware, requireRole("admin"), updateTicketStatus);
router.patch("/tickets/:id/assign", authMiddleware, requireRole("admin"), assignTicket);



// Users
router.get("/users", authMiddleware, requireRole("admin"), getAllUsers);

module.exports = router

