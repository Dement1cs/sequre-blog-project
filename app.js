const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

// ===== DB SETUP (INSECURE) =====
const db = new sqlite3.Database('./blog.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      password TEXT NOT NULL -- INSECURE: plain text
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



// ===== MIDDLEWARE =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));



// ===== ROUTES =====

// Home: show all posts
app.get('/', (req, res) => {
  db.all('SELECT * FROM posts ORDER BY created_at DESC', (err, posts) => {
    if (err) return res.status(500).send('DB error');
    res.render('index', { posts });
  });
});



// ----- AUTH -----
// Register
app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', (req, res) => {
  const { email, password } = req.body;

  // INSECURE: SQL concatenation, no validation, plain password
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

  // INSECURE: SQL Injection possible
  const query = `
    SELECT * FROM users 
    WHERE email = '${email}' AND password = '${password}'
  `;

  db.get(query, (err, user) => {
    if (err) return res.status(500).send('Error logging in');

    if (!user) {
      return res.send('Invalid credentials (or SQL Injection not used)');
    }

    // INSECURE: no sessions + sensitive data exposure
    res.send(`
      <h1>Welcome</h1>
      <p>Email: ${user.email}</p>
      <p>Password from DB (PLAIN TEXT): ${user.password}</p>
      <a href="/">Back to home</a>
    `);
  });
});



// ----- POSTS -----
// New Post (form)
app.get('/posts/new', (req, res) => {
  res.render('new-post');
});

// New Post (submit)
app.post('/posts/new', (req, res) => {
  const { title, content } = req.body;

  // INSECURE: user_id = 1, no auth, SQL concat
  const query = `
    INSERT INTO posts (user_id, title, content)
    VALUES (1, '${title}', '${content}')
  `;

  db.run(query, function (err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Error creating post');
    }
    res.redirect('/');
  });
});

// View single post
app.get('/posts/:id', (req, res) => {
  const id = req.params.id;

  const query = `SELECT * FROM posts WHERE id = ${id}`; // INSECURE

  db.get(query, (err, post) => {
    if (err) return res.status(500).send('DB error');
    if (!post) return res.status(404).send('Post not found');

    res.send(`
      <h1>${post.title}</h1>
      <div>${post.content}</div>
      <p><small>${post.created_at}</small></p>
      <a href="/">Back</a>
    `);
  });
});

// Edit form (no auth)
app.get('/posts/:id/edit', (req, res) => {
  const id = req.params.id;
  const query = `SELECT * FROM posts WHERE id = ${id}`;

  db.get(query, (err, post) => {
    if (err) return res.status(500).send('DB error');
    if (!post) return res.status(404).send('Post not found');

    const html = `
      <h1>Edit Post</h1>
      <form method="post" action="/posts/${id}/edit">
        <label>Title: <input type="text" name="title" value="${post.title}"></label><br>
        <label>Content:</label><br>
        <textarea name="content" rows="5" cols="40">${post.content}</textarea><br>
        <button type="submit">Save</button>
      </form>
      <a href="/">Back</a>
    `;
    res.send(html);
  });
});

// Handle edit
app.post('/posts/:id/edit', (req, res) => {
  const id = req.params.id;
  const { title, content } = req.body;

  const query = `
    UPDATE posts
    SET title = '${title}', content = '${content}'
    WHERE id = ${id}
  `;

  db.run(query, function (err) {
    if (err) return res.status(500).send('DB error');
    res.redirect('/');
  });
});

// Delete post using GET (bad practice)
app.get('/posts/:id/delete', (req, res) => {
  const id = req.params.id;

  const query = `DELETE FROM posts WHERE id = ${id}`;

  db.run(query, function (err) {
    if (err) return res.status(500).send('DB error');
    res.redirect('/');
  });
});

// ----- Reflected XSS -----
app.get('/search', (req, res) => {
  const q = req.query.q || "";

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Search</title></head>
    <body>
      <h1>Search Results</h1>
      <p>You searched for: ${q}</p> <!-- Reflected XSS -->

      <a href="/">Back</a>
    </body>
    </html>
  `;

  res.send(html);
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Insecure blog running at http://localhost:${PORT}`);
});
