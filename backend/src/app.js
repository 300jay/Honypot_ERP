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
const {logActivity} = require("./logger");
const loginLimiter = rateLimit({
    windowMs: 15*60*1000,
    max: 5,
    message: {message:"Too many attempts, try later"}
})
const accountLimiter = (req, res, next) => {
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
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
            logActivity(db,{
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

        const query = `
            SELECT * FROM admin.session_tracker 
            WHERE session_id = ? AND logout_time IS NULL
        `;

        db.query(query, [decoded.session_id], (err, results) => {
            if (err || results.length === 0) {
                logActivity(db,{
                    account_id: decoded.id,
                    activity: "INVALID_SESSION",
                    ip_address: req.ip,
                    session_id: decoded.session_id,
                    result: "FAILED",
                    source:"AUTH"
                });
                return res.json({ message: "Invalid session" });
            }

            const roleQuery = `
                SELECT r.role_name 
                FROM og.account_role_map arm 
                JOIN og.access_roles r ON arm.role_id = r.role_id 
                WHERE arm.account_id = ?
            `;

            db.query(roleQuery, [decoded.id], (err2, roleResults) => {
                if (err2 || roleResults.length === 0) {
                    logActivity(db,{account_id: decoded.id, activity:"ROLE_NOT_FOUND", ip_address:req.ip, session_id: decoded.session_id, result: "FAILED", source:"AUTH"
                        });
                    return res.json({ message: "Role not found" });
                }

            
                req.user = {
                    ...decoded,
                    role: roleResults[0].role_name
                };

                next(); 
            });
        });

    } catch (err) {
        logActivity(db, {
            activity: "INVALID_TOKEN",
            ip_address: req.ip,
            result:"FAILED",
            source:"AUTH"
        });
        return res.json({ message: "Invalid token" });
    }
};
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
            });

            return originalSend.call(this, body);
        };

        next();
    };
};const requireRole = (role) => {
    return (req, res, next) => {
        if(!req.user || req.user.role !== role){
            return res.json({message: "Access denied"});
        } 
        next();
    };
};

function logHoneypotEvent(req, eventType,details){
    const ip = req.ip;
    const userId = req.user ? req.user.id : null;

    const query = 'INSERT INTO admin.activity_logs(account_id, activity, ip_address, result, source) values (?,?,?,?,?)';
    const activity = `[${eventType}] ${details}`;
    db.query(query, [userId,activity,ip,"CAPTURED", "HONEYPOT"], (err) => {
        if (err) console.error("Honeypot log error:", err);
    });
}
app.use(express.json());

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

app.get("/student/profile", authMiddleware, requireRole("student"),logRequest("VIEW_PROFILE"), (req, res)=>{
    const accountId = req.user.id;

    const query = 'SELECT student_id, full_name, prn, class_id, roll_no, admission_year FROM og.student_profiles WHERE account_id = ?';
    db.query(query, [accountId], (err, results) =>{
        if (err) return res.json(ERROR);
        if (results.length===0){
            return res.json({message: "Profile not found"})
        }
        res.json(results[0]);
    });
});

app.get("/student/attendance", authMiddleware, requireRole("student"), logRequest("VIEW_ATTENDANCE"), (req,res) =>{
    const accountId = req.user.id;

    const query = `SELECT ar.status, asess.attendance_date, co.course_id, co.class_id
                   FROM og.attendance_records ar
                   JOIN og.student_profiles sp ON ar.student_id = sp.student_id 
                   JOIN og.attendance_sessions asess ON ar.attendance_session_id = asess.attendance_session_id
                   JOIN og.course_offerings co ON asess.offering_id = co.offering_id
                   WHERE sp.account_id =?`;

    db.query(query,[accountId], (err,results)=>{
        if (err) return res.json(ERROR);
        
        res.json(results);
    });
});

