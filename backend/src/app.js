const rateLimit = require("express-rate-limit");
const express = require("express");
const app = express();
const path = require("path");

const frontendPath = path.resolve(__dirname, "../../Frontend");
console.log("Frontend path:", frontendPath);

app.use(express.static(frontendPath));
const cors = require("cors");   
app.use(cors()); 

const bcrypt = require("bcrypt");
const db = require("./db");
const jwt = require("jsonwebtoken");
const authHeader = req.headers.authorization;
// module.exports = (req, res, next) => {
//     

//     if (!authHeader) {
//         return res.json({ message: "Unauthorized" });
//     }

//     const token = authHeader.split(" ")[1];

//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);

//         req.user = decoded;
//         next();
//     } catch (err) {
//         console.error("JWT ERROR:", err.message);
//         return res.json({ message: "Invalid token" });
//     }
// };
require("dotenv").config();

const SECRET_KEY = process.env.JWT_SECRET;
const loginAttempts ={};
const INVALID_INPUT = {message: "Invalid input"};
const UNAUTHORIZED = {message: "Unauthorized"};
const ERROR = {message: "Error"};

const ticketRoutes = require("./routes/ticketRoutes");
// const notificationRoutes = require("./routes/notificationRoutes");
const adminRoutes = require("./routes/adminRoutes");
const timetableRoutes = require("./routes/timetableRoutes");

const authMiddleware= require("./middleware/authMiddleware");
const requireRole = require("./middleware/roleMiddleware");
const {logActivity} = require("./logger");
const loginLimiter = rateLimit({
    windowMs: 15*60*1000,
    max: 5,
    message: {message:"Too many attempts, try later"}
})
const accountLimiter = async (req, res, next) => {
    const email = req.body.email?.toLowerCase();
    if(!email) return next();
    const now = Date.now();
    const windowMs = 15*60*1000;
    const maxAttempts = 5;

    if(!loginAttempts[email]){
        loginAttempts[email] = {count: 1, firstAttempt: now};
        return next();
    }
    const attempt = loginAttempts[email];
    if (now - attempt.firstAttempt>windowMs){
        loginAttempts[email]={count: 1, firstAttempt: now};
        return next();
    }
    attempt.count++;
    if(attempt.count>maxAttempts){
        logActivity(db, {
            activity: "BRUTE_FORCE_DETECTED",
            ip_address: req.ip,
            result: "BLOCKED",
            source:"SECURITY"
        });
        return res.json({ message: "Too many login attempts, Try again later"});
    }
    next();
}

const logRequest = (activityName) => {
    return (req, res, next) => {
        const originalSend = res.json;

        res.json = function (body){
            const msg = (body?.message || "").toLowerCase();

            logActivity(db, {
                account_id: req.user?.id || null,
                activity: activityName,
                ip_address: req.ip,
                session_id: req.user?.session_id || null,
                result: msg.includes("error") ||
                        msg.includes("invalid") ||
                        msg.includes("unauthorized")
                        ? "FAILED"
                        : "SUCCESS",
                source: "ACTIVITY"
            })

            return originalSend.call(this, body);
        };

        next();
    };
};

async function logHoneypotEvent(req, eventType, details){
    const ip = req.ip;
    const userId = req.user ? req.user.id : null;
    const activity = `[${eventType}] ${details}`;

    try{
        await db.execute(
            'INSERT INTO admin.activity_logs(account_id, activity, ip_address, result, source) values (?,?,?,?,?)',
            [userId, activity, ip, "CAPTURED", "HONEYPOT"]
        );
    } catch(err){
        console.error("Honeypot log error:", err);
    }
}
app.use(express.json());
app.use("/manage",adminRoutes);
app.use("/timetable", timetableRoutes);

app.get("/",(req,res) => {
    res.send("Server is running");
});

// below section only there for testing
// app.get("/protected", authMiddleware, (req, res)=>{
//     res.json({
//         message: "Protected here",
//         user: req.user
//     });
// });

