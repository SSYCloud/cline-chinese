# 通用 Code Review 工作流

## Objective
以结构化、全面的方式审查代码变更，发现潜在 Bug、安全漏洞、性能问题和代码设计缺陷，并为每个发现的问题提供可操作的解决方案提示。所有输出均使用中文。

## 支持的审查选项
审查开始前，请用户从以下四种模式中选择一种：

1. **工作区改动审查**：审查 staged、unstaged 和 untracked 的所有改动。
2. **分支差异审查**：审查当前分支与指定 base 分支之间的差异。
3. **指定 Commit 审查**：审查某个具体 commit 引入的改动。
4. **自定义审查指令**：根据用户提供的任意审查指令进行审查。

## Step 1: 确定审查范围
<important>在收到用户明确选择之前，不要输出任何审查结果或评论。</important>

向用户呈现上述四种选项，并询问其选择。如果用户选择：
- 选项 2：询问 base 分支名称（如 `main`、`master`、`develop` 等）
- 选项 3：询问 commit hash（完整或缩写）
- 选项 4：询问具体的审查指令内容

## Step 2: 收集 Git 变更信息
根据用户选择的选项，运行对应的命令收集 diff 信息。此阶段保持静默，不输出分析性文字。

### 选项 1：工作区改动
```bash
printf "=== GIT STATUS ===\n"; git status --porcelain | cat; printf "\n=== STAGED DIFF ===\n"; git diff --cached | cat; printf "\n=== UNSTAGED DIFF ===\n"; git diff | cat; printf "\n=== UNTRACKED FILES ===\n"; git ls-files --others --exclude-standard | cat
```

### 选项 2：分支差异
```bash
BASE_BRANCH="<用户指定的 base 分支>"
printf "=== CURRENT BRANCH ===\n"; git branch --show-current | cat; printf "\n=== BASE BRANCH ===\n"; echo "$BASE_BRANCH" | cat; printf "\n=== COMMITS (BASE..HEAD) ===\n"; git log "$BASE_BRANCH"..HEAD --oneline | cat; printf "\n=== CHANGED FILES ===\n"; git diff "$BASE_BRANCH" --name-only | cat; printf "\n=== FULL DIFF ===\n"; git diff "$BASE_BRANCH" | cat
```

### 选项 3：指定 Commit
```bash
COMMIT_HASH="<用户指定的 commit>"
printf "=== COMMIT INFO ===\n"; git show --no-patch --format="%h %s (%an %ad)" "$COMMIT_HASH" | cat; printf "\n=== COMMIT DIFF ===\n"; git show "$COMMIT_HASH" | cat
```

### 选项 4：自定义指令
根据用户提供的指令，运行相应的 git 命令收集相关改动信息（如 `git diff`、`git show`、`git log` 等）。

如果输出内容过长（超过 500 行），将结果写入临时文件 `cline-code-review.temp` 并提示 `::OUTPUT_FILE=cline-code-review.temp`，随后通过 `read_file` 读取。

## Step 3: 上下文收集（静默阶段）
- 根据收集到的 diff，识别所有受影响的文件。
- 使用 `read_file` 阅读修改后的文件，必要时也阅读未修改的相关文件以理解上下文。
- 检查依赖、导入、跨文件引用以及修改范围之外的关联代码。
- 如果上下文窗口使用已超过 60%，停止继续读取文件；若低于 40%，应继续补充上下文。
- 整个过程不输出任何分析或评论。

## Step 4: 代码审查分析
在充分理解变更后，按以下四个维度进行审查。每个发现的问题都应附带：
- 问题描述
- 涉及文件和代码位置
- 严重程度（高/中/低）
- **解决方案提示**（具体的修改建议或代码示例）

### 1. 潜在 Bug
检查：
- 空指针、未处理的异常/错误
- 逻辑错误、条件判断缺陷
- 变量作用域、类型不匹配
- 竞态条件、异步处理问题
- 边界情况未覆盖

### 2. 安全漏洞
检查：
- 输入验证缺失（SQL 注入、XSS、命令注入等）
- 敏感信息泄露（密码、token、密钥硬编码）
- 权限/认证缺失
- 不安全的依赖或 API 使用
- 数据泄露风险

### 3. 性能问题
检查：
- N+1 查询、低效的循环
- 大对象/大数组频繁复制
- 阻塞式操作未异步化
- 缓存缺失或失效策略不当
- 大量日志或同步 I/O 在热路径上

### 4. 代码设计缺陷
检查：
- 违反单一职责原则、函数/类过大
- 代码重复（DRY 原则）
- 接口设计不合理、耦合过高
- 缺乏类型安全或异常处理不一致
- 命名不清晰、魔法数字/字符串

## Step 5: 输出审查报告
使用中文输出结构化的审查报告，包含：

### 报告模板
```
# Code Review 报告

## 审查概述
- 审查模式：<选项 1/2/3/4>
- 审查范围：<文件列表或提交信息>
- 变更统计：<新增/删除行数，如可用>

## 发现的问题

### 潜在 Bug
- [ ] <问题描述> —— 文件：<path>，行号：<line> —— 严重程度：<高/中/低>
  - **解决方案**：<具体修改建议>

### 安全漏洞
- [ ] <问题描述> —— 文件：<path>，行号：<line> —— 严重程度：<高/中/低>
  - **解决方案**：<具体修改建议>

### 性能问题
- [ ] <问题描述> —— 文件：<path>，行号：<line> —— 严重程度：<高/中/低>
  - **解决方案**：<具体修改建议>

### 代码设计缺陷
- [ ] <问题描述> —— 文件：<path>，行号：<line> —— 严重程度：<高/中/低>
  - **解决方案**：<具体修改建议>

## 总体评价
<简要总结变更质量，是否建议合并，需修改的优先级>
```

## Key Rules
- **审查研究阶段不输出任何评论**：在收集 diff 和上下文期间，保持静默。
- **先分析后交互**：必须完成所有文件阅读和四个维度的审查分析后，才能输出报告。
- **每个问题均需附带解决方案**：不能只提出问题，必须给出可操作的修复建议。
- **所有输出使用中文**：包括报告、建议和与用户的沟通。
- **基于实际变更给出建议**：仅对实际修改的代码提出相关建议，避免无关的泛泛而谈。

## Important Notes
- 审查 untracked 文件时，确保文件已被 `git` 识别（未被 `.gitignore` 忽略）。
- 分支差异审查建议使用三点语法 `git diff <base>...HEAD`（仅当前分支相对于基准分支的独有改动）或双点语法 `git diff <base>..HEAD`（所有差异），视用户需求而定。
- 如遇合并冲突或无法解析的 diff，优先提醒用户并请求澄清。