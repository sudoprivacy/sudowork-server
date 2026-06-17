import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  Outlet,
} from "react-router-dom";
import { Layout, Menu, Avatar, Dropdown, Breadcrumb, message } from "antd";
import type { MenuProps } from "antd";
import {
  DashboardOutlined,
  AppstoreOutlined,
  UserOutlined,
  LogoutOutlined,
  RobotOutlined,
  GiftOutlined,
  FileTextOutlined,
  PayCircleOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EnterpriseList from "./pages/EnterpriseList";
import UserList from "./pages/UserList";
import UserManagement from "./pages/UserManagement";
import SystemConfig from "./pages/SystemConfig";
import InvitationCodeList from "./pages/InvitationCodeList";
import OperationLogs from "./pages/OperationLogs";
import RechargeList from "./pages/RechargeList";
import RechargeRecords from "./pages/RechargeRecords";
import ConfigItemList from "./pages/ConfigItemList";
import SkillsList from "./pages/SkillsList";
import { TenantSelector as QmsTenantSelector } from "./components/qms";
import QmsDashboard from "./pages/qms/Dashboard";
import QmsPerformance from "./pages/qms/Performance";
import QmsConversations from "./pages/qms/Conversations";
import QmsInstalls from "./pages/qms/Installs";
import QmsAlerts from "./pages/qms/Alerts";
import QmsCrashIssues from "./pages/qms/CrashIssues";
import QmsCrashStats from "./pages/qms/CrashStats";
import QmsSystem from "./pages/qms/System";
import QmsUserStats from "./pages/qms/UserStats";
import "antd/dist/reset.css";
import "./components/Layout.css";

const { Sider, Content, Header } = Layout;

type Role = "SUPER_ADMIN" | "ENTERPRISE_ADMIN" | "USER";

interface AdminUser {
  role?: Role;
  nickname?: string;
}

interface MenuItemConfig {
  key: string;
  icon?: React.ReactNode;
  label: string;
  roles: Role[];
  hidden?: boolean;
  children?: Array<{
    key: string;
    label: string;
    roles: Role[];
    hidden?: boolean;
  }>;
}

function isRole(value: unknown): value is Role {
  return value === "SUPER_ADMIN" || value === "ENTERPRISE_ADMIN" || value === "USER";
}

function parseAdminUser(value: string | null): AdminUser {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const data = parsed as Record<string, unknown>;
    return {
      role: isRole(data.role) ? data.role : undefined,
      nickname: typeof data.nickname === "string" ? data.nickname : undefined,
    };
  } catch {
    return {};
  }
}

