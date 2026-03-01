---
description: 每次代码修改完成后，自动 commit 并 push 到 GitHub，触发 Vercel 自动部署
---

# 自动部署工作流

每次完成代码修改后，必须执行以下步骤将更改推送到 GitHub，Vercel 会自动检测并部署。

// turbo-all

1. 暂存所有修改：
```bash
cd "/Users/huangzuhang/Desktop/编程/vibe coding/币安数据面板" && git add -A
```

2. 提交修改（根据实际修改内容写有意义的 commit message）：
```bash
cd "/Users/huangzuhang/Desktop/编程/vibe coding/币安数据面板" && git commit -m "<描述本次修改的内容>"
```

3. 推送到 GitHub：
```bash
cd "/Users/huangzuhang/Desktop/编程/vibe coding/币安数据面板" && git push origin main
```

4. 告知用户推送完成，Vercel 将在 1-2 分钟内自动部署更新。

**部署地址**: https://binance-psi-eosin.vercel.app
