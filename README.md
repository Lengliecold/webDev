# 福州鳌峰学校 · 校园论坛

给 `aofeng.pages.dev` 加的一个多版块校园论坛：发帖、回复、点赞、注册登录、管理员置顶/锁定/删除。
前端与学校现有站点同一套视觉（深蓝 + 米白、直角、衬线标题），后端是 Cloudflare Pages Functions + D1，全部免费额度内。

## 目录结构

```
public/
  index.html              首页（已加上「校园论坛」入口）
  forum.html              论坛页面（单文件，内联样式与脚本）
functions/
  api/[[path]].js         论坛后端 API（Cloudflare Pages Functions）
schema.sql                D1 建表语句 + 6 个初始版块
README.md                 本文件
```

> 静态文件放 `public/`、后端放根目录 `functions/`，是 Cloudflare Pages Git 部署的标准结构：Pages 只发布 `public/`，同时自动识别根目录的 `functions/`。

## 部署步骤

### 一、代码进仓库

**方式 A：直接放进你现有的站点仓库（推荐，域名不变，还是 aofeng.pages.dev）**

1. 把本目录的 `public/`、`functions/` 两个文件夹，以及 `schema.sql`、`README.md` 放到仓库根目录。
2. 如果仓库原本没有 `public/`，就把原来的 `index.html`、`favicon.ico` 等站点文件移进 `public/`。
3. 提交推送：

```bash
git add .
git commit -m "add campus forum"
git push
```

**方式 B：新建一个仓库单独放论坛**，同样保持 `public/` + `functions/` 结构，然后在 Pages 里新建项目并绑定域名。

### 二、建 D1 数据库

1. Cloudflare 控制台 → **Storage & Databases → D1 SQL Database → Create**，名字填 `aofeng-forum`。
2. 创建后进入该数据库 → 右上角 **Console** 标签。
3. 打开 `schema.sql`，把全部内容粘贴进 Console，执行一次。执行完表结构和 6 个版块就都有了。

### 三、给 Pages 项目绑定数据库

1. 打开你的 Pages 项目 → **Settings → Functions → D1 database bindings → Add binding**。
2. **Variable name** 必须填 `DB`（注意大小写）。
3. 选择刚建的 `aofeng-forum` 数据库，保存。

> 如果项目还没建：**Workers & Pages → Create → Pages → Connect to Git**，选仓库；
> Framework preset 选 `None`，Build command 留空，**Build output directory 填 `public`**。

### 四、重新部署

绑定是给「下一次部署」用的：

- 刚 push 过：等 Pages 自动构建完成；
- 已经构建过：进入 **Deployments → 最新一次 → Retry deployment**，或者随便改个文件再 push 一次。

打开 `https://aofeng.pages.dev/forum.html`，能看到版块列表就是成功了。

### 五、拿到管理员权限

两种方式，二选一：

1. **首位注册者自动成为管理员**（默认行为，没配 `ADMIN_KEY` 时生效）。部署完立刻去论坛注册你的账号。
2. **用密钥注册**：Pages → Settings → Environment variables 添加 `ADMIN_KEY`（值自己定，例如一长串随机字符），然后注册时在「管理员密钥」里填同一个值，该账号即为管理员。

管理员可以发「公告通知」版块，可以对帖子置顶、锁定、删除，可以删回复。

## 功能说明

| 功能 | 说明 |
| --- | --- |
| 注册 / 登录 | 用户名 2–16 位（中英文、数字、下划线），密码 6–32 位；PBKDF2 + 随机盐，登录态是 HttpOnly Cookie，30 天有效 |
| 版块 | 公告通知、学习交流、校园生活、活动社团、失物招领、意见建议（要改版块改 `schema.sql` 的 INSERT 部分） |
| 发帖 | 标题 4–80 字，正文 8000 字以内；「公告通知」仅管理员可发 |
| 回复 | 楼层自动累加，帖子锁定后不能回复 |
| 点赞 | 同一账号对同一帖只能点一次，可取消 |
| 防刷 | 发帖 30 秒冷却、回复 6 秒冷却 |
| 搜索 | 按标题/正文关键词搜索 |

## 本地预览（可选）

```bash
npm i -g wrangler
wrangler pages dev public --d1 DB=<你的数据库ID>
```

纯前端改样式时直接双击 `public/forum.html` 只能看到界面，接口会报错，因为 `/api` 需要 Pages 运行时。

## 常见问题

- **页面提示「后端尚未配置数据库」**：Pages 项目里没绑定 D1，或变量名不是 `DB`，绑定后要重新部署。
- **提示「no such table」**：`schema.sql` 没在对应数据库里执行，或绑定了另一个库。
- **注册后不是管理员**：说明已经有人注册过了，或你配了 `ADMIN_KEY` 但没填密钥；可以在 D1 Console 里手动改：
  `UPDATE users SET role = 'admin' WHERE username = '你的用户名';`
- **想清空重来**：在 D1 Console 里重新执行一次 `schema.sql`（开头会 DROP 所有表，谨慎操作）。
- **想换站点配色**：`forum.html` 顶部的 CSS 变量（`--navy`、`--bg`、`--paper`）与首页一致，改一处即可。
