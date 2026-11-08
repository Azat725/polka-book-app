export interface User {
  id: string;
  first_name: string;
  username?: string;
  avatar_url?: string;
}
export interface Progress {
  page: number;
  position: number;
  revision: number;
}
export interface Book {
  id: string;
  title: string;
  author: string;
  page_count: number;
  size_bytes: number;
  status: 'want' | 'reading' | 'read';
  favorite: boolean;
  processing_status: 'processing' | 'ready' | 'locked' | 'error';
  error_code?: string;
  progress: Progress;
  cover_url: string | null;
  folder_id: string | null;
  collection_ids: string[];
  created_at: string;
  deleted_at: string | null;
}
export interface Settings {
  theme: string;
  mode: 'light' | 'dark' | 'system';
  language: 'ru' | 'en';
  onboarding_done: boolean;
  cover_size: 'small' | 'medium' | 'large';
  density: 'compact' | 'comfortable';
  reader_mode: 'scroll' | 'flip';
  sound_enabled: boolean;
  page_sound: boolean;
  ui_sound: boolean;
  volume: number;
  animation_speed: number;
  brightness: number;
  contrast: number;
  night_mode: boolean;
  texture: string;
  reader_texture: 'none' | 'paper' | 'linen';
  shelf_style: 'plain' | 'wood' | 'line';
  custom_colors: Record<string, string>;
  revision?: number;
}
export interface Annotation {
  id: string;
  book_id: string;
  page: number;
  position: number;
  text: string;
  color: string;
  quads?: number[][];
  revision: number;
  created_at?: string;
}
export interface Collection {
  id: string;
  name: string;
  description?: string;
  book_count?: number;
}
export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
}
export interface Statistics {
  books: number;
  read: number;
  reading: number;
  storage_bytes: number;
  reading_seconds: number;
}
export interface Page<T> {
  results: T[];
  next?: string | null;
  count?: number;
}
export interface Me {
  user: User;
  settings: Settings;
  statistics: Statistics;
}
export const defaultSettings: Settings = {
  theme: 'midnight',
  mode: 'dark',
  language: 'ru',
  onboarding_done: false,
  cover_size: 'medium',
  density: 'comfortable',
  reader_mode: 'scroll',
  sound_enabled: false,
  page_sound: true,
  ui_sound: false,
  volume: 0.35,
  animation_speed: 1,
  brightness: 1,
  contrast: 1,
  night_mode: false,
  texture: 'none',
  reader_texture: 'none',
  shelf_style: 'plain',
  custom_colors: {},
};
