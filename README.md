# SGUNLoadImage (Resizable & Maskable) for ComfyUI

这是一个专为 ComfyUI 打造的高级图像加载节点，集成了**动态尺寸调整**、**多种比例保持模式**以及**内置笔刷遮罩（Mask）**编辑功能。

## 主要特性

- 🎨 **内置遮罩编辑器**：在 `single`模式下直接在节点上进行涂抹，支持撤销（Undo）、清空（Clear）、画笔大小与不透明度调节。
- 🧽 **新增：填充遮罩 (Fill Mask)**：支持“先画框后填充”功能。使用画笔画出闭合区域后，切换至 **Fill** 工具点击区域内部，即可自动填充。算法内置了自动扩张（Dilation）和颜色容差处理，确保填充区域无缝覆盖。
- 📦 **新增：批量加载模式**：支持通过 `batch` 模式一次性加载整个文件夹或 `.zip` 压缩包中的图片。
  - **文件夹支持**：自动扫描指定路径下的所有图片。
  - **Zip 支持**：直接读取压缩包内容，无需手动解压。
- 🖥️ **智能 UI 交互**：
  - 批量模式下自动隐藏预览与画笔区域，节点高度自动收缩，节省工作流空间。
  - 单图模式下自动恢复所有编辑工具。
- 📏 **动态尺寸调节**：支持自定义输出宽高（默认 720x1280），并提供多种比例保持方案：
  - **Crop (默认)**：自动裁剪以适配目标比例。
  - **Stretch**：拉伸图像填充。
  - **Pad**：等比例缩放并填充黑边。
- 🔄 **智能重采样**：内置多种缩放算法（Nearest, Bilinear, Bicubic, Lanczos 等），确保画质清晰。
- 🧩 **高度集成**：单节点完成“加载+调整+遮罩”全流程，极大简化了工作流布局。
<img width="1838" height="1434" alt="c498d8e0-7ccf-4b61-abc9-3f3774cd7e60" src="https://github.com/user-attachments/assets/0c1d907b-8eb9-4f27-947d-bb69c0281a89" />

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
2. **选择模式** (`mode`)：
   - `single`：单张图片加载，支持遮罩编辑。
   - `batch`：批量加载，支持路径或 Zip 文件。
3. **单图模式**：
   - 通过 `Load` 按钮或 `image` 菜单选择图片。
   - 直接在预览图上涂抹编辑遮罩。
42→   - 使用 `Brush` 和 `Eraser` 切换工具，`Undo` 撤销，`Size/Alpha` 调节。
43→   - **填充技巧**：先用 `Brush` 勾勒出一个闭合的轮廓，然后点击 `Fill` 按钮，再点击轮廓内部即可完成大面积填充。
44→4. **批量模式**：
   - 在 `batch_path` 中填入文件夹路径（如 `D:\photos`）或 Zip 路径。
   - 节点将自动收缩，不显示预览区域以节省空间。
5. **通用设置**：设置所需的 `width` 和 `height`，并选择合适的 `keep_proportion` 模式。

## 节点参数说明

- **mode**: 加载模式（single/batch）。
- **image**: (单图模式) 选择要加载的图像。
- **batch_path**: (批量模式) 输入文件夹或 Zip 文件的绝对路径。
- **width/height**: 输出图像的目标分辨率（默认 720x1280）。
- **upscale_method**: 缩放时使用的采样算法。
- **keep_proportion**: 
  - `crop`: 居中裁剪以匹配比例。
  - `stretch`: 非等比拉伸。
  - `pad`: 等比缩放，不足部分补黑边。
- **divisible_by**: 确保输出宽高能被该数值整除（默认 2）。

