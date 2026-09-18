require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const morgan = require("morgan");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const app = express();
const db = new Database("shop.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 game TEXT NOT NULL,
 description TEXT DEFAULT '',
 price INTEGER NOT NULL,
 stock INTEGER DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS accounts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 product_id INTEGER NOT NULL,
 username TEXT NOT NULL,
 password TEXT NOT NULL,
 extra TEXT DEFAULT '',
 sold INTEGER DEFAULT 0,
 order_id TEXT,
 FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS orders(
 id TEXT PRIMARY KEY,
 product_id INTEGER NOT NULL,
 amount INTEGER NOT NULL,
 method TEXT NOT NULL,
 status TEXT NOT NULL,
 customer_note TEXT DEFAULT '',
 account_id INTEGER,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(product_id) REFERENCES products(id),
 FOREIGN KEY(account_id) REFERENCES accounts(id)
);
CREATE TABLE IF NOT EXISTS card_payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 telco TEXT NOT NULL,
 denomination INTEGER NOT NULL,
 serial TEXT NOT NULL,
 code TEXT NOT NULL,
 status TEXT DEFAULT 'pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(morgan("dev"));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:8*60*60*1000}
}));
app.use(express.static(path.join(__dirname,"public")));

function admin(req,res,next){
  if(req.session.admin) return next();
  res.status(401).json({error:"Unauthorized"});
}
function orderCode(){ return "ORD-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase(); }
function normalizePrice(v){ const n=Number(v); return Number.isInteger(n)&&n>0?n:0; }

app.get("/api/config",(req,res)=>res.json({
  shopName:process.env.SHOP_NAME||"SHOP ACC",
  bank:{name:process.env.BANK_NAME||"",account:process.env.BANK_ACCOUNT||"",owner:process.env.BANK_OWNER||"",bin:process.env.BANK_BIN||""}
}));

app.get("/api/products",(req,res)=>{
  const rows=db.prepare(`
    SELECT p.*, COALESCE(SUM(CASE WHEN a.sold=0 THEN 1 ELSE 0 END),0) AS real_stock
    FROM products p LEFT JOIN accounts a ON a.product_id=p.id
    GROUP BY p.id ORDER BY p.id DESC`).all();
  res.json(rows);
});

app.get("/api/products/:id",(req,res)=>{
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if(!p) return res.status(404).json({error:"Không tìm thấy sản phẩm"});
  p.real_stock=db.prepare("SELECT COUNT(*) c FROM accounts WHERE product_id=? AND sold=0").get(p.id).c;
  res.json(p);
});

app.post("/api/orders",(req,res)=>{
  const productId=Number(req.body.productId);
  const method=req.body.method;
  if(!["bank","card"].includes(method)) return res.status(400).json({error:"Phương thức thanh toán không hợp lệ"});
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(productId);
  if(!p) return res.status(404).json({error:"Sản phẩm không tồn tại"});
  const acc=db.prepare("SELECT * FROM accounts WHERE product_id=? AND sold=0 ORDER BY id LIMIT 1").get(productId);
  if(!acc) return res.status(409).json({error:"Sản phẩm đã hết hàng"});
  const id=orderCode();
  db.prepare("INSERT INTO orders(id,product_id,amount,method,status,customer_note) VALUES(?,?,?,?,?,?)")
    .run(id,p.id,p.price,method,"pending",String(req.body.note||"").slice(0,200));
  res.json({orderId:id,amount:p.price,method,status:"pending"});
});

/* Demo bank confirmation endpoint.
   In production, connect this to your bank/payment provider webhook.
   Do NOT let a public client call this endpoint. It is admin-protected here. */
app.post("/api/admin/orders/:id/confirm-bank",admin,(req,res)=>{
  const order=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(order.method!=="bank") return res.status(400).json({error:"Không phải đơn ngân hàng"});
  fulfill(order.id,res);
});

/* Card provider callback: protect with a provider signature in production. */
app.post("/api/payment/card/callback",(req,res)=>{
  const secret=process.env.CARD_PROVIDER_API_KEY||"";
  const signature=req.get("x-provider-signature")||"";
  if(secret && signature !== crypto.createHmac("sha256",secret).update(JSON.stringify(req.body)).digest("hex"))
    return res.status(401).json({error:"Invalid signature"});
  const {orderId,status}=req.body;
  if(status!=="success") return res.json({ok:true});
  fulfill(orderId,res,true);
});

app.post("/api/payment/card",(req,res)=>{
  const {orderId,telco,denomination,serial,code}=req.body;
  const order=db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if(!order || order.method!=="card") return res.status(404).json({error:"Đơn không hợp lệ"});
  if(Number(denomination)!==order.amount) return res.status(400).json({error:"Mệnh giá thẻ không khớp giá đơn"});
  if(!telco || !serial || !code) return res.status(400).json({error:"Thiếu thông tin thẻ"});
  db.prepare("INSERT INTO card_payments(order_id,provider,telco,denomination,serial,code) VALUES(?,?,?,?,?,?)")
    .run(orderId,"configured-provider",telco,Number(denomination),String(serial).slice(0,100),String(code).slice(0,100));
  /* This starter does not pretend to verify a card without a real provider.
     Configure your provider API and call the callback endpoint after success. */
  res.json({ok:true,message:"Đã tiếp nhận thẻ. Hệ thống sẽ giao ACC sau khi nhà cung cấp xác nhận thành công."});
});

function fulfill(orderId,res,callback=false){
  const tx=db.transaction(()=>{
    const order=db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if(!order) throw new Error("Order not found");
    if(order.status==="paid" && order.account_id){
      return db.prepare("SELECT * FROM accounts WHERE id=?").get(order.account_id);
    }
    const acc=db.prepare("SELECT * FROM accounts WHERE product_id=? AND sold=0 ORDER BY id LIMIT 1").get(order.product_id);
    if(!acc) throw new Error("Hết ACC");
    db.prepare("UPDATE accounts SET sold=1, order_id=? WHERE id=?").run(order.id,acc.id);
    db.prepare("UPDATE orders SET status='paid', account_id=? WHERE id=?").run(acc.id,order.id);
    return acc;
  });
  try{
    const acc=tx();
    res.json({ok:true,orderId,account:{username:acc.username,password:acc.password,extra:acc.extra}});
  }catch(e){res.status(409).json({error:e.message});}
}

/* Admin */
app.post("/api/admin/login",(req,res)=>{
  if(req.body.username===process.env.ADMIN_USER && req.body.password===process.env.ADMIN_PASSWORD){
    req.session.admin=true; return res.json({ok:true});
  }
  res.status(401).json({error:"Sai tài khoản hoặc mật khẩu"});
});
app.post("/api/admin/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/me",admin,(req,res)=>res.json({ok:true}));

app.post("/api/admin/products",admin,(req,res)=>{
  const {name,game,description}=req.body, price=normalizePrice(req.body.price);
  if(!name||!game||!price) return res.status(400).json({error:"Thiếu dữ liệu"});
  const r=db.prepare("INSERT INTO products(name,game,description,price) VALUES(?,?,?,?)")
    .run(name,game,description||"",price);
  res.json({id:r.lastInsertRowid});
});

app.post("/api/admin/accounts",admin,(req,res)=>{
  const productId=Number(req.body.productId);
  const p=db.prepare("SELECT id FROM products WHERE id=?").get(productId);
  if(!p) return res.status(404).json({error:"Product not found"});
  if(!req.body.username||!req.body.password) return res.status(400).json({error:"Thiếu username/password"});
  const r=db.prepare("INSERT INTO accounts(product_id,username,password,extra) VALUES(?,?,?,?)")
    .run(productId,String(req.body.username),String(req.body.password),String(req.body.extra||""));
  res.json({id:r.lastInsertRowid});
});

app.get("/api/admin/orders",admin,(req,res)=>{
  res.json(db.prepare(`
    SELECT o.*,p.name product_name,a.username account_username
    FROM orders o JOIN products p ON p.id=o.product_id
    LEFT JOIN accounts a ON a.id=o.account_id
    ORDER BY o.created_at DESC LIMIT 100`).all());
});
app.get("/api/admin/stats",admin,(req,res)=>{
  res.json({
    products:db.prepare("SELECT COUNT(*) c FROM products").get().c,
    stock:db.prepare("SELECT COUNT(*) c FROM accounts WHERE sold=0").get().c,
    sold:db.prepare("SELECT COUNT(*) c FROM accounts WHERE sold=1").get().c,
    revenue:db.prepare("SELECT COALESCE(SUM(amount),0) s FROM orders WHERE status='paid'").get().s
  });
});

const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`SHOP ACC running: http://localhost:${port}`));
