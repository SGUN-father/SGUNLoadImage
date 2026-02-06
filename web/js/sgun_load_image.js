import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

console.log("[SGUNLoadImage] Initializing...");

async function canvasToBlob(canvas) {
    return new Promise((resolve) => {
        canvas.toBlob(resolve, "image/png");
    });
}

// --- Custom Widget Class ---
class ImageBrushWidget {
    constructor(name, node) {
        this.name = name;
        this.type = "custom";
        this.node = node;
        this.value = "";
        
        // Internal State
        this.brushSize = 80;
        this.brushOpacity = 0.5;
        this.isEraser = false;
        this.isDrawing = false;
        this.lastMousePos = null;
        this.history = [];
        this.canvasRect = { x: 0, y: 0, w: 0, h: 0 };
        
        // Image & Canvas
        this.img = new Image();
        this.drawingCanvas = document.createElement("canvas");
        this.drawingCtx = this.drawingCanvas.getContext("2d");
        
        // Toolbar Config
        this.toolbarHeight = 80;
        this.footerHeight = 25;
        this.margin = 10;
        this.desiredHeight = 520;
    }
    
    computeSize(width) {
        // Ensure width is valid
        if (!width || width < 100) {
            width = this.widgetWidth || 450;
        }

        // Fix for text overlap: Add top padding
        const topPadding = 20;

        let neededHeight = this.desiredHeight;
        
        if (this.img && this.img.width && this.img.height) {
            const aspect = this.img.width / this.img.height;
            const drawWidth = width - this.margin * 2;
            const imgHeight = drawWidth / aspect;
            neededHeight = this.toolbarHeight + this.footerHeight + this.margin * 3 + imgHeight + topPadding;
        }
        
        return [width, neededHeight];
    }

