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
        const allowed=new Set(['34868420','37956870','35413193','35413179','35413205','35413198','35413153']);
        if(!allowed.has(mailMatch[1]))return json({error:'确认邮件不存在'},404);
        const upstream=await fetch('https://wanderlog.com/api/tripPlans/ryfdswcvguxmleir/emails/'+mailMatch[1],{signal:AbortSignal.timeout(20000)});
        if(!upstream.ok)return json({error:'Wanderlog 暂时无法读取邮件，请稍后重试'},502);
        const result=await upstream.json();if(!result.success||!result.data?.text)return json({error:'确认邮件暂不可用'},502);
        const safe=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const mail=result.data;
        const original=String(mail.sanitizedHtml||'').replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<base[\s\S]*?>/gi,'').replace(/<form[\s\S]*?<\/form>/gi,'').replace(/\son\w+\s*=\s*(["']).*?\1/gi,'').replace(/href\s*=\s*(["'])javascript:[\s\S]*?\1/gi,'href="#"');
        const fallback='<pre>'+safe(mail.text)+'</pre>';
        return new Response('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+safe(mail.subject)+'</title><style>body{margin:0;background:#e9eeea;color:#13262f;font:14px/1.6 system-ui}.bar{position:sticky;top:0;z-index:3;padding:12px 18px;background:#13262f;color:white}.bar strong{display:block}.bar small{color:#b8cccf}.mail{max-width:760px;margin:20px auto;padding:0 12px 30px}.paper{overflow:auto;background:white;border-radius:14px;box-shadow:0 14px 45px #13262f1c}.paper>article,.paper>div{max-width:100%}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:24px;font:14px/1.8 system-ui}a{color:#185f82}</style></head><body><header class="bar"><strong>'+safe(mail.subject)+'</strong><small>Wanderlog 保存的原邮件 HTML · 图片可能由邮件原发送方加载</small></header><main class="mail"><div class="paper">'+(original||fallback)+'</div></main></body></html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",'x-content-type-options':'nosniff'}});
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
      if(url.pathname==='/api/items/reorder'&&request.method==='PUT'){
        const body=await request.json(),items=Array.isArray(body.items)?body.items.slice(0,150):[];
        if(!items.length)return json({error:'没有排序变更'},400);
        const statements=items.map(item=>{const id=clean(item.id,80),category=clean(item.category,60),position=Number(item.position);if(!id||!category||!Number.isFinite(position))throw new Error('排序数据无效');return env.DB.prepare('update packing_items set category=?,position=?,updated_at=unixepoch() where id=?').bind(category,position,id);});
        await env.DB.batch(statements);return json({ok:true,updated:items.length});
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
