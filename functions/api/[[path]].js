// 福州鳌峰学校 · 校园论坛 API
// Cloudflare Pages Functions + D1
// 路由前缀 /api/

const SESSION_COOKIE = 'af_sid';
const SESSION_DAYS = 30;

const enc = new TextEncoder();

/* ---------------- 基础工具 ---------------- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function fail(msg, status = 400) {
  return json({ error: msg }, status);
}

function hexToBuf(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes = 16) {
  return bufToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: 120000, hash: 'SHA-256' },
    key,
    256
  );
  return bufToHex(bits);
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  const out = {};
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function currentUser(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.last_post_at, u.last_reply_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?1`
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
    return null;
  }
  return row;
}

function requireUser(user) {
  if (!user) throw new HttpError('请先登录', 401);
}

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, max) {
  if (typeof value !== 'string') throw new HttpError('参数格式不正确');
  const text = value.replace(/\r\n/g, '\n').trim();
  if (!text) throw new HttpError('内容不能为空');
  if (text.length > max) throw new HttpError(`内容超出长度限制（最多 ${max} 字）`);
  return text;
}

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,16}$/;

/* ---------------- 业务处理 ---------------- */

async function handleMeta(env) {
  const cats = await env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.description,
       (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id) AS thread_count
     FROM categories c ORDER BY c.sort ASC, c.id ASC`
  ).all();
  const stats = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM threads) AS threads,
            (SELECT COUNT(*) FROM replies) AS replies,
            (SELECT COUNT(*) FROM users) AS members`
  ).first();
  return json({ categories: cats.results || [], stats: stats || {} });
}

async function handleThreads(url, env) {
  const cat = (url.searchParams.get('cat') || '').trim();
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const size = 20;
  const offset = (page - 1) * size;

  const where = [];
  const params = [];
  if (cat) { where.push('c.slug = ?'); params.push(cat); }
  if (q) { where.push("(t.title LIKE ? OR t.content LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM threads t JOIN categories c ON c.id = t.category_id ${clause}`
  ).bind(...params).first();

  const rows = await env.DB.prepare(
    `SELECT t.id, t.title, t.created_at, t.updated_at, t.reply_count, t.views, t.pinned, t.locked,
            u.username, c.slug AS cat_slug, c.name AS cat_name,
            (SELECT r.content FROM replies r WHERE r.thread_id = t.id ORDER BY r.floor DESC LIMIT 1) AS last_reply,
            (SELECT u2.username FROM replies r2 JOIN users u2 ON u2.id = r2.user_id
              WHERE r2.thread_id = t.id ORDER BY r2.floor DESC LIMIT 1) AS last_user
     FROM threads t
     JOIN users u ON u.id = t.user_id
     JOIN categories c ON c.id = t.category_id
     ${clause}
     ORDER BY t.pinned DESC, t.updated_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, size, offset).all();

  return json({ items: rows.results || [], total: total ? total.n : 0, page, size });
}

async function handleThread(url, env, user) {
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) throw new HttpError('缺少帖子编号');

  const thread = await env.DB.prepare(
    `SELECT t.*, u.username, u.role AS author_role, c.slug AS cat_slug, c.name AS cat_name,
       (SELECT COUNT(*) FROM likes l WHERE l.thread_id = t.id) AS like_count
     FROM threads t
     JOIN users u ON u.id = t.user_id
     JOIN categories c ON c.id = t.category_id
     WHERE t.id = ?1`
  ).bind(id).first();
  if (!thread) throw new HttpError('帖子不存在或已被删除', 404);

  await env.DB.prepare('UPDATE threads SET views = views + 1 WHERE id = ?1').bind(id).run();

  const replies = await env.DB.prepare(
    `SELECT r.id, r.content, r.floor, r.created_at, u.username, u.role
     FROM replies r JOIN users u ON u.id = r.user_id
     WHERE r.thread_id = ?1
     ORDER BY r.floor ASC
     LIMIT 500`
  ).bind(id).all();

  let liked = false;
  if (user) {
    const row = await env.DB.prepare('SELECT id FROM likes WHERE thread_id = ?1 AND user_id = ?2')
      .bind(id, user.id).first();
    liked = !!row;
  }

  return json({
    thread: { ...thread, views: thread.views + 1, liked },
    replies: replies.results || [],
    page: 1,
    size: 500,
    total: thread.reply_count
  });
}

async function handleCreateThread(request, env, user) {
  requireUser(user);
  const body = await request.json().catch(() => ({}));
  const now = Math.floor(Date.now() / 1000);
  if (user.last_post_at && now - user.last_post_at < 30) throw new HttpError('发帖太快了，歇 30 秒再发');

  const title = cleanText(body.title, 80);
  const content = cleanText(body.content, 8000);
  if (title.length < 4) throw new HttpError('标题至少 4 个字');

  const cat = await env.DB.prepare('SELECT id, slug FROM categories WHERE slug = ?1').bind(body.cat).first();
  if (!cat) throw new HttpError('版块不存在');
  if (cat.slug === 'notices' && user.role !== 'admin') throw new HttpError('「公告通知」仅管理员可发布', 403);

  const res = await env.DB.prepare(
    `INSERT INTO threads (category_id, user_id, title, content, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`
  ).bind(cat.id, user.id, title, content, now).run();

  await env.DB.prepare('UPDATE users SET last_post_at = ?1 WHERE id = ?2').bind(now, user.id).run();
  return json({ ok: true, id: res.meta.last_row_id });
}

async function handleReply(request, env, user) {
  requireUser(user);
  const body = await request.json().catch(() => ({}));
  const now = Math.floor(Date.now() / 1000);

  const threadId = parseInt(body.threadId, 10);
  if (!threadId) throw new HttpError('缺少帖子编号');
  const content = cleanText(body.content, 4000);

  const thread = await env.DB.prepare('SELECT id, locked FROM threads WHERE id = ?1').bind(threadId).first();
  if (!thread) throw new HttpError('帖子不存在', 404);
  if (thread.locked) throw new HttpError('该帖已被锁定，无法回复', 403);
  if (user.last_reply_at && now - user.last_reply_at < 6) throw new HttpError('回复太快了，歇几秒再来');

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO replies (thread_id, user_id, content, floor, created_at)
       VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(floor), 0) + 1 FROM replies WHERE thread_id = ?1), ?4)`
    ).bind(threadId, user.id, content, now),
    env.DB.prepare('UPDATE threads SET reply_count = reply_count + 1, updated_at = ?1 WHERE id = ?2')
      .bind(now, threadId),
    env.DB.prepare('UPDATE users SET last_reply_at = ?1 WHERE id = ?2').bind(now, user.id)
  ]);

  return json({ ok: true });
}