    draw(ctx, node, widget_width, y, widget_height) {
        const topY = y;
        this.widgetTopY = topY;
        
        // Dynamic Height Logic:
        // 1. Calculate the available space in the node (Node Height - Current Y - Footer/Margin)
        // 2. Use the LARGER of (allocated widget_height) and (available space)
        // This ensures that if the node is huge, the widget fills it, fixing the "Tiny Image" issue.
        const availableHeight = node.size[1] - y - 10; // 10 buffer
        this.widgetHeight = Math.max(widget_height, availableHeight);
        
        // Safety floor
        this.widgetHeight = Math.max(this.widgetHeight, this.toolbarHeight + this.footerHeight + 100);
        
        this.widgetWidth = widget_width;
        
        const topPadding = 20;
        
        // Draw Main Background
        ctx.save();
        ctx.fillStyle = "#222";
        ctx.fillRect(0, topY, widget_width, this.widgetHeight);

        const drawWidth = widget_width - this.margin * 2;
        const drawHeight = Math.max(0, this.widgetHeight - this.toolbarHeight - this.footerHeight - this.margin - topPadding);
        
        ctx.beginPath();

        // 1. Draw Toolbar
        const toolbarY = topY + topPadding;
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#181818";
        ctx.roundRect(this.margin, toolbarY, drawWidth, this.toolbarHeight, 4);
        ctx.fill();
        
        // Reset Shadow IMMEDIATELY to prevent bleeding into mask/image
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // 2. Draw Buttons
        const btns = [
            { label: "Load", id: "load" },
            { label: "Clear", id: "clear" },
            { label: "Undo", id: "undo" },
            { label: "Eraser", id: "eraser" },
            { label: "Brush", id: "brush" }
        ];
        const btnW = (drawWidth - 10) / btns.length;
        const btnH = 24;
        const btnY = toolbarY + 6;

        btns.forEach((btn, i) => {
            const bx = this.margin + 5 + i * btnW;
            const isSelected = (btn.id === "brush" && !this.isEraser) || (btn.id === "eraser" && this.isEraser);
            
            ctx.fillStyle = isSelected ? "#4a90e2" : "#333";
            ctx.beginPath();
            ctx.roundRect(bx + 2, btnY, btnW - 4, btnH, 3);
            ctx.fill();
            
            ctx.fillStyle = "#fff";
            ctx.font = "bold 10px Arial";
            ctx.textAlign = "center";
            ctx.fillText(btn.label, bx + btnW / 2, btnY + 16);
        });

        // 3. Draw Sliders
        const sliderY = btnY + 34;
        const sliderW = (drawWidth - 30) / 2;
        
        ctx.fillStyle = "#aaa";
        ctx.font = "10px Arial";
        ctx.textAlign = "left";
        ctx.fillText(`Size: ${this.brushSize}`, this.margin + 5, sliderY + 12);
        const sBarX = this.margin + 50;
        const sBarW = sliderW - 50;
        ctx.fillStyle = "#222";
        ctx.fillRect(sBarX, sliderY + 6, sBarW, 6);
        ctx.fillStyle = "#4a90e2";
        ctx.fillRect(sBarX, sliderY + 6, (this.brushSize / 200) * sBarW, 6);

        ctx.fillStyle = "#aaa";
        ctx.fillText(`Alpha: ${Math.round(this.brushOpacity * 100)}%`, this.margin + sliderW + 15, sliderY + 12);
        const oBarX = this.margin + sliderW + 75;
        const oBarW = sliderW - 75;
        ctx.fillStyle = "#222";
        ctx.fillRect(oBarX, sliderY + 6, oBarW, 6);
        ctx.fillStyle = "#4a90e2";
        ctx.fillRect(oBarX, sliderY + 6, this.brushOpacity * oBarW, 6);

        // 4. Draw Image Area
        const imgY = toolbarY + this.toolbarHeight + 5;
        if (this.img.complete && this.img.src && this.img.naturalWidth > 0) {
            const aspect = this.img.width / this.img.height;
            let dw = drawWidth;
            let dh = drawWidth / aspect;
            
            // Constrain to available area to prevent overflow
            if (dh > drawHeight) {
                dh = drawHeight;
                dw = dh * aspect;
            }
            
            const dx = this.margin + (drawWidth - dw) / 2;
            const dy = imgY; // Top align to avoid floating in the middle
            this.canvasRect = { x: dx, y: dy, w: dw, h: dh };

            // Image Shadow
            ctx.shadowColor = "rgba(0,0,0,0.5)";
            ctx.shadowBlur = 10;
            ctx.fillStyle = "#000";
            ctx.fillRect(dx, dy, dw, dh);
            
            // Reset Shadow AGAIN just to be sure
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            ctx.drawImage(this.img, dx, dy, dw, dh);
            
            // Mask Layer
            ctx.globalAlpha = this.brushOpacity;
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = this.drawingCanvas.width;
            tempCanvas.height = this.drawingCanvas.height;
            const tempCtx = tempCanvas.getContext("2d");
            tempCtx.drawImage(this.drawingCanvas, 0, 0);
            tempCtx.globalCompositeOperation = "source-in";
            tempCtx.fillStyle = "red";
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            ctx.drawImage(tempCanvas, dx, dy, dw, dh);
            ctx.globalAlpha = 1.0;
            
            ctx.strokeStyle = "#444";
            ctx.strokeRect(dx, dy, dw, dh);

            // 5. Resolution - Follow the image bottom
            ctx.fillStyle = "#888";
            ctx.font = "10px monospace";
            ctx.textAlign = "center";
            ctx.fillText(`${this.img.width} × ${this.img.height}PX`, widget_width / 2, dy + dh + 15);
        } else {
            ctx.fillStyle = "#111";
            ctx.fillRect(this.margin, imgY, drawWidth, drawHeight);
            ctx.fillStyle = "#444";
            ctx.textAlign = "center";
            ctx.fillText("NO IMAGE LOADED", widget_width / 2, imgY + drawHeight / 2);
        }
        ctx.restore();
    }

