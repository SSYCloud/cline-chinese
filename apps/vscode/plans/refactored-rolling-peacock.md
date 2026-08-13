# 自动合并 `.cline-chinese` 遗留配置到 `.cline`

## Context

用户此前手动对比了 `~/.cline/data` 与 `~/.cline-chinese/data`（旧版 "cline-chinese" 分支安装遗留的配置目录），发现两者的 `globalState.json` 和 `workspaces/<hash>/workspaceState.json` 内容重叠，并约定冲突解决规则：**按整个文件的修改时间，新文件中的键覆盖旧文件中的同名键**（非冲突的键直接并入）。

现在需要把这个手动合并操作固化到插件代码里，做到**每次插件读取配置（即构建 `StorageContext`）时自动执行**，无需用户手动介入，并且以后即使 `.cline-chinese` 目录内容变化也能继续生效。

## 现状（探索结论）

- 所有对 `globalState.json` / `secrets.json` / `workspaceState.json` 的读写都经过唯一的文件存储层 `ClineFileStorage`（`apps/vscode/src/shared/storage/ClineFileStorage.ts`），三者都是在 `createStorageContext()`（`apps/vscode/src/shared/storage/storage-context.ts:116`）里构造出来的，构造时立刻把整份 JSON 读入内存（`readFromDisk()`）。
- `createStorageContext()` 是唯一的入口，VSCode 扩展（`extension.ts:81`）和 standalone/JetBrains/CLI（`standalone/cline-core.ts:74`）都调用它——这里是不依赖 `vscode` 模块、两端共用的最合适的合并触发点。
- 目录解析的唯一权威函数是 `resolveDataDirFromEnv()`（`storage-context.ts:93`），其文档注释明确指出所有 reader/writer 必须走同一套解析规则（ENG-2332 的历史教训），不应再新增一套独立的路径拼接逻辑。
- 仓库里已有的迁移范式（`apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts`）采用的手法是：sentinel 版本号做幂等门控（`__vscodeMigrationVersion`，分别存在 `globalState` 和 `workspaceState` 两处，独立门控全局态和工作区态）、"目标存储已有值则不覆盖"的合并策略、`setBatch()` 批量写入、绝不清除/写回旧数据源。这是本次改动要复用的模式，只是本次的冲突规则改成"文件 mtime 更新的一方覆盖"而不是"目标永远优先"。
- 探索也确认 `.cline-chinese` 在当前用户环境里只有 `globalState.json` 和一个 `workspaces/73327cdf/workspaceState.json`，没有 `secrets.json` 或 `settings/*.json`。本次改动的范围对齐用户上一轮实际执行过的合并操作：**globalState.json、secrets.json、workspaceState.json**（`ClineFileStorage` 家族的三个文件）。不涉及 `settings/global-settings.json`、`settings/providers.json`、`settings/cline_mcp_settings.json`（这些走的是 SDK 侧完全不同的读写实现，属于范围外的扩展，不在本次"上面的合并操作"所指范围内）。

## 实现方案

### 1. 新增合并模块 `apps/vscode/src/shared/storage/cline-chinese-legacy-merge.ts`

放在 `shared/storage/` 下（不依赖 `vscode` 包），与 `storage-context.ts` 同级，供 VSCode 扩展和 standalone 入口共用。

```ts
export interface ClineChineseMergeOptions {
  /** 覆盖 .cline-chinese 根目录，默认 ~/.cline-chinese。测试用。 */
  legacyClineDir?: string
}

export function mergeLegacyClineChineseStorage(
  storage: StorageContext,
  opts?: ClineChineseMergeOptions,
): void
```

- 同步执行（纯文件系统操作，无需 async）。
- `legacyDataDir = path.join(opts?.legacyClineDir ?? path.join(os.homedir(), ".cline-chinese"), "data")`。
- Sentinel：`__clineChineseMergeVersion`，`CURRENT_VERSION = 1`。分别存在 `storage.globalState`（门控 globalState+secrets 合并）和 `storage.workspaceState`（门控当前工作区的 workspaceState 合并），与 `vscode-to-file-migration.ts` 的双 sentinel 设计完全一致——新开的工作区仍会各自触发一次工作区级合并。
- 先查 sentinel，已是当前版本则跳过对应部分的所有文件系统访问（避免每次启动都做多余的 `existsSync`/`readFileSync`）。
- 核心合并逻辑抽成一个小helper：

