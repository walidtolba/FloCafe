'use client';

import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  Package,
  Grid3X3,
  Users,
  UserCog,
  Settings,
  ChefHat,
  MessageCircle,
  Boxes,
  PiggyBank,
  type LucideIcon,
} from 'lucide-react';
import type { AppConfig } from 'use-intl';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import api from '@/lib/api';
import type { PermissionId } from '@shared/permissions';
import { tenantCan } from '@/lib/permissions';

type NavKey = keyof AppConfig['Messages']['nav'];

interface NavItem {
  href: string;
  labelKey: NavKey;
  icon: LucideIcon;
  permission: PermissionId;
  businessTypes: string[] | null;
}

// null = show for all business types
const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/pos', labelKey: 'pos', icon: ShoppingCart, permission: 'pos.use', businessTypes: null },
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard, permission: 'dashboard.view', businessTypes: null },
  { href: '/profit', labelKey: 'profit', icon: PiggyBank, permission: 'reports.financial.view', businessTypes: null },
  { href: '/orders', labelKey: 'orders', icon: ClipboardList, permission: 'orders.read', businessTypes: null },
  { href: '/whatsapp', labelKey: 'whatsapp', icon: MessageCircle, permission: 'whatsapp.use', businessTypes: null },
  { href: '/products', labelKey: 'products', icon: Package, permission: 'catalog.manage', businessTypes: null },
  { href: '/inventory', labelKey: 'inventory', icon: Boxes, permission: 'inventory.view', businessTypes: null },
  { href: '/tables', labelKey: 'tables', icon: Grid3X3, permission: 'tables.view', businessTypes: ['restaurant'] },
  { href: '/settings?tab=kds', labelKey: 'kds', icon: ChefHat, permission: 'kitchen.stations.manage', businessTypes: ['restaurant'] },
  { href: '/customers', labelKey: 'customers', icon: Users, permission: 'customers.view', businessTypes: null },
  { href: '/staff', labelKey: 'staff', icon: UserCog, permission: 'staff.view', businessTypes: null },
  { href: '/settings', labelKey: 'settings', icon: Settings, permission: 'settings.view', businessTypes: null },
];


/**
 * The navigation entries the signed-in user may see, plus the tenant flags that
 * decide them. Shared by the sidebar and the top menu bar so both always agree.
 */
export function useNavItems() {
  const { currentTenant } = useAuthStore();
  const { tablesRequired, kdsEnabled, whatsappEnabled, setTablesRequired, setKdsEnabled, setWhatsappEnabled } = usePosSettingsStore();
  const [emailNeedsAttention, setEmailNeedsAttention] = useState(false);

  const businessType = currentTenant?.business_type || 'restaurant';
  const navItems = ALL_NAV_ITEMS.filter((item) => {
    if (item.href === '/tables' && !tablesRequired) return false;
    // Hide KDS settings navigation when KDS is disabled.
    if (item.href === '/settings?tab=kds' && !kdsEnabled) return false;
    // WhatsApp integration not enabled on this tenant → hide the nav entry.
    if (item.href === '/whatsapp' && !whatsappEnabled) return false;
    const permitted = item.href === '/staff'
      ? tenantCan(currentTenant, 'staff.view') || tenantCan(currentTenant, 'authorization.manage')
      : item.href === '/settings'
        ? [
            'settings.view', 'settings.manage', 'tax-packs.view-test', 'tax-configuration.manage',
            'tax-packs.manage', 'printers.manage', 'print-templates.view', 'print-templates.manage',
            'payment-methods.manage', 'cloud.manage', 'cloud.account.manage', 'google-drive.manage',
            'database.manage', 'mobile-access.manage', 'kitchen.stations.manage', 'whatsapp.manage',
          ].some((permission) => tenantCan(currentTenant, permission as PermissionId))
        : tenantCan(currentTenant, item.permission);
    return permitted
      && (item.businessTypes === null || item.businessTypes.includes(businessType));
  });

  useEffect(() => {
    if (!currentTenant) return;
    if (tenantCan(currentTenant, 'settings.view')) {
      api.get('/settings/business')
        .then((res) => {
          setTablesRequired(typeof res.data.tables_required === 'boolean' ? res.data.tables_required : true);
        })
        .catch(() => { });
      api.get('/settings/kds_enabled')
        .then((res) => setKdsEnabled(res.data.setting?.value !== 'false'))
        .catch(() => { });
    }
    if (tenantCan(currentTenant, 'whatsapp.use')) {
      // Sync WhatsApp status so the sidebar only shows the entry when enabled.
      api.get('/whatsapp/status')
        .then((res) => setWhatsappEnabled(!!res.data?.enabled))
        .catch(() => { });
    } else {
      setWhatsappEnabled(false);
    }
  }, [currentTenant, setTablesRequired, setKdsEnabled, setWhatsappEnabled]);

  useEffect(() => {
    if (!tenantCan(currentTenant, 'cloud.account.manage')) return;
    let active = true;
    const refreshCloudAttention = async () => {
      try {
        const [accountResponse, cloudResponse] = await Promise.all([
          api.get('/settings/cloud/account'),
          api.get('/settings/cloud'),
        ]);
        if (!active) return;
        const deletionStatus = accountResponse.data?.deletion_request?.status || cloudResponse.data?.cloud_deletion_status;
        setEmailNeedsAttention(
          (accountResponse.data?.cloud_account_available !== false && Boolean(accountResponse.data?.email) && !accountResponse.data?.verified)
          || ['pending', 'processing', 'failed'].includes(deletionStatus)
        );
      } catch {
        if (active) setEmailNeedsAttention(false);
      }
    };
    void refreshCloudAttention();
    window.addEventListener('flo:cloud-account-status-changed', refreshCloudAttention);
    return () => {
      active = false;
      window.removeEventListener('flo:cloud-account-status-changed', refreshCloudAttention);
    };
  }, [currentTenant]);

  return { navItems, emailNeedsAttention };
}
