# Pro Watermark

一款隐私优先的照片加水印工具。给照片加文字或 Logo 水印的同时，**保留原图元数据与完整分辨率**——全程在浏览器本地完成，图片绝不上传服务器。

[English](README.md) · **简体中文** · [日本語](README.ja.md)

🔗 **在线体验：** https://pro-watermark.vercel.app/

---

## 功能特性

- **文字 / Logo 水印** —— 输入文字，或上传 PNG/SVG Logo。
- **完全可控** —— 9 个预设位置 + 自由拖拽、旋转、大小、不透明度、颜色（预设 + 自定义取色）。
- **每张图独立设置** —— 批量里每张照片各自保留独立的水印状态，改一张不影响另一张。
- **批量处理** —— 一次处理多张照片。
- **支持 iPhone HEIC** —— HEIC/HEIF 照片自动解码。
- **无损保留元数据** —— 把原图的 EXIF / ICC 色彩配置无损缝回导出图。
- **自动排到相册最前** —— 导出时把 EXIF 拍摄时间刷新为当下，成品图落在相册最新位置；并复位方向标记，避免手机二次旋转。
- **直接存进相册** —— 手机端通过系统分享面板「存储图像」存入相册，电脑端则下载。
- **视觉无损导出** —— 完整原始分辨率，JPEG 质量 0.95，无黑边。
- **多语言** —— English / 简体中文 / 日本語。
- **精致动效与交互** —— 滑动的 Tab/位置选择、缩略图平滑增删、极光氛围背景、有仪式感的导出进度环，以及错误兜底（页面永不白屏）。

> **关于「无损」：** 任何"在画布上合成水印"的工具都必然重新编码一次图像，因此这里是 **元数据无损 + 视觉无损（质量 0.95）**，并非逐字节相同。原始 EXIF/ICC 完整保留，分辨率绝不缩水。

## 工作原理

全部在**浏览器本地**运行：解码照片 → 在画布上绘制水印 → 重新编码为 JPEG，然后在二进制层面把原图的元数据段（EXIF/ICC）精确缝回新 JPEG，仅调整拍摄时间和方向。你的图片**永不离开设备**——当照片里有人物（比如学生）时，这是实打实的优势。

## 技术栈

- **React 18** + **TypeScript**
- **Rspack**（SWC）构建
- **Fabric.js v6** 画布编辑器
- **Effect** 图像处理流水线
- **Tailwind CSS** 样式
- **Framer Motion** 动效，**Vaul** 移动端抽屉
- **i18next** 多语言，**lucide-react** 图标
- **heic-to** HEIC 解码
- **Vitest** 测试，**Biome** lint/格式化
- **Vercel** 托管（含 Analytics 与 Speed Insights）

## 快速开始

```bash
npm install
npm run dev      # 启动开发服务器 http://localhost:8080
```

### 脚本命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建到 `dist/` |
| `npm run test` | 运行单元测试（Vitest） |
| `npm run lint` | 用 Biome 检查 |
| `npm run format` | 用 Biome 格式化 |
| `npm run check` | Biome 检查 + 格式校验 |

## 项目结构

采用 Feature-Sliced Design：

```
src/
  app/        应用入口、根状态、全局样式
  features/   画布编辑器与编辑器布局
  entities/   水印领域类型与几何计算
  kernel/     二进制元数据手术与处理流水线
  shared/     i18n、共享 UI（错误边界）
```

## 部署

托管在 Vercel。

## 许可

私有 / 个人项目。
