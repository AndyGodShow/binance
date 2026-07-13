# GitHub 公开仓库检查清单

本项目当前远端为 <https://github.com/AndyGodShow/binance>，默认分支是 `main`，仓库可见性为公开，线上地址为 <https://binance-psi-eosin.vercel.app>。

## 本次检查结论

- 没有发现 `.env.local`、私钥文件、`.pem` 或 `.key` 文件被 git 跟踪。
- `.env.example` 是唯一被跟踪的 env 文件，内容为空占位变量，可作为公开配置模板。
- 本地存在 `.env.local`，但它被 `.gitignore` 的 `.env*` 规则忽略；不要把其中真实值复制到文档、issue、截图或提交信息。
- 代码中的 `COINALYZE_API_KEY`、`MORALIS_API_KEY`、`DATA_DOWNLOAD_TOKEN` 等命中均为环境变量读取、测试占位或配置说明，不是硬编码密钥。
- 历史提交中只看到 `.env.example` 的 env 文件记录，没有看到 `.env.local`、私钥文件或证书文件进入历史。
- `output/playwright/*.png` 当前已经在 git 跟踪列表中；继续提交截图前应确认画面里没有本地路径、账户信息、token、私有钱包地址或未公开策略数据。
- `data/daily-news/`、`data/external/`、`data/ledger_strategy/`、`data/historical/` 和 `.playwright-cli/` 已被忽略，适合存放本地抓取缓存和临时输出，但不要手动强制添加。

## 推送前必查

```bash
git status --short
git ls-files .env .env.local .env.production .env.development .env.example
git check-ignore -v .env.local data/daily-news .playwright-cli data/historical data/external data/ledger_strategy
git grep -I -n -i -E 'api[_-]?key|secret|private[_-]?key|password|token|bearer|authorization|client_secret|mnemonic|database_url' -- . ':!package-lock.json'
```

预期：

- `git ls-files` 只显示 `.env.example`。
- `git check-ignore` 能说明 `.env.local` 和本地数据目录被 `.gitignore` 拦截。
- `git grep` 的命中应该是环境变量名、测试占位值、文档说明或业务里的链上 token 概念；如果出现真实 key、Bearer token、cookie、私钥、助记词或数据库连接串，应立即从提交中移除并轮换凭据。

## 公开仓库资料建议

- GitHub 仓库描述当前为空，可以在 GitHub 设置里补一句：`Binance U-margined futures dashboard for market monitoring, strategy research, backtesting and risk simulation.`
- License 当前为空；如果希望别人能合法复用代码，应选择并提交合适的开源许可证。如果只是个人研究公开展示，可以先保持无 license。
- README 应继续避免展示真实 API key、真实账户、私有钱包、交易所账号、完整本地路径和未公开策略参数。
- issue、PR、截图和日志同样按公开内容处理；特别注意浏览器 DevTools、请求 header、Vercel 环境变量页和本地 `.env.local` 画面。
