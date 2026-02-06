# SGUNLoadImage (Resizable & Maskable) for ComfyUI

这是一个专为 ComfyUI 打造的高级图像加载节点，集成了**动态尺寸调整**、**多种比例保持模式**以及**内置笔刷遮罩（Mask）**编辑功能。

## 主要特性

- 🎨 **内置遮罩编辑器**：直接在节点上进行涂抹，支持撤销（Undo）、清空（Clear）、画笔大小与不透明度调节，无需切换外部节点。
- 📏 **动态尺寸调节**：支持自定义输出宽高（默认 720x1280），并提供多种比例保持方案：
  - **Crop (默认)**：自动裁剪以适配目标比例。
  - **Stretch**：拉伸图像填充。
  - **Pad**：等比例缩放并填充黑边。
- 🔄 **智能重采样**：内置多种缩放算法（Nearest, Bilinear, Bicubic, Lanczos 等），确保画质清晰。
- 🧩 **高度集成**：单节点完成“加载+调整+遮罩”全流程，极大简化了工作流布局。

## 安装方法

1. 进入 ComfyUI 的 `custom_nodes` 目录：
   ```bash
   cd ComfyUI/custom_nodes/
   ```
2. 克隆本仓库：
   ```bash
   git clone https://github.com/YourUsername/ImageBrushResizable.git
   ```
3. 重启 ComfyUI。

## 使用说明

1. 在 ComfyUI 中搜索并添加 `SGUNLoadImage` 节点。
2. **加载图片**：通过节点上的 `Load` 按钮或 `image` 下拉菜单选择图片。
3. **编辑遮罩**：直接在节点预览图上涂抹。
   - 使用 `Brush` 和 `Eraser` 切换画笔与橡皮擦。
   - 通过 `Size` 滑块调整画笔粗细。
   - 通过 `Alpha` 滑块调整预览遮罩的显示透明度。
   - 使用 `Undo` 撤销上一步操作。
4. **调整尺寸**：设置所需的 `width` 和 `height`，并选择合适的 `keep_proportion` 模式。

## 节点参数说明

- **image**: 选择要加载的图像。
- **width/height**: 输出图像的目标分辨率（默认 720x1280）。
- **upscale_method**: 缩放时使用的采样算法。
- **keep_proportion**: 
  - `crop`: 居中裁剪以匹配比例。
  - `stretch`: 非等比拉伸。
  - `pad`: 等比缩放，不足部分补黑边。
- **divisible_by**: 确保输出宽高能被该数值整除（默认 2）。

## 许可证

MIT License
