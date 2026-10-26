import type { CSSProperties } from 'react';

export function QuickIcon({ path }: { path: string }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase() ?? '').join('');

export function Avatar({ name }: { name: string }) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return <span className={`avatar avatar-tone-${hash % 5}`} aria-hidden="true">{initials(name)}</span>;
}

export function FinancialMetricCard({ figureKey, label, value, support, icon, tone, onOpen }: {
  figureKey: string; label: string; value: string; support: string; icon: string; tone: string; onOpen: () => void;
}) {
  return <button type="button" className="home-metric" data-figure-key={figureKey} onClick={onOpen} style={{ '--amount-length': value.length } as CSSProperties}>
    <span className={`metric-icon ${tone}`} aria-hidden="true"><QuickIcon path={icon} /></span>
    <span className="metric-chevron" aria-hidden="true">›</span>
    <span className="metric-label" data-figure-label>{label}</span>
    <strong className="metric-value" data-figure-value>{value}</strong>
    <small className="metric-micro">{support}</small>
  </button>;
}

export function OverviewLoading() {
  return <section className="overview-loading" aria-busy="true" aria-label="Cargando información">
    <p role="status">Cargando información…</p><div className="overview-skeleton-hero" aria-hidden="true" />
    <div className="overview-skeleton-cards" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index} />)}</div>
  </section>;
}
