const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(value,max)=>String(value??'').trim().slice(0,max);

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(url.searchParams.get('share')!==env.SHARE_KEY)return json({error:'共享链接无效'},403);
    try{
      const mailMatch=url.pathname.match(/^\/api\/confirmation\/(\d+)$/);
      if(mailMatch&&request.method==='GET'){
        const allowed=new Set(['34868420','35413193','35413179','35413205','35413198','35413153']);
        if(!allowed.has(mailMatch[1]))return json({error:'确认邮件不存在'},404);
        const upstream=await fetch('https://wanderlog.com/api/tripPlans/ryfdswcvguxmleir/emails/'+mailMatch[1],{signal:AbortSignal.timeout(20000)});
        if(!upstream.ok)return json({error:'Wanderlog 暂时无法读取邮件，请稍后重试'},502);
        const result=await upstream.json();if(!result.success||!result.data?.text)return json({error:'确认邮件暂不可用'},502);
        const safe=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const mail=result.data;
        return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+safe(mail.subject)+'</title><style>body{max-width:880px;margin:32px auto;padding:0 20px;background:#f3f6f2;color:#13262f;font:16px/1.7 system-ui}h1{font-size:22px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.8 system-ui;background:white;padding:24px;border-radius:16px}a{color:#174c49}</style><h1>'+safe(mail.subject)+'</h1><p>Wanderlog 确认邮件 · 实时读取原文</p><pre>'+safe(mail.text)+'</pre><p><a href="https://wanderlog.com/plan/ryfdswcvguxmleir/前往australia的旅行" rel="noreferrer">返回 Wanderlog 行程</a></p></html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}});
      }
      if(url.pathname==='/api/state'&&request.method==='GET'){
        const [items,todos,settings]=await Promise.all([
          env.DB.prepare('select id, category, label, packed, position from packing_items order by position, id').all(),
          env.DB.prepare('select id, label, completed, position from todos order by position, id').all(),
          env.DB.prepare("select value from shared_settings where key='notes'").first()
        ]);
        return json({items:items.results.map(x=>({...x,packed:Boolean(x.packed)})),todos:todos.results.map(x=>({...x,completed:Boolean(x.completed)})),notes:settings?.value||''});
      }
      if(url.pathname==='/api/seed'&&request.method==='POST'){
        const count=await env.DB.prepare('select count(*) as count from packing_items').first();
        if(Number(count.count)>0)return json({seeded:false});
        const body=await request.json(),items=Array.isArray(body.items)?body.items.slice(0,100):[];
        if(!items.length)return json({error:'没有可导入的条目'},400);
        const statements=items.map(item=>env.DB.prepare('insert or ignore into packing_items(id,category,label,packed,position,updated_at) values(?,?,?,?,?,unixepoch())').bind(clean(item.id,80),clean(item.category,60)||'其他',clean(item.label,160),item.packed?1:0,Number(item.position)||0));
        await env.DB.batch(statements);return json({seeded:true});
      }
      if(url.pathname==='/api/items'&&request.method==='POST'){
        const item=await request.json(),id=clean(item.id,80),label=clean(item.label,160),category=clean(item.category,60)||'其他';
        if(!id||!label)return json({error:'条目不能为空'},400);
        await env.DB.prepare('insert into packing_items(id,category,label,packed,position,updated_at) values(?,?,?,?,?,unixepoch())').bind(id,category,label,item.packed?1:0,Number(item.position)||0).run();return json({ok:true},201);
      }
      const match=url.pathname.match(/^\/api\/items\/([^/]+)$/);
      if(match&&request.method==='PATCH'){
        const id=decodeURIComponent(match[1]),body=await request.json();
        if(Object.hasOwn(body,'packed'))await env.DB.prepare('update packing_items set packed=?,updated_at=unixepoch() where id=?').bind(body.packed?1:0,id).run();
        if(Object.hasOwn(body,'label')){const label=clean(body.label,160);if(!label)return json({error:'条目不能为空'},400);await env.DB.prepare('update packing_items set label=?,updated_at=unixepoch() where id=?').bind(label,id).run();}
        return json({ok:true});
      }
      if(match&&request.method==='DELETE'){await env.DB.prepare('delete from packing_items where id=?').bind(decodeURIComponent(match[1])).run();return new Response(null,{status:204});}
      if(url.pathname==='/api/todos'&&request.method==='POST'){
        const item=await request.json(),id=clean(item.id,80),label=clean(item.label,120);if(!id||!label)return json({error:'待办不能为空'},400);
        await env.DB.prepare('insert into todos(id,label,completed,position,updated_at) values(?,?,?,?,unixepoch())').bind(id,label,item.completed?1:0,Number(item.position)||0).run();return json({ok:true},201);
      }
      const todoMatch=url.pathname.match(/^\/api\/todos\/([^/]+)$/);
      if(todoMatch&&request.method==='PATCH'){const body=await request.json();await env.DB.prepare('update todos set completed=?,updated_at=unixepoch() where id=?').bind(body.completed?1:0,decodeURIComponent(todoMatch[1])).run();return json({ok:true});}
      if(todoMatch&&request.method==='DELETE'){await env.DB.prepare('delete from todos where id=?').bind(decodeURIComponent(todoMatch[1])).run();return new Response(null,{status:204});}
      if(url.pathname==='/api/notes'&&request.method==='PUT'){
        const body=await request.json(),notes=String(body.notes??'').slice(0,12000);
        await env.DB.prepare("insert into shared_settings(key,value,updated_at) values('notes',?,unixepoch()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at").bind(notes).run();return json({ok:true});
      }
      return json({error:'接口不存在'},404);
    }catch(error){console.error(error);return json({error:'服务器暂时无法处理此操作'},500);}
  }
};
