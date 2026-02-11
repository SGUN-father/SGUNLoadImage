# SGUNLoadImage (Resizable & Maskable) for ComfyUI

[中文说明](#chinese) | [English Description](#english)

<a name="chinese"></a>
## 🇨🇳 中文说明 (Chinese)

### 主要特性
- 🎨 **内置遮罩编辑**：`single` 模式支持直接涂抹、撤销、清空及画笔调节。
- 🧽 **区域填充 (Fill)**：支持先勾勒轮廓后一键填充，大幅提升遮罩效率。
- 📦 **批量与 ZIP 上传**：`batch` 模式支持文件夹路径或直接上传 `.zip`。
- 🌍 **跨平台兼容**：完美支持本地 (Windows) 与云端 (Linux) 环境，路径自动识别。
- 📏 **智能对齐与缩放**：
  - **自动对齐**：批量模式自动统一图片尺寸，防止张量合并报错。
  - **短边缩放**：支持按短边像素等比缩放 (`resize_short_side`)。
- 🖥️ **动态 UI**：根据模式自动隐藏/显示相关组件，保持界面清爽。
<img width="2344" height="1314" alt="微信图片_20260211164225_17707_1072" src="https://github.com/user-attachments/assets/55e47b0b-4e05-4429-8c28-6db6e045b5f1" />

### 安装与使用
1. `git clone` 仓库至 `custom_nodes` 目录。
2. **模式选择**：`single` 用于单图编辑，`batch` 用于批量加载。
3. **ZIP 上传**：批量模式点击底部按钮上传，文件名自动填入路径框。
4. **填充遮罩**：使用 `Brush` 画出闭合圈，切换 `Fill` 点击内部即可。

---

<a name="english"></a>
## 🇺🇸 English Description (English)

### Key Features
- 🎨 **Built-in Mask Editor**: Supports drawing, undo, clear, and brush settings in `single` mode.
- 🧽 **Area Fill**: Draw an outline and fill it with one click, significantly boosting efficiency.
- 📦 **Batch & ZIP Upload**: Supports folder paths or direct `.zip` uploads in `batch` mode.
- 🌍 **Cross-Platform**: Fully compatible with Local (Windows) and Cloud (Linux) environments.
- 📏 **Smart Alignment & Scaling**:
  - **Auto-Alignment**: Uniforms image sizes in batch mode to prevent tensor errors.
  - **Short-Side Scaling**: Proportional scaling based on target short-side pixels.
- 🖥️ **Dynamic UI**: Automatically hides/shows widgets based on mode to keep UI clean.
<img width="2344" height="1314" alt="微信图片_20260211164225_17707_1072" src="https://github.com/user-attachments/assets/541bd4ce-b0c3-48da-9b60-8158c67906b6" />

### Installation & Usage
1. `git clone` the repo into your `custom_nodes` folder.
2. **Modes**: Use `single` for image editing and `batch` for bulk loading.
3. **ZIP Upload**: Click the upload button in batch mode; the filename auto-fills the path.
4. **Mask Filling**: Draw a closed shape with `Brush`, switch to `Fill`, and click inside.
