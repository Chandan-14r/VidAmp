import os
import zipfile

os.makedirs('dist', exist_ok=True)

files_to_pack = [
    'manifest.json',
    'content.js',
    'popup.html',
    'popup.js',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'icons/icon512.png'
]

# Verify all files exist
for f in files_to_pack:
    if not os.path.exists(f):
        raise FileNotFoundError(f"Missing required extension file: {f}")

# Package 1: Universal Chrome, Edge, Brave, Opera, Arc
chrome_zip = 'dist/VidAmp-v6.1.0-Chrome-Edge-Brave.zip'
with zipfile.ZipFile(chrome_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files_to_pack:
        z.write(f, arcname=f)
print(f"Created {chrome_zip} ({os.path.getsize(chrome_zip)} bytes)")

# Package 2: Firefox Add-ons (AMO)
firefox_zip = 'dist/VidAmp-v6.1.0-Firefox.zip'
with zipfile.ZipFile(firefox_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files_to_pack:
        z.write(f, arcname=f)
print(f"Created {firefox_zip} ({os.path.getsize(firefox_zip)} bytes)")

# Inspect contents of the zip
print("\n--- Zip File Contents Verification ---")
with zipfile.ZipFile(chrome_zip, 'r') as z:
    for info in z.infolist():
        print(f"  {info.filename} ({info.file_size} bytes -> compressed: {info.compress_size} bytes)")