    mouse(event, pos, node) {
        const [x, y] = pos;
        if (this.widgetTopY === undefined || this.widgetHeight === undefined) return false;
        const localY = y - this.widgetTopY;
        
        // Fix for text overlap: respect top padding
        const topPadding = 20;
        
        // 1. Interacting with Toolbar
        if (localY < this.toolbarHeight + topPadding) {
            if (event.type === "pointerdown" || event.type === "mousedown") {
                const drawWidth = (this.widgetWidth || node.size[0]) - this.margin * 2;
                const btnW = (drawWidth - 10) / 5;
                const btnY = 6 + topPadding;
                const btnX0 = this.margin + 5;
                
                // Button Detection
                if (localY >= btnY && localY <= btnY + 24 && x >= btnX0 && x <= btnX0 + btnW * 5) {
                    const idx = Math.floor((x - btnX0) / btnW);
                    if (idx === 0) this.uploadImage();
                    else if (idx === 1) this.clear();
                    else if (idx === 2) this.undo();
                    else if (idx === 3) this.isEraser = true;
                    else if (idx === 4) this.isEraser = false;
                    node.setDirtyCanvas(true, true);
                    return true;
                }
                
                // Slider Detection
                const sliderY = btnY + 34;
                const sliderW = (drawWidth - 30) / 2;
                if (localY >= sliderY && localY <= sliderY + 20) {
                    if (x < node.size[0] / 2) {
                        const sBarX = this.margin + 50;
                        const sBarW = sliderW - 50;
                        const sizeRatio = Math.max(0, Math.min(1, (x - sBarX) / sBarW));
                        this.brushSize = Math.max(1, Math.min(200, Math.round(sizeRatio * 200)));
                    } else {
                        const oBarX = this.margin + sliderW + 75;
                        const oBarW = sliderW - 75;
                        const opacityRatio = Math.max(0, Math.min(1, (x - oBarX) / oBarW));
                        this.brushOpacity = Math.max(0.1, Math.min(1.0, opacityRatio));
                    }
                    node.setDirtyCanvas(true, true);
                    return true;
                }
            }
            return false;
        }

        // 2. Interacting with Canvas
        if (this.canvasRect && this.img.src) {
            const { x: rx, y: ry, w: rw, h: rh } = this.canvasRect;
            
            // Map Screen Coords to Image Coords
            const scaleX = this.drawingCanvas.width / rw;
            const scaleY = this.drawingCanvas.height / rh;
            const imgX = (x - rx) * scaleX;
            const imgY = (y - ry) * scaleY;

            if (event.type === "pointerdown" || event.type === "mousedown") {
                if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
                    this.isDrawing = true;
                    this.saveHistory();
                    this.drawAt(imgX, imgY);
                    this.lastMousePos = [imgX, imgY];
                    return true;
                }
            } else if (event.type === "pointermove" || event.type === "mousemove") {
                if (this.isDrawing) {
                    this.drawAt(imgX, imgY, this.lastMousePos);
                    this.lastMousePos = [imgX, imgY];
                    node.setDirtyCanvas(true, true);
                    return true;
                }
            } else if (event.type === "pointerup" || event.type === "mouseup") {
                if (this.isDrawing) {
                    this.isDrawing = false;
                    this.uploadMask();
                    node.setDirtyCanvas(true, true);
                    return true;
                }
            }
        }
        return false;
    }

    drawAt(x, y, lastPos = null) {
        const ctx = this.drawingCtx;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = this.brushSize;
        
        if (this.isEraser) {
            ctx.globalCompositeOperation = "destination-out";
        } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = "white"; // Corrected to white for masks
        }

        ctx.beginPath();
        if (lastPos) {
            ctx.moveTo(lastPos[0], lastPos[1]);
        } else {
            ctx.moveTo(x, y);
        }
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    saveHistory() {
        this.history.push(this.drawingCanvas.toDataURL());
        if (this.history.length > 20) this.history.shift();
    }

    undo() {
        if (this.history.length > 0) {
            const last = this.history.pop();
            const tempImg = new Image();
            tempImg.onload = () => {
                this.drawingCtx.clearRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
                this.drawingCtx.drawImage(tempImg, 0, 0);
                this.node.setDirtyCanvas(true, true);
                this.uploadMask();
            };
            tempImg.src = last;
        }
    }

    clear() {
        this.saveHistory();
        this.drawingCtx.clearRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
        this.node.setDirtyCanvas(true, true);
        this.uploadMask();
    }

    uploadImage() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            const body = new FormData();
            body.append("image", file);
            const resp = await api.fetchApi("/upload/image", { method: "POST", body });
            const data = await resp.json();
            const imageWidget = this.node.widgets.find(w => w.name === "image");
            if (imageWidget) {
                imageWidget.value = data.name;
                this.onImageChanged(data.name, true);
            }
        };
        input.click();
    }

    onImageChanged(name, resetMask = false) {
        if (!name) return;
        console.log(`[SGUNLoadImage] onImageChanged: ${name}, resetMask: ${resetMask}`);
        
        // Clear previous state when switching images
        this.history = [];
        this.drawingCtx.clearRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
        
        const maskWidget = this.node.widgets.find(w => w.name === "mask_data");

        // Only clear mask data if explicitly requested (e.g. user uploaded new image)
        if (resetMask) {
            if (maskWidget) {
                maskWidget.value = "";
            }
            // Also ensure we don't load a mask in the onload callback
            this.pendingMaskReset = true;
        } else {
            this.pendingMaskReset = false;
        }

        this.img.src = api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&t=${Date.now()}`);
        this.img.onerror = () => {
            console.error(`[SGUNLoadImage] Failed to load image/video: ${name}. Note: Videos are not supported for masking.`);
            this.node.setDirtyCanvas(true, true);
        };
        this.img.onload = () => {
            // Reset canvas size to match new image
            this.drawingCanvas.width = this.img.width;
            this.drawingCanvas.height = this.img.height;
            
            // Only load mask if it exists AND we haven't just cleared it for a new image.
            // But wait, if we are loading a workflow, mask_data might have a value we WANT to load.
            // How to distinguish "User changed image via upload" vs "Workflow loaded"?
            // For now, if mask_data is empty (which we just set), it won't load, which is correct for new image.
            // If we are loading from workflow, onNodeCreated -> onImageChanged happens, but mask_data might be populated.
            
            // Actually, we should check if mask_data matches the current image or if it's just a leftover.
            // Since we can't easily link them, the safest bet for "User changed image" is to clear it.
            // But for "Workflow Load", we want to keep it.
            // The `imageWidget.callback` triggers this. When loading a workflow, callback might trigger.
            
            // Let's rely on the fact that we just cleared maskWidget.value above.
            // So if this was triggered by user interaction (upload), mask is gone.
            // If it's a workflow load, `onNodeCreated` runs.
            // Wait, `onNodeCreated` runs `brushWidget.onImageChanged(imageWidget.value)`.
            // If I clear it here, I lose saved masks!
            
            // REVISION: Only clear mask if the image NAME has actually changed?
            // But `onImageChanged` is called with the new name.
            
            // Let's check if we should load the mask.
            if (!this.pendingMaskReset && maskWidget && maskWidget.value) {
                 this.loadMask(maskWidget.value);
            }
            this.pendingMaskReset = false; // Reset for next time
            
            // Auto-resize node to fit image
            if (this.node) {
                // Use computeSize to let the node calculate its total required size
                // We trust node.computeSize() now because we fixed imageWidget.computeSize
                this.node.setSize(this.node.computeSize());
            }
            
            this.node.setDirtyCanvas(true, true);
        };
    }

    loadMask(name) {
        const maskImg = new Image();
        maskImg.onerror = () => {
            console.error(`[SGUNLoadImage] Failed to load mask: ${name}`);
        };
        maskImg.onload = () => {
            if (maskImg.naturalWidth > 0) {
                this.drawingCtx.clearRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
                this.drawingCtx.drawImage(maskImg, 0, 0);
                this.node.setDirtyCanvas(true, true);
            }
        };
        maskImg.src = api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&subfolder=masks&t=${Date.now()}`);
    }

    async uploadMask() {
        if (!this.drawingCanvas.width) return;
        const blob = await canvasToBlob(this.drawingCanvas);
        const file = new File([blob], `mask_${Date.now()}.png`, { type: "image/png" });
        const body = new FormData();
        body.append("image", file);
        // body.append("subfolder", "masks"); // Removed to save in root, easier for backend to find
        const resp = await api.fetchApi("/upload/image", { method: "POST", body });
        const data = await resp.json();
        const maskWidget = this.node.widgets.find(w => w.name === "mask_data");
        if (maskWidget) {
            maskWidget.value = data.name;
        } else {
            console.warn("[SGUNLoadImage] mask_data widget not found! Creating it now to ensure data persistence.");
            const w = this.node.addWidget("text", "mask_data", data.name, (v)=>{}, { serialize: true });
            w.computeSize = () => [0, -4]; 
            w.type = "hidden";
            w.draw = () => {};
        }
    }
}

