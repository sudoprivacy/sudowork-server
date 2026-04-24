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
} from "@ant-design/icons";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EnterpriseList from "./pages/EnterpriseList";
import UserList from "./pages/UserList";
import InvitationCodeList from "./pages/InvitationCodeList";
import OperationLogs from "./pages/OperationLogs";
import RechargeList from "./pages/RechargeList";
import RechargeRecords from "./pages/RechargeRecords";
import ConfigItemList from "./pages/ConfigItemList";
import SkillsList from "./pages/SkillsList";
import "antd/dist/reset.css";
import "./components/Layout.css";

const { Sider, Content, Header } = Layout;

type Role = "SUPER_ADMIN" | "ENTERPRISE_ADMIN" | "USER";

interface MenuItemConfig {
  key: string;
  icon?: React.ReactNode;
  label: string;
  roles: Role[];
  children?: Array<{
    key: string;
    label: string;
    roles: Role[];
  }>;
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
  { key: "/orders", icon: <UnorderedListOutlined />, label: "订单管理", roles: ["SUPER_ADMIN"] },
  { key: "/recharge-records", icon: <PayCircleOutlined />, label: "充值记录", roles: ["SUPER_ADMIN"] },
  { key: "/invitation-codes", icon: <GiftOutlined />, label: "邀请码管理", roles: ["SUPER_ADMIN"] },
  { key: "/logs", icon: <FileTextOutlined />, label: "操作日志", roles: ["SUPER_ADMIN"] },
];

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem("admin_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // 禁止普通用户登录管理后台
  const userStr = localStorage.getItem("admin_user");
  try {
    const user = JSON.parse(userStr || "{}");
    if (user.role === "USER") {
      localStorage.removeItem("admin_token");
      localStorage.removeItem("admin_user");
      message.error("普通用户无权访问管理后台");
      return <Navigate to="/login" replace />;
    }
  } catch {}
  return <>{children}</>;
};

const MainLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const userStr = localStorage.getItem("admin_user");
  let user: any = {};
  try {
    const parsed = userStr ? JSON.parse(userStr) : null;
    user = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    user = {};
  }

  const userRole: Role = user.role || "USER";

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    message.success("已退出登录");
    navigate("/login");
  };

  // 根据用户角色过滤菜单
  const menuItems = (menuConfig
    .filter((item) => item.roles.includes(userRole))
    .map((item) => {
      if ('children' in item && item.children) {
        return {
          ...item,
          children: item.children.filter((child) => child.roles.includes(userRole)),
        };
      }
      return item;
    })) as any;

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
          defaultOpenKeys={["enterprise-mgmt"]}
          onClick={({ key }) => navigate(key)}
          items={menuItems}
        />
      </Sider>

      <Layout>
        <Header className="admin-header">
          <Breadcrumb className="admin-breadcrumb">
            <Breadcrumb.Item>首页</Breadcrumb.Item>
            {location.pathname !== "/" && (() => {
              for (const item of menuItems) {
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
          <Route path="users" element={<UserList />} />
          <Route path="skills" element={<SkillsList assetType="skills" />} />
          <Route path="assistants" element={<SkillsList assetType="assistants" />} />
          <Route path="orders" element={<RechargeList />} />
          <Route path="recharge-records" element={<RechargeRecords />} />
          <Route path="invitation-codes" element={<InvitationCodeList />} />
          <Route path="logs" element={<OperationLogs />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