app.get("/student/results", authMiddleware, requireRole("student"), logRequest("VIEW_RESULTS"), (req, res)=>{
    const accountId = req.user.id;

    const query = 'SELECT e.exam_name, e.exam_date, e.max_marks, er.marks_obtained, er.grade FROM og.exam_results er JOIN og.student_profiles sp ON er.student_id = sp.student_id JOIN og.exams e ON er.exam_id = e.exam_id WHERE sp.account_id = ?';
    db.query(query, [accountId], (err, results) =>{
        if (err) return res.json({message:"Error fetching results"});
        res.json(results);
    });
});

app.post("/teacher/attendance", authMiddleware, requireRole("teacher"),logRequest("MARK_ATTENDANCE"), (req, res) =>{
    const {student_id, attendance_date, status,offering_id} = req.body;

    if(!isNumber(student_id)||!isNumber(offering_id)){
        return res.json(INVALID_INPUT);
    }
    if(!isValidDate(attendance_date)){
        return res.json(INVALID_INPUT);
    }
    if(!isEnum(status,["present", "absent"])){
        return res.json(INVALID_INPUT);
    }
    if (!student_id||!attendance_date||!status||!offering_id){
        return res.json({message: "All fields required"});
    }

    const getTeacher = 'SELECT teacher_id FROM og.teacher_profiles WHERE account_id = ?';
    db.query(getTeacher, [req.user.id], (err, teacherRes)=>{
        if (err || teacherRes.length===0){
            return res.json(UNAUTHORIZED);
        }
        const teacher_id = teacherRes[0].teacher_id;
    
    const checkQuery = 'SELECT * FROM og.course_offerings where offering_id = ? and teacher_id =?';

    db.query(checkQuery, [offering_id, teacher_id], (err,results) => {
        if(err||results.length === 0){
            return res.json({message:"Unauthorized"});
        }
    const studentCheck = 'SELECT * FROM og.student_course_enrollments WHERE student_id = ? AND offering_id = ?';
        db.query(studentCheck, [student_id, offering_id], (err2, result2) =>{
            if (err2||result2.length===0){
                return res.json({message:"Unauthorized"});
            }
        

    const sessionQuery = 'INSERT INTO og.attendance_sessions (offering_id, attendance_date, marked_by) VALUES (?,?,?)';
    db.query(sessionQuery, [offering_id, attendance_date, teacher_id], (err, result) => {
        if(err){
            console.error(err);
            return res.json(ERROR);
        }
        const sessionId = result.insertId;
        
        const recordQuery = 'INSERT INTO og.attendance_records (attendance_session_id, student_id, status) VALUES (?,?,?)';
        db.query(recordQuery,[sessionId, student_id, status], (err2) =>{
            if (err2){
                console.error(err2);
                return res.json(ERROR);
            }
            res.json({message: "Attendance marked successfully"});
        });
    });
});
});
});
});
app.post("/teacher/results", authMiddleware, requireRole("teacher"),logRequest("ADD_RESULTS"), (req, res) =>{
    const {offering_id, student_id, exam_name, exam_date, max_marks, marks_obtained, grade} = req.body;

    if(!offering_id||!student_id|| !exam_name || !exam_date || !max_marks || !marks_obtained || !grade){
        return res.json(INVALID_INPUT);
    }

    if(!isNumber(student_id)|| !isNumber(offering_id) || !isNumber(max_marks) || !isNumber(marks_obtained)){
        return res.json(INVALID_INPUT);
    }

    if(!isValidDate(exam_date)){
        return res.json(INVALID_INPUT);
    }
    const getTeacher = 'SELECT teacher_id FROM og.teacher_profiles WHERE account_id = ?';

    db.query(getTeacher, [req.user.id], (err, teacherRes)=>{
        if (err || teacherRes.length===0){
            return res.json(UNAUTHORIZED);
        }
        const teacher_id = teacherRes[0].teacher_id;
    
    const checkQuery = 'SELECT * FROM og.course_offerings WHERE offering_id = ? AND teacher_id = ?';
    db.query(checkQuery, [offering_id, teacher_id], (err, results)=>{
        if(err || results.length===0){
            return res.json(UNAUTHORIZED);
        }
    
    const studentCheck = 'SELECT * FROM og.student_course_enrollments WHERE student_id = ? AND offering_id =?';
    db.query(studentCheck, [student_id, offering_id], (err2, result2)=>{
        if(err2 || result2.length===0){
            return res.json(UNAUTHORIZED);
        }
    
    const examQuery = 'INSERT INTO og.exams (offering_id, exam_name, exam_date, max_marks) VALUES (?,?,?,?)';

    db.query(examQuery, [offering_id, exam_name, exam_date, max_marks], (err, result)=>{
        if(err){
            console.error(err);
            return res.json(ERROR);
        }
        const examId = result.insertId;

        const resultQuery = 'INSERT INTO og.exam_results (exam_id, student_id, marks_obtained, grade) VALUES (?,?,?,?)';
        db.query(resultQuery,[examId, student_id, marks_obtained, grade], (err2) =>{
            if (err2){
                console.error(err2);
                return res.json(ERROR);
            }
            res.json({message: "Result added successfully"});
        });
    });
    });
});
});
});

