const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'legal-app-secret-2024';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');

// ===== SIMPLE JSON DATABASE =====
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { users:[], cases:[], clients:[], events:[], tasks:[], documents:[], finances:[], messages:[] };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}

// ===== INIT DB =====
const db = readDB();
if (!db.users.find(u => u.email === 'admin@legal.ir')) {
  db.users.push({
    id: 1,
    name: 'مدیر سیستم',
    email: 'admin@legal.ir',
    password: bcrypt.hashSync('admin123', 10),
    role: 'admin'
  });
  writeDB(db);
}

// ===== MIDDLEWARES =====
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ===== AUTH MIDDLEWARE =====
function auth(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'لطفاً وارد شوید' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'توکن نامعتبر است' });
  }
}

// ===== AUTH ROUTES =====
app.post('/api/login', (req, res) => {
  const db = readDB();
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
});

app.post('/api/register', (req, res) => {
  const db = readDB();
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'همه فیلدها الزامی است' });
  if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'این ایمیل قبلاً ثبت شده' });
  const user = { id: nextId(db.users), name, email, password: bcrypt.hashSync(password, 10), role: role || 'lawyer' };
  db.users.push(user);
  writeDB(db);
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, email } });
});

// ===== GENERIC CRUD FACTORY =====
function makeCRUD(collection) {
  // GET ALL
  app.get(`/api/${collection}`, auth, (req, res) => {
    const db = readDB();
    res.json((db[collection] || []).filter(x => x.user_id === req.user.id));
  });
  // POST
  app.post(`/api/${collection}`, auth, (req, res) => {
    const db = readDB();
    const item = { id: nextId(db[collection] || []), ...req.body, user_id: req.user.id, created_at: new Date().toISOString() };
    db[collection] = db[collection] || [];
    db[collection].push(item);
    writeDB(db);
    res.json(item);
  });
  // PUT
  app.put(`/api/${collection}/:id`, auth, (req, res) => {
    const db = readDB();
    const idx = db[collection].findIndex(x => x.id == req.params.id && x.user_id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'پیدا نشد' });
    db[collection][idx] = { ...db[collection][idx], ...req.body };
    writeDB(db);
    res.json(db[collection][idx]);
  });
  // DELETE
  app.delete(`/api/${collection}/:id`, auth, (req, res) => {
    const db = readDB();
    db[collection] = db[collection].filter(x => !(x.id == req.params.id && x.user_id === req.user.id));
    writeDB(db);
    res.json({ ok: true });
  });
}

makeCRUD('cases');
makeCRUD('clients');
makeCRUD('events');
makeCRUD('tasks');
makeCRUD('finances');
makeCRUD('messages');

// ===== FILE UPLOAD =====
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.get('/api/documents', auth, (req, res) => {
  const db = readDB();
  res.json((db.documents || []).filter(x => x.user_id === req.user.id));
});
app.post('/api/documents', auth, upload.single('file'), (req, res) => {
  const db = readDB();
  const doc = {
    id: nextId(db.documents || []),
    name: req.body.name || (req.file ? req.file.originalname : 'سند'),
    cat: req.body.cat || 'legal',
    case_num: req.body.case_num || '',
    file_path: req.file ? '/uploads/' + req.file.filename : '',
    file_type: req.file ? req.file.mimetype : '',
    user_id: req.user.id,
    created_at: new Date().toISOString()
  };
  db.documents = db.documents || [];
  db.documents.push(doc);
  writeDB(db);
  res.json(doc);
});
app.delete('/api/documents/:id', auth, (req, res) => {
  const db = readDB();
  db.documents = db.documents.filter(x => !(x.id == req.params.id && x.user_id === req.user.id));
  writeDB(db);
  res.json({ ok: true });
});

// ===== SERVE APP =====
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log('');
  console.log('  ================================');
  console.log('   سامانه مدیریت دفتر حقوقی');
  console.log('  ================================');
  console.log('');
  console.log('  آدرس: http://localhost:' + PORT);
  console.log('');
  console.log('  ایمیل:  admin@legal.ir');
  console.log('  رمز:    admin123');
  console.log('');
  console.log('  برای توقف: Ctrl + C');
  console.log('');
});
