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
        this.isFilling = false;
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

        if (this.mode === "batch") {
            return [width, 0];
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
        // Get current mode
        const modeWidget = node.widgets.find(w => w.name === "mode");
        this.mode = modeWidget ? modeWidget.value : "single";

        if (this.mode === "batch") {
            return;
        }

        const topY = y;
        this.widgetTopY = topY;
        
        // Dynamic Height Logic:
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

        // --- Single Mode UI (Normal) ---
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
            { label: "Fill", id: "fill" },
            { label: "Brush", id: "brush" }
        ];
        const btnW = (drawWidth - 10) / btns.length;
        const btnH = 24;
        const btnY = toolbarY + 6;

        btns.forEach((btn, i) => {
            const bx = this.margin + 5 + i * btnW;
            const isSelected = (btn.id === "brush" && !this.isEraser && !this.isFilling) || 
                               (btn.id === "eraser" && this.isEraser) ||
                               (btn.id === "fill" && this.isFilling);
            
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
        if (this.mode === "batch") return false;
        
        const [x, y] = pos;
        if (this.widgetTopY === undefined || this.widgetHeight === undefined) return false;
        const localY = y - this.widgetTopY;
        
        // Fix for text overlap: respect top padding
        const topPadding = 20;
        
        // 1. Interacting with Toolbar
        if (localY < this.toolbarHeight + topPadding) {
            if (event.type === "pointerdown" || event.type === "mousedown") {
                const drawWidth = (this.widgetWidth || node.size[0]) - this.margin * 2;
                const btnsCount = 6;
                const btnW = (drawWidth - 10) / btnsCount;
                const btnY = 6 + topPadding;
                const btnX0 = this.margin + 5;
                
                // Button Detection
                if (localY >= btnY && localY <= btnY + 24 && x >= btnX0 && x <= btnX0 + btnW * btnsCount) {
                    const idx = Math.floor((x - btnX0) / btnW);
                    if (idx === 0) { console.log("[SGUNLoadImage] Action: Load Image"); this.uploadImage(); }
                    else if (idx === 1) { console.log("[SGUNLoadImage] Action: Clear Mask"); this.clear(); }
                    else if (idx === 2) { console.log("[SGUNLoadImage] Action: Undo"); this.undo(); }
                    else if (idx === 3) { console.log("[SGUNLoadImage] Tool: Eraser"); this.isEraser = true; this.isFilling = false; }
                    else if (idx === 4) { console.log("[SGUNLoadImage] Tool: Fill"); this.isEraser = false; this.isFilling = true; }
                    else if (idx === 5) { console.log("[SGUNLoadImage] Tool: Brush"); this.isEraser = false; this.isFilling = false; }
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
                    if (this.isFilling) {
                        this.saveHistory();
                        this.floodFill(Math.round(imgX), Math.round(imgY));
                        this.uploadMask();
                        node.setDirtyCanvas(true, true);
                    } else {
                        this.isDrawing = true;
                        this.saveHistory();
                        this.drawAt(imgX, imgY);
                        this.lastMousePos = [imgX, imgY];
                    }
                    return true;
                }
            } else if (event.type === "pointermove" || event.type === "mousemove") {
                if (this.isDrawing && !this.isFilling) {
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

    floodFill(startX, startY) {
        console.log(`[SGUNLoadImage] FloodFill started at (${startX}, ${startY}) with improved boundary logic`);
        const startTime = performance.now();
        const ctx = this.drawingCtx;
        const width = this.drawingCanvas.width;
        const height = this.drawingCanvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        const i = (startY * width + startX) * 4;
        const targetR = data[i];
        const targetG = data[i+1];
        const targetB = data[i+2];

        // Strict boundary threshold. Only stop at very bright pixels.
        // This allows the fill to pass through semi-transparent anti-aliased edges.
        const boundaryThreshold = 250; 

        if (targetR >= boundaryThreshold && targetG >= boundaryThreshold && targetB >= boundaryThreshold) {
            console.log("[SGUNLoadImage] FloodFill: Clicked on a boundary. Skipping.");
            return;
        }

        let pixelsFilled = 0;
        const stack = [startX, startY];
        const visited = new Uint8Array(width * height);
        const filledPixels = []; // Store filled pixels for dilation
        
        while (stack.length > 0) {
            const y = stack.pop();
            const x = stack.pop();
            
            const pos = y * width + x;
            if (visited[pos]) continue;
            visited[pos] = 1;

            const idx = pos * 4;
            const isBoundary = data[idx] >= boundaryThreshold && data[idx+1] >= boundaryThreshold && data[idx+2] >= boundaryThreshold;
            
            // We fill BOTH background and boundary pixels to ensure no gaps,
            // but we only continue recursion for NON-boundary pixels.
            data[idx] = 255;
            data[idx+1] = 255;
            data[idx+2] = 255;
            data[idx+3] = 255;
            pixelsFilled++;
            filledPixels.push(x, y);

            if (!isBoundary) {
                if (x > 0) { stack.push(x - 1); stack.push(y); }
                if (x < width - 1) { stack.push(x + 1); stack.push(y); }
                if (y > 0) { stack.push(x); stack.push(y - 1); }
                if (y < height - 1) { stack.push(x); stack.push(y + 1); }
            }
        }

        // Post-process: 1px Dilation to swallow any remaining sub-pixel gaps
        // We only dilate the newly filled pixels to avoid corrupting the whole mask
        const dilationBuffer = new Int32Array(filledPixels.length);
        for (let j = 0; j < filledPixels.length; j += 2) {
            const fx = filledPixels[j];
            const fy = filledPixels[j+1];
            
            const neighbors = [
                [fx-1, fy], [fx+1, fy], [fx, fy-1], [fx, fy+1]
            ];
            
            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = (ny * width + nx) * 4;
                    data[nIdx] = 255;
                    data[nIdx+1] = 255;
                    data[nIdx+2] = 255;
                    data[nIdx+3] = 255;
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const endTime = performance.now();
        console.log(`[SGUNLoadImage] FloodFill completed. Pixels filled: ${pixelsFilled}, Time: ${(endTime - startTime).toFixed(2)}ms`);
    }

    saveHistory() {
        this.history.push(this.drawingCanvas.toDataURL());
        if (this.history.length > 20) this.history.shift();
    }

    undo() {
        if (this.history.length > 0) {
            const last = this.history.pop();
            console.log(`[SGUNLoadImage] Undo: Restoring from history (remaining: ${this.history.length})`);
            const tempImg = new Image();
            tempImg.onload = () => {
                this.drawingCtx.globalCompositeOperation = "source-over";
                this.drawingCtx.clearRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
                this.drawingCtx.drawImage(tempImg, 0, 0);
                this.node.setDirtyCanvas(true, true);
                this.uploadMask();
            };
            tempImg.src = last;
        } else {
            console.log("[SGUNLoadImage] Undo: No history to restore.");
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
            console.log(`[SGUNLoadImage] Image loaded: ${this.img.width}x${this.img.height}`);
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
        console.log("[SGUNLoadImage] Uploading mask...");
        const blob = await canvasToBlob(this.drawingCanvas);
        const file = new File([blob], `mask_${Date.now()}.png`, { type: "image/png" });
        const body = new FormData();
        body.append("image", file);
        // body.append("subfolder", "masks"); // Removed to save in root, easier for backend to find
        try {
            const resp = await api.fetchApi("/upload/image", { method: "POST", body });
            const data = await resp.json();
            console.log(`[SGUNLoadImage] Mask uploaded successfully: ${data.name}`);
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
        } catch (e) {
            console.error("[SGUNLoadImage] Failed to upload mask:", e);
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
                const keep = ["mode", "image", "batch_path", "width", "height", "upscale_method", "keep_proportion", "crop_position", "divisible_by", "mask_data"];
                this.widgets = this.widgets.filter(w => keep.includes(w.name));
                
                // 2. Add our custom ImageBrushWidget
                const brushWidget = new ImageBrushWidget("painter", this);
                this.addCustomWidget(brushWidget);
                this.brushWidget = brushWidget;
                
                // 3. Setup Mode Toggle
                const modeWidget = this.widgets.find(w => w.name === "mode");
                const imageWidget = this.widgets.find(w => w.name === "image");
                const batchPathWidget = this.widgets.find(w => w.name === "batch_path");
                
                const imageWidgetType = imageWidget.type;
                const batchPathWidgetType = batchPathWidget.type;
                
                const updateVisibility = () => {
                    const isBatch = modeWidget.value === "batch";
                    brushWidget.mode = modeWidget.value; // Sync mode to brush widget

                    if (isBatch) {
                        imageWidget.type = "hidden";
                        batchPathWidget.type = batchPathWidgetType;
                    } else {
                        imageWidget.type = imageWidgetType;
                        batchPathWidget.type = "hidden";
                    }
                    
                    // Force node to recalculate its size based on new widget visibility and mode
                    this.setSize(this.computeSize());
                    this.setDirtyCanvas(true, true);
                };

                if (modeWidget) {
                    modeWidget.callback = () => {
                        updateVisibility();
                    };
                }

                // 4. Initial Load & Setup for Image Widget
                if (imageWidget) {
                    imageWidget.computeSize = () => [0, 26]; 
                    const originalCallback = imageWidget.callback;
                    imageWidget.callback = (v) => {
                        if (originalCallback) originalCallback.apply(imageWidget, [v]);
                        this.imgs = null;
                        this.images = null;
                        brushWidget.onImageChanged(v, true);
                    };
                    if (imageWidget.value) {
                        this.imgs = null;
                        this.images = null;
                        brushWidget.onImageChanged(imageWidget.value, false);
                    }
                }

                // 5. Hide mask_data widget
                const maskWidget = this.widgets.find(w => w.name === "mask_data");
                if (maskWidget) {
                    maskWidget.type = "hidden";
                    maskWidget.computeSize = () => [0, -4]; 
                    maskWidget.draw = () => {};
                }
                
                updateVisibility();
                this.onResize?.(this.size);
                this.setDirtyCanvas(true, true);
            }, 100);

            return r;
        };
    }
});
