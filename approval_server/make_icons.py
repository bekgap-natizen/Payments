from pathlib import Path
import sys
from PIL import Image
if __name__=="__main__":
    source=Image.open(sys.argv[1]).convert("RGBA")
    dest=Path(__file__).resolve().parent/"static"
    for filename,size in (("icon-192.png",192),("icon-512.png",512),("apple-touch-icon.png",180)):
        tile=Image.new("RGBA",(size,size),"#ffffff")
        mark=source.copy();mark.thumbnail((int(size*.76),int(size*.76)),Image.Resampling.LANCZOS)
        tile.alpha_composite(mark,((size-mark.width)//2,(size-mark.height)//2))
        tile.convert("RGB").save(dest/filename)
