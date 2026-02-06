from .sgun_load_image import SGUNLoadImage

# Alias for backward compatibility and to prevent boot errors
ImageBrushResizable = SGUNLoadImage

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    "SGUNLoadImage": SGUNLoadImage
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SGUNLoadImage": "SGUNLoadImage"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']
