const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

// DB 
const db = new sqlite3.Database('./blog.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        password TEXT NOT NULL -- insecure: storing plain passwords!
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
        )
    `);
});

// MIDDLEWARE 
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ROUTES 

// Home page
// show all posts
app.get('/', (req, res) => {
    db.all('SELECT * FROM posts ORDER BY created_at DESC', (err, posts) => {
        if (err) return res.status(500).send('DB error');
        res.render('index', { posts });
    });
});

// Register
app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', (req, res) => {
    const { email, password } = req.body;

    // INSECURE SQL 
    const query = `INSERT INTO users (email, password) VALUES ('${email}', '${password}')`;

    db.run(query, function (err) {
        if (err) return res.status(500).send('Error registering');
        res.redirect('/login');
    });
});

// Login
app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // INSECURE SQL (SQLI POSSIBLE)
    const query = `
        SELECT * FROM users 
        WHERE email = '${email}' AND password = '${password}'
    `;

    db.get(query, (err, user) => {
        if (err) return res.status(500).send('Error logging in');

        if (!user) {
        return res.send('Invalid credentials (or SQL Injection not used 😈)');
        }

        // NO SESSION MANAGEMENT insecure on purpose
        res.send(`Logged in as: ${user.email}`);
    });
});

// New Post
app.get('/posts/new', (req, res) => {
    res.render('new-post');
});

app.post('/posts/new', (req, res) => {
    const { title, content } = req.body;

    // INSECURE: user_id hardcoded as "1"
    const query = `
        INSERT INTO posts (user_id, title, content)
        VALUES (1, '${title}', '${content}')
    `;

    db.run(query, function (err) {
        if (err) return res.status(500).send('Error creating post');
        res.redirect('/');
    });
});

//START SERVER 
app.listen(PORT, () => {
    console.log(`Insecure blog running at http://localhost:${PORT}`);
});