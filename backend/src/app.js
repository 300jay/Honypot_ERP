const rateLimit = require("express-rate-limit");
const express = require("express");
const app = express();
const bcrypt = require("bcrypt");
const db = require("./db");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const SECRET_KEY = process.env.JWT_SECRET;
const loginAttempts ={};
const INVALID_INPUT = {message: "Invalid input"};
const UNAUTHORIZED = {message: "Unauthorized"};
const ERROR = {message: "Error"};

const ticketRoutes = require("./routes/ticketRoutes");
// const notificationRoutes = require("./routes/notificationRoutes");
const adminRoutes = require("./routes/adminRoutes");

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
app.use("/service/ticket", ticketRoutes);
// app.use("/service/notifications", notificationRoutes);
app.use("/manage",adminRoutes);

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

app.get("/student/profile", authMiddleware, requireRole("student"), logRequest("VIEW_PROFILE"), async (req, res)=>{
    try{
        const accountId = req.user.id;

        const [results] = await db.execute(
            'SELECT student_id, full_name, prn, class_id, roll_no, admission_year FROM og.student_profiles WHERE account_id = ?',
            [accountId]
        );

        if (results.length === 0){
            return res.json({message: "Profile not found"});
        }

        res.json(results[0]);
    }catch(err){
        res.json(ERROR);
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
app.post("/service/create-user", authMiddleware, requireRole("admin"), logRequest("CREATE_ACCOUNT"), async(req, res) => {
    let { email, password, full_name, prn, class_id, roll_no, admission_year, role, department } = req.body;

    email = email?.trim().toLowerCase();
    full_name = full_name?.trim();
    department = department?.trim();

    if (!email || !password || !full_name || !role) return res.json({ message: "All fields required" });
    if(!isEmail(email)||password.length<6) return res.json(INVALID_INPUT);
    if(!isEnum(role, ["student", "teacher", "admin"])) return res.json ({message: "Invalid role"});

    if(role === "student"){
        if(!isNumber(class_id)|| !isNumber(roll_no) || !isNumber(admission_year)) return res.json(INVALID_INPUT);
    }

    if(role === "teacher"){
        if(!department || department.length>100) return res.json(INVALID_INPUT);
    }
    let conn;
    try{
        conn = await db.getConnection();

        await conn.beginTransaction();

        const hashedPassword = password;

        const [account] = await conn.execute(
            'INSERT INTO og.accounts (email, password_hash) VALUES (?, ?)',
            [email, hashedPassword]
        );

        const accountId = account.insertId;

        const [roleRes] = await conn.execute(
            "SELECT role_id FROM og.access_roles WHERE role_name = ?",
            [role]
        );

        if (roleRes.length ===0){
            await conn.rollback();
            conn.release();
            return res.json({message: "Role fetch failed"});
        }

        await conn.execute(
            "INSERT INTO og.account_role_map (account_id, role_id) VALUES (?,?)",
            [accountId, roleRes[0].role_id]
        );

        if (role === "student") {
            if (!prn || class_id == null || roll_no == null || admission_year == null){
                await conn.rollback();
                conn.release();
                return res.json({ message: "Student fields missing" });
            }

            await conn.execute(
                'INSERT INTO og.student_profiles (account_id, prn, full_name, class_id, roll_no, admission_year) VALUES (?,?,?,?,?,?)',
                [accountId, prn, full_name, class_id, roll_no, admission_year]
            );
        }

        if (role === "teacher") {
            if (!department){
                await conn.rollback();
                conn.release();
                return res.json({ message: "Department required for teacher" });
            }

            await conn.execute(
                'INSERT INTO og.teacher_profiles (account_id, full_name, department) VALUES (?, ?, ?)',
                [accountId, full_name, department]
            );
        }

        await conn.commit();
        conn.release();

        res.json({
            message: role === "student" ? "Student created successfully" : "Teacher created successfully"
        });

    }catch(err){
        if (conn) conn.release();
        console.error(err);
        res.json({message: "Server error"});
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
            "SELECT * FROM og.accounts WHERE email = ?",
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
                session_id: sessionId
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
            token
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
app.listen(3000,() => {
    console.log("Server has started on port 3000");
});
