const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const csrf = require('csurf');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = 3000;

// ===== DB SETUP (SECURE VERSION) =====
const db = new sqlite3.Database('./blog.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
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

// ===== VIEW ENGINE & STATIC =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== SECURITY MIDDLEWARE =====
app.use(helmet());            // security headers
app.use(morgan('dev'));       // logging HTTP requests

app.use(session({
  secret: 'replace_this_with_env_secret', // в реале хранить в .env
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // secure: true в проде с HTTPS
    maxAge: 1000 * 60 * 60 // 1 час
  }
}));

// CSRF должен идти после session и body-parser
app.use(csrf());

// Сделаем токен и текущего пользователя доступным во всех шаблонах
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.currentUser = req.session.user || null;
  next();
});

// Простое логирование действий пользователя (для monitoring)
app.use((req, res, next) => {
  const userId = req.session.user ? req.session.user.id : 'guest';
  console.log(`[LOG] ${new Date().toISOString()} ${req.method} ${req.url} user=${userId}`);
  next();
});

// ===== AUTH MIDDLEWARE =====
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// ===== ROUTES =====

// Home: show all posts
app.get('/', (req, res) => {
  db.all('SELECT posts.*, users.email AS author_email FROM posts JOIN users ON posts.user_id = users.id ORDER BY created_at DESC', [], (err, posts) => {
    if (err) return res.status(500).send('Database error');
    res.render('index', { posts });
  });
});

// ----- AUTH -----
// Register
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('register', { error: 'Email and password are required.' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  const query = `INSERT INTO users (email, password) VALUES (?, ?)`;
  db.run(query, [email, hashedPassword], function (err) {
    if (err) {
      console.error(err);
      return res.render('register', { error: 'Registration failed (maybe email already used).' });
    }
    res.redirect('/login');
  });
});

// Login
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  const query = `SELECT * FROM users WHERE email = ?`;
  db.get(query, [email], (err, user) => {
    if (err) {
      console.error(err);
      return res.render('login', { error: 'Login error.' });
    }

    if (!user) {
      return res.render('login', { error: 'Invalid email or password.' });
    }

    const match = bcrypt.compareSync(password, user.password);
    if (!match) {
      return res.render('login', { error: 'Invalid email or password.' });
    }

    // Сохраняем пользователя в сессии (без пароля)
    req.session.user = { id: user.id, email: user.email };
    res.redirect('/');
  });
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ----- POSTS -----
// New Post (form)
app.get('/posts/new', requireLogin, (req, res) => {
  res.render('new-post', { error: null });
});

// New Post (submit)
app.post('/posts/new', requireLogin, (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.render('new-post', { error: 'Title and content are required.' });
  }

  const query = `
    INSERT INTO posts (user_id, title, content)
    VALUES (?, ?, ?)
  `;

  db.run(query, [req.session.user.id, title, content], function (err) {
    if (err) {
      console.error(err);
      return res.render('new-post', { error: 'Error creating post.' });
    }
    res.redirect('/');
  });
});

// View single post (safe)
app.get('/posts/:id', (req, res) => {
  const id = req.params.id;
  const query = `
    SELECT posts.*, users.email AS author_email 
    FROM posts 
    JOIN users ON posts.user_id = users.id
    WHERE posts.id = ?
  `;

  db.get(query, [id], (err, post) => {
    if (err) return res.status(500).send('Database error');
    if (!post) return res.status(404).send('Post not found');

    res.render('view-post', { post });
  });
});

// Edit form (only owner)
app.get('/posts/:id/edit', requireLogin, (req, res) => {
  const id = req.params.id;
  const query = `SELECT * FROM posts WHERE id = ? AND user_id = ?`;

  db.get(query, [id, req.session.user.id], (err, post) => {
    if (err) return res.status(500).send('Database error');
    if (!post) return res.status(404).send('Post not found or access denied');

    res.render('edit-post', { post, error: null });
  });
});

// Handle edit
app.post('/posts/:id/edit', requireLogin, (req, res) => {
  const id = req.params.id;
  const { title, content } = req.body;

  if (!title || !content) {
    return res.render('edit-post', { post: { id, title, content }, error: 'Title and content are required.' });
  }

  const query = `
    UPDATE posts
    SET title = ?, content = ?
    WHERE id = ? AND user_id = ?
  `;

  db.run(query, [title, content, id, req.session.user.id], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    if (this.changes === 0) {
      return res.status(404).send('Post not found or access denied');
    }
    res.redirect('/');
  });
});

// Delete post (POST + owner check)
app.post('/posts/:id/delete', requireLogin, (req, res) => {
  const id = req.params.id;
  const query = `DELETE FROM posts WHERE id = ? AND user_id = ?`;

  db.run(query, [id, req.session.user.id], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    res.redirect('/');
  });
});

// ----- Search (SAFE, no reflected XSS) -----
app.get('/search', (req, res) => {
  const q = req.query.q || "";
  const like = `%${q}%`;

  const query = `SELECT posts.*, users.email AS author_email 
                 FROM posts 
                 JOIN users ON posts.user_id = users.id
                 WHERE title LIKE ? OR content LIKE ?
                 ORDER BY created_at DESC`;

  db.all(query, [like, like], (err, posts) => {
    if (err) return res.status(500).send('Database error');
    res.render('search', { q, posts });
  });
});

// ===== CSRF ERROR HANDLER =====
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.error('CSRF token error:', err);
    return res.status(403).send('Form tampered with (CSRF token invalid).');
  }
  next(err);
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`SECURE blog running at http://localhost:${PORT}`);
});
