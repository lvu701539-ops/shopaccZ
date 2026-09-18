async function api(url,opt){const r=await fetch(url,{headers:{"Content-Type":"application/json"},...opt});const d=await r.json();if(!r.ok)throw Error(d.error||"Có lỗi");return d}
const money=n=>Number(n).toLocaleString("vi-VN")+"đ";
async function load(){
 const cfg=await api("/api/config"); document.querySelector("#shopName").textContent=cfg.shopName;
 const ps=await api("/api/products"); const box=document.querySelector("#products");
 box.innerHTML=ps.map(p=>`<article class="card"><span class="tag">${p.game}</span><h3>${p.name}</h3><p>${p.description||""}</p><strong>${money(p.price)}</strong><p>Kho: ${p.real_stock}</p><button ${p.real_stock? "":"disabled"} onclick="buy(${p.id})">${p.real_stock?"Mua ngay":"Hết hàng"}</button></article>`).join("");
}
async function buy(id){
 const method=prompt("Nhập phương thức: bank hoặc card","bank"); if(!method)return;
 try{
  const o=await api("/api/orders",{method:"POST",body:JSON.stringify({productId:id,method})});
  if(method==="bank") showBank(o); else showCard(o);
 }catch(e){alert(e.message)}
}
async function showBank(o){
 const c=await api("/api/config");
 alert(`Mã đơn: ${o.orderId}\nSố tiền: ${Number(o.amount).toLocaleString("vi-VN")}đ\nNgân hàng: ${c.bank.name}\nSTK: ${c.bank.account}\nChủ TK: ${c.bank.owner}\nNội dung CK: ${o.orderId}\n\nSau khi chuyển khoản, chờ hệ thống xác nhận.`);
}
async function showCard(o){
 const telco=prompt("Nhà mạng (Viettel/Vina/Mobi):"); if(!telco)return;
 const denomination=o.amount, serial=prompt("Serial thẻ:"), code=prompt("Mã thẻ:");
 try{const d=await api("/api/payment/card",{method:"POST",body:JSON.stringify({orderId:o.orderId,telco,denomination,serial,code})});alert(d.message)}catch(e){alert(e.message)}
}
load();