// --- Main Extension Registration ---
app.registerExtension({
    name: "Comfy.SGUNLoadImage",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "SGUNLoadImage") return;

        // Hook Prototype
        const onNodeCreated = nodeType.prototype.onNodeCreated;

        // Force clear images to prevent default ComfyUI preview
        const onDrawBackground = nodeType.prototype.onDrawBackground;
        nodeType.prototype.onDrawBackground = function(ctx) {
            this.imgs = null;
            this.images = null;
            if (onDrawBackground) {
                return onDrawBackground.apply(this, arguments);
            }
        };

        // Also hook onExecute to clear images immediately after execution
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            if (onExecuted) onExecuted.apply(this, arguments);
            this.imgs = null;
            this.images = null;
        };

        nodeType.prototype.onNodeCreated = function() {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            console.log("[SGUNLoadImage] Node Instance Created. ID:", this.id);

            // 1. Cleanup Redundant Widgets (ComfyUI internal preview)
            setTimeout(() => {
                const keep = ["image", "width", "height", "upscale_method", "keep_proportion", "crop_position", "divisible_by", "mask_data"];
                this.widgets = this.widgets.filter(w => keep.includes(w.name));
                
                // 2. Add our custom ImageBrushWidget
                const brushWidget = new ImageBrushWidget("painter", this);
                this.addCustomWidget(brushWidget);
                this.brushWidget = brushWidget;
                
                // 3. Initial Load
                const imageWidget = this.widgets.find(w => w.name === "image");
                if (imageWidget) {
                    // Prevent standard image widget from taking huge space, but reserve space for filename text
                    // 20px is standard height for text widgets. 
                    imageWidget.computeSize = () => [0, 26]; 
                    
                    const originalCallback = imageWidget.callback;
                    imageWidget.callback = (v) => {
                        if (originalCallback) originalCallback.apply(imageWidget, [v]);
                        // Completely clear images to prevent default drawing
                        this.imgs = null;
                        this.images = null;
                        brushWidget.onImageChanged(v, true); // true = reset mask
                    };
                    if (imageWidget.value) {
                        this.imgs = null;
                        this.images = null;
                        brushWidget.onImageChanged(imageWidget.value, false); // false = don't reset mask (load from workflow)
                    }
                }

                // 4. Hide mask_data widget completely
                const maskWidget = this.widgets.find(w => w.name === "mask_data");
                if (maskWidget) {
                    maskWidget.type = "hidden";
                    maskWidget.computeSize = () => [0, -4]; 
                    maskWidget.draw = () => {}; // Never draw it
                }
                
                // Force initial resize
                this.onResize?.(this.size);
                this.setDirtyCanvas(true, true);
            }, 100);

            return r;
        };
    }
});
