'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LifeBuoy, LogOut, Monitor, Moon, Sun, UserCircle } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { useAuthStore } from '@/store/auth';
import { useNavItems } from '@/hooks/useNavItems';
import { useConfirm } from '@/hooks/use-confirm';
import { useThemeModeToggle } from '@/hooks/useThemeModeToggle';
import { normalizePathname } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function TopNavBar() {
  const pathname = normalizePathname(usePathname());
  const { user, logout } = useAuthStore();
  const { navItems, emailNeedsAttention } = useNavItems();
  const t = useTranslations('nav');
  const tSettings = useTranslations('settings');
  const { confirm, ConfirmDialog } = useConfirm();
  const { mode: themeMode, cycle: cycleThemeMode } = useThemeModeToggle();
  const ThemeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : Monitor;
  const themeLabel = themeMode === 'light'
    ? tSettings('themeLight')
    : themeMode === 'dark'
      ? tSettings('themeDark')
      : tSettings('themeSystem');

  return (
    <nav
      aria-label={t('menuBar')}
      data-testid="top-nav-bar"
      className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-2"
    >
      <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map((item) => {
          const [hrefPath, hrefQuery] = item.href.split('?');
          const isActive = !hrefQuery && (pathname === hrefPath || pathname?.startsWith(hrefPath + '/'));
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand/10 text-brand' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <item.icon className="size-4 shrink-0" />
                <span>{t(item.labelKey)}</span>
                {item.href === '/settings' && emailNeedsAttention && (
                  <span aria-label="Email verification required" className="absolute end-1 top-1 h-2 w-2 rounded-full bg-red-500" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={cycleThemeMode}
        title={`${tSettings('themeTitle')}: ${themeLabel}`}
        aria-label={`${tSettings('themeTitle')}: ${themeLabel}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ThemeIcon className="size-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 max-w-48 shrink-0 items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-sm hover:bg-muted"
          >
            <UserCircle className="size-4 shrink-0 text-brand" />
            <span className="truncate font-medium">{user?.name || user?.email || t('user')}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-lg">
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href="/support" className="flex items-center gap-2">
              <LifeBuoy className="size-4 shrink-0" />
              <span>{t('support')}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              if (await confirm(t('confirmLogout'))) logout();
            }}
            className="flex cursor-pointer items-center gap-2 text-red-600 focus:bg-red-50 focus:text-red-600 dark:focus:bg-red-950/50"
          >
            <LogOut className="size-4 shrink-0" />
            <span>{t('logout')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {ConfirmDialog}
    </nav>
  );
}