const menuConfig: MenuItemConfig[] = [
  { key: "/", icon: <DashboardOutlined />, label: "仪表盘", roles: ["SUPER_ADMIN"] },
  { key: "enterprise-mgmt", icon: <AppstoreOutlined />, label: "企业管理", roles: ["SUPER_ADMIN"], children: [
    { key: "/enterprises", label: "企业列表", roles: ["SUPER_ADMIN"] },
    { key: "/config-items", label: "配置项列表", roles: ["SUPER_ADMIN"] },
  ]},
  { key: "/users", icon: <UserOutlined />, label: "用户管理", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"] },
  { key: "/skills", icon: <AppstoreOutlined />, label: "专属技能", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"] },
  { key: "/assistants", icon: <RobotOutlined />, label: "专属助手", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"] },
  { key: "qms-mgmt", icon: <BarChartOutlined />, label: "质量管理", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"], children: [
    { key: "/qms", label: "总览", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"] },
    { key: "/qms/user-stats", label: "用户统计", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"] },
    { key: "/qms/conversations", label: "会话质量", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"] },
    { key: "/qms/performance", label: "性能指标", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"], hidden: true },
    { key: "/qms/installs", label: "安装统计", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"] },
    { key: "/qms/crash-stats", label: "崩溃统计", roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"] },
    { key: "/qms/crash-issues", label: "崩溃问题", roles: ["SUPER_ADMIN"], hidden: true },
    { key: "/qms/alerts", label: "告警配置", roles: ["SUPER_ADMIN"], hidden: true },
    { key: "/qms/system", label: "配置", roles: ["SUPER_ADMIN"] },
  ]},
  { key: "/orders", icon: <UnorderedListOutlined />, label: "订单管理", roles: ["SUPER_ADMIN"] },
  { key: "/recharge-records", icon: <PayCircleOutlined />, label: "充值记录", roles: ["SUPER_ADMIN"] },
  { key: "/invitation-codes", icon: <GiftOutlined />, label: "邀请码管理", roles: ["SUPER_ADMIN"] },
  { key: "/logs", icon: <FileTextOutlined />, label: "操作日志", roles: ["SUPER_ADMIN"] },
  { key: "/system-config", icon: <SettingOutlined />, label: "系统配置", roles: ["SUPER_ADMIN"] },
];

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem("admin_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // 禁止普通用户登录管理后台
  const userStr = localStorage.getItem("admin_user");
  const user = parseAdminUser(userStr);
  if (user.role === "USER") {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    message.error("普通用户无权访问管理后台");
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const MainLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const userStr = localStorage.getItem("admin_user");
  const user = parseAdminUser(userStr);

  const userRole: Role = user.role || "USER";
  const isQmsPage = location.pathname === "/qms" || location.pathname.startsWith("/qms/");
  const canSelectQmsTenant = isQmsPage && userRole === "SUPER_ADMIN";

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    message.success("已退出登录");
    navigate("/login");
  };

  // 根据用户角色过滤菜单
  const visibleMenuConfig = menuConfig
    .filter((item) => item.roles.includes(userRole) && !item.hidden)
    .map((item) => {
      if ('children' in item && item.children) {
        return {
          ...item,
          children: item.children.filter((child) => child.roles.includes(userRole) && !child.hidden),
        };
      }
      return item;
    });

  const menuItems: MenuProps["items"] = visibleMenuConfig.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
    children: item.children?.map((child) => ({
      key: child.key,
      label: child.label,
    })),
  }));

  const userMenuItems = [
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
    },
  ];

  return (
    <Layout className="admin-layout">
      <Sider className="admin-sider" width={256}>
        <div className="admin-logo">
          <span className="admin-logo-text">SUDOWORK</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={["enterprise-mgmt", "qms-mgmt"]}
          onClick={({ key }) => navigate(key)}
          items={menuItems}
        />
      </Sider>

      <Layout>
        <Header className="admin-header">
          <Breadcrumb className="admin-breadcrumb">
            <Breadcrumb.Item>首页</Breadcrumb.Item>
            {location.pathname !== "/" && (() => {
              for (const item of visibleMenuConfig) {
                if ('children' in item && item.children) {
                  for (const child of item.children) {
                    if (child.key === location.pathname) {
                      return (
                        <React.Fragment key={item.key}>
                          <Breadcrumb.Item>{item.label}</Breadcrumb.Item>
                          <Breadcrumb.Item>{child.label}</Breadcrumb.Item>
                        </React.Fragment>
                      );
                    }
                  }
                } else if (item.key === location.pathname) {
                  return <Breadcrumb.Item key={item.key}>{item.label}</Breadcrumb.Item>;
                }
              }
              return <Breadcrumb.Item>页面</Breadcrumb.Item>;
            })()}
          </Breadcrumb>

          {canSelectQmsTenant && <QmsTenantSelector />}

          <Dropdown menu={{ items: userMenuItems, onClick: ({ key }) => key === "logout" && handleLogout() }} placement="bottomRight">
            <div className="admin-user">
              <Avatar style={{ backgroundColor: "#165DFF" }}>
                {user.nickname?.[0]?.toUpperCase() || "A"}
              </Avatar>
              <span className="admin-user-name">{user.nickname || "管理员"}</span>
            </div>
          </Dropdown>
        </Header>

        <Content className="admin-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="enterprises" element={<EnterpriseList />} />
          <Route path="config-items" element={<ConfigItemList />} />
          <Route path="users" element={<UserManagement />} />
          <Route path="skills" element={<SkillsList assetType="skills" />} />
          <Route path="assistants" element={<SkillsList assetType="assistants" />} />
          <Route path="qms" element={<QmsDashboard />} />
          <Route path="qms/user-stats" element={<QmsUserStats />} />
          <Route path="qms/conversations" element={<QmsConversations />} />
          <Route path="qms/performance" element={<QmsPerformance />} />
          <Route path="qms/installs" element={<QmsInstalls />} />
          <Route path="qms/crash-stats" element={<QmsCrashStats />} />
          <Route path="qms/crash-issues" element={<QmsCrashIssues />} />
          <Route path="qms/alerts" element={<QmsAlerts />} />
          <Route path="qms/system" element={<QmsSystem />} />
          <Route path="orders" element={<RechargeList />} />
          <Route path="recharge-records" element={<RechargeRecords />} />
          <Route path="invitation-codes" element={<InvitationCodeList />} />
          <Route path="logs" element={<OperationLogs />} />
          <Route path="system-config" element={<SystemConfig />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