```ts
function mergeJsonFileByMtime(legacyPath: string, currentPath: string): Record<string, any> | undefined
```
  - 若 legacy 文件不存在 → 返回 `undefined`（无事可做）。
  - 若 current 文件不存在 → 直接返回 legacy 整个对象（相当于"当前为空，无冲突，全部并入"）。
  - 两者都存在：`fs.statSync` 比较 mtime；对 legacy 中的每个键：若 current 里没有这个键 → 直接并入（无冲突）；若 current 里有 → 只有 legacy 文件更新时才用 legacy 的值覆盖。
  - 返回值只包含"需要写入 current 的差异键"（没有变化的键不放入返回对象），调用方直接 `setBatch(result)`。
  - 用 try/catch 包裹 JSON.parse/fs 调用，出错时 `Logger.warn` 并返回 `undefined`，绝不抛出——与 `ClineFileStorage.readFromDisk` / `legacy-state-reader.ts` 的"永不抛出"惯例一致。
- `mergeLegacyClineChineseStorage` 用这个 helper 依次处理：
  - `globalState.json`：`currentPath = path.join(storage.dataDir, "globalState.json")`；结果 `setBatch` 到 `storage.globalState`，同时把 sentinel 键塞进同一个 batch 一并写入。
  - `secrets.json`：同样模式，写入 `storage.secrets`。
  - `workspaceState.json`：**只处理当前工作区**，用 `path.basename(storage.workspaceStoragePath)` 取出 workspace hash（`storage-context.ts` 里 `workspaceDir = path.join(dataDir, "workspaces", hash)`，避免重复实现 hash 算法），legacy 路径是 `path.join(legacyDataDir, "workspaces", hash, "workspaceState.json")`；结果连同它自己的 sentinel 一起 `setBatch` 到 `storage.workspaceState`。

### 2. 挂接到 `createStorageContext()`

`apps/vscode/src/shared/storage/storage-context.ts`：
- `StorageContextOptions` 增加可选字段 `legacyClineChineseDir?: string`（测试用覆盖，语义对齐现有的 `clineDir` 字段）。
- 在函数末尾、三个 `ClineFileStorage` 都构造完成、`return` 之前，调用：
  ```ts
  mergeLegacyClineChineseStorage(context, { legacyClineDir: opts.legacyClineChineseDir })
  ```
  （`context` 是即将返回的 `StorageContext` 对象，需要先把它组装好再调用，再 `return context`。）
- 这样 VSCode 扩展（`extension.ts:81` 的 `createStorageContext({ workspacePath })`）和 standalone（`cline-core.ts:74` 的 `createStorageContext()`）都会在每次启动、构建配置读取上下文时自动尝试合并，不需要各入口分别调用。

### 3. 测试

新增 `apps/vscode/src/shared/storage/__tests__/cline-chinese-legacy-merge.test.ts`，参照 `apps/vscode/src/hosts/vscode/__tests__/vscode-to-file-migration.test.ts` 的写法（`bun:test` + `should` + 真实临时目录，不需要 mock vscode，因为这个模块本身不依赖 vscode）：
- 用例：legacy 目录不存在 → 无操作，`.cline` 内容不变。
- 用例：legacy 有独有键、current 没有 → 独有键被合并进 current。
- 用例：同一个键两边都有，legacy 文件 mtime 更新 → legacy 值覆盖 current。
- 用例：同一个键两边都有，current 文件 mtime 更新 → current 值保留。
- 用例：workspaceState 只合并 hash 匹配当前工作区的那个目录，其他 workspace 目录不受影响。
- 用例：sentinel 写入后，第二次调用不再重复读取/覆盖（用 spy/mtime 修改验证幂等）。
- 用例：legacy JSON 损坏 → 不抛出，current 数据保持原样。

## 验证方式

- `cd apps/vscode && bun test src/shared/storage/__tests__/cline-chinese-legacy-merge.test.ts` 跑新测试。
- 跑现有的 `bun test src/shared/storage src/hosts/vscode/__tests__/vscode-to-file-migration.test.ts` 确认没有破坏既有迁移测试。
- 手动验证（可选）：设置 `CLINE_DIR`/临时 HOME 指向一个准备好 `.cline` + `.cline-chinese` 两个目录的沙箱，跑一次 standalone 入口或扩展的 `createStorageContext()`，检查合并后的 `globalState.json` 内容与预期一致，且 `.cline-chinese` 目录本身不被修改。
