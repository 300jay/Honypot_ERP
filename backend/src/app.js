const express = require("express");
const app = express();
const bcrypt = require("bcrypt");
const db = require("./db");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const SECRET_KEY = process.env.JWT_SECRET;

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.json({ message: "No token provided" });
    }

    const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

    try {
        const decoded = jwt.verify(token, SECRET_KEY);

        const query = `
            SELECT * FROM session_tracker 
            WHERE session_id = ? AND logout_time IS NULL
        `;

        db.query(query, [decoded.session_id], (err, results) => {
            if (err || results.length === 0) {
                return res.json({ message: "Invalid session" });
            }

            const roleQuery = `
                SELECT r.role_name 
                FROM account_role_map arm 
                JOIN access_roles r ON arm.role_id = r.role_id 
                WHERE arm.account_id = ?
            `;

            db.query(roleQuery, [decoded.id], (err2, roleResults) => {
                if (err2 || roleResults.length === 0) {
                    return res.json({ message: "Role not found" });
                }

                // ✅ MUST be inside callback
                req.user = {
                    ...decoded,
                    role: roleResults[0].role_name
                };

                next(); // ✅ also inside
            });
        });

    } catch (err) {
        return res.json({ message: "Invalid token" });
    }
};
const requireRole = (role) => {
    return (req, res, next) => {
        if(!req.user || req.user.role !== role){
            return res.json({message: "Access denied"});
        } 
        next();
    };
};
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

app.get("/student/profile", authMiddleware, requireRole("student"), (req, res)=>{
    const accountId = req.user.id;

    const query = 'SELECT student_id, full_name, prn, class_id, roll_no, admission_year FROM student_profiles WHERE account_id = ?';
    db.query(query, [accountId], (err, results) =>{
        if (err) return res.json({message: "Error fetching profile"});
        if (results.length===0){
            return res.json({message: "Profile not found"})
        }
        res.json(results[0]);
    });
});

app.get("/student/attendance", authMiddleware, requireRole("student"), (req,res) =>{
    const accountId = req.user.id;

    const query = `SELECT ar.*, asses.session_date, asess.subject
                   FROM attendance_records ar
                   JOIN student_profiles sp ON ar.student_id = sp.student_id 
                   JOIN attendance_sessions asess ON ar.session_id = asess.session_id WHERE sp.account_id =?`;

    db.query(query,[accountId], (err,results)=>{
        if (err) return res.json({message: "Error fetching attendance"});
        
        res.json(results);
    });
});

app.get("/student/results", authMiddleware, requireRole("student"), (req, res)=>{
    const accountId = req.user.id;

    const query = 'SELECT e.exam_name, e.exam_date, e.max_marks, er.marks_obtained, er.grade FROM exam_results er JOIN student_profiles sp ON er.student_id = sp.student_id JOIN exams e ON er.exam_id = e.exam_id WHERE sp.account_id = ?';
    db.query(query, [accountId], (err, results) =>{
        if (err) return res.json({message:"Error fetching results"});
        res.json(results);
    });
});

