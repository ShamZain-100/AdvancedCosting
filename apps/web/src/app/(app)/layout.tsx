'use client';
import { Calculator, ChevronDown, ArrowLeftRight, BarChart3, Coins, Database, FileStack, FileText, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, Tags, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-store';
import { NotificationBell } from '@/components/notification-bell';
import { MASTER_CONFIGS } from '@/lib/masters';
import { cn } from '@/lib/utils';

type NavItem = { href: string; label: string; perm?: string };
type NavGroup = { title: string; items: NavItem[] };

const MASTER_ITEMS: NavItem[] = Object.entries(MASTER_CONFIGS).filter(([key]) => !['customers', 'customerGroups', 'priceListDealers'].includes(key)).map(([key, c]) => ({ href: `/masters/${key}`, label: c.nav, perm: c.perm }));

/** Navigation structure of the application. Entries are hidden when the user lacks the permission; empty groups disappear. */
const NAV: NavGroup[] = [
  { title: 'Dashboard', items: [
    { href: '/', label: 'Overview', perm: 'dashboard:view' },
    { href: '/#recent-activity', label: 'Recent Activity', perm: 'dashboard:view' },
    { href: '/#statistics', label: 'Statistics', perm: 'dashboard:view' },
  ] },
  { title: 'Masters', items: MASTER_ITEMS },
  { title: 'Purchase & Rates', items: [
    { href: '/purchase-rates', label: 'Purchase Rates', perm: 'purchase_rates:view' },
    { href: '/purchase-rates?tab=history', label: 'Rate History', perm: 'purchase_rates:view' },
    { href: '/recalculation', label: 'Rate Change Impact', perm: 'purchase_rates:view' },
  ] },
  { title: 'Templates', items: [
    { href: '/templates', label: 'Template List', perm: 'templates:view' },
    { href: '/templates/new', label: 'Create Template', perm: 'templates:create' },
  ] },
  { title: 'Costing', items: [
    { href: '/costings', label: 'All Costings', perm: 'costing:view' },
    { href: '/costings/new', label: 'New Costing', perm: 'costing:create' },
    { href: '/costings?status=PENDING_APPROVAL', label: 'Costing Approval', perm: 'costing:approve' },
    { href: '/reports/costing-history', label: 'Costing History', perm: 'reports:view' },
    { href: '/product-images', label: 'Product Photos', perm: 'images:view' },
  ] },
  { title: 'Price List', items: [
    { href: '/price-list', label: 'Dealer Price List', perm: 'dealer_price_list:view' },
    { href: '/cost-report', label: 'Cost Report', perm: 'costing:view' },
    { href: '/price-lists', label: 'Price List Documents', perm: 'price_lists:view' },
    { href: '/price-lists/generate', label: 'Generate Price List', perm: 'price_lists:create' },
    { href: '/masters/priceListDealers', label: 'Price List Dealers', perm: 'price_list_dealers:view' },
  ] },
  { title: 'Quotations', items: [
    { href: '/masters/customers', label: 'Customers', perm: 'customers:view' },
    { href: '/masters/customerGroups', label: 'Customer Groups', perm: 'customer_groups:view' },
    { href: '/quotations', label: 'All Quotations', perm: 'quotations:view' },
    { href: '/quotations/new', label: 'Create Quotation', perm: 'quotations:create' },
  ] },
  { title: 'Reports', items: [
    { href: '/reports#costing-reports', label: 'Costing Reports', perm: 'reports:view' },
    { href: '/reports#material-reports', label: 'Material Reports', perm: 'reports:view' },
    { href: '/reports#labour-reports', label: 'Labour Reports', perm: 'reports:view' },
    { href: '/reports#supplier-reports', label: 'Supplier Reports', perm: 'reports:view' },
    { href: '/reports#profit-reports', label: 'Profit Reports', perm: 'reports:view' },
    { href: '/reports#quotation-reports', label: 'Quotation Reports', perm: 'reports:view' },
  ] },
  { title: 'Data Management', items: [
    { href: '/data/import', label: 'Import Excel', perm: 'data_management:import' },
    { href: '/data/export', label: 'Export Excel', perm: 'data_management:view' },
    { href: '/data/history', label: 'Import History', perm: 'data_management:import' },
  ] },
  { title: 'Administration', items: [
    { href: '/users', label: 'User Management', perm: 'users:view' },
    { href: '/roles', label: 'Roles & Permissions', perm: 'roles:view' },
    { href: '/settings/company', label: 'Company Settings', perm: 'settings:view' },
    { href: '/settings#calculation-rules', label: 'Costing Settings', perm: 'settings:view' },
    { href: '/settings', label: 'All Settings', perm: 'settings:view' },
    { href: '/audit-logs', label: 'Audit Logs', perm: 'audit_logs:view' },
    { href: '/profile', label: 'My Profile' },
  ] },
];


/** Each category has its own icon; the colour is the same flat primary blue for all of them. */
const ICONS: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard, Masters: Database, 'Purchase & Rates': Coins, Templates: FileStack, Costing: Calculator, 'Price List': Tags,
  Quotations: FileText, Reports: BarChart3, 'Data Management': ArrowLeftRight, Administration: ShieldCheck,
};

