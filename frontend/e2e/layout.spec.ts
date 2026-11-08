import { test, expect, skipOnboarding } from './fixtures';

for (const width of [375, 768, 1440]) {
  test(`library layout stays usable at ${width}px without gradients`, async ({ page, telegramUser }) => {
    expect(telegramUser.id).toBeGreaterThan(0);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await skipOnboarding(page);
    await expect(page.getByRole('navigation')).toBeVisible();
    const measurements = await page.evaluate(() => ({
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      gradients: Array.from(document.querySelectorAll('*')).filter(element => getComputedStyle(element).backgroundImage.includes('gradient')).map(element => element.className),
      iconButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('button.icon-button')).map(button => ({ label: button.getAttribute('aria-label'), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
    }));
    expect(measurements.scroll).toBeLessThanOrEqual(measurements.width);
    expect(measurements.gradients).toEqual([]);
    for (const button of measurements.iconButtons) {
      expect(button.label).toBeTruthy();
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `../artifacts/library-${width}.png`, fullPage: true });
  });
}
