# WeFlow 微信回复助手

一个本地运行的微信聊天回复助手：读取你自己电脑上的微信 4.x 聊天记录，收到对方新消息时自动调用大模型生成 3 条候选回复，可编辑后一键发送到微信。

## 特性

- 实时读取微信 4.x 会话和消息（本地、只读）
- 收到新消息自动生成 3 条候选回复
- 每个聊天对象可分别设置「聊天对象设定」，并支持多次发送指令
- 回复可直接编辑，一键粘贴并发送到微信当前聊天
- 聊天记录中显示图片和动画表情
- DeepSeek / 任意 OpenAI 兼容模型

## 工作原理

本工具由两部分组成：

1. 本项目自带的本地 Web 服务（Node.js，无第三方 npm 依赖）
2. 开源的 [WeFlow Rust CLI](https://github.com/334456777/WeFlow)，负责读取微信本地数据库和提取密钥

首次启动时，`setup` 脚本会自动下载匹配当前系统的 `weflow` 组件。

## 环境要求

- Node.js 18 或更高版本
- 已登录的 Windows 微信 4.x（读取数据需要）
- DeepSeek 或其他 OpenAI 兼容模型的 API Key

> macOS / Linux 仅理论上支持 weflow 数据组件，微信 4.x 数据读取以 Windows 验证为主。

## 快速开始

### 1. 下载本项目

```bash
git clone https://github.com/sunshine-ha/weflow-reply-assistant.git
cd weflow-reply-assistant
```

### 2. 启动

Windows：

```bat
setup.cmd
```

macOS / Linux：

```bash
bash setup.sh
```

首次运行会自动下载 `weflow` 组件，并生成 `.env` 文件。

### 3. 填写 API Key

编辑 `.env`，把 `DEEPSEEK_API_KEY` 换成你的 Key：

```env
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE=https://api.deepseek.com
```

使用火山方舟（豆包）时示例：

```env
DEEPSEEK_API_KEY=你的火山方舟APIKey
DEEPSEEK_MODEL=doubao-seed-character-260628
DEEPSEEK_BASE=https://ark.cn-beijing.volces.com/api/v3
```

`DEEPSEEK_BASE` 填写 API 根地址，不要带 `/chat/completions`；程序也兼容完整接口地址。

### 4. 提取微信密钥

`setup` 下载的 `weflow` 位于 `runtime/` 目录。用管理员身份打开终端：

Windows：

```powershell
.\runtime\weflow.exe key db
.\runtime\weflow.exe config set decrypt_key <数据库密钥>
.\runtime\weflow.exe key image
.\runtime\weflow.exe config set image_xor_key <图片XOR密钥>
.\runtime\weflow.exe config set image_aes_key <图片AES密钥>
```

macOS / Linux 使用对应命令，路径为 `./runtime/weflow`。

### 5. 打开网页

浏览器访问 `http://127.0.0.1:8787`。

## 使用说明

- 左侧选择会话，右侧查看聊天记录
- 收到对方新消息时自动生成回复建议
- 在「聊天对象指令」中输入要求并点「发送」，可多次追加
- 候选回复可编辑，点「确认发送」会粘贴到微信当前聊天并回车发送

## 配置说明

`.env` 常用项：

```env
PORT=8787
WEFLOW_PORT=5031
WEFLOW_TOKEN=weflow-local-token-2026
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE=https://api.deepseek.com
```

## 合规与风险提示

本工具仅用于处理你本人拥有且有权访问的微信数据。读取/解密微信本地数据库、提取密钥、模拟键盘发送消息可能违反微信用户协议，并可能带来账号风控或法律风险。请仅在你自己控制的设备上使用，遵守当地法律法规和微信规则。

本项目代码采用 MIT License。`weflow` 数据组件来自开源项目 [334456777/WeFlow](https://github.com/334456777/WeFlow)，其许可与说明以该仓库为准。

## 致谢与版权声明

- 作者：Chao Li（GitHub：[sunshine-ha](https://github.com/sunshine-ha)）
- 本项目代码以 MIT License 发布，版权归 Chao Li 所有。
- 数据引擎 `weflow` 来自开源项目 [334456777/WeFlow](https://github.com/334456777/WeFlow)，其许可与说明以该仓库为准。
- 感谢 WeFlow 社区以及 DeepSeek 提供的技术与服务。
