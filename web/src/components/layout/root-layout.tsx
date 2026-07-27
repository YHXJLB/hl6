import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBranding } from "@/hooks/use-branding";
import { prefetchRouteData } from "@/lib/prefetch";
import { api, getErrorMessage } from "@/lib/api";
import { PageTransition } from "./page-transition";
import { ThemeToggle } from "./theme-toggle";
import { LanguageToggle } from "./language-toggle";
import { SiteFooter } from "./site-footer";
import { NotificationBell } from "@/components/notification/notification-bell";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Globe,
  Layers,
  Coins,
  Users,
  Settings2,
  ShieldCheck,
  ClipboardList,
  SlidersHorizontal,
  ShieldAlert,
  ChevronDown,
  Menu,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { BrandingResponse } from "@/types";

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";
const SIDEBAR_NAV_SECTIONS_KEY = "sidebar-nav-sections";

type NavSectionId = "admin";
type NavSectionsCollapsed = Record<NavSectionId, boolean>;

const DEFAULT_NAV_SECTIONS: NavSectionsCollapsed = { admin: false };

function loadNavSectionsCollapsed(): NavSectionsCollapsed {
  try {
    const raw = localStorage.getItem(SIDEBAR_NAV_SECTIONS_KEY);
    if (!raw) return DEFAULT_NAV_SECTIONS;
    const parsed = JSON.parse(raw) as Partial<NavSectionsCollapsed>;
    return { ...DEFAULT_NAV_SECTIONS, ...parsed };
  } catch {
    return DEFAULT_NAV_SECTIONS;
  }
}

type NavItem = {
  labelKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "nav.domains", href: "/domains", icon: Globe },
  { labelKey: "nav.mySubdomains", href: "/subdomains", icon: Layers },
  { labelKey: "nav.credits", href: "/credits", icon: Coins },
];

const adminItems: NavItem[] = [
  { labelKey: "nav.adminUsers", href: "/admin/users", icon: Users },
  { labelKey: "nav.adminDomains", href: "/admin/domains", icon: Settings2 },
  { labelKey: "nav.audit", href: "/admin/audit", icon: ShieldCheck },
  { labelKey: "nav.claimRules", href: "/admin/claim-rules", icon: ShieldAlert },
  { labelKey: "nav.auditLogs", href: "/admin/audit-logs", icon: ClipboardList },
  { labelKey: "nav.adminSettings", href: "/admin/settings", icon: SlidersHorizontal },
];

function NavLink({ item, onClick, collapsed }: { item: NavItem; onClick?: () => void; collapsed?: boolean }) {
  const location = useLocation();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const active =
    location.pathname === item.href ||
    (item.href !== "/" && location.pathname.startsWith(`${item.href}/`));
  const Icon = item.icon;

  return (
    <Link
      to={item.href}
      onClick={onClick}
      onMouseEnter={() => prefetchRouteData(queryClient, item.href)}
      onFocus={() => prefetchRouteData(queryClient, item.href)}
      title={collapsed ? t(item.labelKey) : undefined}
      className={`flex items-center rounded-lg text-sm transition-colors ${
        collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2"
      } ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
    </Link>
  );
}

function NavSection({
  sectionId,
  titleKey,
  items,
  collapsed: sidebarCollapsed,
  sectionCollapsed,
  onSectionCollapsedChange,
  onNavigate,
}: {
  sectionId: NavSectionId;
  titleKey: string;
  items: NavItem[];
  collapsed?: boolean;
  sectionCollapsed: boolean;
  onSectionCollapsedChange: (id: NavSectionId, collapsed: boolean) => void;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const showItems = sidebarCollapsed || !sectionCollapsed;

  return (
    <>
      <div className="my-3 border-t" />
      {sidebarCollapsed ? (
        showItems &&
        items.map((item) => (
          <NavLink key={item.href} item={item} onClick={onNavigate} collapsed={sidebarCollapsed} />
        ))
      ) : (
        <Collapsible
          open={!sectionCollapsed}
          onOpenChange={(open) => onSectionCollapsedChange(sectionId, !open)}
        >
          <CollapsibleTrigger
            className={cn(
              "mb-1 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wider",
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <span>{t(titleKey)}</span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out",
                !sectionCollapsed && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1">
            {items.map((item) => (
              <NavLink key={item.href} item={item} onClick={onNavigate} collapsed={false} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

function SidebarContent({ onNavigate, collapsed, branding }: { onNavigate?: () => void; collapsed?: boolean; branding: BrandingResponse }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [sectionsCollapsed, setSectionsCollapsed] = useState(loadNavSectionsCollapsed);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_NAV_SECTIONS_KEY, JSON.stringify(sectionsCollapsed));
  }, [sectionsCollapsed]);

  const setSectionCollapsed = useCallback((id: NavSectionId, sectionCollapsed: boolean) => {
    setSectionsCollapsed((prev) => ({ ...prev, [id]: sectionCollapsed }));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-14 items-center border-b ${collapsed ? "justify-center px-2" : "px-4"}`}>
        <Link to="/dashboard" className="flex items-center gap-2 font-semibold" onClick={onNavigate}>
          {branding.logo_url && (
            <img src={branding.logo_url} alt={branding.name} className="h-5 w-5 shrink-0 rounded-sm object-contain" />
          )}
          {!collapsed && <span>{branding.name}</span>}
        </Link>
      </div>
      <nav className={`flex-1 space-y-1 ${collapsed ? "p-2" : "p-4"}`}>
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} onClick={onNavigate} collapsed={collapsed} />
        ))}
        {isAdmin && (
          <NavSection
            sectionId="admin"
            titleKey="nav.admin"
            items={adminItems}
            collapsed={collapsed}
            sectionCollapsed={sectionsCollapsed.admin}
            onSectionCollapsedChange={setSectionCollapsed}
            onNavigate={onNavigate}
          />
        )}
      </nav>
    </div>
  );
}

