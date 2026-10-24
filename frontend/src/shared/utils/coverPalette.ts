// 生成封面与书色兜底：没有封面或封面主色（后端 coverColor，见视觉重构计划 B3）时，按书名稳定地算出两种颜色。
// 同一书名永远得到同一组颜色，换设备、刷新都不变。

export interface CoverPalette {
    /** 封面底色，也作为这本书的“书色” */
    base: string;
    /** 高光色，用于生成封面左上的光晕 */
    glow: string;
}

function hashTitle(title: string): number {
    // FNV-1a 32 位
    let hash = 0x811c9dc5;
    for (const char of title.trim()) {
        hash ^= char.codePointAt(0)!;
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function titleHue(title: string) {
    const hash = hashTitle(title || '未命名');
    // 饱和度和亮度只在小范围内浮动，保证白色书名在任何底色上都读得清
    return { hue: hash % 360, saturation: 30 + ((hash >>> 9) % 16), lightness: 26 + ((hash >>> 17) % 10) };
}

export function coverPalette(title: string): CoverPalette {
    const { hue, saturation, lightness } = titleHue(title);
    return {
        base: `hsl(${hue} ${saturation}% ${lightness}%)`,
        glow: `hsl(${(hue + 32) % 360} ${saturation + 14}% 72%)`,
    };
}

/** 书色：优先用后端算好的封面主色，没有时退回书名哈希色 */
export function bookAccent(title: string, coverColor?: string | null): string {
    return coverColor && /^#[0-9a-f]{6}$/i.test(coverColor) ? coverColor : coverPalette(title).base;
}

/** 生成封面上书名的字号（相对封面宽度的 cqw），书名越长字越小 */
export function coverTitleSize(title: string): number {
    const length = Math.max(1, [...title.trim()].length);
    return Math.round(Math.min(15, Math.max(8, 74 / length)) * 10) / 10;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
    const s = saturation / 100, l = lightness / 100;
    const a = s * Math.min(l, 1 - l);
    const channel = (n: number) => {
        const k = (n + hue / 30) % 12;
        const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(value * 255).toString(16).padStart(2, '0');
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * 阅读器里的书色（进度条、批注波浪线）：同一色相，亮度提到 44%，明亮/暗黑/羊皮三套底色上都看得清。
 * 返回 #rrggbb，因为批注颜色要存到后端（字段最长 7 个字符）。
 */
export function readingAccent(title: string, coverColor?: string | null): string {
    if (coverColor && /^#[0-9a-f]{6}$/i.test(coverColor)) return coverColor.toLowerCase();
    const { hue, saturation } = titleHue(title);
    return hslToHex(hue, saturation + 8, 44);
}