const STORAGE_KEY = 'costing.sidebar';
type SidebarState = { collapsed: boolean; closed: string[] };
const readState = (): SidebarState => {
  try { const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? ''); return { collapsed: !!v.collapsed, closed: Array.isArray(v.closed) ? v.closed : [] }; } catch { return { collapsed: false, closed: [] }; }
};
const writeState = (v: SidebarState) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* private mode: the sidebar just forgets */ } };

/** How well a link matches the current address (-1 = not at all). The best match is highlighted; #anchor links never are. */
function matchScore(href: string, path: string, search: URLSearchParams) {
  if (href.includes('#')) return -1;
  const [hrefPath, hrefQuery = ''] = href.split('?');
  const wanted = [...new URLSearchParams(hrefQuery)];
  if (wanted.some(([k, v]) => search.get(k) !== v)) return -1;
  const bonus = wanted.length ? 5000 : 0;
  if (path === hrefPath) return 2000 + hrefPath.length + bonus;
  if (hrefPath !== '/' && path.startsWith(`${hrefPath}/`)) return hrefPath.length + bonus;
  return -1;
}

/** The sidebar content. Expanded by default: every category is open and lists its pages; a category can be folded and the choice is remembered. */
function SideNav({ collapsed, closed, onToggle, onNavigate }: { collapsed: boolean; closed: string[]; onToggle: (title: string) => void; onNavigate: () => void }) {
  const path = usePathname();
  const search = useSearchParams();
  const { can } = useAuth();
  const visible = NAV.map((g) => ({ ...g, items: g.items.filter((n) => !n.perm || can(n.perm)) })).filter((g) => g.items.length);
  const best = Math.max(...visible.flatMap((g) => g.items).map((n) => matchScore(n.href, path, search)));
  const isCurrent = (n: NavItem) => best >= 0 && matchScore(n.href, path, search) === best;
  return (
    <nav className="sidebar-scroll flex-1 space-y-0.5 overflow-y-auto px-2 py-2" aria-label="Main">
      {visible.map((g) => {
        const Icon = ICONS[g.title];
        const hasCurrent = g.items.some(isCurrent);
        const open = !closed.includes(g.title) || hasCurrent;
        if (collapsed) {
          return (
            <Link key={g.title} href={g.items[0].href} title={g.title} onClick={onNavigate}
              className={cn('mx-auto grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-white/10', hasCurrent && 'bg-primary-600')}>
              <Icon size={17} className={hasCurrent ? 'text-white' : 'text-primary-400'} />
            </Link>
          );
        }
        return (
          <div key={g.title}>
            <button type="button" onClick={() => onToggle(g.title)} aria-expanded={open}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5">
              <Icon size={16} className="shrink-0 text-primary-400" />
              <span className="flex-1 truncate text-[13px] font-semibold text-white">{g.title}</span>
              <ChevronDown size={14} className={cn('shrink-0 text-slate-500 transition-transform', !open && '-rotate-90')} />
            </button>
            {open && (
              <div className="ml-4 space-y-px border-l border-white/10 pl-2">
                {g.items.map((n) => (
                  <Link key={n.href} href={n.href} title={n.label} onClick={onNavigate} aria-current={isCurrent(n) ? 'page' : undefined}
                    className={cn('block truncate rounded-md px-2 py-1 text-[13px] transition-colors',
                      isCurrent(n) ? 'bg-primary-600 font-medium text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white')}>
                    {n.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { me, loading, load, logout } = useAuth();
  const [side, setSide] = useState<SidebarState>({ collapsed: false, closed: [] });
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { setSide(readState()); }, []);
  useEffect(() => { setDrawer(false); }, [path]);
  useEffect(() => { if (!useAuth.getState().me) void load(); else useAuth.setState({ loading: false }); }, [load]);
  useEffect(() => { if (!loading && !me) router.replace('/login'); }, [loading, me, router]);
  // the server refuses everything else until a temporary password is replaced
  useEffect(() => { if (me?.mustChangePassword && path !== '/profile') router.replace('/profile'); }, [me, path, router]);
  // users without the dashboard (dealers, designers) start on the first page they may open
  useEffect(() => {
    if (!me || me.mustChangePassword || path !== '/' || me.permissions.includes('dashboard:view')) return;
    const first = NAV.flatMap((g) => g.items).find((i) => i.perm && me.permissions.includes(i.perm) && !i.href.includes('#'));
    router.replace(first?.href ?? '/profile');
  }, [me, path, router]);

  const update = (next: SidebarState) => { setSide(next); writeState(next); };
  const toggleGroup = (title: string) => update({ ...side, closed: side.closed.includes(title) ? side.closed.filter((t) => t !== title) : [...side.closed, title] });

  if (loading || !me) return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  // the rail (icons only) is a desktop mode; the mobile drawer is always the full sidebar
  const rail = side.collapsed;

  return (
    <div className="min-h-screen">
      {drawer && <div className="fixed inset-0 z-30 bg-slate-950/60 md:hidden print:hidden" onClick={() => setDrawer(false)} aria-hidden />}
      <aside
        className={cn('fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-slate-300 transition-all duration-150 print:hidden',
          rail ? 'md:w-[3.5rem]' : 'md:w-[13.5rem]', 'w-[16rem]', drawer ? 'translate-x-0' : '-translate-x-full md:translate-x-0')}
        aria-label="Sidebar">
        <div className={cn('flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-3', rail && 'md:justify-center md:px-0')}>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary-600 text-white"><Calculator size={16} /></span>
          <span className={cn('min-w-0 leading-tight', rail && 'md:hidden')}>
            <span className="block truncate text-sm font-semibold text-white">Smart Costing</span>
            <span className="block truncate text-[11px] text-slate-400">Management System</span>
          </span>
          <button type="button" aria-label="Close menu" className="ml-auto rounded-md p-1 text-slate-300 hover:bg-white/10 md:hidden" onClick={() => setDrawer(false)}><X size={18} /></button>
        </div>

        <Suspense fallback={null}>
          <SideNav collapsed={rail && !drawer} closed={side.closed} onToggle={toggleGroup} onNavigate={() => setDrawer(false)} />
        </Suspense>

        <div className={cn('shrink-0 border-t border-white/10 p-2', rail && 'md:px-1')}>
          <div className={cn('flex items-center gap-2 rounded-md bg-white/5 p-1.5', rail && 'md:justify-center md:bg-transparent md:p-0')}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-600 text-[11px] font-bold text-white" title={me.name}>{initials(me.name)}</span>
            <span className={cn('min-w-0 flex-1 leading-tight', rail && 'md:hidden')}>
              <span className="block truncate text-[13px] font-medium text-white">{me.name}</span>
              <span className="block truncate text-[11px] text-slate-400">{me.email}</span>
            </span>
            <button type="button" title="Sign out" aria-label="Sign out" className={cn('rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white', rail && 'md:hidden')}
              onClick={async () => { await logout(); router.replace('/login'); }}><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <div className={cn('flex min-h-screen min-w-0 flex-col transition-[padding] duration-150 print:pl-0', rail ? 'md:pl-[3.5rem]' : 'md:pl-[13.5rem]')}>
        <header className="sticky top-0 z-20 flex h-11 items-center gap-2 border-b border-slate-200 bg-white px-3 print:hidden">
          <button type="button" aria-label="Open menu" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 md:hidden" onClick={() => setDrawer(true)}><Menu size={20} /></button>
          <button type="button" aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-md p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-primary-700 md:block" onClick={() => update({ ...side, collapsed: !side.collapsed })}>
            {rail ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <NotificationBell />
            <span className="hidden text-slate-600 sm:inline">{me.name}</span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-600 text-[11px] font-bold text-white">{initials(me.name)}</span>
          </div>
        </header>
        <main className="flex-1 p-3 sm:p-4">{children}</main>
      </div>
    </div>
  );
}
