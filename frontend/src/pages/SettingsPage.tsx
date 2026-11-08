import { useEffect, useState } from 'react';
import { Check, Palette, Volume2, BookOpen, SlidersHorizontal, Plus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { themes, resolveTheme } from '../shared/themes';
import { api } from '../shared/api';
import { defaultSettings, type Settings, type Page } from '../shared/types';
import { Modal } from '../components/Primitives';

interface Preset {
  id: string;
  name: string;
  settings: Settings;
}
export function SettingsPage({
  settings,
  onSave,
  onPreview,
  onError,
}: {
  settings: Settings;
  onSave(value: Settings): Promise<void>;
  onPreview(value: Settings | null): void;
  onError(error: unknown): void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [presetName, setPresetName] = useState<string | null>(null);
  const presets = useQuery({
    queryKey: ['presets'],
    queryFn: () => api<Page<Preset>>('/theme-presets/'),
  });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
  };
  useEffect(() => {
    onPreview(draft);
  }, [draft, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);
  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  const current = resolveTheme(
    draft.theme,
    draft.mode === 'light' ? 'light' : 'dark',
    draft.custom_colors,
  );
  const select = (
    key:
      | 'mode'
      | 'cover_size'
      | 'density'
      | 'reader_mode'
      | 'texture'
      | 'reader_texture'
      | 'shelf_style',
    label: string,
    options: string[],
  ) => (
    <label>
      {t(label)}
      <select value={draft[key]} onChange={(event) => set(key, event.target.value as never)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {t(option)}
          </option>
        ))}
      </select>
    </label>
  );
  const toggle = (
    key: 'sound_enabled' | 'page_sound' | 'ui_sound' | 'night_mode',
    label: string,
  ) => (
    <label className="switch-row">
      <span>{t(label)}</span>
      <input
        type="checkbox"
        role="switch"
        checked={draft[key]}
        onChange={(event) => set(key, event.target.checked)}
      />
    </label>
  );
  const slider = (
    key: 'volume' | 'animation_speed' | 'brightness' | 'contrast',
    label: string,
    min: number,
    max: number,
  ) => (
    <label className="range-label">
      <span>
        {t(label)}
        <output>{Math.round(draft[key] * 100)}%</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step="0.05"
        value={draft[key]}
        onChange={(event) => set(key, Number(event.target.value))}
      />
    </label>
  );
  return (
    <section className="page settings-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('brand')}</p>
          <h1>{t('settings')}</h1>
        </div>
        <SlidersHorizontal size={26} strokeWidth={1.3} />
      </div>
      <div className="section-heading">
        <div>
          <h2>{t('theme')}</h2>
          <p className="muted">{t('themeHelp')}</p>
        </div>
        <Palette size={24} strokeWidth={1.3} />
      </div>
      <div className="theme-grid">
        {themes.map((theme) => {
          const palette = theme[draft.mode === 'light' ? 'light' : 'dark'];
          return (
            <button
              key={theme.id}
              className={`theme-card ${draft.theme === theme.id ? 'selected' : ''}`}
              aria-pressed={draft.theme === theme.id}
              onClick={() => {
                set('theme', theme.id);
                set('custom_colors', {});
              }}
            >
              <span
                className="theme-preview"
                style={{ backgroundColor: palette.bg, color: palette.text }}
              >
                <span style={{ backgroundColor: palette.accent }} />
                <span style={{ backgroundColor: palette.surface }} />
                {draft.theme === theme.id && <Check size={18} />}
              </span>
              <span>{theme.name}</span>
            </button>
          );
        })}
      </div>
      <div className="settings-columns">
        <section className="settings-group">
          <h2>
            <Palette size={20} />
            {t('appearance')}
          </h2>
          {select('mode', 'appearance', ['dark', 'light', 'system'])}
          <label>
            {t('language')}
            <select
              value={draft.language}
              onChange={(event) => set('language', event.target.value as 'ru' | 'en')}
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
          {select('cover_size', 'coverSize', ['small', 'medium', 'large'])}
          {select('density', 'density', ['comfortable', 'compact'])}
          {select('texture', 'texture', ['none', 'paper', 'linen'])}
          {select('reader_texture', 'readerTexture', ['none', 'paper', 'linen'])}
          {select('shelf_style', 'shelfStyle', ['plain', 'wood', 'line'])}
          <details>
            <summary>{t('customColors')}</summary>
            <div className="color-inputs">
              {(['bg', 'text', 'accent'] as const).map((key) => (
                <label key={key}>
                  {t(key === 'bg' ? 'background' : key === 'text' ? 'foreground' : 'accent')}
                  <input
                    type="color"
                    value={draft.custom_colors[key] || current[key]}
                    onChange={(event) =>
                      set('custom_colors', { ...draft.custom_colors, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <button className="button subtle" onClick={() => set('custom_colors', {})}>
              {t('reset')}
            </button>
          </details>
        </section>
        <section className="settings-group">
          <h2>
            <BookOpen size={20} />
            {t('reader')}
          </h2>
          {select('reader_mode', 'readerMode', ['scroll', 'flip'])}
          {slider('animation_speed', 'animation', 0.5, 2)}
          {slider('brightness', 'brightness', 0.3, 1.5)}
          {slider('contrast', 'contrast', 0.5, 2)}
          {toggle('night_mode', 'nightMode')}
          <h2>
            <Volume2 size={20} />
            {t('sound')}
          </h2>
          {toggle('sound_enabled', 'soundEnabled')}
          {toggle('page_sound', 'pageSound')}
          {toggle('ui_sound', 'uiSound')}
          {slider('volume', 'volume', 0, 1)}
        </section>
      </div>
      <section className="settings-group">
        <div className="section-heading">
          <h2>{t('presets')}</h2>
          <button className="button subtle" onClick={() => setPresetName('')}>
            <Plus size={18} />
            {t('savePreset')}
          </button>
        </div>
        <div className="preset-list">
          {presets.data?.results.map((preset) => (
            <div className="list-row" key={preset.id}>
              <span>{preset.name}</span>
              <div>
                <button
                  className="button subtle"
                  onClick={() => {
                    setDraft({
                      ...defaultSettings,
                      ...preset.settings,
                      language: draft.language,
                      onboarding_done: true,
                      revision: settings.revision,
                    });
                    setSaved(false);
                  }}
                >
                  {t('apply')}
                </button>
                <button
                  className="icon-button"
                  aria-label={`${t('delete')}: ${preset.name}`}
                  onClick={() =>
                    void api(`/theme-presets/${preset.id}/`, { method: 'DELETE' })
                      .then(() => presets.refetch())
                      .catch(onError)
                  }
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="settings-save">
        <button className="button primary" disabled={busy} onClick={() => void save()}>
          <Check size={18} />
          {t(saved ? 'saved' : 'save')}
        </button>
      </div>
      {presetName !== null && (
        <Modal title={t('savePreset')} onClose={() => setPresetName(null)}>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void api('/theme-presets/', {
                method: 'POST',
                body: JSON.stringify({ name: presetName.trim(), settings: draft }),
              })
                .then(() => {
                  setPresetName(null);
                  return presets.refetch();
                })
                .catch(onError);
            }}
          >
            <label>
              {t('name')}
              <input
                autoFocus
                required
                maxLength={100}
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
              />
            </label>
            <button className="button primary" disabled={!presetName.trim()}>
              {t('save')}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
