"""One PDF job. No Django, database, broker or application secrets."""

import json
import sys
from contextlib import closing
from pathlib import Path


def main(source, output, kind="pdf"):
    import pypdfium2 as pdfium

    destination = Path(output)
    destination.mkdir(parents=True, exist_ok=True)
    result = {"status": "error", "error_code": "invalid_pdf"}
    try:
        if kind == "cover":
            from PIL import Image, ImageOps

            Image.MAX_IMAGE_PIXELS = 12000000
            with Image.open(source) as picture:
                if picture.format not in {"JPEG", "PNG", "WEBP"} or picture.width * picture.height > 12000000:
                    raise ValueError("Unsupported image")
                image = ImageOps.exif_transpose(picture).convert("RGB")
                image.thumbnail((640, 900))
                image.save(destination / "cover.jpg", "JPEG", quality=85, optimize=True)
                image.close()
            (destination / "result.json").write_text(
                json.dumps({"status": "ready", "page_count": 1}), encoding="utf-8"
            )
            return
        with pdfium.PdfDocument(source) as document:
            pages = len(document)
            if pages < 1:
                raise ValueError("Empty document")
            with closing(document[0]) as page:
                scale = min(640 / max(page.get_width(), 1), 900 / max(page.get_height(), 1), 2)
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil().convert("RGB")
                    image.save(destination / "cover.jpg", "JPEG", quality=85, optimize=True)
                    image.close()
                finally:
                    bitmap.close()
            metadata = document.get_metadata_dict()
            result = {"status": "ready", "page_count": pages, "author": str(metadata.get("Author", ""))[:200]}
    except pdfium.PdfiumError as exc:
        if getattr(exc, "err_code", None) == 4:
            result = {"status": "locked", "page_count": 0}
    except (ValueError, RuntimeError, OSError):
        pass
    temporary = destination / "result.tmp"
    temporary.write_text(json.dumps(result), encoding="utf-8")
    temporary.replace(destination / "result.json")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "pdf")