export function RootLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut, credits } = useAuth();
  const branding = useBranding();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [urlConfirmOpen, setUrlConfirmOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  });
  const isAdmin = user?.role === "admin";

  const { data: adminConfig } = useQuery({
    queryKey: ["admin-config"],
    queryFn: async () => {
      const res = await api.adminGetConfig();
      return res.data;
    },
    staleTime: 30_000,
    enabled: isAdmin,
  });

  const confirmMutation = useMutation({
    mutationFn: api.adminConfirmUrlConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
      toast.success(t("adminSettings.urlConfirmed"));
    },
    onError: (err) => toast.error(getErrorMessage(err, t)),
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const shouldShowUrlPrompt = Boolean(
    isAdmin &&
    adminConfig?.url_runtime &&
    !adminConfig?.url_runtime?.confirmed &&
    location.pathname !== "/admin/settings"
  );

  useEffect(() => {
    setUrlConfirmOpen(shouldShowUrlPrompt);
  }, [shouldShowUrlPrompt]);

  const goToSettings = () => {
    setUrlConfirmOpen(false);
    navigate("/admin/settings");
  };

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={`hidden border-r bg-sidebar-background lg:flex lg:flex-col shrink-0 sticky top-0 h-screen transition-all duration-300 ${collapsed ? "w-16" : "w-64"}`}>
        <div className="flex-1 overflow-hidden">
          <SidebarContent collapsed={collapsed} branding={branding} />
        </div>
        <div className={`border-t p-2 ${collapsed ? "flex justify-center" : "flex justify-end"}`}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={collapsed ? t("common.expand") : t("common.collapse")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`}>
              <path d="M11 17l-5-5 5-5" />
              <path d="M18 17l-5-5 5-5" />
            </svg>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 items-center gap-4 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl lg:px-6 sticky top-0 z-40">
          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SidebarContent onNavigate={() => setMobileOpen(false)} branding={branding} />
            </SheetContent>
          </Sheet>

          <div className="flex-1" />

          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Coins className="h-3.5 w-3.5" />
            <span className="tabular-nums">{credits}</span>
          </div>

          <NotificationBell />

          <LanguageToggle />
          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full h-8 w-8">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.avatar_url} />
                  <AvatarFallback className="text-xs">{user?.name?.charAt(0)?.toUpperCase() || "U"}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>{t("common.signOut")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 lg:p-6">
          <PageTransition>
            {children}
          </PageTransition>
        </main>
        <SiteFooter />
      </div>

      <Dialog open={urlConfirmOpen} onOpenChange={(open) => { if (open) setUrlConfirmOpen(true); }}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            goToSettings();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("adminSettings.urlConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("adminSettings.urlConfirmDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">{t("adminSettings.frontendUrl")}:</span>{" "}
              {adminConfig?.url_runtime.frontend_url}
            </p>
            {(adminConfig?.url_runtime?.frontend_urls?.length ?? 0) > 1 && (
              <p className="text-muted-foreground">
                {adminConfig?.url_runtime?.frontend_urls?.join(" , ")}
              </p>
            )}
            <p>
              <span className="font-medium">{t("adminSettings.backendUrl")}:</span>{" "}
              {adminConfig?.url_runtime.backend_url}
            </p>
            {(adminConfig?.url_runtime?.backend_urls?.length ?? 0) > 1 && (
              <p className="text-muted-foreground">
                {adminConfig?.url_runtime?.backend_urls?.join(" , ")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={goToSettings}
            >
              {t("adminSettings.goToSettings")}
            </Button>
            <Button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
              data-dialog-primary="true"
            >
              {confirmMutation.isPending ? t("common.saving") : t("adminSettings.confirmCurrentUrls")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
