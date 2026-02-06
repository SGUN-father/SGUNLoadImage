import os
import torch
import numpy as np
import hashlib
from PIL import Image, ImageOps, ImageSequence
import folder_paths
import zipfile
import io

class SGUNLoadImage:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        return {
            "required": {
                "mode": (["single", "batch"], {"default": "single"}),
                "image": (sorted(files), {"image_upload": True}),
                "batch_path": ("STRING", {"default": ""}),
                "width": ("INT", {"default": 720, "min": 1, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1280, "min": 1, "max": 8192, "step": 1}),
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

    def load_image(self, mode, image, batch_path, width, height, upscale_method, keep_proportion, crop_position, divisible_by, mask_data=""):
        # Ensure dimensions are divisible
        width = (width // divisible_by) * divisible_by
        height = (height // divisible_by) * divisible_by
        
        # Mapping upscale methods to PIL Resampling filters
        resample_map = {
            "nearest-exact": Image.NEAREST,
            "bilinear": Image.BILINEAR,
            "area": Image.BOX,
            "bicubic": Image.BICUBIC,
            "lanczos": Image.LANCZOS,
        }
        resample = resample_map.get(upscale_method, Image.BICUBIC)

        images_to_load = []
        if mode == "single":
            image_path = folder_paths.get_annotated_filepath(image)
            images_to_load.append(("path", image_path))
        else:
            if not batch_path:
                raise Exception("Batch path is empty")
            
            # Normalize path
            batch_path = batch_path.strip().strip('"')
            
            if os.path.isdir(batch_path):
                for f in sorted(os.listdir(batch_path)):
                    if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp')):
                        images_to_load.append(("path", os.path.join(batch_path, f)))
            elif zipfile.is_zipfile(batch_path):
                with zipfile.ZipFile(batch_path, 'r') as z:
                    for f in sorted(z.namelist()):
                        if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp')):
                            # We'll read the data later to keep the handle open only when needed
                            # or just read it now if it's not too many. 
                            # For safety, let's store the name and we'll re-open zip in the loop.
                            images_to_load.append(("zip", (batch_path, f)))
            else:
                raise Exception(f"Invalid batch path: {batch_path}. Must be a directory or zip file.")

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
                image_rgb, current_mask_pil = self.apply_resize(
                    image_rgb, current_mask_pil, width, height, resample, keep_proportion, crop_position
                )
                
                # 4. Convert to Tensors
                image_tensor = np.array(image_rgb).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(image_tensor)[None,]
                
                mask_tensor = np.array(current_mask_pil).astype(np.float32) / 255.0
                mask_tensor = torch.from_numpy(mask_tensor)[None,]

                output_images.append(image_tensor)
                output_masks.append(mask_tensor)

        if not output_images:
            raise Exception("No valid images processed.")

        output_image = torch.cat(output_images, dim=0)
        output_mask = torch.cat(output_masks, dim=0)

        return (output_image, output_mask, width, height)

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
            if os.path.exists(batch_path):
                # Use modification time to detect changes in the folder/zip
                m.update(str(os.path.getmtime(batch_path)).encode())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, mode, image, batch_path, **kwargs):
        if mode == "single":
            if not folder_paths.exists_annotated_filepath(image):
                return "Invalid image file: {}".format(image)
        else:
            if not batch_path:
                return "Batch path is required for batch mode."
            if not os.path.exists(batch_path):
                return "Batch path does not exist: {}".format(batch_path)
        return True