async function handleLike(request, env, user) {
  requireUser(user);
  const body = await request.json().catch(() => ({}));
  const threadId = parseInt(body.threadId, 10);
  if (!threadId) throw new HttpError('缺少帖子编号');

  const exists = await env.DB.prepare('SELECT id FROM likes WHERE thread_id = ?1 AND user_id = ?2')
    .bind(threadId, user.id).first();

  if (exists) {
    await env.DB.prepare('DELETE FROM likes WHERE id = ?1').bind(exists.id).run();
  } else {
    await env.DB.prepare('INSERT INTO likes (thread_id, user_id) VALUES (?1, ?2)').bind(threadId, user.id).run();
  }

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM likes WHERE thread_id = ?1').bind(threadId).first();
  const liked = await env.DB.prepare('SELECT id FROM likes WHERE thread_id = ?1 AND user_id = ?2')
    .bind(threadId, user.id).first();

  return json({ liked: !!liked, count: count.n });
}

async function handleRegister(request, env) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!USERNAME_RE.test(username)) throw new HttpError('用户名需 2–16 位，仅限中英文、数字、下划线');
  if (password.length < 6 || password.length > 32) throw new HttpError('密码需 6–32 位');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?1').bind(username).first();
  if (existing) throw new HttpError('该用户名已被占用', 409);

  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  let role = 'user';
  const adminKey = env.ADMIN_KEY;
  if (adminKey) {
    if (String(body.adminKey || '').trim() === adminKey) role = 'admin';
  } else if (total.n === 0) {
    role = 'admin'; // 未配置 ADMIN_KEY 时，首位注册者成为管理员
  }

  const salt = randomHex(16);
  const pass = await hashPassword(password, salt);
  const now = Math.floor(Date.now() / 1000);

  const res = await env.DB.prepare(
    `INSERT INTO users (username, pass, salt, role, created_at, last_post_at, last_reply_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, 0)`
  ).bind(username, pass, salt, role, now).run();

  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)')
    .bind(token, res.meta.last_row_id, now + SESSION_DAYS * 86400).run();

  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  headers.append('Set-Cookie', sessionCookie(token, SESSION_DAYS * 86400));
  return new Response(JSON.stringify({ ok: true, user: { username, role } }), { status: 200, headers });
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) throw new HttpError('请输入用户名和密码');

  const user = await env.DB.prepare('SELECT id, username, role, pass, salt FROM users WHERE username = ?1')
    .bind(username).first();
  if (!user) throw new HttpError('用户名或密码不正确', 401);

  const pass = await hashPassword(password, user.salt);
  if (pass !== user.pass) throw new HttpError('用户名或密码不正确', 401);

  const now = Math.floor(Date.now() / 1000);
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)')
    .bind(token, user.id, now + SESSION_DAYS * 86400).run();

  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  headers.append('Set-Cookie', sessionCookie(token, SESSION_DAYS * 86400));
  return new Response(JSON.stringify({ ok: true, user: { username: user.username, role: user.role } }), { status: 200, headers });
}

