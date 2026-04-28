const axios = require('axios');
var express = require('express'),
  cors = require('cors');

const bodyParser = require('body-parser');
const ejs = require('ejs');
const session = require('express-session');
const path = require('path');
const MemoryStore = require('memorystore')(session);
const fs = require('fs');
const { exec, spawn } = require("child_process");
const BASE_URL = "https://mitsuri-api.onrender.com";


const {
  ft,
  total,
  insta,
  zap,
  yt,
  wallpaper,
  saldo
} = require("./config.js");

const htmlPath = path.join(__dirname, './views/error.html');
const creator = "CM";

const DB_PATH = './database/database.json';

function getUsers() {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH));
}

function saveUsers(users) {
  fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
}

function findUser(username) {
  const users = getUsers();
  return users.find(u => u.username === username);
}

var app = express();
app.enable('trust proxy');

app.set("json spaces", 2);
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'secret',
  resave: true,
  saveUninitialized: true,
  cookie: { maxAge: 86400000 },
  store: new MemoryStore({
    checkPeriod: 86400000
  }),
}));

app.use(cors());
app.use(express.static("public"));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json());

/* ================= FUNÇÕES ================= */

async function diminuirSaldo(username) {
  const users = getUsers();
  const user = users.find(u => u.username === username);

  if (!user) return false;
  if (user.isAdm) return false;

  if (user.saldo > 0) {
    user.saldo--;
    saveUsers(users);
    return true;
  }

  return false;
}

async function adicionarSldoUsado(username) {
  const users = getUsers();
  const user = users.find(u => u.username === username);

  if (!user) return false;

  user.total += 1;
  saveUsers(users);
  return true;
}

function consumirSaldoPorKey(key) {
    const users = getUsers();
    const user = users.find(u => u.key === key);

    if (!user) {
        return { ok: false, msg: "invalid key" };
    }

    // ADM tem saldo infinito, não desconta nada
    if (user.isAdm) {
        return {
            ok: true,
            saldo: "∞",
            user
        };
    }

    if (typeof user.saldo !== "number") {
        user.saldo = 0;
    }

    if (user.saldo <= 0) {
        return { ok: false, msg: "insufficient balance" };
    }

    user.saldo -= 1;
    saveUsers(users);

    return {
        ok: true,
        saldo: user.saldo,
        user
    };
}

function checkSaldo(key) {
    const users = getUsers();
    const user = users.find(u => u.key === key);

    if (!user) return { ok: false, msg: "invalid key" };

    if (user.isAdm) {
        return { ok: true, user, saldo: "∞" };
    }

    if (user.saldo <= 0) {
        return { ok: false, msg: "insufficient balance" };
    }

    user.saldo -= 1;
    saveUsers(users);

    return { ok: true, user };
}

/* ================= ROTAS ================= */

app.get('/', (req, res) => {
  return res.redirect('/loading?to=/home');
});

app.get('/loading', (req, res) => {
  const redirect = req.query.to || '/'
  res.render('loading', { redirect })
})

app.get('/home', (req, res) => {
  // 🔐 verifica se tá logado
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const users = getUsers();

  // 🔎 pega usuário atualizado
  const userDb = users.find(u => u.username === req.session.user.username);

  // ⚠️ se não existir
  if (!userDb) {
    req.session.destroy();
    return res.redirect('/login');
  }

  // 🏆 top 5
  const topUsers = [...users]
    .sort((a, b) => (b.saldo || 0) - (a.saldo || 0))
    .slice(0, 5);

  res.render('dashboard', {
    user: userDb,
    userDb,
    topUsers,
    quantidade: users.length
  });
});

app.get('/apis', (req, res) => {
  res.redirect('/loading?to=/apisPage')
})

app.get('/myperfil', (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/login');

  const users = getUsers();
  const userDb = users.find(u => u.username === user.username);

  const topUsers = [...users].sort((a, b) => b.total - a.total).slice(0, 7);

  res.render('myperfil', {
    user,
    userDb,
    users: userDb,
    topUsers,
    quantidade: users.length
  });
});

app.get('/search', (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/login');

  const searchTerm = req.query.search || '';
  const users = getUsers();

  const searchResults = users.filter(u =>
    u.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  res.render('search', { searchTerm, searchResults });
});

/* ================= AUTH ================= */

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', (req, res) => {
  const { username, password, email } = req.body;
  const users = getUsers();

  if (users.find(u => u.username === username)) {
    return res.status(409).send('Usuário já existe.');
  }

  const key = Math.floor(100000 + Math.random() * 900000).toString();

  const newUser = {
    username,
    password,
    email,
    key,
    saldo,
    total,
    ft,
    zap,
    insta,
    yt,
    wallpaper,
    isAdm: false
  };

  users.push(newUser);
  saveUsers(users);

  req.session.user = newUser;
  res.redirect('/');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const user = findUser(username);
  if (!user) return res.status(401).send('Usuário não encontrado.');

  if (user.password !== password) {
    return res.status(401).send('Senha incorreta.');
  }

  req.session.user = user;
  res.redirect('/');
});

