import os
import torch
import numpy as np
import hashlib
from PIL import Image, ImageOps, ImageSequence
import folder_paths
import zipfile
import io

def get_full_batch_path(p):
    if not p: return None
    
    # Normalize path
    p = p.strip().strip('"')
    
    # 1. Try relative to ComfyUI input directory first (Highest compatibility for Cloud/Local)
    # This handles cases where a filename is stored, or a path relative to input
    input_dir = folder_paths.get_input_directory()
    joined_path = os.path.join(input_dir, p)
    if os.path.exists(joined_path):
        return joined_path
    
    # 2. Try as absolute path (For local fixed paths)
    if os.path.isabs(p) and os.path.exists(p):
        return p
        
    # 3. Handle potential OS path separator differences (Cloud is often Linux, Local often Windows)
    # If the stored path contains \ but we are on Linux, or / but we are on Windows
    p_normalized = p.replace("\\", "/").replace("/", os.sep)
    joined_normalized = os.path.join(input_dir, p_normalized)
    if os.path.exists(joined_normalized):
        return joined_normalized

    return None # Return None if not found so we can raise a clear exception

class SGUNLoadImage:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        # Define supported image extensions
        supported_extensions = ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif')
        files = [f for f in os.listdir(input_dir) 
                 if os.path.isfile(os.path.join(input_dir, f)) 
                 and f.lower().endswith(supported_extensions)]
        return {
            "required": {
                "mode": (["single", "batch"], {"default": "single"}),
                "image": (sorted(files), {"image_upload": True}),
                "batch_path": ("STRING", {"default": ""}),
                "width": ("INT", {"default": 720, "min": 1, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1280, "min": 1, "max": 8192, "step": 1}),
                "resize_short_side": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
                "upscale_method": (["nearest-exact", "bilinear", "area", "bicubic", "lanczos"],),
                "keep_proportion": (["crop", "stretch", "pad"],),
                "crop_position": (["center", "top", "bottom", "left", "right"], {"default": "center"}),
                "divisible_by": ("INT", {"default": 2, "min": 1, "max": 64, "step": 1}),
            },
            "hidden": {
                "mask_data": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "MASK", "width", "height")
    FUNCTION = "load_image"
    CATEGORY = "image"
    TITLE = "SGUNLoadImage"

    def load_image(self, mode, image, batch_path, width, height, resize_short_side, upscale_method, keep_proportion, crop_position, divisible_by, mask_data=""):
        # Mapping upscale methods to PIL Resampling filters
        resample_map = {
            "nearest-exact": Image.NEAREST,
            "bilinear": Image.BILINEAR,
            "area": Image.BOX,
            "bicubic": Image.BICUBIC,
            "lanczos": Image.LANCZOS,
        }
        resample = resample_map.get(upscale_method, Image.BICUBIC)

        # Base target dimensions (will be overridden if resize_short_side > 0)
        target_width = width
        target_height = height

        images_to_load = []
        if mode == "single":
            image_path = folder_paths.get_annotated_filepath(image)
            images_to_load.append(("path", image_path))
        else:
            if not batch_path:
                raise Exception("Batch path is empty")
            
            full_path = get_full_batch_path(batch_path)
            
            if full_path is None:
                raise Exception(f"Batch path does not exist: {batch_path}")
            
            if os.path.isdir(full_path):
                for f in sorted(os.listdir(full_path)):
                    if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp')):
                        images_to_load.append(("path", os.path.join(full_path, f)))
            elif zipfile.is_zipfile(full_path):
                with zipfile.ZipFile(full_path, 'r') as z:
                    for f in sorted(z.namelist()):
                        if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp')):
                            images_to_load.append(("zip", (full_path, f)))
            else:
                raise Exception(f"Invalid batch path: {batch_path}. Path not found or not a directory/zip.")

        if not images_to_load:
            raise Exception("No images found to load.")

        # Handle external mask from frontend (brush data) - ONLY for single mode
        external_mask = None
        if mode == "single" and mask_data:
            try:
                mask_path = folder_paths.get_annotated_filepath(mask_data)
                if os.path.exists(mask_path):
                    mask_img = Image.open(mask_path)
                    if "A" in mask_img.getbands():
                        external_mask = np.array(mask_img.getchannel("A")).astype(np.float32) / 255.0
                    else:
                        external_mask = np.array(mask_img.convert("L")).astype(np.float32) / 255.0
            except Exception as e:
                print(f"Error loading external mask: {e}")

        output_images = []
        output_masks = []
        
        for img_type, img_info in images_to_load:
            if img_type == "path":
                img = Image.open(img_info)
            else: # zip
                z_path, z_file = img_info
                with zipfile.ZipFile(z_path, 'r') as z:
                    with z.open(z_file) as f:
                        img = Image.open(io.BytesIO(f.read()))

            for i in ImageSequence.Iterator(img):
                i = ImageOps.exif_transpose(i)
                if i.mode == 'I':
                    i = i.point(lambda i: i * (1 / 255))
                
                # 1. Prepare Image
                image_rgb = i.convert("RGB")
                
                # 2. Prepare Mask
                if external_mask is not None:
                    current_mask_pil = Image.fromarray((external_mask * 255).astype(np.uint8), mode='L')
                    if current_mask_pil.size != image_rgb.size:
                        current_mask_pil = current_mask_pil.resize(image_rgb.size, resample=Image.BILINEAR)
                elif "A" in i.getbands():
                    alpha = np.array(i.getchannel("A")).astype(np.float32) / 255.0
                    current_mask_pil = Image.fromarray(((1.0 - alpha) * 255).astype(np.uint8), mode='L')
                else:
                    current_mask_pil = Image.new("L", image_rgb.size, 0)

                # 3. Consistent Resize for both Image and Mask
                # Determine target dimensions for THIS image
                this_target_width, this_target_height = target_width, target_height
                if resize_short_side > 0:
                    w, h = image_rgb.size
                    if w < h: # Portrait
                        this_target_width = resize_short_side
                        this_target_height = int(h * (resize_short_side / w))
                    else: # Landscape or square
                        this_target_height = resize_short_side
                        this_target_width = int(w * (resize_short_side / h))
                
                # Ensure dimensions are divisible
                this_target_width = (this_target_width // divisible_by) * divisible_by
                this_target_height = (this_target_height // divisible_by) * divisible_by

                # IMPORTANT: In batch mode, if we're not using resize_short_side, 
                # all images MUST be the same size to be concatenated.
                # If they aren't, we force them to the size of the first image in the batch.
                if mode == "batch" and resize_short_side == 0:
                    if output_images:
                        # Use the size of the first image already in output_images
                        # Image tensor shape is [B, H, W, C]
                        first_img = output_images[0]
                        this_target_height = first_img.shape[1]
                        this_target_width = first_img.shape[2]

                image_rgb, current_mask_pil = self.apply_resize(
                    image_rgb, current_mask_pil, this_target_width, this_target_height, resample, keep_proportion, crop_position
                )
                
                # 4. Convert to Tensors
                # We update the actual width/height for the FIRST image processed to return in output
                if not output_images:
                    final_width, final_height = this_target_width, this_target_height
                
                image_tensor = np.array(image_rgb).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(image_tensor)[None,]
                
                mask_tensor = np.array(current_mask_pil).astype(np.float32) / 255.0
                # Mask tensor should be [B, H, W] for ComfyUI
                mask_tensor = torch.from_numpy(mask_tensor)[None,]

                output_images.append(image_tensor)
                output_masks.append(mask_tensor)

        if not output_images:
            raise Exception("No valid images processed.")

        # Ensure all images and masks have the same dimensions before concatenation
        # This is a double-check for the loop logic above
        first_img_shape = output_images[0].shape
        first_mask_shape = output_masks[0].shape
        
        for i in range(len(output_images)):
            if output_images[i].shape != first_img_shape:
                print(f"[SGUNLoadImage] Warning: Image {i} size mismatch. Resizing from {output_images[i].shape} to {first_img_shape}")
                # output_images[i] is [1, H, W, C], torch interpolate expects [B, C, H, W]
                tmp = output_images[i].permute(0, 3, 1, 2)
                tmp = torch.nn.functional.interpolate(tmp, size=(first_img_shape[1], first_img_shape[2]), mode='bilinear')
                output_images[i] = tmp.permute(0, 2, 3, 1)
            
            if output_masks[i].shape != first_mask_shape:
                print(f"[SGUNLoadImage] Warning: Mask {i} size mismatch. Resizing from {output_masks[i].shape} to {first_mask_shape}")
                # output_masks[i] is [1, H, W], torch interpolate expects [B, C, H, W]
                tmp = output_masks[i].unsqueeze(1) # [1, 1, H, W]
                tmp = torch.nn.functional.interpolate(tmp, size=(first_mask_shape[1], first_mask_shape[2]), mode='bilinear')
                output_masks[i] = tmp.squeeze(1) # [1, H, W]

        output_image = torch.cat(output_images, dim=0)
        output_mask = torch.cat(output_masks, dim=0)

        return (output_image, output_mask, final_width, final_height)

    def apply_resize(self, image, mask, target_width, target_height, resample, keep_proportion, crop_position):
        orig_width, orig_height = image.size

        if keep_proportion == "stretch":
            image = image.resize((target_width, target_height), resample=resample)
            mask = mask.resize((target_width, target_height), resample=resample)
        
        elif keep_proportion == "crop":
            ratio = max(target_width / orig_width, target_height / orig_height)
            new_width = int(orig_width * ratio)
            new_height = int(orig_height * ratio)
            image = image.resize((new_width, new_height), resample=resample)
            mask = mask.resize((new_width, new_height), resample=resample)
            
            if crop_position == "center":
                left = (new_width - target_width) // 2
                top = (new_height - target_height) // 2
            elif crop_position == "top":
                left = (new_width - target_width) // 2
                top = 0
            elif crop_position == "bottom":
                left = (new_width - target_width) // 2
                top = new_height - target_height
            elif crop_position == "left":
                left = 0
                top = (new_height - target_height) // 2
            elif crop_position == "right":
                left = new_width - target_width
                top = (new_height - target_height) // 2
            else: # default center
                left = (new_width - target_width) // 2
                top = (new_height - target_height) // 2

            image = image.crop((left, top, left + target_width, top + target_height))
            mask = mask.crop((left, top, left + target_width, top + target_height))
            
        elif keep_proportion == "pad":
            ratio = min(target_width / orig_width, target_height / orig_height)
            new_width = int(orig_width * ratio)
            new_height = int(orig_height * ratio)
            image = image.resize((new_width, new_height), resample=resample)
            mask = mask.resize((new_width, new_height), resample=resample)
            
            new_image = Image.new("RGB", (target_width, target_height), (0, 0, 0))
            new_mask = Image.new("L", (target_width, target_height), 0)
            
            left = (target_width - new_width) // 2
            top = (target_height - new_height) // 2
            new_image.paste(image, (left, top))
            new_mask.paste(mask, (left, top))
            image = new_image
            mask = new_mask
            
        return image, mask

    @classmethod
    def IS_CHANGED(s, mode, image, batch_path, mask_data="", **kwargs):
        m = hashlib.sha256()
        if mode == "single":
            image_path = folder_paths.get_annotated_filepath(image)
            if os.path.exists(image_path):
                with open(image_path, 'rb') as f:
                    m.update(f.read())
            if mask_data:
                m.update(mask_data.encode())
        else:
            m.update(batch_path.encode())
            full_path = get_full_batch_path(batch_path)
            if full_path and os.path.exists(full_path):
                # Use modification time to detect changes in the folder/zip
                m.update(str(os.path.getmtime(full_path)).encode())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, mode, image, batch_path, **kwargs):
        if mode == "single":
            if not folder_paths.exists_annotated_filepath(image):
                return "Invalid image file: {}".format(image)
        else:
            if not batch_path:
                return "Batch path is required for batch mode."
            
            full_path = get_full_batch_path(batch_path)
            if full_path is None or not os.path.exists(full_path):
                return "Batch path does not exist: {}".format(batch_path)
        return True
