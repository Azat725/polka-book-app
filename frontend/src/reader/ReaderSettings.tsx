import { Maximize, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Settings } from '../shared/types';

export function ReaderSettings({
  settings,
  zoom,
  onZoom,
  onChange,
  onRotate,
  onFullscreen,
  disabled,
  fitMode,
  onFitMode,
}: {
  settings: Settings;
  zoom: number;
  onZoom(value: number): void;
  onChange(changes: Partial<Settings>): void;
  onRotate(): void;
  onFullscreen(): void;
  disabled: boolean;
  fitMode: 'width' | 'page';
  onFitMode(value: 'width' | 'page'): void;
}) {
  const { t } = useTranslation('reader');
  return (
    <fieldset className="reader-settings-fields" disabled={disabled}>
      <label>
        {t('mode')}
        <select
          value={settings.reader_mode}
          onChange={(event) =>
            onChange({ reader_mode: event.target.value as Settings['reader_mode'] })
          }
        >
          <option value="scroll">{t('scroll')}</option>
          <option value="flip">{t('flip')}</option>
        </select>
      </label>
      <label>
        {t('fitMode')}
        <select
          value={fitMode}
          onChange={(event) => onFitMode(event.target.value as 'width' | 'page')}
        >
          <option value="width">{t('fitWidth')}</option>
          <option value="page">{t('fitPage')}</option>
        </select>
      </label>
      <div className="reader-tools-row">
        <button
          type="button"
          className="reader-icon"
          aria-label={t('zoomOut')}
          disabled={zoom <= 0.6}
          onClick={() => onZoom(Math.max(0.6, zoom - 0.2))}
        >
          <ZoomOut aria-hidden="true" />
        </button>
        <button type="button" className="reader-button" onClick={() => onZoom(1)}>
          {Math.round(zoom * 100)}% · {t(fitMode === 'page' ? 'fitPage' : 'fitWidth')}
        </button>
        <button
          type="button"
          className="reader-icon"
          aria-label={t('zoomIn')}
          disabled={zoom >= 3}
          onClick={() => onZoom(Math.min(3, zoom + 0.2))}
        >
          <ZoomIn aria-hidden="true" />
        </button>
        <button type="button" className="reader-icon" aria-label={t('rotate')} onClick={onRotate}>
          <RotateCw aria-hidden="true" />
        </button>
        <button
          type="button"
          className="reader-icon"
          aria-label={t('fullscreen')}
          onClick={onFullscreen}
        >
          <Maximize aria-hidden="true" />
        </button>
      </div>
      <label>
        {t('brightness')}
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
          value={settings.brightness}
          onChange={(event) => onChange({ brightness: Number(event.target.value) })}
        />
      </label>
      <label>
        {t('contrast')}
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
          value={settings.contrast}
          onChange={(event) => onChange({ contrast: Number(event.target.value) })}
        />
      </label>
      <label className="reader-check">
        {t('night')}
        <input
          type="checkbox"
          checked={settings.night_mode}
          onChange={(event) => onChange({ night_mode: event.target.checked })}
        />
      </label>
      <label className="reader-check">
        {t('sound')}
        <input
          type="checkbox"
          checked={settings.sound_enabled && settings.page_sound}
          onChange={(event) =>
            onChange({ sound_enabled: event.target.checked, page_sound: event.target.checked })
          }
        />
      </label>
      <label>
        {t('speed')}
        <select
          value={settings.animation_speed}
          onChange={(event) => onChange({ animation_speed: Number(event.target.value) })}
        >
          <option value="0.7">{t('slow')}</option>
          <option value="1">{t('normal')}</option>
          <option value="1.5">{t('fast')}</option>
        </select>
      </label>
    </fieldset>
  );
}