app.get("/student/profile", authMiddleware, requireRole("student"), logRequest("VIEW_PROFILE"), async (req, res) => {
    try {
        const accountId = req.user.id;

        const [rows] = await db.execute(`
            SELECT 
                sp.student_id,
                sp.full_name,
                sp.prn,
                sp.class_id,
                sp.roll_no,
                sp.admission_year,
                sp.branch,
                a.email
            FROM og.student_profiles sp
            JOIN og.accounts a 
                ON sp.account_id = a.account_id
            WHERE sp.account_id = ?
        `, [accountId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: "Profile not found" });
        }

        // Clean structured response (important for frontend)
        const profile = {
            student_id: rows[0].student_id,
            full_name: rows[0].full_name,
            prn: rows[0].prn,
            class_id: rows[0].class_id,
            roll_no: rows[0].roll_no,
            admission_year: rows[0].admission_year,
            branch: rows[0].branch,
            email: rows[0].email
        };

        res.json(profile);

    } catch (err) {
        console.error("Profile error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

app.get("/teacher/profile", authMiddleware, requireRole("teacher"), logRequest("VIEW_PROFILE"), async (req, res) => {
    try {
        const accountId = req.user.id;

        const [rows] = await db.execute(`
            SELECT 
                tp.teacher_id,
                tp.full_name,
                tp.prn,
                tp.department,
                a.email
            FROM og.teacher_profiles tp
            JOIN og.accounts a 
                ON tp.account_id = a.account_id
            WHERE tp.account_id = ?
        `, [accountId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: "Profile not found" });
        }

        // Structured response (same style as student)
        const profile = {
            teacher_id: rows[0].teacher_id,
            full_name: rows[0].full_name,
            prn: rows[0].prn,
            department: rows[0].department,
            email: rows[0].email
        };

        res.json(profile);

    } catch (err) {
        console.error("Teacher profile error:", err);
        res.status(500).json({ message: "Server error" });
    }
});


app.get("/student/attendance", authMiddleware, requireRole("student"), logRequest("VIEW_ATTENDANCE"), async (req,res)=>{
    try{
        const [results] = await db.execute(
            `SELECT ar.status, asess.attendance_date, co.course_id, co.class_id
             FROM og.attendance_records ar
             JOIN og.student_profiles sp ON ar.student_id = sp.student_id 
             JOIN og.attendance_sessions asess ON ar.attendance_session_id = asess.attendance_session_id
             JOIN og.course_offerings co ON asess.offering_id = co.offering_id
             WHERE sp.account_id = ?`,
            [req.user.id]
        );

        res.json(results);
    }catch(err){
        res.json(ERROR);
    }
});
app.get("/student/results", authMiddleware, requireRole("student"), logRequest("VIEW_RESULTS"), async (req, res)=>{
    try{
        const [results] = await db.execute(
            'SELECT e.exam_name, e.exam_date, e.max_marks, er.marks_obtained, er.grade FROM og.exam_results er JOIN og.student_profiles sp ON er.student_id = sp.student_id JOIN og.exams e ON er.exam_id = e.exam_id WHERE sp.account_id = ?',
            [req.user.id]
        );

        res.json(results);
    }catch(err){
        res.json({message:"Error fetching results"});
    }
});
app.post("/teacher/attendance", authMiddleware, requireRole("teacher"),logRequest("MARK_ATTENDANCE"), async (req, res) =>{
    try{
        const {student_id, attendance_date, status,offering_id} = req.body;

        if(!isNumber(student_id)||!isNumber(offering_id)) return res.json(INVALID_INPUT);
        if(!isValidDate(attendance_date)) return res.json(INVALID_INPUT);
        if(!isEnum(status,["present", "absent"])) return res.json(INVALID_INPUT);
        if (!student_id||!attendance_date||!status||!offering_id) return res.json({message: "All fields required"});

        const [teacherRes] = await db.execute(
            'SELECT teacher_id FROM og.teacher_profiles WHERE account_id = ?',
            [req.user.id]
        );

        if (teacherRes.length===0) return res.json(UNAUTHORIZED);

        const teacher_id = teacherRes[0].teacher_id;

        const [course] = await db.execute(
            'SELECT * FROM og.course_offerings where offering_id = ? and teacher_id =?',
            [offering_id, teacher_id]
        );

        if(course.length === 0) return res.json({message:"Unauthorized"});

        const [studentCheck] = await db.execute(
            'SELECT * FROM og.student_course_enrollments WHERE student_id = ? AND offering_id = ?',
            [student_id, offering_id]
        );

        if (studentCheck.length===0) return res.json({message:"Unauthorized"});

        const [session] = await db.execute(
            'INSERT INTO og.attendance_sessions (offering_id, attendance_date, marked_by) VALUES (?,?,?)',
            [offering_id, attendance_date, teacher_id]
        );

        await db.execute(
            'INSERT INTO og.attendance_records (attendance_session_id, student_id, status) VALUES (?,?,?)',
            [session.insertId, student_id, status]
        );

        res.json({message: "Attendance marked successfully"});
    }catch(err){
        console.error(err);
        res.json(ERROR);
    }
});
app.post("/teacher/results", authMiddleware, requireRole("teacher"),logRequest("ADD_RESULTS"), async (req, res)=>{
    try{
        const {offering_id, student_id, exam_name, exam_date, max_marks, marks_obtained, grade} = req.body;

        if(!offering_id||!student_id|| !exam_name || !exam_date || !max_marks || !marks_obtained || !grade) return res.json(INVALID_INPUT);
        if(!isNumber(student_id)|| !isNumber(offering_id) || !isNumber(max_marks) || !isNumber(marks_obtained)) return res.json(INVALID_INPUT);
        if(!isValidDate(exam_date)) return res.json(INVALID_INPUT);

        const [teacherRes] = await db.execute(
            'SELECT teacher_id FROM og.teacher_profiles WHERE account_id = ?',
            [req.user.id]
        );

        if (teacherRes.length===0) return res.json(UNAUTHORIZED);

        const teacher_id = teacherRes[0].teacher_id;

        const [course] = await db.execute(
            'SELECT * FROM og.course_offerings WHERE offering_id = ? AND teacher_id = ?',
            [offering_id, teacher_id]
        );

        if(course.length===0) return res.json(UNAUTHORIZED);

        const [studentCheck] = await db.execute(
            'SELECT * FROM og.student_course_enrollments WHERE student_id = ? AND offering_id =?',
            [student_id, offering_id]
        );

        if(studentCheck.length===0) return res.json(UNAUTHORIZED);

        const [exam] = await db.execute(
            'INSERT INTO og.exams (offering_id, exam_name, exam_date, max_marks) VALUES (?,?,?,?)',
            [offering_id, exam_name, exam_date, max_marks]
        );

        await db.execute(
            'INSERT INTO og.exam_results (exam_id, student_id, marks_obtained, grade) VALUES (?,?,?,?)',
            [exam.insertId, student_id, marks_obtained, grade]
        );

        res.json({message: "Result added successfully"});
    }catch(err){
        console.error(err);
        res.json(ERROR);
    }
});
const {isEmail, isNumber, isEnum, isValidDate} = require("./validators");
app.post("/service/create-user", authMiddleware, requireRole("admin"), logRequest("CREATE_ACCOUNT"), async (req, res) => {

    let { email, password, full_name, prn, class_id, roll_no, admission_year, role, department, branch } = req.body;

    // 🔹 Normalize input
    email = email?.trim().toLowerCase();
    full_name = full_name?.trim();
    department = department?.trim();
    branch = branch?.trim();

    //  Basic validation
    if (!email || !password || !full_name || !role) {
        return res.json({ message: "All fields required" });
    }

    if (!isEmail(email) || password.length < 6) {
        return res.json(INVALID_INPUT);
    }

    //  Restrict roles
    if (!["student", "teacher"].includes(role)) {
        return res.json({ message: "Invalid role" });
    }

    let conn;

    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        //  Check duplicate email
        const [existing] = await conn.execute(
            "SELECT account_id FROM og.accounts WHERE email = ?",
            [email]
        );

        if (existing.length > 0) {
            await conn.rollback();
            conn.release();
            return res.json({ message: "Email already exists" });
        }

        //  Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        //  Insert account
        const [account] = await conn.execute(
            "INSERT INTO og.accounts (email, password_hash) VALUES (?, ?)",
            [email, hashedPassword]
        );

        const accountId = account.insertId;

        //  Get role ID
        const [roleRes] = await conn.execute(
            "SELECT role_id FROM og.access_roles WHERE role_name = ?",
            [role]
        );

        if (roleRes.length === 0) {
            await conn.rollback();
            conn.release();
            return res.json({ message: "Role fetch failed" });
        }

        // 🔗 Map role
        await conn.execute(
            "INSERT INTO og.account_role_map (account_id, role_id) VALUES (?, ?)",
            [accountId, roleRes[0].role_id]
        );

        // =========================
        //  STUDENT
        // =========================
        if (role === "student") {

            if (
                prn == null ||
                class_id == null ||
                roll_no == null ||
                admission_year == null ||
                isNaN(prn) ||
                isNaN(class_id) ||
                isNaN(roll_no) ||
                isNaN(admission_year)
            ) {
                await conn.rollback();
                conn.release();
                return res.json(INVALID_INPUT);
            }

            // 🔍 Check duplicate PRN
            const [existingPrn] = await conn.execute(
                "SELECT student_id FROM og.student_profiles WHERE prn = ?",
                [prn]
            );

            if (existingPrn.length > 0) {
                await conn.rollback();
                conn.release();
                return res.json({ message: "PRN already exists" });
            }

            await conn.execute(
                `INSERT INTO og.student_profiles 
                (account_id, prn, full_name, class_id, roll_no, admission_year, branch) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [accountId, prn, full_name, class_id, roll_no, admission_year, branch]
            );
        }

        // =========================
        //  TEACHER
        // =========================
        if (role === "teacher") {

            if (!department || department.length > 100) {
                await conn.rollback();
                conn.release();
                return res.json(INVALID_INPUT);
            }

            await conn.execute(
                `INSERT INTO og.teacher_profiles 
                (account_id, full_name, department) 
                VALUES (?, ?, ?)`,
                [accountId, full_name, department]
            );
        }

       
        await conn.commit();
        conn.release();

        res.json({
            message: `${role.charAt(0).toUpperCase() + role.slice(1)} created successfully`
        });

    } catch (err) {
        if (conn) {
            await conn.rollback();
            conn.release();
        }
        console.error(err);
        res.json({ message: "Server error" });
    }
});
//fake
app.get("/admin/audit-logs", (req,res)=>{
    logHoneypotEvent(req, "FAKE_ENDPOINT_ACCESS", "Tried accessing audit logs");

    return res.json({
        status: "success",
        logs: [{user:"admin", action: "LOGIN_SUCCESS", time:"2026-04-10 10:10:10"},
            {user:"system", action: "DB_SYNC", time: "2026-04-10 09:00:00"}
        ]
    });
});
//fake
app.get("/admin/db-backup", (req, res) =>{
    logHoneypotEvent(req, "DATA_EXFIL_ATTEMPTS","Attempted DB backup access");

    return res.json({
        status: "success",
        backup: "erp_backup_2026_04_10.sql",
        size: "2.4GB",
        download: "/downloads/erp_backup.sql"
    });
});
//fake
app.get("/debug/env", (req,res)=>{
    logHoneypotEvent(req, "DEBUG_PROBE", "Attempted env access");

    return res.json({
        DB_HOST: "localhost",
        DB_USER: "admin",
        DB_PASS: "130891izcool",
        JWT_SECRET: "9f7c2a6e4d8b1c0f5a3e9d2b7c6f1a8e4b0c9d3f6a1e7b2c5d8f0a4e6b1c3d9",
        API_KEY: "33384b430c5628032887ecfd2d8811sa"
    });
});
//fake
app.post("/admin/register", async (req,res)=>{
    const {email, password} = req.body;

    if(!isEmail(email)||password.length<6) return res.json(INVALID_INPUT);

    try{
        await db.execute(
            `INSERT INTO users.accounts (email, password_hash, status) VALUES (?,?,'active')`,
            [email, password]
        );

        logActivity(db,{
            activity: "HONEYPOT_ACCOUNT_CREATION",
            ip_address: req.ip,
            result: "CAPTURED",
            source:"HONEYPOT"
        });

        return res.json({
            message: "Account created successfully"
        });
    }catch(err){
        console.error(err);
        res.json({message: "Server error"});
    }
});
//fake
app.post("/user/upgrade-role", (req,res)=>{
    logHoneypotEvent(req, "PRIV_ESC_ATTEMPT", "Tried role escalation")
    return res.json({
        status: "FAILED",
        message: "Bad secret for upgrade"
    });
});
//fake
app.get("/internal/file-access", (req, res) => {
    const file = req.query.file;

    if (file && (file.includes("..") || file.includes("/etc") || file.includes(".env"))) {
        logHoneypotEvent(req, "PATH_TRAVERSAL", `Tried accessing: ${file}`);

        return res.send(
            "root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000::/home/user:/bin/bash"
        );
    }

    return res.status(404).json({ message: "File not found" });
});
app.post("/login", loginLimiter, accountLimiter, async (req,res)=>{
    try{
        const {email, password} = req.body;

        if(!email || !password){
            logActivity(db, {
                activity: "LOGIN_ATTEMPT",
                ip_address: req.ip,
                result: "FAILED",
                source: "AUTH"
            });
            return res.json({message: "Invalid credentials"});
        }
        if(!isEmail(email) || password.length<6){
            logActivity(db, {
                activity: "LOGIN_ATTEMPT",
                ip_address: req.ip,
                result: "FAILED",
                source: "AUTH"
            });
            return res.json({message: "Invalid credentials"});
        }

        const [results] = await db.execute(
            `SELECT a.account_id, a.email, a.password_hash, r.role_name
            FROM og.accounts a
            JOIN og.account_role_map arm ON a.account_id = arm.account_id
            JOIN og.access_roles r ON arm.role_id = r.role_id
            WHERE a.email = ?`,
            [email]
        );

        if (results.length==0){
            logActivity(db, {
                activity: "LOGIN_ATTEMPT",
                ip_address: req.ip,
                result: "FAILED",
                source: "AUTH"
            });
            return res.json({message: "User not found"});
        }

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if(!isMatch){
            logActivity(db, {
                activity: "LOGIN_ATTEMPT",
                ip_address: req.ip,
                result: "FAILED",
                source: "AUTH"
            });
            return res.json({message: "Invalid Credentials"});
        }

        delete loginAttempts[email];

        const ip = req.ip;

        const [result2] = await db.execute(
            'INSERT INTO admin.session_tracker(account_id, ip_address) VALUES (?,?)',
            [user.account_id, ip]
        );

        const sessionId = result2.insertId;

        await db.execute(
            'UPDATE og.accounts SET last_login = CURRENT_TIMESTAMP WHERE account_id =?',
            [user.account_id]
        );

        const token = jwt.sign(
            {   
                id: user.account_id,
                email: user.email,
                session_id: sessionId,
                role: user.role_name   // 🔥 ADD THIS
            },
            SECRET_KEY,
            {expiresIn:"1h"}
        ); 

        logActivity(db, {
            account_id: user.account_id,
            activity: "LOGIN_SUCCESS",
            ip_address: req.ip,
            session_id: sessionId,
            result: "SUCCESS",
            source: "AUTH"
        });

        res.json({
            message: "Login working",
            token,
            role: user.role_name   // 🔥 ADD THIS
        });

    }catch(err){
        console.error(err);
        logActivity(db, {
            activity: "LOGIN_ATTEMPT",
            ip_address: req.ip,
            result: "FAILED",
            source: "AUTH"
        });
        res.json({message: "Database Error"});
    }
});
app.post("/logout", authMiddleware, logRequest("LOGOUT"), async (req, res) =>{
    try{
        const sessionId = req.user.session_id;

        await db.execute(
            'UPDATE admin.session_tracker SET logout_time = CURRENT_TIMESTAMP WHERE session_id = ?',
            [sessionId]
        );

        res.json({message: "Logged out successfully"});
    }catch(err){
        res.json({message:"Logout failed"});
    }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});

app.put("/service/update-user/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    const accountId = req.params.id;

    let { full_name, email, role, department, branch } = req.body;

    full_name = full_name?.trim();
    email = email?.trim().toLowerCase();
    department = department?.trim();
    branch = branch?.trim();

    if (!full_name || !email || !role) {
        return res.json({ message: "All fields required" });
    }

    try {
        const conn = await db.getConnection();
        await conn.beginTransaction();

        // update email
        await conn.execute(
            "UPDATE og.accounts SET email = ? WHERE account_id = ?",
            [email, accountId]
        );

        if (role === "teacher") {
            await conn.execute(
                "UPDATE og.teacher_profiles SET full_name = ?, department = ? WHERE account_id = ?",
                [full_name, department, accountId]
            );
        }

        if (role === "student") {
            await conn.execute(
                "UPDATE og.student_profiles SET full_name = ?, branch = ? WHERE account_id = ?",
                [full_name, branch, accountId]
            );
        }

        await conn.commit();
        conn.release();

        res.json({ message: "User updated successfully" });

    } catch (err) {
        console.error(err);
        res.json({ message: "Server error" });
    }
});

app.get("/service/get-user/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    const id = req.params.id;

    try {
        const [rows] = await db.execute(`
            SELECT a.account_id, a.email, r.role_name,
                   sp.full_name AS student_name, sp.prn, sp.branch,
                   tp.full_name AS teacher_name, tp.department
            FROM og.accounts a
            JOIN og.account_role_map arm ON a.account_id = arm.account_id
            JOIN og.access_roles r ON arm.role_id = r.role_id
            LEFT JOIN og.student_profiles sp ON a.account_id = sp.account_id
            LEFT JOIN og.teacher_profiles tp ON a.account_id = tp.account_id
            WHERE a.account_id = ? OR sp.prn = ?
        `, [id, id]);

        if (rows.length === 0) return res.json({ message: "User not found" });

        const user = rows[0];

        res.json({
            account_id: user.account_id,
            email: user.email,
            role: user.role_name,
            full_name: user.student_name || user.teacher_name,
            department: user.department,
            branch: user.branch
        });

    } catch (err) {
        res.json({ message: "Server error" });
    }
});

app.get("/test-db", async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT 1");
        res.json({ success: true, rows });
    } catch (err) {
        console.error("DB TEST ERROR:", err);
        res.json({ success: false, error: err.message });
    }
});

app.use("/api/tickets", ticketRoutes);
