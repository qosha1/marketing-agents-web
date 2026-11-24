'use client';

/**
 * Dashboard (wireframe V01, bd startsim-bj3zz): a holding page. What the
 * Dashboard shows is still to be decided, so the page is one dashed "To do"
 * card. The old health widgets (widgets.tsx, foundry.dashboard.ts) are kept but
 * not shown; they come back when the Dashboard is designed.
 */
export function DashboardHome() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-neutral-900">Dashboard</h1>
      <div className="rounded-[10px] border border-dashed border-slate-400 bg-white px-6 py-12 text-center">
        <p className="text-base font-medium text-slate-500">To do</p>
        <p className="mt-1.5 text-sm text-slate-500">Holding page. What goes here is still to be decided.</p>
      </div>
    </div>
  );
}
