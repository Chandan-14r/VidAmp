import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

os.makedirs('store-assets', exist_ok=True)
logo_path = 'icons/icon512.png'
logo = Image.open(logo_path).convert('RGBA')

font_bold = lambda size: ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', size)
font_regular = lambda size: ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', size)
font_semibold = lambda size: ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf', size) if os.path.exists('C:/Windows/Fonts/seguisb.ttf') else ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', size)

def round_corners(im, radius):
    mask = Image.new('L', im.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, im.size[0], im.size[1]), radius=radius, fill=255)
    result = im.copy()
    result.putalpha(mask)
    return result

def draw_glow(canvas, x, y, w, h, color, blur_r=30):
    glow_img = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_draw.rounded_rectangle((x, y, x + w, y + h), radius=20, fill=color)
    glow_blurred = glow_img.filter(ImageFilter.GaussianBlur(blur_r))
    canvas.alpha_composite(glow_blurred)

# ==============================================================================
# 1. SMALL PROMO TILE (440 x 280)
# ==============================================================================
def create_small_promo():
    w, h = 440, 280
    im = Image.new('RGBA', (w, h), (11, 15, 25, 255))
    draw = ImageDraw.Draw(im)

    # Ambient radial gradient
    for r in range(160, 0, -5):
        alpha = int(25 * (1 - r / 160))
        draw.ellipse([w//2 - r, h//2 - r, w//2 + r, h//2 + r], fill=(56, 189, 248, alpha))

    # Logo with rounded corners
    logo_sz = 96
    l_small = logo.resize((logo_sz, logo_sz), Image.Resampling.LANCZOS)
    l_rounded = round_corners(l_small, 22)
    lx = (w - logo_sz) // 2
    ly = 32

    # Logo glow
    draw_glow(im, lx, ly, logo_sz, logo_sz, (56, 189, 248, 120), blur_r=25)
    im.alpha_composite(l_rounded, (lx, ly))

    # Title
    f_title = font_bold(28)
    title_text = "VidAmp"
    bbox = draw.textbbox((0, 0), title_text, font=f_title)
    tx = (w - (bbox[2] - bbox[0])) // 2
    draw.text((tx, 142), title_text, font=f_title, fill=(255, 255, 255, 255))

    # Subtitle
    f_sub = font_semibold(13)
    sub_text = "Universal Video Enhancer & Speed Controller"
    bbox_sub = draw.textbbox((0, 0), sub_text, font=f_sub)
    sx = (w - (bbox_sub[2] - bbox_sub[0])) // 2
    draw.text((sx, 178), sub_text, font=f_sub, fill=(148, 163, 184, 255))

    # Badges
    badges = ["⚡ Speed Pinch", "🌌 Ambient Glow", "🔊 Studio EQ"]
    f_badge = font_semibold(11)
    total_badge_w = 0
    badge_widths = []
    for b in badges:
        bb = draw.textbbox((0, 0), b, font=f_badge)
        bw = (bb[2] - bb[0]) + 16
        badge_widths.append(bw)
        total_badge_w += bw + 8
    total_badge_w -= 8

    cur_bx = (w - total_badge_w) // 2
    for b, bw in zip(badges, badge_widths):
        draw.rounded_rectangle((cur_bx, 214, cur_bx + bw, 238), radius=12, fill=(30, 41, 59, 220), outline=(51, 65, 85, 255), width=1)
        bb = draw.textbbox((0, 0), b, font=f_badge)
        text_x = cur_bx + (bw - (bb[2] - bb[0])) // 2
        draw.text((text_x, 219), b, font=f_badge, fill=(203, 213, 225, 255))
        cur_bx += bw + 8

    im.convert('RGB').save('store-assets/promo-small-440x280.png', 'PNG')
    print("Created store-assets/promo-small-440x280.png")

# ==============================================================================
# 2. MARQUEE BANNER (1400 x 560)
# ==============================================================================
def create_marquee():
    w, h = 1400, 560
    im = Image.new('RGBA', (w, h), (10, 14, 26, 255))
    draw = ImageDraw.Draw(im)

    # Cyan and Violet atmospheric glow
    for r in range(400, 0, -10):
        alpha_c = int(45 * (1 - r / 400))
        alpha_v = int(35 * (1 - r / 400))
        draw.ellipse([150 - r, 280 - r, 150 + r, 280 + r], fill=(56, 189, 248, alpha_c))
        draw.ellipse([1100 - r, 280 - r, 1100 + r, 280 + r], fill=(168, 85, 247, alpha_v))

    # Big Logo
    logo_sz = 260
    l_big = logo.resize((logo_sz, logo_sz), Image.Resampling.LANCZOS)
    l_rounded = round_corners(l_big, 54)
    lx = 100
    ly = (h - logo_sz) // 2

    draw_glow(im, lx, ly, logo_sz, logo_sz, (56, 189, 248, 160), blur_r=60)
    im.alpha_composite(l_rounded, (lx, ly))

    # Right content section
    rx = 420

    # Pill badge above title
    draw.rounded_rectangle((rx, 75, rx + 170, 105), radius=15, fill=(56, 189, 248, 40), outline=(56, 189, 248, 120), width=1)
    f_cat = font_bold(13)
    draw.text((rx + 16, 82), "MANIFEST V3 • v6.1.0", font=f_cat, fill=(56, 189, 248, 255))

    # Main Title
    f_title = font_bold(58)
    draw.text((rx, 115), "VidAmp", font=f_title, fill=(255, 255, 255, 255))

    # Subtitle
    f_sub = font_semibold(22)
    draw.text((rx, 188), "Universal Video Enhancer & Speed Controller", font=f_sub, fill=(148, 163, 184, 255))

    # Feature List
    f_item = font_regular(16)
    f_item_b = font_bold(16)
    features = [
        ("⚡ Precision Touchpad Gestures", " - Natural 2-finger speed pinch & 1-click popover"),
        ("🌌 Universal Ambient Glow", " - Real-time zero-lag GPU dynamic bias lighting"),
        ("🔊 Studio Audio Superpowers", " - +7dB Bass Boost, +6dB Vocal Clarity, 200% Volume"),
        ("⏱️ Frame Stepper & A-B Clips", " - Step ~0.033s frames & export instant WebM clips"),
        ("📥 Smart Media Downloader", " - 1-Click clean video download on generic HTML5 sites")
    ]

    fy = 236
    for title, desc in features:
        draw.text((rx, fy), title, font=f_item_b, fill=(241, 245, 249, 255))
        bb = draw.textbbox((0, 0), title, font=f_item_b)
        tw = bb[2] - bb[0]
        draw.text((rx + tw, fy), desc, font=f_item, fill=(148, 163, 184, 255))
        fy += 34

    # Browser compatibility footer
    by = 445
    draw.line((rx, by - 16, w - 80, by - 16), fill=(30, 41, 59, 255), width=1)
    f_comp = font_semibold(14)
    draw.text((rx, by), "Compatible with:", font=f_comp, fill=(100, 116, 139, 255))
    bb_comp = draw.textbbox((0, 0), "Compatible with:", font=f_comp)
    bx = rx + (bb_comp[2] - bb_comp[0]) + 16

    browsers = ["Google Chrome", "Microsoft Edge", "Brave Browser", "Mozilla Firefox", "Opera & Arc"]
    f_b = font_bold(14)
    for b in browsers:
        bb = draw.textbbox((0, 0), b, font=f_b)
        bw = (bb[2] - bb[0]) + 18
        draw.rounded_rectangle((bx, by - 4, bx + bw, by + 24), radius=10, fill=(30, 41, 59, 255), outline=(51, 65, 85, 255), width=1)
        draw.text((bx + 9, by), b, font=f_b, fill=(226, 232, 240, 255))
        bx += bw + 10

    im.convert('RGB').save('store-assets/promo-marquee-1400x560.png', 'PNG')
    print("Created store-assets/promo-marquee-1400x560.png")

# ==============================================================================
# 3. SCREENSHOT SHOWCASE (1280 x 800)
# ==============================================================================
def create_screenshot():
    w, h = 1280, 800
    im = Image.new('RGBA', (w, h), (13, 17, 28, 255))
    draw = ImageDraw.Draw(im)

    # Ambient backdrop
    draw_glow(im, 200, 100, 880, 500, (56, 189, 248, 70), blur_r=80)
    draw_glow(im, 400, 300, 600, 400, (168, 85, 247, 60), blur_r=90)

    # Mock Video Player Canvas
    vx, vy, vw, vh = 100, 80, 1080, 580
    draw.rounded_rectangle((vx, vy, vx + vw, vy + vh), radius=16, fill=(5, 7, 13, 255), outline=(30, 41, 59, 255), width=2)

    # Video Player Play Icon Mock
    pw, ph = 70, 70
    px, py = vx + (vw - pw)//2, vy + (vh - ph)//2
    draw.ellipse((px, py, px + pw, py + ph), fill=(56, 189, 248, 180))
    draw.polygon([(px + 28, py + 20), (px + 28, py + 50), (px + 52, py + 35)], fill=(255, 255, 255, 255))

    # Ambient Bias Glow Aura behind video
    draw_glow(im, vx + 50, vy + vh - 40, vw - 100, 60, (56, 189, 248, 140), blur_r=40)

    # Below-Video Toolbar Mock
    tb_w, tb_h = 560, 48
    tbx = vx + (vw - tb_w) // 2
    tby = vy + vh - tb_h - 18
    draw.rounded_rectangle((tbx, tby, tbx + tb_w, tby + tb_h), radius=12, fill=(16, 16, 20, 245), outline=(255, 255, 255, 40), width=1)

    # Toolbar Mock Items
    f_tbi = font_bold(14)
    tb_items = ["🔁 Loop", "🔊 Boost", "🎬 Cinema", "🌌 Glow", "⚡ 1.4×", "📸 Shot", "⚗️ A-B", "📥 Download"]
    cur_ix = tbx + 14
    for item in tb_items:
        bb = draw.textbbox((0, 0), item, font=f_tbi)
        item_w = bb[2] - bb[0]
        color = (56, 189, 248, 255) if "1.4×" in item or "Glow" in item else (203, 213, 225, 255)
        draw.text((cur_ix, tby + 14), item, font=f_tbi, fill=color)
        cur_ix += item_w + 14

    # Speed Popover Mock Floating above speed label
    pop_w, pop_h = 240, 110
    pop_x = tbx + 260
    pop_y = tby - pop_h - 12
    draw.rounded_rectangle((pop_x, pop_y, pop_x + pop_w, pop_y + pop_h), radius=10, fill=(20, 24, 38, 250), outline=(56, 189, 248, 120), width=1)
    f_pop_hdr = font_bold(12)
    draw.text((pop_x + 12, pop_y + 10), "SPEED PRESETS", font=f_pop_hdr, fill=(148, 163, 184, 255))
    
    speeds = ["0.5x", "0.75x", "1.0x", "1.25x", "1.4x", "1.5x", "2.0x", "3.0x"]
    f_spd = font_bold(11)
    sx_offset = pop_x + 12
    sy_offset = pop_y + 36
    for i, s in enumerate(speeds):
        active = (s == "1.4x")
        btn_w = 48
        btn_h = 24
        bg_col = (56, 189, 248, 240) if active else (30, 41, 59, 200)
        fg_col = (11, 15, 25, 255) if active else (226, 232, 240, 255)
        draw.rounded_rectangle((sx_offset, sy_offset, sx_offset + btn_w, sy_offset + btn_h), radius=6, fill=bg_col)
        bb = draw.textbbox((0, 0), s, font=f_spd)
        draw.text((sx_offset + (btn_w - (bb[2]-bb[0]))//2, sy_offset + 4), s, font=f_spd, fill=fg_col)
        sx_offset += btn_w + 6
        if i == 3:
            sx_offset = pop_x + 12
            sy_offset += btn_h + 8

    # Bottom caption bar
    draw.rounded_rectangle((vx, 680, vx + vw, 750), radius=12, fill=(20, 24, 38, 240), outline=(51, 65, 85, 255), width=1)
    f_cap_t = font_bold(18)
    draw.text((vx + 24, 692), "VidAmp: Universal Video Enhancer & Speed Controller", font=f_cap_t, fill=(255, 255, 255, 255))
    f_cap_d = font_regular(14)
    draw.text((vx + 24, 720), "Touchpad Gestures • Ambient Glow • Studio EQ • Frame Stepper • Smart Downloader", font=f_cap_d, fill=(148, 163, 184, 255))

    im.convert('RGB').save('store-assets/screenshot-1280x800.png', 'PNG')
    print("Created store-assets/screenshot-1280x800.png")

if __name__ == '__main__':
    create_small_promo()
    create_marquee()
    create_screenshot()
