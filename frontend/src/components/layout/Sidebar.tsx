'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LogOut,
  UserCircle,
  LifeBuoy,
  ChevronUp,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import { useAuthStore } from '@/store/auth';
import { useNavItems } from '@/hooks/useNavItems';
import { getLandingPage } from '@/components/layout/AuthGuard';
import api from '@/lib/api';
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

// Leaf keys of the `nav` message namespace (use-intl resolves leaf keys
// within the namespace scope, so no dotted keys).
export default function AppSidebar() {
  // Normalized: the desktop build's trailingSlash:true makes usePathname()
  // return e.g. "/staff/" there but "/staff" in dev — see normalizePathname.
  const pathname = normalizePathname(usePathname());
  const { user, currentTenant, logout } = useAuthStore();
  const { isMobile, setOpenMobile } = useSidebar();
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const { confirm, ConfirmDialog } = useConfirm();
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };
  const tSettings = useTranslations('settings');
  const { mode: themeMode, cycle: cycleThemeMode } = useThemeModeToggle();
  const themeModeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : Monitor;
  const themeModeLabel = themeMode === 'light'
    ? tSettings('themeLight')
    : themeMode === 'dark'
      ? tSettings('themeDark')
      : tSettings('themeSystem');
  const ThemeModeIcon = themeModeIcon;

  const { navItems, emailNeedsAttention } = useNavItems();
  const homeHref = getLandingPage(currentTenant);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={homeHref}>
                {currentTenant?.has_logo ? (
                  <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md overflow-hidden bg-sidebar-primary">
                    <img
                      src={`${api.defaults.baseURL}/settings/logo`}
                      alt=""
                      className="size-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-semibold">
                    {(currentTenant?.business_name || tCommon('brandName')).charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex flex-col gap-0.5 min-w-0 leading-none">
                  <span className="font-semibold truncate">{currentTenant?.business_name || tCommon('brandName')}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const [hrefPath, hrefQuery] = item.href.split('?');
                const isActive = !hrefQuery && (pathname === hrefPath || pathname?.startsWith(hrefPath + '/'));
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={t(item.labelKey)}>
                      <Link href={item.href} onClick={closeMobile}>
                        <span className="relative flex size-4 shrink-0 items-center justify-center">
                          <item.icon className="size-4 shrink-0" />
                          {item.href === '/settings' && emailNeedsAttention && (
                            <span aria-label="Email verification required" className="absolute -end-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
                          )}
                        </span>
                        <span>{t(item.labelKey)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={cycleThemeMode}
              tooltip={`${tSettings('themeTitle')}: ${themeModeLabel}`}
            >
              <ThemeModeIcon className="size-4 shrink-0" />
              <span>{tSettings('themeTitle')}</span>
              <span className="ms-auto text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                {themeModeLabel}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className="rounded-xl border-0 bg-sidebar-accent/60 hover:bg-sidebar-accent hover:shadow-xs data-[state=open]:bg-sidebar-accent/90 transition-all h-9 px-3 font-normal group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:p-2! group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:rounded-lg"
                  tooltip={user?.name || user?.email || t('user')}
                >
                  <UserCircle className="size-4 shrink-0 text-sidebar-primary" />
                  <span className="font-medium text-sm truncate group-data-[collapsible=icon]:hidden text-sidebar-foreground">
                    {user?.name || user?.email || t('user')}
                  </span>
                  <ChevronUp className="ms-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "bottom" : "top"}
                align={isMobile ? "end" : "start"}
                className="w-56 rounded-lg"
              >
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link href="/support" onClick={closeMobile} className="flex items-center gap-2">
                    <LifeBuoy className="size-4 shrink-0" />
                    <span>{t('support')}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    if (await confirm(t('confirmLogout'))) logout();
                  }}
                  className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/50 flex items-center gap-2"
                >
                  <LogOut className="size-4 shrink-0" />
                  <span>{t('logout')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
      {ConfirmDialog}
    </Sidebar>
  );
}
