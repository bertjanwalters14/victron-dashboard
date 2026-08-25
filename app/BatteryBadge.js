// Compacte batterij-indicator (telefoon-stijl) voor de SOC, met kleur op ladingsniveau.
// Gedeeld tussen het hoofddashboard en /ess zodat beide exact hetzelfde icoontje tonen.
export default function BatteryBadge({ pct }) {
  const p = pct != null ? Math.max(0, Math.min(100, Math.round(pct))) : null;
  const color = p == null ? '#6b7280' : p < 20 ? '#ef4444' : p < 50 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex items-center gap-1.5" title="Accu SOC">
      <div className="relative w-7 h-3.5 border-2 border-gray-400 rounded-[2px] p-0.5">
        <div className="h-full rounded-[1px]" style={{ width: p != null ? `${Math.max(8, p)}%` : '0%', background: color }} />
        <div className="absolute -right-[3px] top-1/2 -translate-y-1/2 w-[2px] h-[6px] bg-gray-400 rounded-r-sm" />
      </div>
      <span className="text-sm font-semibold">{p != null ? `${p}%` : '—'}</span>
    </div>
  );
}
