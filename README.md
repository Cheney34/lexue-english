# 乐学英语 LexueEnglish

一个**离线优先**的英语单词记忆宫殿 App，把「图片整理 → 图片识别 → 单词入库 → 间隔复习」串成一条闭环。

- **应用名**：乐学英语　**安装包**：[到 Releases 下载](https://github.com/Cheney34/lexue-english/releases/latest)（8.7 MB，自签名，可直接安装）
- **包名**：`com.wordpalace.app`　**版本**：1.3.0 (versionCode 9)
- **系统要求**：Android 5.0 (API 21) 及以上，arm64-v8a / armeabi-v7a
- **权限**：仅 `INTERNET` / `ACCESS_NETWORK_STATE`。**不申请存储、相机、麦克风权限**——取图走系统选择器，拍照走自定义 ContentProvider 授权，OCR 全本地。
- **明文 HTTP**：允许（原因见「八、为什么允许明文 HTTP」）。HTTPS 仍按系统信任链校验证书。
- **许可**：源码 MIT（见 [LICENSE](LICENSE)）；随包分发的第三方组件与数据按各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## 下载与安装

正式构建都放在 [Releases](https://github.com/Cheney34/lexue-english/releases)，每个版本附 SHA-256 可自行核对：

| 版本 | 这一版的重点 | 安装包 |
| --- | --- | --- |
| **v1.3.0** | 阅读页中英对照（最新） | [lexue-english-1.3.0.apk](https://github.com/Cheney34/lexue-english/releases/download/v1.3.0/lexue-english-1.3.0.apk) |
| v1.2.4 | 内置联网查词修好 | [lexue-english-1.2.4.apk](https://github.com/Cheney34/lexue-english/releases/download/v1.2.4/lexue-english-1.2.4.apk) |
| v1.2.3 | 深色正文反色、标题可点词 | [lexue-english-1.2.3.apk](https://github.com/Cheney34/lexue-english/releases/download/v1.2.3/lexue-english-1.2.3.apk) |
| v1.2.2 | 修掉启动白屏与订阅源卡死 | [lexue-english-1.2.2.apk](https://github.com/Cheney34/lexue-english/releases/download/v1.2.2/lexue-english-1.2.2.apk) |

下载后直接覆盖安装即可：沿用同一签名密钥，学习记录、词库进度与设置都不会丢。

> 本仓库源码快照为 1.3.0（`main` 分支）。1.2.x 的安装包是当时实际构建的产物，源码未单独打快照。

---

## 一、功能

首页是**背单词**（底部导航正中），打开即可开始今天的复习；标题栏左上角是**设置**，右上角常驻**词典搜索**。

**语言与外观**在左上角设置里：语言支持 **简体中文 / 繁體中文 / 跟随系统**（跟随系统时「有中文用中文，否则英文」），外观支持 **浅色 / 深色 / 跟随系统设置**，两项都即时生效。

| 模块 | 说明 |
| --- | --- |
| **背单词（首页）** | 今日待复习数量、连续打卡天数、生词本 / 已掌握 / 巩固中三档统计、近 7 日复习柱状图、按记忆宫殿分组复习；点「开始复习」进入四档评分，点「学新词」按每日上限引入新词 |
| **图片整理** | 拍照 / 批量从相册导入，自动压缩到 1400px；标签体系 + 关键词搜索（标题、标签、单词、识别文字都能搜）；多选批量打标签、批量入宫殿、批量删除 |
| **图片识别** | 基于 Tesseract 5 LSTM 英文模型的**纯离线 OCR**，识别结果可编辑再提取；自动抽取英文词、匹配离线释义，支持一键全部入生词本 / 挂到地点桩；同时支持直接粘贴英文段落取词 |
| **英语文章推荐** | 三个标签：**推荐 / 订阅 / 收藏**。15 篇原创分级短文 + **每日更新的在线外刊**（49 个精选源，其中 39 个实测境内可直连）。推荐按「词书匹配 + 生词比例」打分混排，可用类型筛选切到短文或订阅文章；**阅读模式**能抓取原文正文并排成干净版式，可点词查义、朗读、调字号、开关生词高亮；支持精选源目录、粘贴网址自动识别订阅地址、OPML 导入导出、屏蔽词 |
| **词书选择** | 10 本词书：高频核心 / 中考 / 高考 / CET-4 / CET-6 / 考研 / 雅思 / 托福 / GRE / 牛津核心 3000，共 26,202 词条；实时显示已学与掌握进度；可一键「按词频背这本词书」 |
| **词典搜索** | 离线优先检索 26,202 词（支持英文前缀、中文释义、模糊匹配），带音标、释义、所属考纲标签；未收录时自动联网补充（有道 + dictionaryapi.dev），并给出真人发音音频 |
| **记忆宫殿** | 建立多座宫殿，每座宫殿由有序「地点桩」组成（玄关鞋柜 → 客厅沙发 → 书桌台灯…），每个地点桩绑定一张照片并挂载若干单词；可拖序、可整座宫殿复习 |
| **间隔复习** | SM-2 变体算法（忘记 / 模糊 / 记得 / 太简单 四档），忘记的卡片当轮重新入队；复习时可选显示地点桩照片作为回忆线索；含连续打卡、近 7 日复习量、掌握度分布统计 |
| **发音** | 系统 TTS（美式英语），语速可调，查词 / 复习 / 文章朗读均可发声 |

---

## 二、技术方案

```
┌──────────────────────────────────────────────┐
│ MainActivity（单 Activity，零运行时权限）      │
│  ├─ WebView ← https://appassets.local/       │
│  │   由 shouldInterceptRequest 从 assets 提供 │
│  │   （拿到正常 https 源 → IndexedDB 可用）   │
│  └─ Bridge（@JavascriptInterface）            │
│       ├─ Tts          android.speech.tts     │
│       ├─ Ocr          Tesseract 5（离线）     │
│       ├─ ImageUtil    采样/EXIF 旋转/压缩      │
│       ├─ Net          HttpURLConnection      │
│       └─ CaptureProvider  相机临时文件授权     │
├──────────────────────────────────────────────┤
│ 前端：原生 HTML/CSS/ES5，无框架、无外链、无字体 │
│ 存储：IndexedDB（图片/宫殿/卡片/统计）          │
│ 算法：SM-2 间隔重复 · 词形还原 · 词书过滤       │
└──────────────────────────────────────────────┘
```

几个刻意的取舍：

- **不用 Gradle / AGP**：`build.sh` 直接调 `aapt2 → javac → d8 → zipalign → apksigner`，整条链路不依赖 `maven.google.com`，构建可完全离线复现。
- **不用 AndroidX**：UI 全在 WebView 里，原生层只需框架 API，APK 里没有一行 support 库代码。
- **站点根映射**：`shouldInterceptRequest` 先按 assets 原路径找，找不到再试 `www/` 前缀——所以 `index.html` 在站点根，而 `data/`、`tessdata/` 保持各自目录，不需要任何 `file://` 兼容开关。
- **本地存储而非服务端**：所有图片以压缩后的 dataURL 存 IndexedDB，离线、可导出成单个 JSON 备份。

### 订阅源：默认只有 4 个，其余按需订阅

初版内置的是 BBC 6 Minute English + Guardian 三个频道，**在国内网络下全部连不通**——实测 `curl` 返回 `000`（连接直接失败，不是解析或格式问题）。这是选源错误，现在换成**按实测可达性挑出来的 49 个源**：

| 分类 | 数量 | 说明 |
| --- | --- | --- |
| 英语学习 | 3 | Breaking News English（同一新闻分七档难度）、BBC 6 Minute English、VOA |
| 中国英文媒体 | 6 | CGTN ×3（已标记为不可用）、中新社 ECNS、Global Times、Xinhua、Sixth Tone |
| 国际新闻 | 6 | France 24、NPR、VICE、BBC News、Guardian、NYT、DW、Al Jazeera —— 海外源标注「需海外网络」，默认关闭 |
| 科技 | 12 | Hacker News ×2、Ars Technica、The Verge、TechCrunch、WIRED、MIT TR、Solidot、开源中国、InfoQ、Phoronix、Slashdot… |
| 科学 | 7 | Nature、ScienceDaily、Phys.org、NASA、Quanta、WHO、Smithsonian、Nautilus |
| 生活与文化 | 8 | Lifehacker、Atlas Obscura、Aeon、少数派、量子位… |
| 开发 | 4 | MDN Blog、Smashing Magazine、CSS-Tricks、LWN.net |

源清单放在 `assets/data/feeds.json`，**每个源都带 `cn` 标记**（是否实测可在境内直连，2026-10 用 `tools/check_feeds.sh` 逐个实测过）。应用内可以逐个「测试连接」，结果会区分**域名无法解析 / 连接被拒绝 / 请求超时 / HTTP 4xx / 能连上但不是 RSS**，并附上**原始错误文本**。

全新安装**只预置 4 个源**（Breaking News English、新华社英文、中新社英文、Hacker News Best），其余躺在「精选源」里按需订阅——预置几十个关着的源，既看不出哪些在用，也把「订阅源」页撑得很长。精选目录里每一项都会显示真实状态：**已订阅 / 启用（在列表里但被关掉）/ 订阅**。

> **源会漂移**：第三方 RSS 随时可能改版或下线，上面的 `cn` 标记是 2026-10 的结论。请以应用内「测试连接」为准，失效了在「管理订阅源」里换一个即可。项目里留了 `tools/check_feeds.sh` 可以随时重测一遍——注意它必须**跟随跳转并解压 gzip、超时给到 20 秒、失败重试三次**，否则会把一批本来可用的慢源误判为失效（这个坑踩过）。

实测数据（沙箱国内出口，等价于手机国内网络）：

```
OK  Breaking News English  200  14 条      OK  Hacker News · Best   200  30 条
OK  CGTN · World           200  50 条      OK  Ars Technica         200  20 条
OK  中新社 · 英文           200 100 条      OK  Nature               200  75 条
OK  Global Times           200  50 条      OK  ScienceDaily         200  60 条
OK  Xinhua · English       200  20 条      OK  Phys.org             200  30 条
OK  Sixth Tone             200  51 条      OK  NASA                 200  10 条
OK  The Verge              200  10 条      OK  WIRED                200  50 条
OK  TechCrunch             200  20 条      OK  Solidot              200  20 条
OK  开源中国 · 资讯          200  50 条      OK  InfoQ 中文            200  20 条
OK  Lifehacker             200 100 条
（BBC / Guardian / NYT 三个海外源在国内均为连接层失败，已标注并默认关闭）
```

### 抓取会被站点拦截，所以做了「双通道」

实测过一个更麻烦的情况：**同一台手机、同一个地址，浏览器能拿到完整 XML，应用却被拦**。

| 源 | 直连（HttpURLConnection） | 浏览器 |
| --- | --- | --- |
| CGTN | **HTTP 403** | 200，完整 RSS |
| 中新社 ECNS | 200，但内容是 **HTML 拦截页** | 200，完整 RSS |

排除了 DNS、TLS 版本、HTTP/1.1 与 2、UA、连接头等因素后，判断是站点 WAF 按**请求指纹**识别并拦截非浏览器客户端。所以抓取做成两条通道：

1. **直连优先**（快）：`HttpURLConnection`，请求头已按真实 Chrome 补齐（完整版本号 UA、`sec-ch-ua`、`sec-fetch-*`、`Upgrade-Insecure-Requests`）。
2. **被拦自动切换**：若直连返回 4xx/5xx，或内容解析不出条目，自动改用**隐藏 WebView 加载同一地址**，再用 `documentElement.outerHTML` 取回文档——这条路走的是**和浏览器完全相同的网络栈与 TLS 指纹**，只拦应用的规则就失效了。

界面上会如实标注实际走的通道：「直连被站点拦截，已自动切换」；两条都失败时会列出**每条通道各自的原因**。

### 阅读的「每日更新」是怎么做的

内置短文是离线静态资源（保证没网也能读），在线外刊走一条独立的缓存管线：

1. **拉取**：启动后 1.5 秒静默预热一次；进入「阅读」页时若缓存过期再补一次；也可随时手动「立即更新」。
2. **过期判定**：**跨天即过期**，或距上次更新超过 12 小时。所以「每天首次打开」会自动拿到新内容。
3. **缓存**：结果写入 IndexedDB（`meta` 存储），**离线可读**；某个源抓取失败时保留上次的条目并标注"显示上次缓存"，不会因为断网就清空。
4. **不重复请求**：当天已更新过则完全走缓存，0 次网络请求（这条有测试覆盖）。
   - 注意：请求走的是**原生层 HttpURLConnection**，不受浏览器同源策略限制。WebView 内直接 `fetch` 会被 CORS 挡掉（CGTN 等不返回 `Access-Control-Allow-Origin`），所以外刊抓取必须走原生桥。
5. **参与推荐**：在线条目和内置短文用同一套打分排序，并记录已读状态、收藏状态。
6. **摘要清洗**：有的源（典型是 Hacker News）`description` 不是正文而是元信息——`Article URL: … Comments URL: … Points: 410 # Comments: 88`。这类内容会被剥掉；剥完只剩符号的当作空摘要处理，不让一个「#」冒充摘要去参与难度统计。
7. **正文抓取**：条目页的「载入全文」走 `Reader.fetchArticle()`——直连拿不到正文时自动改用隐藏 WebView（会执行页面脚本），抓到的正文按条目 id 缓存最近 40 篇。

### 阅读模块：参考 feed-flow 重写

在线订阅这块参考了 [prof18/feed-flow](https://github.com/prof18/feed-flow)（Apache-2.0）的架构，借鉴的是**思路**而不是代码——feed-flow 是 Kotlin Multiplatform + Compose，本应用是 WebView + 原生壳，无法直接复用，所以按它的分层重写了三块：

| feed-flow 的做法 | 本应用的对应实现 |
| --- | --- |
| `FeedUrlRetriever`：粘贴任意网址，从 HTML 里找出真正的 feed 地址 | `Feed.discover()`：解析 `<link rel="alternate" type="application/rss+xml">`，再退化为尝试 `/feed`、`/rss.xml` 等常见路径 |
| `Suggestions`：内置按主题分类的精选源 | `assets/data/feeds.json`：7 个分类 49 个源，每个都标了是否实测可直连 |
| `ReaderModeEligibility` + Reader Mode | `Reader.canOpen()` 准入判断 + `Reader.extract()` 正文提取 |
| RSSParser：解析失败后追加一次「不规范 XML 清理」再解析 | 三层容错解析（严格 XML → 浏览器式宽松解析 → 正则兜底） |
| OPML 导入导出 | `Feed.parseOpml()` / `buildOpml()`，导入自动去重 |

**正文提取**（`reader.js`）做的是：先按属性特征摘掉导航、广告、相关推荐、侧边栏、页脚、已知 cookie/同意管理平台容器，再对候选容器按「正文量」打分——在正文量相差不到 10% 时选总文本更少的那个，因为它更贴近真正的正文容器而不是裹着评论区的整页 div。保留段落、小标题、引用、列表、代码块、图片，最后把每段切成可点词。

### 推荐排序：为什么「约 12 个生词」这个阈值被换掉了

只用「词书匹配度」排序有个致命问题：它只跟词书有关、跟学习进度无关，于是**推荐结果永远不变**。但也不能简单换成「一次遇到约 12 个生词」——长文章天生生词就多，按**绝对数量**比，一篇 300 词的短文永远输给一条 20 词的新闻摘要，内置分级短文会被整批挤出推荐位（这是实测发现的）。

现在两处都做归一化：

```
目标值  target = clamp(正文词数 × 10%, 5, 40)
偏差    under  = max(0, target − 待记词数) / max(5, target)        ← 生词不够，全额罚
        over   = min(1, max(0, 待记词数 − target) / max(5, target)) × 0.5
        thin   = 正文不足 60 词时按比例扣分（样本太短，统计不可靠）
打分    score  = −((under + over) × 60 + max(0, 0.80 − 词书匹配度) × 30 + thin)
```

- **非对称罚分**：生词不够 = 白读一场，是主要失败模式 → 全额罚；生词偏多 = 吃力但仍有收获 → 半额罚。否则一篇新词很多的文章会被罚得比「一个生词都没有」还狠，方向就反了。
- **短样本折扣**：有的源只给一两句摘要，十几词里正好有 5 个生词纯属运气，不能因此排到一篇百来词短文前面。
- **摘要太短不入选**：正文（含摘要）不足 20 词的条目无法评估难度，直接不参与「为你推荐」，在「订阅」里仍然能看到。
- **按链接去重**：通讯社稿件常被多家媒体转载，同一条只保留一份。

待记词数随生词本积累自然下降，推荐因此会自己往前走——这一条有测试实测验证（换词书找素材、啃掉后确认它让出首位）。推荐页还提供**全部 / 分级短文 / 订阅文章**的类型筛选，保证长文被真实外刊挤占时短文仍然可达。

### 阅读模式：抓不到正文时换一条通道

`Reader.loadFull()` 抓正文同样走双通道：直连拿到的是**未经 JavaScript 执行**的原始 HTML，很多站点（SPA / 前端渲染，例如 CGTN）的正文压根不在里面，只剩一根 cookie 提示条。所以直连提取不出可用正文时，自动改用隐藏 WebView 再抓一次——那条路会真正执行页面脚本。

配套加了提示条识别：已知的同意管理平台容器标记（`onetrust` / `qc-cmp` / `truste` / `didomi` …）会被当成噪声剔除，文案命中 `by continuing to browse` / `manage your cookie` 之类的候选直接跳过。如果整页只剩提示条，会明确告诉你「抓到的是站点提示条，不是正文」，而不是拿提示条冒充文章。

### APK 体积构成（8.7 MB）

| 内容 | 原始 | 压缩后 |
| --- | --- | --- |
| Tesseract 原生库（arm64 + armeabi-v7a） | 12.7 MB | 约 3.8 MB |
| 英文语言包 eng.traineddata | 4.1 MB | 1.9 MB |
| 离线词库 words.json（26,202 词） | 2.0 MB | 0.8 MB |
| 前端 + 文章 + 图标 + dex | 0.2 MB | 0.1 MB |

> 想更小：`ABIS=arm64-v8a bash build.sh` 可再省约 1.8 MB（代价是不支持 32 位老机型）。

---

### 多语言：为什么是「英文词表 + 繁体转换」而不是三份文案

界面有 622 条中文文案，散在 13 个文件里。做成三语有三种做法，这里选了第三种：

| 做法 | 问题 |
| --- | --- |
| 三份文案各写一遍 | 简体/繁体只是字形差异，另写一份是纯浪费，还必然出现两边不同步 |
| 运行时逐字转繁体 | 「头发」会转成「頭發」而不是「頭髮」，这类错误很显眼 |
| **英文人工翻译 + 繁体用转换表** | 英文必须逐条翻译，繁体交给转换；转换用**整串精确表 + 词组表 + 单字兜底**三层 |

具体实现：

1. **源码里写的仍是中文**：`T('删除')`。词表以「简体原文」为键，而不是给每条文案起英文键名——源码可读，且**未翻译时安全回退为原文**，不会变成空白或乱码。简体下 `T()` 是恒等函数，所以默认行为完全不变。
2. **包装是自动做的**（`tools/i18n_wrap.py`）：扫描字符串字面量，跳过注释、正则、模板串，把含汉字的包成 `T(...)`。729 处一次性完成且**幂等**，重复运行不会套娃。
3. **繁体三层表**（`tools/i18n_build.py` 生成）：
   - 524 条**整串映射**（界面固定文案，走 OpenCC 完整规则，最准）
   - 3835 条**词组映射**（只保留本项目文本里真正出现的词组，如「头发→頭髮」；全球词组表有 4.9 万条、1MB，全塞进包里不值得）
   - 1465 个**单字兜底**（词典释义这类动态文本逐字转换）
4. **语言判定**：`跟随系统` 时遍历系统语言列表，**只要有一个是中文就用中文**（`zh-TW`/`zh-HK`/`zh-MO` 用繁体，其余简体），否则一律英文——即「有中文用中文，默认其他语言用 en_US」。
5. **改了文案怎么补**：`tools/i18n_extract.py` 会**保留已有键的顺序**、把新文案追加到末尾并列出，然后往 `tools/i18n/en.json` 末尾补对应英文，跑一次 `i18n_build.py` 即可。键序固定是关键——按词频排序的话，加一句文案就会让整份译文错位。

**一个容易踩的坑**：`TABS`、词书名称、评分档位这些是**模块级常量**，脚本一加载就求值。如果等到界面渲染时再设语言，它们早被「烧」成默认语言了——表现是「切了语言，标签栏还是旧语言」。解决办法是两件事一起做：在 `<head>` 里放一段**引导脚本**，从 `localStorage` 先读出偏好并设好语言，让常量求值时语言已就位；同时把这些常量改为**渲染时翻译**，这样运行中切换也能立刻跟上。

### 主题：变量 + 一处覆盖

浅色/深色的差别集中在 CSS 变量上（`--bg` `--surface` `--text` …），JS 只负责算出当前该用哪套并挂到 `<html data-theme>`。少数几处写死了浅色（底部导航的毛玻璃、提示条、标签、代码块）单独覆盖；`color-scheme: dark` 让表单控件跟着变暗；`<meta name="theme-color">` 同步更新，否则深色下顶部会留一条亮边。跟随系统时监听 `prefers-color-scheme` 的变化。

## 三、目录结构

```
WordPalace/
├── app/
│   ├── AndroidManifest.xml
│   ├── java/com/wordpalace/app/
│   │   ├── MainActivity.java        # 单 Activity + WebView（assets 映射到 https 源）
│   │   ├── Bridge.java              # JS 桥：TTS / 取图 / OCR / HTTP / webFetch / 文件读写
│   │   ├── Net.java                 # 原生 HTTP（浏览器式请求头 + 编码嗅探与回退）
│   │   ├── Ocr.java                 # Tesseract 离线 OCR
│   │   ├── ImageUtil.java           # 图片压缩 / dataURL / 资源关闭
│   │   ├── CaptureProvider.java     # 拍照输出的 FileProvider（零存储权限）
│   │   └── Tts.java                 # 系统语音
│   ├── res/                         # 图标、颜色、主题
│   └── assets/
│       ├── data/
│       │   ├── words.json           # 离线词库（26,202 词）
│       │   ├── articles.json        # 15 篇原创分级短文
│       │   └── feeds.json           # 精选订阅源目录（7 分类 49 源）
│       ├── tessdata/eng.traineddata # OCR 语言包
│       └── www/
│           ├── index.html
│           ├── css/app.css
│           └── js/
│               ├── i18n-data.js     # 词表（生成物）：英文 / 繁体整串 / 繁体词组 / 繁简单字
│               ├── i18n.js          # 多语言运行时：语言判定、T()、繁简转换
│               ├── diag.js          # 诊断面板：启动步骤 / 存储 / 主题 / 网络自检
│               ├── theme.js         # 浅色 / 深色 / 跟随系统
│               ├── util.js          # DOM / 弹层 / 时间 / 分词
│               ├── bridge.js        # 原生桥封装（callId + Promise）
│               ├── store.js         # IndexedDB 与设置
│               ├── dict.js          # 离线词典（前缀 / 中文 / 模糊）
│               ├── ui-kit.js        # 通用组件（取图、标签、查词弹层）
│               ├── feed.js          # 【订阅源领域层】解析 / 抓取 / 发现 / OPML
│               ├── translate.js     # 【中英对照】按句切块、两源回退、译文缓存
│               ├── reader.js        # 【阅读模式】正文提取与阅读器渲染
│               ├── app.js           # 路由与底部导航
│               ├── view-gallery.js  # 图库 / 记忆宫殿
│               ├── view-scan.js     # 识图取词
│               ├── view-read.js     # 阅读（推荐 / 订阅 / 收藏）
│               ├── view-dict.js     # 词书与词典
│               └── view-review.js   # 间隔复习
├── prebuilt/lib/                    # Tesseract 原生库（arm64-v8a / armeabi-v7a）
├── libs/tesseract4android.jar
├── tools/
│   ├── fetch_deps.sh                # 拉取 Tesseract AAR + 语言包
│   ├── build_dict.py                # 由 ECDICT 生成离线词库与词书索引
│   ├── bump_version.py              # 提升版本号并写入更新日志
│   ├── i18n_build.py                # 生成词表（英文 + 繁体转换表）
│   ├── i18n_extract.py              # 扫描源码，登记待翻译文案
│   ├── i18n_wrap.py                 # 把中文字面量包成 T(...)
│   ├── check_bridge.py              # 构建时校验 JS ⇄ 原生 桥接签名一致性
│   └── make_icon.py                 # 生成多密度图标
├── test/                            # 回归测试（无头浏览器驱动）
│   ├── run.sh                       # 一键跑三套：打桩 / 真实网络 / 桥接契约
│   ├── server.py                    # 本地站点 + /proxy（模拟原生层抓源）
│   ├── cdp.js                       # 极简 CDP 驱动
│   ├── test-runner.js               # 功能断言
│   ├── bridge-contract-test.js      # 桥接运行时契约
│   └── site/                        # 测试站点（js/css/data 软链到 app/assets）
├── version.json                     # 版本唯一来源：应用名 / 版本号 / 更新日志
├── screenshots/                     # 界面截图
├── build.sh                         # 手工构建：aapt2 → javac → d8 → zipalign → apksigner
├── build.ps1                        # 同上，Windows / PowerShell 版（含防反斜杠与出包自检）
├── LICENSE                          # 本项目代码与文档的 MIT 许可
├── THIRD_PARTY_NOTICES.md           # 第三方组件与数据的来源、许可、边界说明
├── LICENSES/                        # 各第三方许可全文（ECDICT / Tesseract / Leptonica / libpng …）
├── README.md                        # 功能与技术方案
```

## 四、版本与更新

### 每个构建都带版本号

版本信息只有一个来源：项目根的 `version.json`。构建脚本从它读取**包名、应用名、版本号**，所以三者永远不会对不上。

```json
{
  "appName": "乐学英语",
  "versionCode": 2,
  "versionName": "1.1.0",
  "buildDate": "2026-10-14",
  "history": [
    { "version": "1.1.0", "code": 2, "date": "2026-10-14",
      "title": "阅读模块重写 + 首页改版 + 版本化交付",
      "changes": ["首页改为「背单词」，置于底部导航正中", "…"] }
  ]
}
```

`build.sh` 做的事：

1. 从 `version.json` 取出应用名，**生成** `app/res/values/strings.xml`（不再两处各写一份名字）
2. 把版本号通过 `aapt2 link --version-code / --version-name` 写进清单
3. 把 `version.json` 拷进 `assets/www/`，应用内「关于 / 更新日志」直接读它
4. 产物文件名自带版本：`乐学英语-v1.1.0.apk`
5. **构建后自检**：解包产物的二进制清单与 `resources.arsc`，确认应用名与版本号真的写进去了——否则直接判定构建失败。这条检查在开发过程中真的抓到过一次「版本对了、名字还是旧的」

### 改完代码后怎么发新版本

```bash
python3 tools/bump_version.py patch -m "修复了某个问题" -m "又改了一处"   # 1.1.0 -> 1.1.1
python3 tools/bump_version.py minor -m "新增某某功能"                    # 1.1.0 -> 1.2.0
python3 tools/bump_version.py major -m "首个正式版"                      # 1.1.0 -> 2.0.0
python3 tools/bump_version.py current                                    # 只看当前版本

bash build.sh                                                            # 打包
```

`bump_version.py` 会把 `versionCode` 自增 1（Android 靠它判断“这是升级”）、按 SemVer 提升 `versionName`，并把 `-m` 的内容作为更新日志插进 `history` 开头。不加 `-m` 时记为「例行更新」。

### 应用内怎么看到版本

`词书 → 关于` 一栏显示 **乐学英语 v1.1.0 (build 2)** 与构建日期，右侧「更新日志」按钮列出全部历史版本及每一条改动。这样装的到底是哪个包、比上一版改了什么，一眼就能对上。

---

## 五、构建

```bash
# 0) 依赖：JDK 8+、Android SDK（build-tools 34.0.0 + platforms/android-34）
export ANDROID_HOME=/opt/android-sdk

# 1) 拉取离线 OCR 内核与语言包（仅首次）
bash tools/fetch_deps.sh

# 2)（可选）重建离线词库：需要一个 ecdict.csv
python3 tools/build_dict.py /path/to/ecdict.csv

# 3) 打包
bash build.sh                     # 产物：./乐学英语-v<版本>.apk（名字与版本号自动带入）
ABIS=arm64-v8a bash build.sh      # 更小体积

# 4) 回归测试（可选，需要 node + chromium）
bash test/run.sh                  # 打桩 + 桥接契约，约 1 分钟
bash test/run.sh real             # 再加真实网络模式，约 3 分钟
PORT=8901 CDP_PORT=9223 bash test/run.sh   # 端口被占用时可改
```

安装：把 APK 传到手机直接安装（需允许「安装未知来源应用」）。

### Windows 上构建（PowerShell 版）

项目根的 `build.ps1` 是 `build.sh` 的等价移植，同样的 7 步流水线与全部自检，不依赖 bash / python3：

```powershell
# 签名口令不写在仓库里：用环境变量（或 tools\_local_secrets.ps1，已被 .gitignore 排除）
$env:WP_KEYSTORE_PASS  = '你的密钥口令'
$env:WP_KEYSTORE_ALIAS = '你的密钥别名'
# $env:WP_KEYSTORE_PATH = 'D:\my.jks'       # 可选，缺省用项目根的 keystore.jks（不存在则用上面口令现生成一个）

powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 `
  -SdkPath C:\path\to\android-sdk `
  -JavaPath 'C:\Program Files\Zulu\zulu-17' `
  -OutApk .\乐学英语-v1.3.0.apk
```

`build.sh` 同样从 `WP_KEYSTORE_PASS` / `WP_KEYSTORE_ALIAS` / `WP_KEYSTORE_PATH` 取签名参数（或 `tools/_local_secrets.sh`），两边都**不含**任何口令。

两个值得记住的坑：

- **含中文的 `.ps1` 必须存成 UTF-8 带 BOM**。PowerShell 5.1 对无 BOM 的脚本按代码页 936 解码，中文会变成乱码，症状却表现为莫名其妙的语法错误。
- `tools\check_bridge.ps1` 是 `check_bridge.py` 的等价移植，已接入 `build.ps1` 的 [2.5/7] 步；`tools\verify_apk.ps1` 用于出包后的独立复核（见第十四节）。
- `tools\parsecheck.js` 用 JDK 8 自带的 Nashorn 逐个解析前端脚本，做一次不执行任何代码的语法自检：
  `jjs -scripting tools\parsecheck.js -- app\assets\www\js\*.js`（`reader.js` 用了 ES2018 的后行断言，Nashorn 会误报，忽略即可）。
- `tools\gen_i18n_build.ps1` 是可用 Python 之外的备用方案：它把现有 `i18n-data.js` 里的繁体三张表当作数据搬过去，只重新计算英文表，生成一个能在 Windows 上独立跑完的 `i18n_build.ps1`（在副本里实测产物与现文件逐字节一致）。**日常不需要跑它**，`i18n-data.js` 也不要手改。

---

## 六、首次使用

1. **建词书目标**：`词书` → 选一本（默认 CET-4）。
2. **建宫殿**：`图库 → 我的宫殿 → ＋宫殿`，命名比如「我的家」。
3. **拍地点**：进宫殿 → `📷 拍一个新地点`，依次拍下玄关、书桌、床头…每个位置都会成为地点桩。
4. **挂单词**：在地点桩里点 `＋加词` 搜词挂上去；或者拍一张写满英文的纸 → `识图` → 识别 → `挂到地点桩`。
5. **复习**：`复习` → `开始复习`，卡住时点开卡片看释义，评完四档后 SM-2 会安排下次时间；忘记的卡片当轮会再出现一次。
6. **读起来**：`阅读` → `订阅` → `精选源` 挑几个源（默认已开 4 个），回上一页点「更新」；`推荐` 页会按你的词书把最合适的排前面。条目页点「载入全文」可以把原文正文抓回来读。

---

## 七、数据来源与许可

| 数据 | 来源 | 许可 |
| --- | --- | --- |
| 离线词库（音标 / 中文释义 / 词频 / 考纲标签） | [ECDICT](https://github.com/skywind3000/ECDICT) | MIT |
| 离线 OCR 引擎 | [Tesseract4Android](https://github.com/adaptech-cz/Tesseract4Android)（Tesseract 5） | Apache-2.0 |
| 图像处理库 | [Leptonica](http://www.leptonica.org/) | BSD-2-Clause |
| 英文语言包 | [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) | Apache-2.0 |
| JPEG / PNG 编解码 | libjpeg-turbo / libpng | BSD-3-IJG / libpng-2.0 |
| 15 篇分级短文 | 本项目原创 | — |
| 联网补充 | 有道词典公开接口 / dictionaryapi.dev / Guardian & BBC RSS | 各站点条款 |
| 应用代码与文档 | 本项目作者 | MIT（[LICENSE](LICENSE)） |

逐项版权与许可全文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `LICENSES/` 目录。

**订阅与阅读的边界**：`feeds.json` 只存 RSS 地址与分类，不含任何文章正文；正文在运行时由用户设备直连原站抓取，版权归原发布者，应用内保留来源与原文链接。在线查词与翻译只在用户主动触发时请求公开接口，不缓存、不再分发。

---

## 八、为什么允许明文 HTTP

`android:usesCleartextTraffic="false"`（以及 `targetSdk ≥ 28` 的默认行为）会让应用**拒绝一切 `http://` 请求**。我最初按「更安全」的直觉把它写死了，结果是：

- 内置的**新华英文**源地址是 `http://`，直接连不上；
- 用户自己在「＋订阅」里粘贴的 http 源也一样；
- 而报错落到界面上是**「网络不通或被拦截」**——完全指不到真正原因。

这个处理是错的。RSS 生态里至今有相当一部分源只有 http，把这条路封死等于砍掉一部分功能，而且失败原因还极其隐蔽。现在改成用 `res/xml/network_security_config.xml` 显式放开：

```xml
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />   <!-- 只信系统证书 -->
        </trust-anchors>
    </base-config>
</network-security-config>
```

为什么这个取舍可以接受：本应用不传输账号、密码、支付等任何敏感数据，抓的是公开 RSS 和公开词典接口；而 HTTPS 依旧按**系统信任链**验证，并且**只接受系统证书**（不信任用户自行安装的证书，避免把中间人风险放大）。

三处配套改动：

1. **隐藏 WebView 允许混合内容**：应用页面跑在 `https://appassets.local` 下，而阅读模式的后备通道要加载 http 页面。默认策略会拦掉这种跳转，所以对这条内部通道显式设为 `MIXED_CONTENT_ALWAYS_ALLOW`。
2. **内置源全部换成 https**：能用 https 就不用 http（新华英文的 https 实测同样可用）。用户自行添加的 http 源则照常工作。
3. **错误提示分开**：「明文被系统拦截」不再混在「网络不通」里。另外这类报错里也含 `http` 字样，判断顺序必须排在 TLS 之前，否则会被误报成「TLS 握手失败」。

构建时加了一道自检：用 `aapt2` 反解产物，确认清单确实引用了网络安全配置、且 `cleartextTrafficPermitted=true`。**这条校验我用「故意改回 false」验证过，会中止构建并返回退出码 1。**

---

## 九、订阅解析：为什么「浏览器能打开、应用解析不出来」

这是选源之外的第二类坑，根因在解析器而不是网络：

**`DOMParser.parseFromString(str, 'text/xml')` 是严格模式**——遇到未转义的 `&`、错配的标签、非法字符，它不会像浏览器那样尽量渲染，而是直接返回一个 `parsererror` 文档，`getElementsByTagName('item')` 拿到 0 个。而你在浏览器标签页里打开同一个地址，浏览器用的是宽松解析，内容照常显示。**同一个 URL，两边结论相反。**

现在解析器做了三层容错，并把「到底走了哪一层、为什么降级」原样告诉用户：

| 层次 | 手段 | 说明 |
| --- | --- | --- |
| 1 | 严格 XML 解析 | 正常情况，`<item>`（RSS 2.0 / RDF）与 `<entry>`（Atom）都支持 |
| 2 | 降级为 `text/html` 宽松解析 | 浏览器式解析，能容忍不规范 XML |
| 3 | 正则抽取 `item` / `entry` 区块 | 最终的暴力兜底 |

顺带补齐的解析能力：

- 描述字段依次尝试 `description` / `summary` / `content:encoded` / `content` / `media:description` / `dc:description`
- 时间字段依次尝试 `pubDate` / `published` / `updated` / `dc:date` / `date`
- 链接支持 `<link>URL</link>`、`<link href="...">`（Atom）与 `<guid>`
- **格式嗅探**：自动识别 RSS / Atom / RDF / HTML / 未知，并据此给出人话诊断——如果拿到的其实是网页，会直接说「返回的是网页（HTML），不是 RSS / Atom 地址」，而不是含糊的「解析不到条目」
- **编码**：很多中文源是 GBK/GB2312 而 HTTP 头不带 charset，硬按 UTF-8 解会成乱码、XML 解析随之失败。原生层现在按「HTTP 头 charset → XML 声明里的 encoding → UTF-8」的优先级判定，并在失败时依次回退 UTF-8 / GBK / GB18030 / ISO-8859-1

「测试连接」的结果现在会显示：**识别到的格式、用了标准解析还是容错降级、解析条目数、以及失败时的原始错误文本**。

## 十、踩过的坑：构建脚本吞掉了编译失败

有一次改完 Java 后构建显示成功，APK 也正常签名——**但装上去必然闪退**：`classes.dex` 里只有 `Ocr`、`TessBaseAPI`（来自依赖 jar），我们自己的 `MainActivity` / `Bridge` 一个都没有。

原因是那行编译命令写成了：

```bash
javac ... 2>&1 | grep -v "警告" || true
```

管道的退出码取自 `grep`，后面再跟 `|| true`，于是 **javac 失败被彻底吞掉**；后续 d8 用空目录照样能产出 dex，一路"成功"到签名。

现在构建脚本加了两道硬校验：

1. `javac` 的退出码单独取出并判断，非 0 直接 `exit 1`，同时确认 `MainActivity.class` / `Bridge.class` 确实产出。
2. `d8` 之后检查 `classes.dex` 里是否真的含有 `MainActivity` / `Bridge` / `Ocr` / `CaptureProvider`，缺任何一个立即中止。

已用「故意写一行非法 Java」验证过：构建会停在编译阶段并以退出码 1 结束。

## 十一、踩过的坑：JS ⇄ 原生 桥接参数错位

**症状**：所有联网功能（外刊、在线词典）都失败，界面提示「请求超时（网络不通或被拦截）」；换任何网络、挂不挂代理都一样。

**根因**：`bridge.js` 发起原生调用时把 `callId` 放在了**参数末尾**，而 `Bridge.http(...)` 的 Java 签名要求它在**最前**：

```
JS 发出：  (method, url, headers, body, callId)
Java 收到： callId="GET", method="https://…", url="", headers="", body="c5"
                                     ↑ url 成了空串
```

于是 `Net.request()` 判定地址非法、立即返回，回调又打到了 `"GET"` 这个不存在的 callId 上 —— JS 侧永远等不到回调，45 秒后超时。**请求根本没发出去。**

**为什么没被测出来**：功能测试全程打桩了 `Bridge.http`（`installFeedStub`），绕过了真实的桥接调用链，属于典型的「测试覆盖了功能，却没覆盖集成边界」。

**修复与两道防线**：

1. **统一约定**：所有异步方法第一个参数固定为 `callId`（`pickImages` / `ocr` / `http` 三个方法签名一并修正），JS 侧统一 `[id].concat(args)`。
2. **构建时静态校验**（`tools/check_bridge.py`，已接入 `build.sh`，不一致直接中止构建）：解析 `Bridge.java` 的全部 `@JavascriptInterface` 签名与 `bridge.js` 的全部调用点，比对参数个数与 `callId` 位置，并强制通用分发器必须写成 `[id].concat(...)`。
3. **运行时契约测试**：用 `mock-native.js` 严格按 Java 签名实现一个模拟原生桥，让 `Bridge.http / ocr / pickImages` 走完整链路，断言原生侧收到的第一个参数是 callId、业务参数逐一对位、回调能正确回填、并发调用 callId 不串台。

敏感度已验证：把参数顺序改回错误写法，该测试 **6 项全部失败**（全部报「超时未回填——callId 可能错位或被丢弃」），修复后 6 项全过。

另外顺手修了一个相关隐患：JS 侧的 30 秒超时**短于**原生层的 12s 连接 + 20s 读取 = 32s 最坏耗时，会把真实的网络错误掩盖成假超时；现在改为 45 秒。

## 十二、验证情况与已知限制

**已验证：**

- 前端在无头 Chromium 中以 CDP 真实驱动，跑通 **108 项功能断言**（打桩）/ **107 项 + 1 跳过**（真实网络），两种模式均**零 JS 报错**。
- 覆盖范围：词库查询 / 词形还原 / 中文检索 / 六页签渲染 / 文章分词与高亮 / SM-2 计算 / 卡片增删 / 图片与宫殿全流程 / 弹层返回值 / 标签持久化 / 返回键逻辑；订阅每日更新全链路（拉取→缓存落库→跨天过期→命中缓存时不联网→过期时自动联网→混入推荐→已读标记→开关持久化）；订阅源管理（默认只预置 4 个源、关闭后不再请求、全部关闭时的提示、自定义源增删、错误信息翻译、管理面板与编辑面板、精选目录三种状态）；推荐打分（全局最优性、类型筛选、随进度变化）；以及新增的解析与阅读模式用例。
- **订阅解析**：标准 RSS / 不规范 XML（严格解析失败后容错仍取到全部条目）/ Atom / RSS 1.0 (RDF) / `content:encoded` CDATA / HTML 网页识别 / 空响应 / HN 式元信息摘要剥离，**9 项全覆盖**。
- **正文提取**：段落·小标题·引用·列表都取到 / 导航·相关推荐·侧边栏·页脚全剔掉 / 纯链接页被拒 / cookie 提示条被拒 / 阅读模式准入判断，**5 项**；另有「直连只拿到提示条 → 自动切浏览器引擎并提取到 223 词」的通道降级验证。
- **订阅源发现**：从网页 HTML 里找出 `<link rel="alternate">` 指向的 RSS 地址。
- **OPML**：导出与导入往返一致 / 容忍未转义的 `&` / 重复导入去重，3 项。
- **桥接契约**：构建时静态校验（14 处调用 / 14 个原生方法全部一致）+ 运行时契约测试 **9 项全过**，并已验证「改回错误写法则测试全败」。
- **双通道抓取**：模拟「直连全部 403」时，源自动经浏览器引擎取到条目；两条通道都失败时，报错同时给出原因与已尝试的通道。
- **构建自检**：`javac` 失败与 `classes.dex` 缺类都会中止构建（均已用「故意写错」实测验证）；版本自检会解包产物核对**应用名与版本号**（`resources.arsc` + 二进制清单），开发中确实抓到过一次「版本对了、名字没换」。
- **版本机制**：应用内版本号与 `version.json` 一致 / 设置页「关于」正确显示 / 更新日志列出全部历史版本与改动条目 / 应用名已更名，**4 项**。
- **明文 HTTP**：http 地址从校验到抓取都不被拒绝（实测请求并解析出条目）/ 明文被拦时给出可读原因且不与 TLS 失败混淆 / 49 个内置源全部为 https，**3 项**；构建时另有一道反解产物确认策略生效的校验（已用「故意改回 false」验证会中止构建）。
- **多语言**：跟随系统的判定（zh-CN/zh-TW/zh-HK/en-US/fr-FR/多语言含中文/显式指定共 7 种输入）/ 切英文后标签与标题全为英文 / 切繁体后为繁体 / 繁体走词组规则（头发→頭髮）/ 切回简体恢复原文 / 偏好持久化 / 未收录文案安全回退，**7 项**。
- **主题**：三种取值的解析与状态栏同步 / 深色下背景确实变暗且文字可读（按亮度实测），**2 项**。
- **设置面板**：左上角入口位置与面板内容（4 个语言项 / 3 个外观项）/ 点选语言立即生效并持久化 / 点选主题立即生效，**3 项**。
- **真实网络实测**：4 个默认源全部返回有效 RSS（一天内抓到 124 条）；目录里标记 `cn=true` 的源分批实测通过，但连续扫描会被限流导致偶发失败——这个结论请以应用内「测试连接」为准。
- APK 通过 `apksigner verify`（v1 + v2 + v3 三方案签名）、`zipalign -p 4` 校验，清单 `minSdk=21 / targetSdk=34 / extractNativeLibs=true` 正确。

**尚未验证 / 已知限制：**

1. **未在真实 Android 设备上运行过**（构建环境无设备与模拟器）。原生桥的运行时行为——离线 OCR 首次初始化、TTS 发声、调起相机、隐藏 WebView 抓取、OPML 文件读写——需要在真机上确认。其中隐藏 WebView 那条通道是「站点只拦应用、不拦浏览器」的解决办法，浏览器测试环境里无法完整复现，请以真机「测试连接」的结果为准。
2. 若 OCR 提示「离线识别引擎初始化失败」，通常是 ABI 不匹配：本包只含 `arm64-v8a` 与 `armeabi-v7a` 原生库，x86 模拟器需要自行把 AAR 里 `jni/x86_64/` 的 `.so` 放进 `prebuilt/lib/x86_64/` 后重建。
3. **离线 OCR 限定印刷体英文**：书本、试卷、菜单、路牌效果好；手写体、艺术字、竖排文字识别率低。
4. **联网功能受第三方接口影响**：外刊 RSS、有道 / dictionaryapi 接口若变更或不可达，界面会显示失败原因并回退到上次缓存，离线词库与内置短文不受影响。
5. **在线外刊默认只给摘要**，但可以「载入全文」把原文正文抓回来读。正文提取对新闻类和博客类站点效果好，遇到强登录墙、纯前端渲染且脚本很重的站点仍可能失败——失败时会明确说明原因，而不是拿提示条冒充文章。
6. **订阅源是第三方服务**，随时可能改版、限流或下线。默认源于 2026-10 实测可用，但请以应用内「测试连接」的结果为准；失效了在「管理订阅源」里换一个即可。
7. **海外源需要海外网络**：BBC / Guardian / NYT 在境内是连接层失败，默认关闭。若你有可用代理，打开它们前请确认代理对应用生效（Android 上部分代理只覆盖浏览器流量）。
8. **部分源只提供标题或极短摘要**，这类条目无法评估难度，不会进入「为你推荐」（在「订阅」里仍看得到）。
9. **允许明文 HTTP 是有意的取舍**：不放开会让一部分只支持 http 的源无法使用。应用不传输任何账号或隐私数据，HTTPS 仍按系统信任链校验；若你的使用环境对明文体检严格，可以自行改 `app/res/xml/network_security_config.xml` 并重新构建。
10. 词库为学习向精选（26,202 词，覆盖全部常见考纲 + 高频词），不是完整词典（ECDICT 全量 77 万词条），生僻词需联网。
11. **英文模式下词典释义仍是中文**：离线词库的释义字段来自 ECDICT 的中文翻译列，没有英文释义数据；英文界面下查词看到的释义是中文的。界面文案本身已全部英文化。
12. **本仓库不含签名密钥**：公开仓库里不能放 `keystore.jks` 与口令。请自备密钥并重新签名——口令通过环境变量 `WP_KEYSTORE_PASS` / `WP_KEYSTORE_ALIAS` 传入（或写在被 `.gitignore` 排除的 `tools/_local_secrets.ps1` / `.sh` 里），密钥路径可用 `WP_KEYSTORE_PATH` 指定，缺失时构建脚本会先用 keytool 生成一个。自签名证书仅适合个人侧载，**不要用于应用商店发布**；**换密钥后无法覆盖安装旧包**（签名不一致），需要先卸载。

---

## 十三、踩过的坑（1.2.2）：超时没有配对、以及「无声挂死」

这三条都是真机（澎湃 OS 4 / Android 17）反馈「白屏一直转圈」「订阅源全部无效」之后查出来的。

### 1. IndexedDB 打开可能既不成功、也不报错

`open()` 原来只挂了 `onupgradeneeded / onsuccess / onerror`。某些 ROM 上这三步一个都不走，于是 `Store.init()` 永不 settle，`boot()` 里的 `Promise.all` 永不 settle，界面就永远停在「正在装载词库…」——**没有报错，也没有超时**。

修复：给 `open()` 加 7 秒超时与 `onblocked` 处理，并导出 `Store.storageState`；启动流程改成**分步限时**（词库 20s / 存储 9s / 版本 8s / 订阅缓存 12s），任何一步失败都只降级成一句提示，不再拖垮首页，另有 25 秒看门狗兜底。同类隐患在订阅缓存上还有三处（`loadCache`、`refreshAll` 的写回、阅读页的 `Promise.all`），一并补了超时与 `.catch`——**阅读页那三处原来连 `catch` 都没有，任一步出错就是一片空白。**

### 2. 每处超时都必须成对：JS 抢跑时间 > 原生最坏耗时

原来的数字是：JS 直连预算 **7.5s**，而原生 `Net.java` 是连接 3.5s + 读取 4.5s = **8s**。结果是 **JS 永远先判自己超时**（`status: 0`），直连通道对每个源都返回「无效」——看起来就像「所有源都坏了」，其实请求还在路上。更糟的是兜底通道只剩 2 秒预算，而原生隐藏 WebView 要跑 25 秒：两边都白等，隐藏 WebView 还是**串行**的，后面的源全排在队里一起被判无效。

现在的配对（**改任何一处都要同步改另一处**）：

| 通道 | JS 抢跑 | 原生最坏 / 看门狗 |
| --- | --- | --- |
| 直连 `Bridge.http` | 5500 ms | 2500 + 2000 = 4500 ms（`Net.java`） |
| 兜底 `Bridge.webFetch` | 7000 ms | 6000 ms（`Bridge.FETCH_WATCHDOG_MS`） |
| 单源硬上限 | 14000 ms | —（最后一道闸） |

另外 `Bridge.http(url, opt)` / `Bridge.webFetch(url, opt)` 现在接受 `opt.timeoutMs`：**每次调用可以给不同的等待上限**。以前超时是写死的（25000 / 20000），调用方传进去的预算根本到不了原生。

### 3. 「我改了但手机上没变化」——先确认装的是新包

有一版排障就栽在这里：手机上装的 APK 构建于 22:38，而 `index.html / app.js / store.js / theme.js` 的修改时间在 23:11 之后 —— **看门狗、超时、诊断页一个都没进那个包**，于是真机复现的一直是旧代码的行为。

所以出包之后不要只看「构建成功」，要解包核对：`tools/verify_apk.ps1` 会把 APK 里 `assets/www` 的每个文件与工作树**逐字节比对**，并检查关键修复标记与 `classes.dex` 里的新方法是否都在。

## 十四、1.2.2 的出包复核

- APK 内 `assets/www` 共 **20 个文件与工作树逐字节一致**（逐文件比对，不是只比数量）。
- 修复标记 14 项全部命中：`IDB_TIMEOUT`、`storageState`、`BOOT_WATCHDOG_MS`、`showBootProblem`、`isSystemDark`、`onSystemChange`、`opt.timeoutMs`、`boot-hint`、`WEBVIEW_BUDGET`、`catalogError`、`failPage`、`set-tts-note`、`ttsEngine`、`diag.js` 的探测库 `wp.diag.probe`。
- `classes.dex` 含新增/改写的原生方法：`isSystemDark`、`ttsInfo`、`setTtsMode`、`openTtsSettings`、`onRenderProcessGone`、`setAlgorithmicDarkeningAllowed`、`didCrash`。
- `zipalign -c` 在 **4 字节**与 **16KB 页**（`-P 16`）两种对齐下均通过；`apksigner` v1 + v2 + v3 三方案验签通过。
- 桥接静态校验：17 处调用 / 18 个原生方法一致（`exitApp` 暂未使用）；JS 语法自检用 JDK 8 自带 Nashorn 逐个解析全部 `assets/www/js/*.js` 通过（`reader.js` 含 ES2018 后行断言，Nashorn 报错属误报，WebView 支持）。
- 仍未在真机跑过：本次修复的**运行时**效果（诊断面板、深浅色跟随、发音引擎切换、订阅源实际取回）需要在你的手机上确认——出问题就打开「设置 → 诊断信息」把文本发回来。

## 十五、踩过的坑（1.2.3）：深色正文没反色、标题点不动、在线查词一次失败就判死

真机反馈的原话是「深色模式下对于文章的阅读，它那个颜色没有反过来，没有变成黑底白字」「大标题还不能划词翻译，有一些词他就在线联网都找不到」。

### 1. 主题变量是齐的，偏偏正文颜色写死了

界面的配色全部走 CSS 变量，深色主题段覆盖了 `.rd-body pre`、`blockquote`、`.reader-toolbar`、`.notice`、`.tag`、`.tabbar` 等一大堆——**唯独漏了 `.article-body` 的字色**，它是写死的 `color: #22303c`。深色下背景是 `--bg #10161d`，于是深字压深底。同类漏网还有 `.rd-body hr` 的边框色、词书进度数字、OCR 结果行、确认框正文。

修法：能改的字面量换成变量（`var(--text)` / `var(--line)` / `var(--text-2)` / `var(--brand)`）；**带中文的那几个内联色不能直接改**——那些字符串同时是 i18n 词表的键，改字面量会丢英文与繁体翻译，所以改成在 CSS 末尾用属性选择器覆盖（`[data-theme="dark"] [style*="#a33248"] { color: #f0a1af !important }` 之类）。

### 2. 「划词」只认 `.wd` 节点，而标题是纯文本

阅读页的点击代理是 `e.target.closest('.wd')`，而 `reader.js` 里大标题原来是 `U.esc(article.title)` 直接拼进去的纯文本，没有 `.wd` 节点；正文里的 `h2 / h3 / 图注` 也一样。现在标题与这些块都走 `renderText(..., hl=false)`——**切词但不加生词高亮**，所以标题里的词点得动，也不会把标题词错标成生词。

### 3. 在线查词：候选写法展开 + 多源回退 + 失败只缓存 5 分钟

原来的实现是三个问题叠加：只查 2 个源；把 token 原样丢过去（`teacher's`、`well-known`、`don't` 整串查）；**失败会永久缓存**——断网或超时一次，这个词在本次运行里再也不会重试，界面上只剩「未找到该词的在线释义」。

现在 `dict.js` 的 `online()` 变成：

- **先展开候选写法**（最多 4 个）：大小写与首尾非字母剥离 → 缩写还原（`don't→do`、`won't→will`、`it's→it` …）→ 撇号前段 → 连字符拆分与合并（`well-known→wellknown / well / known`）→ 屈折还原（`ies/ves/ing/ed/es/s`，叠辅音再补一刀：`stopped→stopp→stop`、`running→runn→run`），每个候选都有限时。
- **三个源依次回退**：有道 `jsonapi` → `dictionaryapi.dev` → `api.mymemory.translated.net`（翻译源兜底，会过滤 `NO QUERY SPECIFIED` 这类占位响应）。命中非原词时面板会标注「按原形查到：xxx」，并新增**「浏览器查词」**按钮直接跳到有道网页版。
- **成功与失败分开缓存**：成功永久缓存；失败只缓存 5 分钟（`ONLINE_FAIL_TTL`），并且区分「网络不通 / 被拦截」（`onlineNet`）与「词典里确实没有」（`onlineNone`）——以前两者是同一句话，看不出是哪一种。
- 离线词库没收录的词，打开词条面板时会**自动联网查一次**（原来要手动点）。

这套逻辑有一个不依赖浏览器的回归测试：`tools/test-dict-online.js`（JDK 8 的 `jjs` 直接跑，自带 Promise 垫片、打桩 `Bridge.http` 与 `Bridge.webFetch`、零网络）。`jjs tools/test-dict-online.js` → **34 项全部通过**，覆盖上面所有写法、三源回退、失败缓存 TTL、成功缓存永久、空查询（1.2.4 又加了「原生通道全挂、WebView 通道正常」的用例，见第十七节）。

> 环境坑一条：本机的 Edge/Chrome 没法在这个沙箱里 `--headless` 跑（`process_singleton_win.cc:941 Lock file can not be created`），所以浏览器端的逻辑测试只能用 Nashorn。

## 十六、1.2.3 的出包复核

- APK 内 `assets/www` 20 个文件与工作树**逐字节一致**（20/20）。
- 修复标记 26 项全部命中，其中 1.2.3 新增的 12 项：`color: var(--text)`、`.rd-title .wd`、`.bp-pct`、`style*="#a33248"`、`renderText(b.text, cmap, false)`、`renderText(article.title`、`queryForms`、`ONLINE_FAIL_TTL`、`isTransportFail`、`mymemory`、`data-act="web"`、`onlineTried`。
- `classes.dex` 含新增/改写的原生方法：`isSystemDark`、`ttsInfo`、`setTtsMode`、`openTtsSettings`、`onRenderProcessGone`、`setAlgorithmicDarkeningAllowed`、`didCrash`。
- `zipalign -c` 在 4 字节与 16KB 页（`-P 16`）两种对齐下均通过；`apksigner` v1 + v2 + v3 通过；`versionCode=7 / versionName=1.2.3 / minSdk 21 / targetSdk 34`。
- 仍未在真机跑过：深色阅读、点标题查词、联网查词的命中率都要你在手机上确认。查不到词时先看词条面板里的提示——写「网络不通」是取网失败，写「未收录」才是三个源都没有。

## 十七、踩过的坑（1.2.4）：联网查词「还是不行」——能用的接口没被放在第一位

1.2.3 上线后真机反馈仍然是「内置的联网查词还是不行」。我用 `tools/ProbeDict.java`（请求头与 `Net.java` 完全一致）从国内网络实测了四个接口：

| 接口 | 实测结果 |
| --- | --- |
| 有道 `suggest` | 200，**533 字节 / 28 ms** ✓ |
| 有道 `jsonapi` | 200，39,692 字节 / 473 ms（而客户端读取超时只有 2 秒） |
| MyMemory 翻译 | 200，1,171 字节 / 879 ms ✓ |
| `api.dictionaryapi.dev` | **SocketTimeoutException**（读超时，国内不可用） |

而旧版的取数方式是：把 `jsonapi` 和 `dictionaryapi` **并排放在第一梯队**。后果是——每次查词 dictionaryapi 必然读超时 → `stat.fail++` → 结论永远是「网络不通或被拦截」；同时 40 KB 的 `jsonapi` 在手机的 2 秒读取超时下也经常来不及。**唯一稳定可用的那个轻量接口，从来没被试过。**

1.2.4 的做法：

1. **小接口优先**：先问有道 `suggest`（0.5 KB），命中即返回；只在缺音标/词性时再补一次 `jsonapi`。
2. **换通道重试**：如果原生 `HttpURLConnection` 连第一个接口都失败（超时 / 被 ROM 拦），那就不是词典的问题而是通道的问题——同一个查询立刻改用 **WebView 网络栈**（和系统浏览器同一条路）重试，并跳过剩余的原生请求，不再白等。
3. **三种结论分开**：`onlineNet`（两条通道都连不上）/ `onlineParse`（回包解析不了，多半是接口改版）/ `onlineNone`（三个源都说没这个词）。以前三者都是同一句话。
4. **超时重新配对**：单次接口 4.5 s（原生最坏 4.5 s）、WebView 通道 7 s（原生看门狗 6 s）、整次查询 15 s 硬上限。

回归测试跟着重写（`tools/test-dict-online.js`），**34 项全部通过**，其中新增的用例正是这次真机问题的形状：「原生通道全挂、WebView 通道正常时仍要查到词」。

## 十八、1.2.4 的出包复核

- APK 内 `assets/www` 20 个文件与工作树**逐字节一致**（20/20）。
- 修复标记 32 项全部命中，1.2.4 新增 6 项：`function parseSuggest`、`function planOf`、`SOURCE_TIMEOUT`、`webOnly`、`res.channel = web ? 'web' : 'native'`、`onlineParse`。
- `classes.dex` 里的 7 个原生方法（`isSystemDark`、`ttsInfo`、`setTtsMode`、`openTtsSettings`、`onRenderProcessGone`、`setAlgorithmicDarkeningAllowed`、`didCrash`）齐备。
- `zipalign -c` 在 4 字节与 16KB 页（`-P 16`）两种对齐下均通过；`apksigner` v1 + v2 + v3 通过；`versionCode=8 / versionName=1.2.4 / minSdk 21 / targetSdk 34`。
- 真机上若还有词查不到，**面板里的那句话就是结论**：写「网络不通」= 原生通道和 WebView 通道都没取到网；写「联网查到了内容但解析不出来」= 接口改版；写「在线词典里也没有查到这个词」= 三个源确实都没有——这种情况点「浏览器查词」去网页版看。

## 十九、1.3.0：阅读页的中英对照

阅读页工具栏多了一个「对照」。按一下，正文每段英文下面就会**逐段**出现中文译文——从上往下填，不用等整篇翻完。「原文」按钮本来就有（订阅文章右上角，用系统浏览器打开原链接），中文是按按钮才出来的，不会偷偷替你花流量。

### 为什么不用现成的翻译 SDK

没有可用的密钥，所以只考虑免密钥的公开接口。用 `tools/ProbeTranslate.java`（请求头与 `Net.java` 一致）实测：

| 接口 | 实测结果 |
| --- | --- |
| MyMemory `get` | 200，330 字符整段 633 ms，译文正常 ✓ |
| Google `translate_a/single`（gtx） | 200，223 字节，译文正常 ✓（但境内网络时通时不通） |
| 有道旧版 `fanyi.youdao.com/translate` | 200，但返回的是整页 HTML（那个 GET 接口已经下线，只剩网页版） |
| 有道 `jsonapi?q=<整句>` | 200，只有 253 字节的 `{"input","meta"}`——**它只认单词，不翻句子** |
| `fanyi.baidu.com/transapi` | 200，0 字节 |

所以顺序是 **MyMemory → Google gtx**，两个都失败才算失败。

### 几条工程细节

1. **按句切块，≤400 字符**：MyMemory 匿名单次只能收约 500 字节，直接丢整篇会被截断或报 `QUERY LENGTH LIMIT`。`translate.js` 的 `chunk()` 按句末标点聚合到 400 字符以内；遇到没有标点的超长串就在空格处硬切（会校验「切完拼回去不丢字」）。
2. **块级缓存**：内存 + `Store` 的 meta（键 `tr`，上限 600 条）。同一段文字只翻一次，所以重开同一篇文章、切来切去都是秒出；缓存写入做了 1.5 秒防抖。
3. **两种失败要分开**：MyMemory 用 `quotaFinished` / `responseStatus 429` / `PLEASE SELECT...` 这类文本判定「额度用完」，用「译文等于原文」判定「它其实没翻」。额度用完给出的是"免费额度用完了"而不是"网络不好"，并且顺手提示可以点「原文」。
4. **换通道**：和查词一样——原生 `HttpURLConnection` 一旦取不到数据，后续就走 `Bridge.webFetch`（WebView 网络栈）。被 ROM 限制原生联网的机型靠这条。
5. **并发 2**：同时两段够快，又不至于撞限流；慢的时候用户看到的是「正在翻译 3 / 18」，每翻完一段就往上填。
6. **朗读不念中文**：`speakAll()` 先把 `.rd-zh` 节点摘掉再取文字。
7. **深色可读**：译文行用 `--surface-2` / `--text-2` / `--line` 三个变量，深色下自动变成深底浅字；没翻出来的行是 `--warn` 暖色，点一下重试。

回归测试：`tools/test-translate.js`（jjs 跑，打桩 `Bridge.http` / `Bridge.webFetch` / `Store`，零网络）**24 项全部通过**，覆盖切块不丢字、两个接口的解析、额度与回显判定、回退 gtx、两源全灭、缓存命中。

## 二十、1.3.0 的出包复核

- APK 内 `assets/www` **21 个文件与工作树逐字节一致**（21/21，比 1.2.4 多一个 `translate.js`）。
- 修复标记 **41 项全部命中**，1.3.0 新增 9 项：`js/translate.js`、`function chunk`、`mymemory`、`translate.googleapis.com`、`quotaFinished`、`function startBi`、`data-a="bi"`、`.rd-zh`、`biLabel`。
- `classes.dex` 的 7 个原生方法齐备；`zipalign -c`（4 字节与 `-P 16`）通过；`apksigner` v1 + v2 + v3 通过；`versionCode=9 / versionName=1.3.0 / minSdk 21 / targetSdk 34`。
- 真机待确认：翻译质量（机器翻译就是这样，能读原文就别只读译文）、MyMemory 的免费额度（一个 IP 一天大约 5000 字符，超了会明确提示）、以及境内网络下 gtx 备用源是否可用。若某段一直翻不出来，先看那行提示——写「额度用完」是限流，写「没翻出来」是网络或接口问题。