async function handleLogout(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  headers.append('Set-Cookie', sessionCookie('', 0));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function handleAdmin(request, env, user) {
  requireUser(user);
  if (user.role !== 'admin') throw new HttpError('只有管理员可以执行此操作', 403);
  const body = await request.json().catch(() => ({}));
  const action = body.action;
  const threadId = parseInt(body.threadId, 10);

  if (action === 'deleteThread') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM replies WHERE thread_id = ?1').bind(threadId),
      env.DB.prepare('DELETE FROM likes WHERE thread_id = ?1').bind(threadId),
      env.DB.prepare('DELETE FROM threads WHERE id = ?1').bind(threadId)
    ]);
    return json({ ok: true });
  }

  if (action === 'pin' || action === 'lock') {
    const thread = await env.DB.prepare('SELECT pinned, locked FROM threads WHERE id = ?1').bind(threadId).first();
    if (!thread) throw new HttpError('帖子不存在', 404);
    const field = action === 'pin' ? 'pinned' : 'locked';
    await env.DB.prepare(`UPDATE threads SET ${field} = ?1 WHERE id = ?2`)
      .bind(thread[field] ? 0 : 1, threadId).run();
    return json({ ok: true });
  }

  if (action === 'deleteReply') {
    const replyId = parseInt(body.replyId, 10);
    const reply = await env.DB.prepare('SELECT thread_id FROM replies WHERE id = ?1').bind(replyId).first();
    if (!reply) throw new HttpError('回复不存在', 404);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM replies WHERE id = ?1').bind(replyId),
      env.DB.prepare('UPDATE threads SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?1').bind(reply.thread_id)
    ]);
    return json({ ok: true });
  }

  throw new HttpError('未知操作');
}

/* ---------------- 入口 ---------------- */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  try {
    if (!env.DB) {
      return fail('后端尚未配置数据库（请在 Cloudflare Pages 中绑定 D1，变量名为 DB）', 503);
    }

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    const user = await currentUser(request, env);

    switch (path) {
      case '':
      case 'meta':
        return await handleMeta(env);

      case 'threads':
        if (method !== 'GET') return fail('不支持的请求方法', 405);
        return await handleThreads(url, env);

      case 'thread':
        if (method !== 'GET') return fail('不支持的请求方法', 405);
        return await handleThread(url, env, user);

      case 'post':
        if (method !== 'POST') return fail('不支持的请求方法', 405);
        return await handleCreateThread(request, env, user);

      case 'reply':
        if (method !== 'POST') return fail('不支持的请求方法', 405);
        return await handleReply(request, env, user);

      case 'like':
        if (method !== 'POST') return fail('不支持的请求方法', 405);
        return await handleLike(request, env, user);

      case 'register':
        if (method !== 'POST') return fail('不支持的请求方法', 405);
        return await handleRegister(request, env);

      case 'login':
        if (method !== 'POST') return fail('不支持的请求方法', 405);
        return await handleLogin(request, env);

      case 'logout':
        return await handleLogout(request, env);

      case 'me':
        return json({ user: user ? { id: user.id, username: user.username, role: user.role } : null });

      case 'admin':
        if (method !== 'POST') return fail('不支持的请求方法', 405);
        return await handleAdmin(request, env, user);

      default:
        return fail('接口不存在', 404);
    }
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    return fail('服务器开小差了：' + (err && err.message ? err.message : '未知错误'), 500);
  }
}
