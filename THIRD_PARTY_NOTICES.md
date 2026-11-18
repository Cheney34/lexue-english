# 第三方组件与数据声明

本应用（乐学英语 / LexueEnglish）在代码之外还包含若干第三方组件与数据。它们的版权归各自作者所有，
按下列许可分发。本仓库 `LICENSE` 中的 MIT 许可**不覆盖**这些内容。

| 组件 / 数据 | 用途 | 许可 | 许可全文 |
| --- | --- | --- | --- |
| [ECDICT](https://github.com/skywind3000/ECDICT) | 离线词库（音标、中文释义、词频、考纲标签），由 `tools/build_dict.py` 生成为 `app/assets/data/words.json`、`books.json` | MIT（Copyright © 2025 Linwei） | [`LICENSES/ECDICT-LICENSE.txt`](LICENSES/ECDICT-LICENSE.txt) |
| [Tesseract4Android](https://github.com/adaptech-cz/Tesseract4Android) 4.9.0 | 离线 OCR 的 Java 封装（`libs/tesseract4android.jar`） | Apache-2.0 | [`LICENSES/Tesseract4Android-LICENSE.txt`](LICENSES/Tesseract4Android-LICENSE.txt) |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | OCR 引擎本体（`libtesseract.so`） | Apache-2.0 | [`LICENSES/Tesseract-LICENSE.txt`](LICENSES/Tesseract-LICENSE.txt) |
| [Leptonica](http://www.leptonica.org/) | Tesseract 依赖的图像处理库（`libleptonica.so`） | BSD-2-Clause | [`LICENSES/Leptonica-LICENSE.txt`](LICENSES/Leptonica-LICENSE.txt) |
| [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) | 英文识别模型 `app/assets/tessdata/eng.traineddata` | Apache-2.0 | [`LICENSES/tessdata_fast-LICENSE.txt`](LICENSES/tessdata_fast-LICENSE.txt) |
| [libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo) | JPEG 编解码（`libjpeg.so`，由 Tesseract4Android 预编译提供） | BSD-3-Clause / IJG | [`LICENSES/libjpeg-turbo-LICENSE.md`](LICENSES/libjpeg-turbo-LICENSE.md) |
| [libpng](http://www.libpng.org/pub/png/libpng.html) | PNG 编解码（`libpngx.so`，由 Tesseract4Android 预编译提供） | libpng-2.0 | [`LICENSES/libpng-LICENSE.txt`](LICENSES/libpng-LICENSE.txt) |

## 说明

- 上述 `.so` 原生库与 `tesseract4android.jar` 由 `tools/fetch_deps.sh` 从 Tesseract4Android 的
  JitPack 分发（AAR）中解包得到，未做任何修改；`eng.traineddata` 直接取自 tessdata_fast 仓库。
- `app/assets/data/words.json` 与 `books.json` 是基于 ECDICT 的 **衍生数据**（筛选常用词、清洗释义、
  重排为列式结构、按考纲标签生成词书索引），按 ECDICT 的 MIT 许可分发，并在此保留其版权声明。
- 15 篇分级短文（`app/assets/data/articles.json`）为本项目原创。
- 订阅源目录（`app/assets/data/feeds.json`）只包含 RSS 地址与分类，不包含任何第三方文章正文。
  文章内容在运行时由用户设备直接向原站点请求，版权归原发布者所有，应用内保留原链接与来源。
- 在线查词使用公开接口（有道词典公开接口、dictionaryapi.dev）与公开翻译接口，
  仅用于用户主动查询，不缓存、不再分发其内容。
- 应用图标由 `tools/make_icon.py` 脚本绘制生成，为原创作品。

## 商标

「乐学英语」「LexueEnglish」为本项目自用名称，未在任何商标机关注册；如与他人商标冲突，
请自行改名（改名不影响功能，但会导致覆盖安装失效，见 README 第十二节）。
