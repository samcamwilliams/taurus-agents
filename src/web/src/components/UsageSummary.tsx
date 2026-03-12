import { fmtCost, fmtTokens } from '../utils/format';

interface UsageSummaryProps {
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number; reasoningTokens?: number };
  cost?: number;
  label?: string;
}

export function UsageSummary({ usage, cost, label }: UsageSummaryProps) {
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const cachePct = usage.input > 0 && cacheRead > 0
    ? Math.round((cacheRead / usage.input) * 100)
    : 0;

  return (
    <div className="usage-summary">
      {label && (
        <span className="usage-summary__label">{label}</span>
      )}
      <span className="usage-summary__item">
        {fmtTokens(usage.input)} in
      </span>
      <span className="usage-summary__item">
        {fmtTokens(usage.output)} out
      </span>
      {cacheRead > 0 && (
        <span className="usage-summary__item usage-summary__item--cache">
          {fmtTokens(cacheRead)} cached{cachePct > 0 && ` (${cachePct}%)`}
        </span>
      )}
      {cacheWrite > 0 && (
        <span className="usage-summary__item usage-summary__item--cache">
          {fmtTokens(cacheWrite)} cache write
        </span>
      )}
      {(usage.reasoningTokens ?? 0) > 0 && (
        <span className="usage-summary__item">
          {fmtTokens(usage.reasoningTokens!)} reasoning
        </span>
      )}
      {cost != null && cost > 0 && (
        <span className="usage-summary__item usage-summary__item--cost">
          {fmtCost(cost)}
        </span>
      )}
    </div>
  );
}
