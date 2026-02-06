import os
import torch
import numpy as np
import hashlib
from PIL import Image, ImageOps, ImageSequence
import folder_paths

class SGUNLoadImage:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
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

    def load_image(self, image, width, height, upscale_method, keep_proportion, crop_position, divisible_by, mask_data=""):
        # Ensure dimensions are divisible
        width = (width // divisible_by) * divisible_by
        height = (height // divisible_by) * divisible_by

        image_path = folder_paths.get_annotated_filepath(image)
        img = Image.open(image_path)
        
        # Mapping upscale methods to PIL Resampling filters
        resample_map = {
            "nearest-exact": Image.NEAREST,
            "bilinear": Image.BILINEAR,
            "area": Image.BOX,
            "bicubic": Image.BICUBIC,
            "lanczos": Image.LANCZOS,
        }
        resample = resample_map.get(upscale_method, Image.BICUBIC)

        # Handle external mask from frontend (brush data)
        external_mask = None
        if mask_data:
            try:
                mask_path = folder_paths.get_annotated_filepath(mask_data)
                if os.path.exists(mask_path):
                    mask_img = Image.open(mask_path)
                    # The frontend sends a transparent PNG with red/colored strokes.
                    # We use the alpha channel as the mask.
                    if "A" in mask_img.getbands():
                        external_mask = np.array(mask_img.getchannel("A")).astype(np.float32) / 255.0
                    else:
                        external_mask = np.array(mask_img.convert("L")).astype(np.float32) / 255.0
            except Exception as e:
                print(f"Error loading external mask: {e}")

        output_images = []
        output_masks = []
        
        for i in ImageSequence.Iterator(img):
            i = ImageOps.exif_transpose(i)
            if i.mode == 'I':
                i = i.point(lambda i: i * (1 / 255))
            
            # 1. Prepare Image
            image_rgb = i.convert("RGB")
            
            # 2. Prepare Mask
            # Priority: 1. External mask (from brush) 2. Alpha channel of image 3. Zero mask
            if external_mask is not None:
                # Resize external mask to match current frame size before processing
                current_mask_pil = Image.fromarray((external_mask * 255).astype(np.uint8), mode='L')
                if current_mask_pil.size != image_rgb.size:
                    current_mask_pil = current_mask_pil.resize(image_rgb.size, resample=Image.BILINEAR)
            elif "A" in i.getbands():
                # Standard ComfyUI: 1.0 is mask (black in alpha), 0.0 is background (white in alpha).
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

        if len(output_images) > 1:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

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
    def IS_CHANGED(s, image, mask_data="", **kwargs):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, 'rb') as f:
            m.update(f.read())
        if mask_data:
            m.update(mask_data.encode())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, image, **kwargs):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True