/* ================= ADMIN ================= */

app.get('/admin', (req, res) => {
  const user = req.session.user;
  if (!user) return res.sendFile(htmlPath);

  if (!user.isAdm) return res.sendFile(htmlPath);

  const users = getUsers();
  res.render('adminDashboard', { users, user });
});

/* ================= EDIT ================= */

// 🔥 MUITO IMPORTANTE (se não tiver isso, não funciona)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/edit/:username', (req, res) => {
  console.log("BODY:", req.body); // debug

  const { username } = req.params;
  const currentUser = req.session.user;

  let users = getUsers();
  const user = users.find(u => u.username === username);

  if (!user) return res.status(404).send('Usuário não encontrado.');

  // 🔐 proteção
  if (!currentUser || (!currentUser.isAdm && currentUser.username !== username)) {
    return res.status(401).send('Sem permissão.');
  }

  // 🧠 só atualiza se vier valor válido
  if (req.body.password?.trim()) user.password = req.body.password;
  if (req.body.ft?.trim()) user.ft = req.body.ft;
  if (req.body.wallpaper?.trim()) user.wallpaper = req.body.wallpaper;
  if (req.body.zap?.trim()) user.zap = req.body.zap;
  if (req.body.yt?.trim()) user.yt = req.body.yt;
  if (req.body.insta?.trim()) user.insta = req.body.insta;

  // 🔢 números
  if (req.body.saldo) user.saldo = parseInt(req.body.saldo) || user.saldo;
  if (req.body.total) user.total = parseInt(req.body.total) || user.total;

  // 🔑 só ADM pode mexer
  if (currentUser.isAdm) {
    if (req.body.key) user.key = req.body.key;
    user.isAdm = req.body.isAdm === 'true';
  }

  saveUsers(users);

  console.log("✅ SALVO!");
  
  res.redirect('/loading?to=/home')
});

app.get('/deletar/:username', (req, res) => {
  const currentUser = req.session.user;
  const targetUsername = req.params.username;

  let users = getUsers();
  const user = users.find(u => u.username === targetUsername);

  if (!user) return res.status(404).send('Usuário não encontrado.');

  // 🔐 proteção
  if (!currentUser || (!currentUser.isAdm && currentUser.username !== targetUsername)) {
    return res.status(401).send('Sem permissão.');
  }

  users = users.filter(u => u.username !== targetUsername);
  saveUsers(users);

  res.redirect('/loading?to=/login') // melhor após deletar
});
/* ================= DELETE ================= */

app.get('/deletar/:username', (req, res) => {
  const currentUser = req.session.user;
  const targetUsername = req.params.username;

  let users = getUsers();
  const user = users.find(u => u.username === targetUsername);

  if (!user) return res.status(404).send('Usuário não encontrado.');

  if (!currentUser.isAdm && currentUser.username !== user.username) {
    return res.status(401).send('Sem permissão.');
  }

  users = users.filter(u => u.username !== targetUsername);
  saveUsers(users);

  res.redirect('/loading?to=/home')
});

app.get('/apisPage', (req, res) => {
  const users = getUsers();
  const user = users[0]; // depois você pode trocar por sessão

  const apis = [
    {
      name: 'YouTube Downloader',
      desc: 'Info, MP3 e MP4 do YouTube',
      url: `${BASE_URL}/api/ytdl?url=https://youtube.com/shorts/mOvWdB2EOWs?si=EEQYdcaerT3KMpVG&key=${user.key}`
    },

    {
      name: 'TikTok Downloader',
      desc: 'Baixar vídeos do TikTok sem marca d’água',
      url: `${BASE_URL}/api/tiktok?url=https://vm.tiktok.com/ZS9N9Rh2RXVEY-iQNeH/&key=${user.key}`
    }
  ];

  res.render('apis', { apis, user });
});


app.get("/api/ytdl", (req, res) => {

    const key = req.query.key;
    const result = checkSaldo(key);

    if (!result.ok) {
        return res.status(403).json({ error: result.msg });
    }

    const user = result.user;
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ error: "Invalid url" });
    }

    exec(`yt-dlp -J "${url}"`, (err, stdout) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const data = JSON.parse(stdout);
        const encoded = encodeURIComponent(url);

        return res.json({
            creator: "FelpzSystem",
            user: user.username,
            saldo: user.isAdm ? "∞" : user.saldo,

            info: {
                title: data.title,
                thumbnail: data.thumbnail,
                duration: data.duration,
                author: data.uploader
            },

            download: {
                mp3: `${BASE_URL}/api/ytdl/mp3?url=${encoded}&key=${user.key}`,
                mp4: `${BASE_URL}/api/ytdl/mp4?url=${encoded}&key=${user.key}`
            }
        });
    });
});


