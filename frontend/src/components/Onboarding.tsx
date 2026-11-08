import { useState } from 'react';
import { BookOpen, Bookmark, Palette, PanelsTopLeft, ArrowRight, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
const icons = [BookOpen, PanelsTopLeft, Palette, BookOpen, Bookmark];
export function Onboarding({ onDone }: { onDone(): Promise<void> }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const Icon = icons[step];
  const finish = async () => {
    setBusy(true);
    try {
      await onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={`onboarding onboarding-${step}`}>
      <header>
        <span className="wordmark">{t('brand')}</span>
        <button className="button subtle" disabled={busy} onClick={() => void finish()}>
          {t('skip')}
        </button>
      </header>
      <div className="onboarding-content" key={step}>
        <div className="onboarding-art" aria-hidden="true">
          <span />
          <span />
          <span />
          <Icon size={72} strokeWidth={1} />
        </div>
        <p className="eyebrow">0{step + 1} / 05</p>
        <h1>{t(`onboarding${step + 1}`)}</h1>
        <p>{t(`onboardingText${step + 1}`)}</p>
      </div>
      <footer>
        <div className="steps" aria-label={`${step + 1}/5`}>
          {icons.map((_, index) => (
            <span key={index} className={index === step ? 'active' : ''} />
          ))}
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => (step < 4 ? setStep(step + 1) : void finish())}
        >
          {t(step < 4 ? 'next' : 'start')}
          {step < 4 ? <ArrowRight size={20} /> : <Check size={20} />}
        </button>
      </footer>
    </main>
  );
}
