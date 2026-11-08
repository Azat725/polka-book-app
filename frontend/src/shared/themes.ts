export interface Palette {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
}
interface Theme {
  id: string;
  name: string;
  dark: Palette;
  light: Palette;
}
const palette = (
  bg: string,
  surface: string,
  text: string,
  muted: string,
  accent: string,
  border: string,
): Palette => ({ bg, surface, text, muted, accent, border });
export const themes: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight Blue',
    dark: palette('#18233f', '#222f4d', '#eee6d3', '#bcbfcd', '#d7b985', '#3d4760'),
    light: palette('#f2eee3', '#fffaf0', '#18233f', '#575e71', '#7c202d', '#d5cdbf'),
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    dark: palette('#151619', '#23252a', '#f0eadf', '#bab9b5', '#d7b985', '#42444b'),
    light: palette('#f1f0ed', '#ffffff', '#242529', '#5d5c59', '#70522b', '#d4d1ca'),
  },
  {
    id: 'richesse',
    name: 'Richesse',
    dark: palette('#251b28', '#362939', '#f2e6d0', '#c4b7c6', '#c6a56b', '#58445a'),
    light: palette('#f5ede1', '#fffaf2', '#392b37', '#716174', '#87632b', '#dbcdbd'),
  },
  {
    id: 'terracotta',
    name: 'Terracotta',
    dark: palette('#33231f', '#483028', '#f8e7d7', '#d0b9a9', '#e7a07c', '#725043'),
    light: palette('#f0e0d1', '#fff2e6', '#452b25', '#74564b', '#963f2d', '#d7b49b'),
  },
  {
    id: 'tuscan',
    name: 'Tuscan',
    dark: palette('#262c20', '#343e2b', '#efe5cc', '#c0c5ac', '#c5ba77', '#566047'),
    light: palette('#efe5cc', '#fff7df', '#343c2c', '#62664c', '#596232', '#d3c79f'),
  },
  {
    id: 'ussr',
    name: 'СССР',
    dark: palette('#2b1d1c', '#402a26', '#efe3cb', '#d0b8a5', '#e09773', '#6c4940'),
    light: palette('#efe3cb', '#fff2d9', '#442824', '#78564a', '#a32b32', '#d3b99a'),
  },
  {
    id: 'gdr',
    name: 'ГДР',
    dark: palette('#1c302e', '#28433f', '#e6ead9', '#b1c7bd', '#b7cca0', '#47655c'),
    light: palette('#dfe5db', '#f4f7e9', '#203d39', '#4c6b5f', '#2f6663', '#b9cbbb'),
  },
  {
    id: 'eighties',
    name: '80-е',
    dark: palette('#242344', '#35325a', '#f3e4eb', '#cbc0d5', '#eda6ca', '#595078'),
    light: palette('#f0e7f0', '#fff7fc', '#3b3157', '#755d7c', '#a14578', '#d5bfd6'),
  },
  {
    id: 'cream',
    name: 'Classic Cream',
    dark: palette('#302721', '#44372c', '#f4ebd8', '#cfc0aa', '#d5b786', '#6b5847'),
    light: palette('#f4ebd8', '#fff8e9', '#443026', '#79604c', '#78513a', '#d8c5a3'),
  },
  {
    id: 'burgundy',
    name: 'Burgundy',
    dark: palette('#2b1721', '#462331', '#f3e4da', '#d3b6c1', '#e6a5a9', '#714154'),
    light: palette('#f2e3dc', '#fff4ed', '#4e2535', '#805365', '#862e45', '#dcb8bf'),
  },
];
function luminance(hex: string) {
  const channels = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrastRatio(a: string, b: string) {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function accentText(background: string) {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff')
    ? '#000000'
    : '#ffffff';
}
export function resolveTheme(
  id: string,
  mode: 'dark' | 'light',
  custom: Record<string, string> = {},
): Palette {
  const base = { ...(themes.find((theme) => theme.id === id) || themes[0])[mode] };
  for (const [key, value] of Object.entries(custom))
    if (key in base && /^#[0-9a-f]{6}$/i.test(value)) base[key as keyof Palette] = value;
  const readable = (color: string) =>
    Math.min(contrastRatio(color, base.bg), contrastRatio(color, base.surface));
  const fallback = readable('#000000') >= readable('#ffffff') ? '#000000' : '#ffffff';
  if (readable(base.text) < 4.5) base.text = fallback;
  if (readable(base.muted) < 4.5) base.muted = fallback;
  return base;
}
