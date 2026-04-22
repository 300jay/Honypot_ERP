const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const {
    createTimetable,
    updateTimetable,
    deleteTimetable,
    getTeacherTimetable,
    getStudentTimetable,
    fakeTimetableAdmin
} = require("../controllers/timetableController");

//student routes
router.get("/student", authMiddleware, requireRole("student"), getStudentTimetable);

//honeypot route
router.post("/admin/update-all", authMiddleware, fakeTimetableAdmin);

//all of teacher routes
router.get("/teacher", authMiddleware, requireRole("teacher"), getTeacherTimetable);
router.post("/", authMiddleware, requireRole("teacher"), createTimetable);
router.put("/:id", authMiddleware, requireRole("teacher"), updateTimetable);
router.delete("/:id", authMiddleware, requireRole("teacher"), deleteTimetable);

module.exports = router;