app.post("/teacher/attendance", authMiddleware, requireRole("teacher"), (req, res) =>{
    const {student_id, attendance_date, status} = req.body;
    if (!student_id||!attendance_date||!status){
        return res.json({message: "All fields required"});
    }
    const sessionQuery = 'INSERT INTO attendance_sessions (offering_id, attendance_date, marked_by) VALUES (?,?,?)';
    // const offering_id = 1;
    const teacher_id = req.user.id;
    db.query(sessionQuery, [offering_id, attendance_date, teacher_id], (err, result) => {
        if(err){
            console.error(err);
            return res.json({message: "Error creating session"});
        }
        const sessionId = result.insertId;

        const recordQuery = 'INSERT INTO attendance_records (attendance_session_id, student_id, status) VALUES (?,?,?)';
        db.query(recordQuery,[sessionId, student_id, status], (err2) =>{
            if (err2){
                console.error(err2);
                return res.json({message: "Error marking attendance"});
            }
            res.json({message: "Attendance marked successfully"});
        });
    });
});
app.post("/teacher/results", authMiddleware, requireRole("teacher"), (req, res) =>{
    const {student_id, exam_name, exam_date, max_marks, marks_obtained, grade} = req.body;

    if(!student_id|| !exam_name || !exam_date || !max_marks || !marks_obtained || !grade){
        return res.json({message: "All fields required"});
    }
    const examQuery = 'INSERT INTO exams (offering_id, exam_name, exam_date, max_marks) VALUES (?,?,?,?)';
    // const offering_id = 1

    db.query(examQuery, [offering_id, exam_name, exam_date, max_marks], (err, result)=>{
        if(err){
            console.error(err);
            return res.json({message: "Error creating exam"});
        }
        const examId = result.insertId;

        const resultQuery = 'INSERT INTO exam_results (exam_id, student_id, marks_obtained, grade) VALUES (?,?,?,?)';
        db.query(resultQuery,[examId, student_id, marks_obtained, grade], (err2) =>{
            if (err2){
                console.error(err2);
                return res.json({ message: "Error saving result"});
            }
        });
    });
});
app.post("/admin/register", authMiddleware, requireRole("admin"), async(req, res) => {
    console.log("BODY:", req.body);
    const { email, password, full_name, prn, class_id, roll_no, admission_year, role } = req.body;
    if (!email || !password || !full_name || !prn || class_id == null || roll_no == null || admission_year == null) {
        return res.json({ message: "All fields required" });
    }
    try{
        const hashedPassword = await bcrypt.hash(password, 10);

        db.beginTransaction((err)=> {
            if(err){
                return res.json({message: "Transaction start failed"});
            }
        const accountQuery = 'INSERT INTO accounts (email, password_hash) VALUES (?, ?)';
        db.query(accountQuery, [email, hashedPassword], (err, result) =>{
            if(err){
                console.error(err);
                return db.rollback(() => {
                    return res.json({ message : "Error creating account"});
            });
            }
            const accountId = result.insertId;
            const getRoleQuery = "SELECT role_id FROM access_roles WHERE role_name = 'student'"

            db.query(getRoleQuery, (errRole, roleResult)=>{
                if (errRole || roleResult.length ===0){
                    console.error(errRole);
                    return db.rollback(() => {
                        return res.json({message: "Role fetch failed"});
                    });
                }
                const roleID = roleResult[0].role_id;

                const mapQuery = "INSERT INTO account_role_map (account_id, role_id) VALUES (?,?)";
                db.query(mapQuery, [accountId, roleID], (errMap) => {
                    if (errMap){
                        console.error(errMap);
                        return db.rollback(() => {
                            return res.json({message: "Role assignment failed"});
                        });
                    }
                    const studentQuery = 'INSERT INTO student_profiles (account_id, prn, full_name, class_id, roll_no, admission_year) VALUES (?,?,?,?,?,?)';
            db.query(studentQuery,  [accountId, prn, full_name, class_id, roll_no, admission_year], (err2) => {
                if(err2){
                    console.error(err2);
                    return db.rollback(() => {
                        return res.json({ message: "Error creating student profile"})
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
app.post("/login",(req,res)=>{
    const {email, password} = req.body;

    const query = "SELECT * FROM accounts WHERE email = ?";
    db.query(query, [email], async(err, results) =>{
        if(err){
            console.error(err);
            return res.json({message: "Database Error"});
        }
        if (results.length==0){
            return res.json({message: "User not found"});
        }
        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if(!isMatch){
            return res.json({message: "Invalid Credentials"});
        }
        const sessionQuery = 'INSERT INTO session_tracker(account_id, ip_address) VALUES (?,?)';
        const ip = req.ip;

        db.query(sessionQuery, [user.account_id, ip], (err2, result2)=>{
            if(err2){
                console.error(err2);
                return res.json({message: "Session creation failed"});
            }
            const sessionId = result2.insertId;
            const token = jwt.sign(
            {   id: user.account_id,
                email: user.email,
                session_id: sessionId
            },
                SECRET_KEY,
            {expiresIn:"1h"}

        ); 
        res.json({
            message: "Login working",
            token
        });
            
        });
    });
});

app.post("/logout", authMiddleware, (req, res) =>{
    const sessionId = req.user.session_id;

    const query = 'UPDATE session_tracker SET logout_time = CURRENT_TIMESTAMP WHERE session_id = ?';

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
