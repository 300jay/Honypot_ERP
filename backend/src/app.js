const express = require("express");
const app = express();
const bcrypt = require("bcrypt");
const db = require("./db");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const SECRET_KEY = process.env.JWT_SECRET;

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if(!authHeader){
        return res.json({message: "No token provided"});
    }
    const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : authHeader;
    try{
        const decoded = jwt.verify(token, SECRET_KEY);
        const query = "SELECT * FROM session_tracker WHERE session_id = ? AND logout_time IS NULL";

        db.query(query, [decoded.session_id], (err, results)=>{
            if (err || results.length === 0){
                return res.json({message: "Invalid session"});
            }
        
        req.user = decoded;
        next();
        });
    }catch(err){
        return res.json({message: "Invalid token"});
    }
}
app.use(express.json());

app.get("/",(req,res) => {
    res.send("Server is running");
});

app.get("/protected", authMiddleware, (req, res)=>{
    res.json({
        message: "Protected here",
        user: req.user
    });
});
app.post("/admin/register", async(req, res) => {
    const {email, password, full_name, prn} = req.body;
    try{
        const hashedPassword = await bcrypt.hash(password, 10);

        const accountQuery = 'INSERT INTO accounts (email, password_hash) VALUES (?, ?)';
        db.query(accountQuery, [email, hashedPassword], (err, result) =>{
            if(err){
                console.error(err);
                return res.json({ message : "Error creating account"});
            }
            const accountId = result.insertId;

            const studentQuery = 'INSERT INTO student_profiles (account_id, full_name, prn) VALUES (?,?,?)';
            db.query(studentQuery, [accountId, full_name, prn], (err2) => {
                if(err2){
                    console.error(err2);
                    return res.json({ message: "Error creating student profile"})
                }
            res.json({
                message: "Student created successfully"
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