// 🎧 MP3
app.get("/api/ytdl/mp3", (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("Invalid url");

    res.setHeader("Content-Type", "audio/mpeg");

    const proc = spawn("yt-dlp", [
        "-x",
        "--audio-format", "mp3",
        url,
        "-o",
        "-"
    ]);

    proc.stdout.pipe(res);
});


// 🎬 MP4
app.get("/api/ytdl/mp4", (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("Invalid url");

    res.setHeader("Content-Type", "video/mp4");

    const proc = spawn("yt-dlp", [
        "-f", "mp4",
        url,
        "-o",
        "-"
    ]);

    proc.stdout.pipe(res);
});

app.get("/api/tiktok", (req, res) => {

    const key = req.query.key;
    const result = checkSaldo(key);

    if (!result.ok) {
        return res.status(403).json({ error: result.msg });
    }

    const user = result.user;
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ error: "Invalid url" });
    }

    exec(`yt-dlp -J "${url}"`, (err, stdout) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        let data;
        try {
            data = JSON.parse(stdout);
        } catch (e) {
            return res.status(500).json({ error: "Failed to parse response" });
        }

        const encoded = encodeURIComponent(url);

        return res.json({
            creator: "FelpzSystem",

            user: user.username,
            saldo: user.isAdm ? "∞" : user.saldo,

            info: {
                title: data.title,
                thumbnail: data.thumbnail,
                duration: data.duration,
                author: data.uploader
            },

            download: {
                mp3: `${BASE_URL}/api/tiktok/mp3?url=${encoded}&key=${user.key}`,
                mp4: `${BASE_URL}/api/tiktok/mp4?url=${encoded}&key=${user.key}`
            }
        });
    });
});

app.get("/api/tiktok/mp3", (req, res) => {
    const url = req.query.url;

    if (!url) return res.status(400).send("Invalid url");

    res.setHeader("Content-Type", "audio/mpeg");

    const proc = spawn("yt-dlp", [
        "-x",
        "--audio-format", "mp3",
        url,
        "-o",
        "-"
    ]);

    proc.stdout.pipe(res);
});

app.get("/api/tiktok/mp4", (req, res) => {
    const url = req.query.url;

    if (!url) return res.status(400).send("Invalid url");

    res.setHeader("Content-Type", "video/mp4");

    const proc = spawn("yt-dlp", [
        "-f", "best",
        url,
        "-o",
        "-"
    ]);

    proc.stdout.pipe(res);
});

app.get("/api/player-info", async (req, res) => {

    const key = req.query.key;
    const uid = req.query.uid;
    const region = req.query.region || "BR";

    // 🔑 validação da key + saldo
    const result = checkSaldo(key);

    if (!result.ok) {
        return res.status(403).json({ error: result.msg });
    }

    const user = result.user;

    if (!uid) {
        return res.status(400).json({ error: "uid required" });
    }

    try {
        const { data } = await axios.get(
            `https://hydra-info-api.vercel.app/player-info?uid=${uid}&region=${region}`
        );

        return res.json({
            creator: "FelpzSystem",

            user: user.username,
            saldo: user.isAdm ? "∞" : user.saldo,

            uid,
            region,

            basicInfo: data.basicInfo,
            profileInfo: data.profileInfo,
            clanBasicInfo: data.clanBasicInfo,
            captainBasicInfo: data.captainBasicInfo,
            petInfo: data.petInfo,
            socialInfo: data.socialInfo,
            diamondCostRes: data.diamondCostRes,
            creditScoreInfo: data.creditScoreInfo
        });

    } catch (err) {
        return res.status(500).json({
            error: "Failed to fetch player info",
            details: err.message
        });
    }
});

app.get("/api/gen-accounts", async (req, res) => {

    const key = req.query.key;
    const name = req.query.name;
    const count = req.query.count || 10;
    const region = req.query.region || "BR";

    // 🔑 sistema de key/saldo
    const result = checkSaldo(key);

    if (!result.ok) {
        return res.status(403).json({ error: result.msg });
    }

    const user = result.user;

    if (!name) {
        return res.status(400).json({ error: "name required" });
    }

    try {
        const { data } = await axios.get(
            `https://hydra-guest-api.vercel.app/gen?name=${name}&count=${count}&region=${region}`
        );

        return res.json({
            creator: "FelpzSystem",

            user: user.username,
            saldo: user.isAdm ? "∞" : user.saldo,

            response: data
        });

    } catch (err) {
        return res.status(500).json({
            error: "Failed to fetch API",
            details: err.message
        });
    }
});
/* ================= SERVER ================= */
    
app.listen(3500, () => {
  console.log("🚀 Server rodando: http://localhost:3500");
});

module.exports = app;