const {isEmail, isNumber, isEnum, isValidDate} = require("./validators");
app.post("/service/create-user", authMiddleware, requireRole("admin"), logRequest("CREATE_ACCOUNT"), async(req, res) => {
    let { email, password, full_name, prn, class_id, roll_no, admission_year, role, department } = req.body;

    //to trim the details
    email = email?.trim().toLowerCase();
    full_name = full_name?.trim();
    department = department?.trim();
    if (!email || !password || !full_name || !role) {
        return res.json({ message: "All fields required" });
    }
    if(!isEmail(email)||password.length<6){
        return res.json(INVALID_INPUT);
    }
    if(!isEnum(role, ["student", "teacher", "admin"])){
        return res.json ({message: "Invalid role"});
    }
    if(role === "student"){
        if(!isNumber(class_id)|| !isNumber(roll_no) || !isNumber(admission_year)){
            return res.json(INVALID_INPUT);
        }
    }
    
    if(full_name.length>100){
        return res.json(INVALID_INPUT);
    }
    if(role === "teacher"){
        if(!department || department.length>100){
            return res.json(INVALID_INPUT);
        }
    }

    try{
        const hashedPassword = await bcrypt.hash(password, 10);

        db.beginTransaction((err)=> {
            if(err){
                return res.json({message: "Transaction start failed"});
            }

        const accountQuery = 'INSERT INTO og.accounts (email, password_hash) VALUES (?, ?)';
        db.query(accountQuery, [email, hashedPassword], (err, result) =>{
            if(err){
                console.error(err);
                return db.rollback(() => {
                    return res.json({ message : "Error creating account"});
            });
            }

            const accountId = result.insertId;

            const getRoleQuery = "SELECT role_id FROM og.access_roles WHERE role_name = ?";

            db.query(getRoleQuery, [role], (errRole, roleResult)=>{
                if (errRole || roleResult.length ===0){
                    console.error(errRole);
                    return db.rollback(() => {
                        return res.json({message: "Role fetch failed"});
                    });
                }

                const roleID = roleResult[0].role_id;

                const mapQuery = "INSERT INTO og.account_role_map (account_id, role_id) VALUES (?,?)";
                db.query(mapQuery, [accountId, roleID], (errMap) => {
                    if (errMap){
                        console.error(errMap);
                        return db.rollback(() => {
                            return res.json({message: "Role assignment failed"});
                        });
                    }

                    if (role === "student") {

                        if (!prn || class_id == null || roll_no == null || admission_year == null) {
                            return db.rollback(() => {
                                return res.json({ message: "Student fields missing" });
                            });
                        }

                        const studentQuery = 'INSERT INTO og.student_profiles (account_id, prn, full_name, class_id, roll_no, admission_year) VALUES (?,?,?,?,?,?)';

                        db.query(studentQuery,  [accountId, prn, full_name, class_id, roll_no, admission_year], (err2) => {
                            if(err2){
                                console.error(err2);
                                return db.rollback(() => {
                                    return res.json(ERROR)
                                });
                            }

                            db.commit((errCommit) => {
                                if (errCommit){
                                    return db.rollback(() => {
                                        return res.json({message: "Commit failed"});
                                    });
                                }

                                return res.json({
                                    message: "Student created successfully"
                                });
                            });
                        });

                    } 
                    
                    else if (role === "teacher") {
                        if (!department) {
                            return db.rollback(() => {
                                return res.json({ message: "Department required for teacher" });
                            });
                        }
                        const teacherQuery = `
                            INSERT INTO og.teacher_profiles (account_id, full_name, department)
                            VALUES (?, ?, ?)
                        `;

                        db.query(teacherQuery, [accountId, full_name, department], (errTeacher) => {
                            if (errTeacher) {
                                console.error(errTeacher);
                                return db.rollback(() => {
                                    return res.json({ message: "Error creating teacher profile" });
                                });
                            }

                            db.commit((errCommit) => {
                                if (errCommit){
                                    return db.rollback(() => {
                                        return res.json({message: "Commit failed"});
                                    });
                                }

                                return res.json({
                                    message: "Teacher created successfully"
                                });
                            });
                        });

                    } 
                    
                    else {
                        return db.rollback(() => {
                            return res.json({ message: "Invalid role" });
                        });
                    }

                });
            });
        });
    });
    }
    catch (error){
        console.error(error);
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
app.post("/admin/register", (req,res)=>{
    const {email, password} = req.body;

    if(!isEmail(email)||password.length<6){
        return res.json(INVALID_INPUT);
    }
    const ip = req.ip;
    const Hash = bcrypt.hashSync(password, 5);

    const query = `INSERT INTO users.accounts (email, password_hash, status) VALUES (?,?,'active')`;
    db.query(query, [email, password], (err, result)=>{
        if(err){
            console.error(err);
        }
        logActivity(db,{
            activity: "HONEYPOT_ACCOUNT_CREATION",
            ip_address: ip,
            result: "CAPTURED",
            source:"HONEYPOT"
        });
        return res.json({
            message: "Account created successfully"
        });
    });
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
app.post("/login", loginLimiter,accountLimiter, (req,res)=>{
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
    const query = "SELECT * FROM og.accounts WHERE email = ?";
    db.query(query, [email], async(err, results) =>{
        if(err){
            console.error(err);
            logActivity(db, {
            activity: "LOGIN_ATTEMPT",
            ip_address: req.ip,
            result: "FAILED",
            source: "AUTH"
        });
            return res.json({message: "Database Error"});
        }
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
        const sessionQuery = 'INSERT INTO admin.session_tracker(account_id, ip_address) VALUES (?,?)';
        const ip = req.ip;

        db.query(sessionQuery, [user.account_id, ip], (err2, result2)=>{
            if(err2){
                console.error(err2);
                logActivity(db, {
                activity: "LOGIN_ATTEMPT",
                ip_address: req.ip,
                result: "FAILED",
                source: "AUTH"
            });
                return res.json({message: "Session creation failed"});
            }
            const sessionId = result2.insertId;
            const updateLastLogin = 'UPDATE og.accounts SET last_login = CURRENT_TIMESTAMP WHERE account_id =?';
            db.query(updateLastLogin, [user.account_id]);
            const token = jwt.sign(
            {   id: user.account_id,
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
            
        });
    });
});

app.post("/logout", authMiddleware, logRequest("LOGOUT"), (req, res) =>{
    const sessionId = req.user.session_id;

    const query = 'UPDATE admin.session_tracker SET logout_time = CURRENT_TIMESTAMP WHERE session_id = ?';

    db.query(query, [sessionId], (err) =>{
        if (err){
            return res.json({message:"Logout failed"});
        }
        res.json({message: "Logged out successfully"});
    });
    });
app.listen(3000,() => {
    console.log("Server has started on port 3000");
});
