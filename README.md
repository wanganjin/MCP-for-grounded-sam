# MCP Vision Server - 视觉AI工具服务

这是一个基于 Model Context Protocol (MCP) 的视觉AI工具服务器，集成了 Grounded DINO、SAM 和 Stable Diffusion 等先进模型，提供目标检测、语义分割和图像修复等AI视觉能力。

## 🚀 功能特性

- **🎯 目标检测**: 基于文本提示检测图像中的物体，支持多标签检测
- **✂️ 语义分割**: 精确分割指定物体并生成掩码，支持交互式分割
- **🎨 图像修复**: 智能移除物体并用新内容填充，支持文本引导修复
- **🌐 MCP协议**: 完全兼容 Model Context Protocol 标准
- **🔧 多格式支持**: 支持本地图片和网络图片URL
- **⚡ 高性能**: 优化的图像处理和结果保存机制

## 📋 系统要求

- **Node.js**: >= 18.0.0
- **内存**: 建议 8GB+ RAM
- **存储**: 至少 2GB 可用空间
- **网络**: 需要访问 Gradio 服务器端点

## 🛠️ 安装

### 1. 克隆项目

```bash
git clone <repository-url>
cd MCP
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 构建项目

```bash
pnpm run build
```

## ⚙️ 配置

### 环境配置

在启动服务前，需要确保 Gradio 服务器正在运行。默认配置：

```typescript
const GRADIO_ENDPOINT_URL = "http://localhost:7589";
```

如需修改端点URL，请编辑 `src/server.ts` 文件中的 `GRADIO_ENDPOINT_URL` 常量。

### 输出目录配置

服务会自动创建以下输出目录结构：

```
output/
├── det/           # 目标检测结果
├── segmentation/  # 语义分割结果
└── inpainting/    # 图像修复结果
```

## 🚀 使用方法

### 启动服务

```bash
# 开发模式
pnpm run dev

# 生产模式
pnpm run build
pnpm start
```

### MCP 客户端集成

服务启动后，MCP 客户端可以通过标准 MCP 协议连接到服务器，使用以下工具：

#### 1. 目标检测工具 (`detect`)

```typescript
// 工具名称: detect
// 功能: 基于文本提示做目标检测并渲染框与标签

// 参数:
{
  "image": "网络图像URL或本地路径",
  "text_prompt": "英文目标标签，多个以 ' . ' 分隔",
  "box_threshold": 0.3,      // 可选，DINO 框过滤阈值
  "text_threshold": 0.25     // 可选，短语抽取阈值
}
```

#### 2. 语义分割工具 (`segment`)

```typescript
// 工具名称: segment
// 功能: 文本引导分割（抠图）：DINO 出框 → SAM 掩码 → 叠加

// 参数:
{
  "image": "网络图像URL或本地路径",
  "text_prompt": "英文目标标签，多个以 ' . ' 分隔",
  "box_threshold": 0.3,      // 可选
  "text_threshold": 0.25     // 可选
}
```

#### 3. 图像修复工具 (`inpaint`)

```typescript
// 工具名称: inpaint
// 功能: SAM 掩码 + Stable Diffusion 文本修复

// 参数:
{
  "image": "网络图像URL或本地路径",
  "text_prompt": "用于定位对象的英文文本",
  "inpaint_prompt": "修复成什么样子的英文文本",
  "box_threshold": 0.3,      // 可选
  "text_threshold": 0.25,    // 可选
  "inpaint_mode": "merge"    // 可选，"merge" 或 "first"
}
```

#### 4. 系统提示词工具 (`vision-tool-system`)

```typescript
// 工具名称: vision-tool-system
// 功能: 将用户需求转为英文参数，规范 text_prompt 标签

// 参数:
{
  "request": "用户的自然语言需求，可能是中文"
}
```

## 📁 输出格式

所有工具都返回标准 MCP 响应格式：

```typescript
{
  "content": [
    {
      "type": "text",
      "text": "已保存 X 个结果:\nfile:///path/to/result1.png\nfile:///path/to/result2.png"
    }
  ]
}
```

结果文件会自动保存到对应的输出目录，并以 `file://` 协议URL形式返回。

## 🔧 开发指南

### 项目结构

```
src/
├── server.ts          # 主服务器文件
├── types/             # 类型定义（如有）
└── utils/             # 工具函数（如有）

output/                # 输出目录
├── det/              # 检测结果
├── segmentation/      # 分割结果
└── inpainting/       # 修复结果
```

### 添加新工具

1. 在 `ToolRegistry` 类中添加新的注册方法
2. 实现工具逻辑
3. 在 `registerAllTools()` 中调用新方法
4. 更新相关文档

### 自定义配置

可以通过修改以下常量来自定义服务行为：

- `GRADIO_ENDPOINT_URL`: Gradio 服务器端点
- 输出目录路径
- 默认阈值参数

## 🐛 故障排除

### 常见问题

1. **连接失败**
   - 检查 Gradio 服务器是否正在运行
   - 验证端点URL是否正确
   - 确认网络连接正常

2. **图像处理失败**
   - 检查图像格式是否支持（PNG/JPG/JPEG/GIF/WEBP）
   - 确认图像文件存在且可访问
   - 验证图像大小是否合理

3. **内存不足**
   - 降低图像分辨率
   - 调整批处理大小
   - 增加系统内存

4. **模型加载慢**
   - 首次使用需要下载模型，请耐心等待
   - 检查网络连接速度
   - 考虑使用本地模型缓存

### 日志调试

服务运行时会输出详细日志，包括：
- 工具注册状态
- 图像处理进度
- 错误信息和堆栈跟踪

## 📄 许可证

本项目遵循各组件的原始许可证。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目！

## 📞 支持

如有问题或建议，请通过以下方式联系：

- 提交 GitHub Issue
- 发送邮件至 [your-email@example.com]
- 加入我们的讨论群组

---

**注意**: 使用本服务需要确保 Gradio 服务器正在运行，并且有足够的计算资源来处理AI模型推理。
